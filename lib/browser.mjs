import {createRequire} from 'node:module';
import {existsSync} from 'node:fs';
import {hash,publicURL,assert} from './core.mjs';
import {isInternalAnswer} from './answer-policy.mjs';
const require=createRequire(import.meta.url);
let chromium;
({chromium}=require('playwright'));
export async function browserSession({allowTest=false,headless=true,recordDir,networkAuthorized=false,controlOverlay=false}={}) {
 const browser=await chromium.launch({headless,...(existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')?{channel:'chrome'}:{}),args:headless?[]:['--window-size=1320,980']});
 const context=await browser.newContext({viewport:{width:1280,height:900},serviceWorkers:'block',acceptDownloads:false,...(recordDir?{recordVideo:{dir:recordDir,size:{width:1280,height:900}}}:{})});
 if(recordDir&&!controlOverlay)await context.addInitScript(()=>{
  // Make pointer movement and clicks visible in the saved browser recording.
  const start=()=>{const marker=document.createElement('div');marker.setAttribute('aria-hidden','true');marker.style.cssText='position:fixed;width:16px;height:16px;border:2px solid #fff;border-radius:50%;background:#0008;box-shadow:0 0 0 1px #000;pointer-events:none;z-index:2147483647;display:none;transform:translate(-50%,-50%)';document.documentElement.append(marker);
   addEventListener('pointermove',e=>{marker.style.display='block';marker.style.left=e.clientX+'px';marker.style.top=e.clientY+'px';},true);
   addEventListener('pointerdown',()=>{marker.style.background='#fff';marker.style.width=marker.style.height='26px';setTimeout(()=>{marker.style.background='#0008';marker.style.width=marker.style.height='16px';},450);},true);
  };document.readyState==='loading'?addEventListener('DOMContentLoaded',start,{once:true}):start();
 });
 const gate={approved:networkAuthorized,dispatched:false}, checked=new Map();
 await context.route('**/*',async route=>{
  const req=route.request(),url=req.url();
  try{
   if(!/^https?:/.test(url))return route.abort();
   const u=new URL(url);const key=u.origin;
   if(!checked.has(key)){await publicURL(url,{allowTest});checked.set(key,true);}
   if(!gate.approved&&!['GET','HEAD','OPTIONS'].includes(req.method()))return route.abort();
   if(gate.approved&&!['GET','HEAD','OPTIONS'].includes(req.method()))gate.dispatched=true;
   await route.continue();
  }catch{await route.abort().catch(()=>{});}
 });
 await context.routeWebSocket('**/*',ws=>ws.close());
 const page=await context.newPage();page.setDefaultTimeout(12000);page.on('dialog',d=>d.dismiss());
 return {browser,context,page,gate};
}
export async function snapshot(page){
 return page.evaluate(()=>{
  const visible=e=>e.getBoundingClientRect().width>0&&e.getBoundingClientRect().height>0;
  const forms=[...document.forms].map((form,index)=>{
   const all=[...form.querySelectorAll('input,textarea,select')];
   const fields=all.map((el,i)=>{
    const type=el.type||el.tagName.toLowerCase();if(['hidden','submit','button','reset'].includes(type)||el.disabled||(!visible(el)&&type!=='file'))return null;
    const label=([...(el.labels||[])].map(l=>l.innerText).join(' ')||el.getAttribute('aria-label')||el.placeholder||el.name||el.id||type).replace(/\s+/g,' ').trim().slice(0,700);
    return {key:'f'+i,index:i,name:el.name,type,label,required:el.required||el.getAttribute('aria-required')==='true'||label.includes('*'),accept:el.accept||'',options:el.tagName==='SELECT'?[...el.options].map(o=>({value:o.value,label:o.text})):[],multiple:!!el.multiple};
   }).filter(Boolean);
   const buttons=[...form.querySelectorAll('button,input[type=submit]')].map((b,i)=>({index:i,text:(b.innerText||b.value||'').trim(),type:b.type,visible:visible(b)})).filter(b=>b.visible&&(/submit|send application|apply|ansøg|ansog/i.test(b.text)||b.type==='submit'));
   const eligible=fields.some(f=>f.type==='email'||/email|e-mail/i.test(f.label))&&fields.some(f=>f.type==='file');
   const unsupported=!!form.querySelector('[role=combobox], [contenteditable=true]')||fields.some(f=>f.multiple||f.type==='radio'||f.type==='password');
   return {index,fields,buttons,eligible,unsupported,action:form.action,method:form.method};
  });
  const form=forms.find(f=>f.eligible)||null;
  const captcha=[...document.querySelectorAll('iframe, [class*=captcha], [id*=captcha]')].some(e=>visible(e)&&/captcha|challenge/i.test([e.src,e.id,e.className].join(' ')));
  const text=document.body.innerText.slice(0,35000);
  const expired=/this (job|position|role) (is no longer|has been filled)|no longer accepting applications|job (not found|closed)|stillingen er besat/i.test(text);
  const reason=expired?'This posting appears closed.':captcha?'CAPTCHA requires manual completion.':!form?'No supported application form on this page. Use the application link or open the site manually.':form.unsupported?'This form uses custom controls. Complete it on the employer site.':form.buttons.length!==1?'A unique final submit button could not be identified.':null;
  const links=[...document.querySelectorAll('a[href]')].filter(a=>/apply|ansøg|ansog/i.test(a.innerText)).map(a=>({text:a.innerText.trim().slice(0,100),url:a.href})).filter(a=>/^https?:/.test(a.url)).slice(0,8);
  return {title:document.title,text,form,captcha,expired,supported:!reason,reason,links,url:location.href};
 });
}
export function fingerprint(s){return hash({url:s.url,form:s.form,reason:s.reason});}
export async function capture(url,file,options={}){
 await publicURL(url,options);const s=await browserSession(options);
 try{
  const response=await s.page.goto(url,{waitUntil:'domcontentloaded',timeout:45000});
  assert(!response||response.status()<400,`The job page returned HTTP ${response?.status()}.`);
  await s.page.waitForTimeout(1800);const snap=await snapshot(s.page);
  await s.page.screenshot({path:file,type:'jpeg',quality:78,fullPage:false});
  return {...snap,fingerprint:fingerprint(snap),capturedAt:new Date().toISOString()};
 }finally{await s.browser.close();}
}
export function proposedAnswers(snapshot,profile,includeLetter=true,applicationSource=''){
 const answers={};
 for(const f of snapshot.form?.fields||[]){
  const l=(f.label+' '+f.name).toLowerCase();let value='';
  if(f.type==='file'){if(/cover|application letter|ansøgning/.test(l))value=includeLetter?'@letter':'';else if(/resume|cv|curriculum/.test(l))value='@cv';}
  else if(f.type==='checkbox')value=false;
  else if(/\b(valid\s+)?work permit\b.*\b(eu|european union)\b|\b(eu|european union)\b.*\bwork (?:permit|authori[sz]ation)\b/i.test(l)&&profile.euWorkPermission===true)value=optionAnswer(f,'Yes');
  else if(/\benglish\b.*\b(proficien|language|skill|level)|\b(proficien|fluen)\w*.*\benglish\b/i.test(l)&&profile.englishProficiency)value=optionAnswer(f,profile.englishProficiency);
  else if(/not living in copenhagen.*relocat/i.test(l)&&/copenhagen|københavn/i.test(profile.location||'')&&f.type==='text')value='I already live in Copenhagen.';
  else if(/where.*hear about|how.*hear about/i.test(l)&&['greenhouse','lever','ashby'].includes(applicationSource))value=optionAnswer(f,'Job Board');
  else if(/\b(based|located|live|reside)\b.*\b(copenhagen|københavn)\b/i.test(l)&&/copenhagen|københavn/i.test(profile.location||''))value=optionAnswer(f,'Yes');
  else if(/current company|current employer/i.test(l)&&profile.currentCompany)value=optionAnswer(f,profile.currentCompany);
  else if(/(?:years.*consulting|consulting.*years)/i.test(l)&&profile.consultingYears!==undefined)value=optionAnswer(f,String(profile.consultingYears));
  else if((/^country\W/i.test(l)||/^(?:country|country[-_]code)$/i.test(f.name||'')||f.autocomplete==='country-name')&&!/citizen|nationality|birth|visa|authori[sz]/i.test(l)){
   const country=profile.country||(profile.location?.includes(',')?profile.location.split(',').at(-1).trim():'');
   if(country)value=optionAnswer(f,country);
  }
  else if(/postal.?code|post.?code|zip(?:.?code)?\b|postnummer/i.test(l)||f.autocomplete==='postal-code')value=profile.postalCode||'';
  else if(/address(?:[ _-]?line)?[ _-]?2|apartment|\bunit\b/i.test(l)||f.autocomplete==='address-line2')value=profile.addressLine2||'';
  else if(/address(?:[ _-]?line)?[ _-]?1/i.test(l)||f.autocomplete==='address-line1')value=profile.addressLine1||'';
  else if((/street|home address|residential address|^address\b|^adresse\b/i.test(l)||f.autocomplete==='street-address')&&!/e.?mail|web.?site|linkedin|github|company|employer/i.test(l))value=profile.streetAddress||'';
  else if(/district|borough/i.test(l))value=profile.district||'';
  else if(f.type==='select-one')value='';
  else if(/first.?name|given.?name|fornavn/.test(l))value=profile.firstName;
  else if(/last.?name|surname|family.?name|efternavn/.test(l))value=profile.lastName;
  else if(/full.?name|^name |^name$/.test(l))value=profile.name;
  else if(f.type==='email'||/e.?mail/.test(l))value=profile.email;
  else if(/phone|mobile|telefon/.test(l))value=profile.phone;
  else if(/github/.test(l))value=profile.github;
  else if(/linkedin/.test(l))value=profile.linkedin||'';
  else if(/salary|compensation|løn/.test(l))value=salaryAnswer(f,profile);
  else if(/start date|availability|notice period/.test(l))value=profile.availability;
  else if((/current location|\bcity\b|^location\b/.test(l)||f.autocomplete==='address-level2')&&!/^are |^do |^will /i.test(l))value=f.kind==='combobox'?profile.location:(profile.city||profile.location);
  answers[f.key]=value;
 }return answers;
}
function optionAnswer(field,value){
 if(field.type==='select-one'||field.kind==='radio')return field.options?.find(o=>o.label.trim().toLowerCase()===value.toLowerCase())?.value||'';
 return value;
}
export function salaryAnswer(f,profile){
 const l=(f.label+' '+(f.name||'')).toLowerCase();
 const monthly=/month|monthly|måned|maaned/.test(l),annual=/annual|year|yearly|årlig|aarlig|per år/.test(l);
 if(/hour|hourly|timebetaling/.test(l))return '';
 if(!monthly&&!annual)return f.type==='number'?'':profile.salary;
 const value=monthly?profile.salaryMonthly:profile.salaryAnnual;if(!Number.isFinite(value))return '';
 return f.type==='number'||/amount|numeric|tal|\bdkk\b/.test(l)?String(value):`DKK ${Number(value).toLocaleString('en-US')} ${monthly?'per month':'per year'}, excluding employer pension and bonus; negotiable.`;
}
export function validateAnswers(snap,answers,includeLetter){
 assert(snap.supported,snap.reason||'Unsupported application form.');
 for(const f of snap.form.fields){
  const v=answers[f.key];
  assert(!f.required || (f.type==='checkbox'?v===true:typeof v==='string'&&v.trim()!==''),`Answer required: ${f.label}`);
  if(!v)continue;
  assert(!isInternalAnswer(v),`An internal status cannot be sent as an answer: ${f.label}`);
  if(f.type==='checkbox')assert(typeof v==='boolean','Checkbox answers must be true or false.');
  else assert(typeof v==='string'&&v.length<=10000,'Invalid form answer.');
  if(f.type==='file')assert(v==='@cv'||(v==='@letter'&&includeLetter),'Choose a prepared attachment.');
  if(f.type==='select-one')assert(f.options.some(o=>o.value===v),`Choose a valid option: ${f.label}`);
 }
}
export async function dispatch({job,draft,artifacts,afterFile,allowTest=false,onDispatch=()=>{}}){
 // Only the service's reviewed-revision approval path may call this function.
 const s=await browserSession({allowTest});let attempted=false;
 try{
  await s.page.goto(draft.snapshot.url,{waitUntil:'domcontentloaded',timeout:45000});await s.page.waitForTimeout(1800);
  const fresh=await snapshot(s.page);
  assert(fingerprint(fresh)===draft.snapshot.fingerprint,'The application form changed. Inspect and review it again before approving.',409);
  validateAnswers(fresh,draft.answers,draft.includeLetter);
  // FIRST possible exposure of any candidate data is AFTER the persisted approval.
  s.gate.approved=true;attempted=true;onDispatch();
  const form=s.page.locator('form').nth(fresh.form.index), controls=form.locator('input,textarea,select');
  for(const f of fresh.form.fields){
   const v=draft.answers[f.key],el=controls.nth(f.index);if(!v&&f.type!=='checkbox')continue;
   if(f.type==='file')await el.setInputFiles(v==='@cv'?artifacts.cv:artifacts.letter);
   else if(f.type==='checkbox')await el.setChecked(!!v);
   else if(f.type==='select-one')await el.selectOption(v);
   else await el.fill(v);
  }
  const valid=await form.evaluate(e=>e.checkValidity());assert(valid,'The employer form rejected an answer. Check the site manually; do not retry automatically.');
  const button=form.locator('button,input[type=submit]').nth(fresh.form.buttons[0].index);
  await button.click({timeout:15000});await s.page.waitForTimeout(3500);
  const body=await s.page.locator('body').innerText();
  await s.page.screenshot({path:afterFile,type:'jpeg',quality:80,fullPage:false});
  const confirmed=/thank you for (applying|your application)|application (has been |was )?(successfully )?(submitted|received)|we.have received your application|tak for din ansøgning/i.test(body);
  return {status:confirmed?'submitted':'uncertain',url:s.page.url(),note:confirmed?'Employer confirmation detected.':'Submission outcome is uncertain. Check the employer site or confirmation email. Automatic retries are blocked.',receiptText:body.slice(0,3000)};
 }catch(e){e.attempted=attempted||s.gate.dispatched;throw e;}finally{await s.browser.close();}
}
