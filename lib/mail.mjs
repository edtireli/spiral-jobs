import {paintBrowserControl} from './browser-control.mjs';
import path from 'node:path';
import {mkdir,chmod} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {assert} from './core.mjs';
const require=createRequire(import.meta.url);
const {chromium}=require('playwright');
const domainOf=email=>String(email).toLowerCase().split('@').at(-1);
export function mailPolicy(job,recipient,since){
 const host=new URL(job.url).hostname;
 const domains=host==='job-boards.greenhouse.io'||host.endsWith('.greenhouse.io')?['greenhouse.io']:host==='jobs.lever.co'?['lever.co']:host==='jobs.ashbyhq.com'?['ashbyhq.com']:[];
 assert(domains.length,'Automatic email verification is not supported for this application host.');
 assert(/^[^\s<>"(){}]+@[^\s<>"(){}]+$/.test(recipient),'Set your application email first.');
 const company=String(job.company).replace(/[^\p{L}\p{N} .-]/gu,' ').trim();
 assert(company.length>=2&&Number.isFinite(Date.parse(since)),'Missing application identity.');
 return {domains,company,recipient:recipient.toLowerCase(),since:Date.parse(since),query:`in:anywhere to:(${recipient}) after:${Math.floor(Date.parse(since)/1000)-5} {${domains.map(d=>'from:('+d+')').join(' ')}} "${company}" {"verification code" "security code" "one-time code"}`};
}
export function verifiedCode(messages,policy,clock=Date.now()){
 const matches=[];
 for(const m of messages){
  const when=Date.parse(m.date),domain=domainOf(m.sender),body=String(m.body||''),context=String(m.subject||'')+' '+body;
  if(!policy.domains.some(d=>domain===d||domain.endsWith('.'+d))||!Number.isFinite(when)||when<policy.since-5000||when>clock+60000||clock-when>10*60000)continue;
  if(!context.toLowerCase().includes(policy.company.toLowerCase())||!/(?:verification|security|one.time) code/i.test(context))continue;
  const codes=new Set();
  for(const re of [/(?:verification|security|one.time) code(?:\s+is)?\s*[:\-]?\s*([A-Z0-9]{6,8})\b/g,/^\s*([A-Z0-9]{6,8})\s*$/gm])for(const hit of body.matchAll(re))if(/[0-9]/.test(hit[1]))codes.add(hit[1]);
  if(codes.size===1)matches.push({code:[...codes][0],messageId:m.id});
 }
 // Multiple matching emails/codes require review, never guess between them.
 return matches.length===1?matches[0]:null;
}
export class GmailMailbox{
 constructor({dataDir,settings,save,launch=opts=>chromium.launchPersistentContext(opts.directory,opts.options)}){Object.assign(this,{dataDir,settings,save,launch});this.state={status:'disconnected',message:'Gmail not connected'};}
 async open({checkpoint=async()=>{}}={}){
  await checkpoint();
  if(this.context)return this.page;
  const directory=path.join(this.dataDir,'gmail-browser');await mkdir(directory,{recursive:true,mode:0o700});await chmod(directory,0o700);
  this.context=await this.launch({directory,options:{channel:process.platform==='darwin'?'chrome':undefined,headless:false,viewport:{width:1120,height:800},acceptDownloads:false}});
  this.context.on('close',()=>{this.context=null;this.page=null;this.state={status:'closed',message:'Gmail window closed; sign-in is saved on this Mac.'};});
  this.page=this.context.pages()[0]||await this.context.newPage();this.page.setDefaultTimeout(10000);
  await checkpoint();await this.page.goto('https://mail.google.com/',{waitUntil:'domcontentloaded'});return this.page;
 }
 async connect(){this.save({enabled:true});await this.open();return this.check();}
 async check(){
  if(!this.settings().enabled)return this.state={status:'disconnected',message:'Gmail not connected'};
  if(!this.page||this.page.isClosed())return this.state={status:'closed',message:'Open Gmail to continue with your saved sign-in.'};
  const url=new URL(this.page.url()),expected=this.settings().email?.toLowerCase();
  const title=await this.page.title();const found=title.match(/[^\s<>]+@[^\s<>]+\.[^\s<>]+/g)?.map(s=>s.toLowerCase())||[];
  if(url.hostname!=='mail.google.com'||!await this.page.locator('[role=main]').count())return this.state={status:'sign_in',message:'Sign in directly in the Gmail window, then Check connection.'};
  if(!expected||!found.includes(expected))return this.state={status:'wrong_account',message:'Use the same Gmail account as your application email.'};
  return this.state={status:'connected',email:expected,message:'Connected · application verification codes only'};
 }
 async syncControl(){if(this.reading)await paintBrowserControl(this.page,{...this.controlState?.(),activity:'Checking verification email',cursor:this.cursor?.url===this.page?.url()?this.cursor:null});}
 async lookup({job,recipient,since,signal,checkpoint=async()=>{},controlState=()=>null}){
  if(!this.settings().enabled)return null;
  assert(!this.reading,'An email check is already running.');this.reading=true;this.controlState=controlState;this.cursor=null;
  try{
   await checkpoint();signal?.throwIfAborted();const policy=mailPolicy(job,recipient,since);await this.open({checkpoint});await this.syncControl();
   if((await this.check()).status!=='connected')return null;
   const search='https://mail.google.com/mail/u/0/#search/'+encodeURIComponent(policy.query);
   await checkpoint();await this.page.goto(search,{waitUntil:'domcontentloaded'});
   await this.syncControl();const rows=this.page.locator('[role=main] tr[role=row]');await rows.first().waitFor({state:'visible',timeout:8000}).catch(()=>{});
   const count=await rows.count();if(!count||count>5)return null;
   const messages=[];
   for(let i=0;i<count;i++){
    await checkpoint();signal?.throwIfAborted();if(i){await this.page.goto(search);await rows.first().waitFor({state:'visible'});}
    const box=await rows.nth(i).boundingBox();this.cursor=box?{x:box.x+box.width*.5,y:box.y+box.height*.5,url:this.page.url()}:null;await this.syncControl();await checkpoint();await rows.nth(i).click();await this.syncControl();await this.page.locator('.a3s').first().waitFor({state:'visible'});
    messages.push(...await this.page.locator('[data-message-id]').evaluateAll(nodes=>nodes.filter(n=>n.querySelector('.a3s')).map(n=>({id:n.getAttribute('data-message-id'),sender:n.querySelector('.gD[email]')?.getAttribute('email'),date:n.querySelector('.g3[title]')?.getAttribute('title'),subject:document.querySelector('h2.hP')?.textContent||'',body:[...n.querySelectorAll('.a3s')].map(x=>x.innerText).join('\n')}))));
   }
   signal?.throwIfAborted();return verifiedCode(messages,policy);
  }finally{this.reading=false;this.controlState=null;this.cursor=null;await paintBrowserControl(this.page,{status:'idle'});}
 }
 async disconnect(){this.save({enabled:false});await this.close();this.state={status:'disconnected',message:'Disconnected. Saved Google sign-in stays in the separate browser profile.'};return this.state;}
 async close(){if(this.context)await this.context.close();}
}
