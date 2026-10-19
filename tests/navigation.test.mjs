import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {Navigator,observe,canInfer,jobDetails} from '../lib/navigator.mjs';
import {salaryAnswer,proposedAnswers} from '../lib/browser.mjs';
import {hash} from '../lib/core.mjs';

async function fixture(t,html){
 const dir=await mkdtemp(path.join(os.tmpdir(),'job-desk-nav-'));let requests=[];
 const server=http.createServer(async(req,res)=>{let body='';for await(const part of req)body+=part;if(req.method==='POST')requests.push({url:req.url,body});res.setHeader('Content-Type','text/html');res.end(typeof html==='function'?html(req):html);});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 t.after(async()=>{await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});});
 const url=`http://127.0.0.1:${server.address().port}`;return {dir,url,requests};
}
async function prepared(n,dir,answers={}){
 const cv=path.join(dir,'CV.pdf');await writeFile(cv,'%PDF fixture CV');
 const o=await observe(n.page);return {snapshot:o.snapshot,answers,includeLetter:false,revision:1,artifacts:{cv,letter:null,hashes:{cv:hash(await readFile(cv)),letter:null}}};
}
const profile={name:'Fixture Person',firstName:'Fixture',lastName:'Person',email:'fixture@example.test',salaryAnnual:720000,salaryMonthly:60000,salary:'DKK 720,000 annually / DKK 60,000 monthly',facts:[{id:'pbrain',text:'Python MRI data pipelines.'}],unknowns:[]};

test('each browser attempt saves a playable recording and timestamped thoughts and actions',async t=>{
 const f=await fixture(t,'<h1>Recording fixture</h1><button>Apply now</button><div style="height:1800px">Scroll content</div>');
 const events=[];const n=new Navigator({dir:f.dir,allowTest:true,headless:true,onEvent:(action,detail)=>events.push({action,detail})});
 t.after(()=>n.close());await n.open(f.url);n.update('running','Scrolling the application');
 await n.page.mouse.move(150,150);await n.page.mouse.wheel(0,550);await n.page.waitForTimeout(600);
 n.recordingReasoning=[{id:'fixture',thinking:'Fixture model reasoning',done:true}];
 await n.close();await n.close();
 const saved=events.filter(e=>e.action==='recording_saved');assert.equal(saved.length,1);assert.equal(saved[0].detail.seekable,true);
 const bytes=await readFile(path.join(f.dir,saved[0].detail.file));assert.ok(bytes.length>1000);assert.equal(bytes.subarray(0,4).toString('hex'),'1a45dfa3');
 const transcript=events.find(e=>e.action==='recording_transcript_saved');assert.ok(transcript);
 const log=JSON.parse(await readFile(path.join(f.dir,transcript.detail.file)));assert.equal(log.activity[0].message,'Scrolling the application');assert.equal(log.reasoning[0].thinking,'Fixture model reasoning');
});

test('salary respects monthly and annual fields; ambiguous numeric units stay blank',()=>{
 assert.equal(salaryAnswer({label:'Annual salary (DKK)',type:'number'},profile),'720000');
 assert.equal(salaryAnswer({label:'Monthly salary DKK',type:'text'},profile),'60000');
 assert.equal(salaryAnswer({label:'Salary',type:'number'},profile),'');
 assert.equal(salaryAnswer({label:'Salary expectations',type:'text'},profile),profile.salary);
 assert.equal(salaryAnswer({label:'Hourly compensation',type:'number'},profile),'');
});
test('an authorized automatic visit allows form initialization without entering applicant data during inspection',async t=>{
 const f=await fixture(t,'<label>Email<input type=email name=email></label><script>fetch("/initialize",{method:"POST",body:"initialize-form"})</script>');
 const n=new Navigator({dir:f.dir,allowTest:true,headless:true,profile});n.networkAuthorized=true;t.after(()=>n.close());await n.open(f.url);
 assert.equal(f.requests.length,1);assert.equal(f.requests[0].body,'initialize-form');assert.equal(n.exposed,false);
 const o=await observe(n.page);await assert.rejects(n.fill(o.targets.get(o.controls.find(c=>c.type==='email').target)),/manual approval/);
 assert.equal(await n.page.locator('input').inputValue(),'');
});
test('requested location and employment answers use established profile values and exact options',()=>{
 const fields=[{key:'location',type:'text',kind:'combobox',label:'Are you based in Copenhagen or the surrounding area?'},{key:'current',type:'text',label:'Current company'},{key:'years',type:'select-one',label:'How many years of consulting experience do you have?',options:[{label:'0',value:'zero'},{label:'3',value:'three'}]},{key:'place',type:'select-one',label:'Are you based in Copenhagen?',options:[{label:'Yes',value:'yes-value'},{label:'No',value:'no-value'}]}];
 assert.deepEqual(proposedAnswers({form:{fields}},{...profile,location:'Copenhagen, Denmark'}),{location:'Yes',current:'',years:'',place:'yes-value'});
 const supplied=proposedAnswers({form:{fields}},{...profile,location:'Copenhagen, Denmark',currentCompany:'Independent',consultingYears:0});assert.equal(supplied.current,'Independent');assert.equal(supplied.years,'zero');
});
test('CV inference never supplies consent, eligibility or unestablished personal details',()=>{
 for(const label of ['Work authorisation experience','Visa sponsorship','Do you agree to privacy terms?','Disability experience','Salary per month','Fluent Danish experience'])assert.equal(canInfer({type:'text',label,name:''}),false);
 assert.equal(canInfer({type:'text',label:'Describe your Python experience',name:''}),true);
});
test('job address and deadline use source evidence; absent postcodes are never guessed',()=>{
 const d=jobDetails([{'@type':'JobPosting',title:'AI Engineer',validThrough:'2026-12-01',jobLocation:{address:{streetAddress:'Example Street 4',postalCode:'2100',addressLocality:'Copenhagen'}}}],'','https://example.com');
 assert.equal(d.postcode,'2100');assert.equal(d.address,'Example Street 4');assert.equal(d.deadline,'2026-12-01');
 assert.equal(jobDetails([],'Copenhagen, Denmark').postcode,null);
});
test('vision flow follows links and iframes, fills approved files and controls, then requires final approval',async t=>{
 const f=await fixture(t,req=>{
  if(req.url==='/')return `<h1>AI Engineer</h1><a href='/apply'>Apply now</a><script>fetch('/tracking',{method:'POST'}).catch(()=>{});</script>`;
  if(req.url==='/apply')return `<h1>Application</h1><iframe style='width:100%;height:700px' src='/form'></iframe>`;
  if(req.url==='/form')return `<form action='/submit' method='post'><section id='one'><label>Email<input type=email name=email required></label><label>Resume<input type=file name=resume required></label><label>Monthly salary DKK<input type=number name=salary required></label><button type=button onclick="document.querySelector('#one').hidden=true;document.querySelector('#two').hidden=false">Next</button></section><section id='two' hidden><label>Python experience<textarea name=skills required></textarea></label><label>Highest degree<input role=combobox aria-expanded=false aria-controls=opts name=degree></label><div id=opts role=listbox hidden><div role=option onclick="document.querySelector('[role=combobox]').value='PhD';document.querySelector('#opts').hidden=true">PhD</div></div><button type=submit>Submit application</button></section></form><script>document.querySelector('[role=combobox]').onclick=()=>document.querySelector('#opts').hidden=false;document.querySelector('[name=email]').oninput=e=>fetch('/autosave',{method:'POST',body:e.target.value});</script>`;
  return 'Thank you for your application';
 });
 const actions=[];
 const n=new Navigator({dir:f.dir,allowTest:true,headless:true,profile,decide:async({observation,phase})=>{
  const cs=observation.controls;let c;
  if(phase==='inspect'){c=cs.find(c=>c.label==='Apply now');actions.push('apply');return {action:'click',target:c.target};}
  c=cs.find(c=>c.kind==='combobox'&&c.pending);if(c){actions.push('combobox');return {action:'fill',target:c.target};}
  c=cs.find(c=>c.label==='Next');if(c){actions.push('next');return {action:'click',target:c.target};}
  c=cs.find(c=>c.label==='Submit application');return {action:'final',target:c.target};
 },infer:async({field})=>({value:/degree/.test(field.label)?'PhD':'I develop Python MRI pipelines.',evidenceIds:['pbrain'],reason:'CV project evidence'})});
 t.after(()=>n.close());await n.open(f.url);await n.inspect();assert.equal(n.state.status,'review');assert.equal(f.requests.length,0);
 const d=await prepared(n,f.dir);await n.approve(d);
 assert.equal(n.state.status,'final_review',n.state.message);assert.ok(actions.includes('apply')&&actions.includes('next'));assert.ok(!actions.includes('combobox'),'Known dropdown values should not require a vision decision');
 const frame=n.page.frames().find(f=>f.url().endsWith('/form'));
 assert.equal(await frame.locator('[name=salary]').inputValue(),'60000');assert.equal(await frame.locator('[name=email]').inputValue(),profile.email);
 assert.equal(await frame.locator('[name=resume]').evaluate(e=>e.files[0].name),'CV.pdf');
 assert.equal(f.requests.filter(r=>r.url==='/submit').length,0);assert.ok(f.requests.some(r=>r.url==='/autosave'));
 await assert.rejects(n.finalSubmit('wrong'),/Approve/);await n.finalSubmit(n.final.key);
 assert.equal(n.state.status,'submitted');assert.equal(f.requests.filter(r=>r.url==='/submit').length,1);
 await assert.rejects(n.finalSubmit(n.final.key));
});
test('a model cannot fill before approval or click final submit through a navigation action',async t=>{
 const f=await fixture(t,'<label>Email<input type=email></label><button>Submit application</button>');
 const n=new Navigator({dir:f.dir,allowTest:true,headless:true,profile,decide:async({observation})=>({action:'click',target:observation.controls.find(c=>c.label==='Submit application').target})});t.after(()=>n.close());await n.open(f.url);await n.inspect();
 const o=await observe(n.page);await assert.rejects(n.fill(o.targets.get(o.controls.find(c=>c.type==='email').target)),/manual approval/);
 await n.approve(await prepared(n,f.dir));assert.equal(n.state.status,'paused');assert.equal(f.requests.length,0);
});
test('a shifted DOM index is resolved to the same observed button, never the new occupant',async t=>{
 const f=await fixture(t,req=>req.method==='POST'?'Thank you for your application':'<form method=post action=/send><input id=transient type=hidden><label>Email<input type=email name=email required></label><label>Years of consulting experience<input name=years required></label><button type=submit>Submit application</button></form>');
 let decisions=0;
 const n=new Navigator({dir:f.dir,allowTest:true,headless:true,profile:{...profile,consultingYears:0},decide:async({observation})=>{
  decisions++;const target=observation.controls.find(c=>c.type==='submit').target;
  assert.equal(observation.controls.find(c=>c.name==='years').invalid,false);
  await n.page.locator('#transient').evaluate(e=>e.remove());return {action:'final',target,reason:'All answers are complete.'};
 }});t.after(()=>n.close());await n.open(f.url);await n.inspect();await n.approve(await prepared(n,f.dir));
 assert.equal(n.state.status,'final_review',n.state.message);assert.equal(decisions,1);assert.equal(await n.page.locator('[name=years]').inputValue(),'0');assert.equal(f.requests.length,0);
 await n.finalSubmit(n.final.key);assert.equal(n.state.status,'submitted');assert.equal(f.requests.length,1);
});
test('a required letter discovered on a later step pauses before uploading it',async t=>{
 const f=await fixture(t,`<label>Email<input type=email></label><label>Cover letter<input type=file required></label><button>Submit application</button>`);
 const n=new Navigator({dir:f.dir,allowTest:true,headless:true,profile,decide:async()=>{throw new Error('Must pause first');}});t.after(()=>n.close());await n.open(f.url);await n.inspect();await n.approve(await prepared(n,f.dir));assert.equal(n.state.status,'needs_document');assert.equal(f.requests.length,0);
});
test('unknown eligibility asks the user and cannot be guessed from the CV',async t=>{
 const f=await fixture(t,'<label>Email<input type=email></label><label>Work authorisation<input name=permission required></label>');let called=false;
 const n=new Navigator({dir:f.dir,allowTest:true,headless:true,profile,infer:async()=>{called=true;},decide:async()=>({action:'human'})});t.after(()=>n.close());await n.open(f.url);await n.inspect();await n.approve(await prepared(n,f.dir));assert.equal(n.state.status,'needs_answer');assert.equal(called,false);
});
test('changed attachment and changed final page both invalidate approval',async t=>{
 const f=await fixture(t,'<form><label>Email<input type=email></label><button type=submit>Submit application</button></form>');
 const n=new Navigator({dir:f.dir,allowTest:true,headless:true,profile,decide:async({observation})=>({action:'final',target:observation.controls.find(c=>c.type==='submit').target})});t.after(()=>n.close());await n.open(f.url);await n.inspect();const d=await prepared(n,f.dir);await n.approve(d);assert.equal(n.state.status,'final_review');
 await n.page.locator('input').fill('changed@example.test');await assert.rejects(n.finalSubmit(n.final.key),/changed after review/);
 await n.page.locator('input').fill(profile.email);await writeFile(d.artifacts.cv,'modified');await assert.rejects(n.finalSubmit(n.final.key),/attachment changed/);assert.equal(f.requests.length,0);
});

test('custom upload groups expose required CV/letter labels and skip invisible validation inputs',async t=>{
 const f=await fixture(t,`<label>Country*<input role=combobox name=country aria-required=true></label><input required aria-hidden=true style="opacity:0;width:1px;height:1px"><div><h3>Resume/CV *</h3><div><label>Attach<input type=file name=resume hidden></label></div></div><div><h3>Cover Letter *</h3><div><label>Attach<input type=file name=cover_letter hidden></label></div></div><div role=listbox hidden><div role=option onclick="document.querySelector('[role=combobox]').value='Denmark (+45)';this.parentNode.hidden=true">Denmark (+45)</div></div><script>document.querySelector('[role=combobox]').onclick=()=>document.querySelector('[role=listbox]').hidden=false;</script>`);
 const n=new Navigator({dir:f.dir,allowTest:true,headless:true,profile:{...profile,location:'Copenhagen, Denmark'},decide:async()=>({action:'human'})});t.after(()=>n.close());await n.open(f.url);
 const o=await observe(n.page),fields=o.snapshot.form.fields;
 assert.equal(fields.length,3);assert.equal(fields.find(f=>f.name==='resume').label,'Resume/CV *');assert.equal(fields.find(f=>f.name==='cover_letter').required,true);
 n.state.phase='fill';n.s.gate.approved=true;
 const country=o.controls.find(f=>f.name==='country');assert.equal(n.fieldAnswer(country),'Denmark');await n.fill(o.targets.get(country.target));
 assert.equal(await n.page.locator('[name=country]').inputValue(),'Denmark (+45)');
});

test('city suggestions receive keyboard events and choose Denmark rather than a namesake city',async t=>{
 const f=await fixture(t,`<label>Location (City)*<input id=city role=combobox name=city aria-required=true></label><div id=options role=listbox hidden><div role=option onclick="city.value=this.textContent;options.hidden=true">Copenhagen, Capital, Denmark</div><div role=option onclick="city.value=this.textContent;options.hidden=true">Copenhagen, New York, United States</div></div><script>city.addEventListener('keyup',()=>{options.hidden=city.value!=='Copenhagen'});</script>`);
 const n=new Navigator({dir:f.dir,allowTest:true,headless:true,profile:{...profile,location:'Copenhagen, Denmark'}});t.after(()=>n.close());await n.open(f.url);
 const o=await observe(n.page),city=o.controls.find(c=>c.name==='city');n.state.phase='fill';n.s.gate.approved=true;
 await n.fill(o.targets.get(city.target));assert.equal(await n.page.locator('#city').inputValue(),'Copenhagen, Capital, Denmark');
});

test('country, phone and city fill without vision deliberation even inside a shared Phone group',async t=>{
 const f=await fixture(t,`<form><label>Email<input type=email name=email required></label><div><div class=application-label>Phone</div><div class=application-field><label for=country>Country*</label><input id=country role=combobox name=country aria-required=true><div id=countries role=listbox hidden><div role=option onclick="country.value='Denmark (+45)';countries.hidden=true">Denmark (+45)</div><div role=option>Germany (+49)</div></div><label for=phone>Phone*</label><input id=phone name=phone type=tel required></div></div><label>Location (City)*<input id=city role=combobox name=candidate-location aria-required=true></label><div id=cities role=listbox hidden><div role=option onclick="city.value=this.textContent;cities.hidden=true">Copenhagen, Capital, Denmark</div><div role=option>Copenhagen, New York, United States</div></div><button type=submit>Submit application</button></form><script>country.onkeyup=()=>{countries.hidden=country.value!=='Denmark'};city.onkeyup=()=>{cities.hidden=city.value!=='Copenhagen'};</script>`);
 let decisions=0;
 const n=new Navigator({dir:f.dir,allowTest:true,headless:true,profile:{...profile,phone:'+45 00 00 00 00',location:'Copenhagen, Denmark',city:'Copenhagen',country:'Denmark'},decide:async({observation})=>{decisions++;assert.equal(observation.controls.filter(c=>c.isField&&c.pending).length,0);return {action:'final',target:observation.controls.find(c=>c.type==='submit').target};}});
 t.after(()=>n.close());await n.open(f.url);await n.inspect();const o=await observe(n.page);
 assert.equal(o.controls.find(c=>c.name==='country').label,'Country*');
 await n.approve(await prepared(n,f.dir));
 assert.equal(n.state.status,'final_review',n.state.message);assert.equal(decisions,1);
 assert.equal(await n.page.locator('#country').inputValue(),'Denmark (+45)');assert.equal(await n.page.locator('#phone').inputValue(),'+45 00 00 00 00');assert.equal(await n.page.locator('#city').inputValue(),'Copenhagen, Capital, Denmark');assert.equal(f.requests.length,0);
});

test('address components stay distinct and misleading Phone labels do not override country identity',()=>{
 const p={...profile,city:'Copenhagen',country:'Denmark',location:'Copenhagen, Denmark',postalCode:'2100',addressLine1:'Example Street 12',addressLine2:'2. 4',streetAddress:'Example Street 12, 2. 4',district:'København Ø'};
 const fields=[{key:'country',kind:'combobox',type:'combobox',label:'Phone',name:'country'},{key:'city',type:'text',label:'City'},{key:'location',type:'text',label:'Location'},{key:'post',type:'text',label:'Postcode'},{key:'line1',type:'text',label:'Address line 1'},{key:'line2',type:'text',label:'Address line 2'},{key:'street',type:'text',label:'Street address'},{key:'email',type:'email',label:'Email address'},{key:'birth',type:'text',label:'Country of birth',name:'country'}];
 assert.deepEqual(proposedAnswers({form:{fields}},p),{country:'Denmark',city:'Copenhagen',location:'Copenhagen',post:'2100',line1:'Example Street 12',line2:'2. 4',street:'Example Street 12, 2. 4',email:profile.email,birth:''});
});

test('internal missing-information status can never be typed into an employer field',async t=>{
 const f=await fixture(t,'<label>Location<input name=city required></label>');
 const n=new Navigator({dir:f.dir,allowTest:true,headless:true,profile});t.after(()=>n.close());await n.open(f.url);const o=await observe(n.page),field=o.controls[0];n.answers[field.key]='human missing information';n.state.phase='fill';n.s.gate.approved=true;
 await assert.rejects(n.fill(o.targets.get(field.target)),/internal status/);assert.equal(await n.page.locator('input').inputValue(),'');assert.equal(f.requests.length,0);
});

test('confirmed personal answers are scoped to English and EU work permission',()=>{
 const fields=[{key:'eu',label:'Do you have a valid work permit in the EU?',type:'select-one',options:[{value:'y',label:'Yes'},{value:'n',label:'No'}]},{key:'english',label:'How would you rate your English language skills?',type:'select-one',options:[{value:'native',label:'Native'},{value:'fluent',label:'Fluent'}]},{key:'us',label:'Do you have a valid work permit in the US?',type:'text'},{key:'danish',label:'Danish language proficiency',type:'text'},{key:'consent',label:'Yes, contact me about future jobs',type:'checkbox'}];
 assert.deepEqual(proposedAnswers({form:{fields}},profile),{eu:'',english:'',us:'',danish:'',consent:false});
 assert.deepEqual(proposedAnswers({form:{fields}},{...profile,englishProficiency:'Native',euWorkPermission:true}),{eu:'y',english:'native',us:'',danish:'',consent:false});
});

test('email verification stays open and completes the same submission without replay',async t=>{
 const code='12893467';let phase=0;
 const f=await fixture(t,req=>{if(req.method==='POST')phase++;if(phase===2)return 'Thank you for your application';if(phase===1)return `<p>A verification code was sent to fixture@example.test. Enter the security code.</p><form action=/verify method=post><label>Security code<input name=verification-code autocomplete=one-time-code maxlength=8 required></label><button>Verify code</button></form>`;return '<form action=/send method=post><label>Email<input type=email name=email required></label><label>Resume<input type=file name=cv></label><button>Submit application</button></form>';});
 const events=[];const n=new Navigator({dir:f.dir,allowTest:true,headless:true,profile,onEvent:(action,detail)=>events.push({action,detail}),decide:async({observation})=>({action:'final',target:observation.controls.find(c=>c.label==='Submit application').target})});t.after(()=>n.close());await n.open(f.url);await n.inspect();await n.approve(await prepared(n,f.dir));await n.finalSubmit(n.final.key);assert.equal(n.state.status,'verification');assert.equal(n.closed,false);assert.equal(f.requests.length,1);await assert.rejects(n.finalSubmit(n.final.key),/once/);n.lookupEmailCode=async()=>({code});await n.waitForReceipt();assert.equal(n.state.status,'submitted');assert.equal(f.requests.length,2);assert.equal(f.requests[1].url,'/verify');assert.equal(events.filter(e=>e.action==='final_submit_started').length,1);assert.ok(!JSON.stringify(events).includes(code));
});

test('verification before final submission uses Gmail without asking the model to invent a code',async t=>{
 const code='12345678';let verified=false;
 const f=await fixture(t,req=>{
  if(req.url==='/verify'){verified=true;return '<h1>Application</h1><form action=/send method=post><button>Submit application</button></form>';}
  if(req.url==='/send')return 'We have received your application';
  return `<label>Email<input type=email name=email></label><button id=next onclick="document.body.innerHTML='<p>We sent a security code to your email.</p><form action=/verify method=post><label>Security code<input name=otp autocomplete=one-time-code></label><button>Verify code</button></form>'">Next</button>`;
 });
 const n=new Navigator({dir:f.dir,allowTest:true,headless:true,profile,decide:async({observation})=>{const next=observation.controls.find(c=>c.label==='Next'),button=next||observation.controls.find(c=>c.label==='Submit application');assert.ok(button,'Code field must be handled outside the model');return {action:next?'click':'final',target:button.target};}});
 n.lookupEmailCode=async request=>{assert.equal(request.challengeBound,true);return {code};};t.after(()=>n.close());
 await n.open(f.url);await n.inspect();await n.approve(await prepared(n,f.dir));assert.equal(verified,true);assert.equal(n.state.status,'final_review',n.state.message);assert.equal(f.requests.filter(r=>r.url==='/send').length,0);
 await n.finalSubmit(n.final.key);assert.equal(n.state.status,'submitted');assert.equal(f.requests.filter(r=>r.url==='/send').length,1);
});
test('a preliminary thank-you with an email challenge cannot count as successful submission',async t=>{
 const f=await fixture(t,req=>req.method==='POST'?'<p>Thank you for applying. Please verify your email. Check your inbox: fixture@example.test</p>':'<form action=/send method=post><label>Email<input type=email></label><button>Submit application</button></form>');
 const n=new Navigator({dir:f.dir,allowTest:true,headless:true,profile,decide:async({observation})=>({action:'final',target:observation.controls.find(c=>c.label==='Submit application').target})});t.after(()=>n.close());
 await n.open(f.url);await n.inspect();await n.approve(await prepared(n,f.dir));await n.finalSubmit(n.final.key);assert.equal(n.state.status,'verification');assert.equal(n.state.verification.kind,'email_link');assert.equal(n.closed,false);assert.equal(f.requests.length,1);
});

test('verification codes cannot be forwarded to a different application origin',async()=>{
 const n=new Navigator({dir:os.tmpdir(),profile});n.initialOrigin='https://job-boards.greenhouse.io';n.exposed=true;
 n.lookupEmailCode=async()=>{throw Error('Mailbox must not be accessed for an unapproved destination');};
 const paused=await n.handleVerification({snapshot:{url:'https://other.example/verify',text:'Security code sent to fixture@example.test'},controls:[{isField:true,key:'otp',name:'otp',label:'Security code',autocomplete:'one-time-code'}]});
 assert.equal(paused,true);assert.equal(n.state.status,'verification');assert.match(n.state.message,/changed destination/);
});
