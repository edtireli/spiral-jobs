import {setTimeout as delay} from 'node:timers/promises';
import {assert} from './core.mjs';
import {MailBridge} from './mail-bridge.mjs';
const domainOf=email=>String(email).toLowerCase().split('@').at(-1);
const normal=value=>String(value||'').normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
export const verificationText=/(?:verification|security|confirmation|one[ -]time|single[ -]use|authentication) code|(?:verify|confirm) (?:your )?(?:email|e-mail)|(?:verification|confirmation) link/i;
export const receiptText=/thank you for (applying|your application)|application (has been |was )?(successfully )?(submitted|received)|we.have received your application|tak for din ansøgning/i;
export function mailPolicy(job,recipient,since,{kind='code',challengeBound=false}={}){
 const host=new URL(job.url).hostname;
 const domains=host==='job-boards.greenhouse.io'||host.endsWith('.greenhouse.io')?['greenhouse.io','greenhouse-mail.io']:host==='jobs.lever.co'?['lever.co']:host==='jobs.ashbyhq.com'?['ashbyhq.com']:[];
 assert(domains.length,'Automatic email verification is not supported for this application host.');
 assert(/^[^\s<>"(){}]+@[^\s<>"(){}]+$/.test(recipient),'Set your application email first.');
 const company=String(job.company).replace(/[^\p{L}\p{N} .-]/gu,' ').trim();
 assert(company.length>=2&&Number.isFinite(Date.parse(since)),'Missing application identity.');
 const scope=challengeBound&&kind==='code'?'':` "${company}"`;
 const terms=kind==='receipt'?'':` {"verification code" "security code" "confirmation code" "one-time code" "single-use" "verify your email" "confirm your email"}`;
 return {domains,company,title:job.title,recipient:recipient.toLowerCase(),since:Date.parse(since),challengeBound,query:`in:anywhere to:(${recipient}) after:${Math.floor(Date.parse(since)/1000)-5} {${domains.map(d=>'from:('+d+')').join(' ')}}${scope}${terms}`};
}
function matching(m,policy,clock,maxAge){
 const when=Date.parse(m.date),domain=domainOf(m.sender);
 return policy.domains.some(d=>domain===d||domain.endsWith('.'+d))&&Number.isFinite(when)&&when>=policy.since-5000&&when<=clock+60000&&clock-when<=maxAge&&(!m.searchedRecipient||m.searchedRecipient===policy.recipient)&&(!m.recipient||String(m.recipient).toLowerCase()===policy.recipient);
}
export function verifiedCode(messages,policy,clock=Date.now()){
 const matches=[];
 for(const m of messages){
  const body=String(m.body||''),context=String(m.subject||'')+' '+body;
  if(!matching(m,policy,clock,10*60000))continue;
  if(!policy.challengeBound&&!normal(context).includes(normal(policy.company)))continue;
  if(!verificationText.test(context))continue;
  const codes=new Set();
  for(const re of [/(?:verification|security|confirmation|one[ -]time|single[ -]use|authentication) code(?:\s+is)?\s*[:\-]?\s*([A-Z0-9]{4,12})\b/gi,/^\s*([A-Z0-9]{4,12})\s*$/gm,/\b([A-Z0-9]{4,12})\s+is your (?:verification|security|confirmation|one[ -]time) code/gi])for(const hit of body.matchAll(re))if(/[0-9]/.test(hit[1]))codes.add(hit[1]);
  if(codes.size===1)matches.push({code:[...codes][0],messageId:m.id});
 }
 // Ambiguous or expired codes are not guessed or reused.
 return matches.length===1?matches[0]:null;
}
export function verifiedReceipt(messages,policy,clock=Date.now()){
 const matches=messages.filter(m=>matching(m,policy,clock,14*86400000));
 const receipts=matches.filter(m=>{const text=m.subject+' '+m.body;return normal(text).includes(normal(policy.company))&&policy.title&&normal(text).includes(normal(policy.title))&&receiptText.test(text)&&!verificationText.test(text);});
 if(receipts.length===1)return {kind:'receipt',messageId:receipts[0].id,receivedAt:new Date(Date.parse(receipts[0].date)).toISOString()};
 if(matches.some(m=>normal(m.subject+' '+m.body).includes(normal(policy.company))&&verificationText.test(m.subject+' '+m.body)))return {kind:'verification'};
 return null;
}
export class GmailMailbox {
 constructor({dataDir,settings,save}){Object.assign(this,{dataDir,settings,save});this.bridge=new MailBridge({settings,save});this.state={status:'disconnected',message:'Gmail not connected'};}
 connect(origin){const connection=this.bridge.connect(origin);this.state={status:'setup',message:'Load the Gmail companion in regular Chrome, then paste the connection code.'};return {...this.state,connection};}
 async check(){
  if(!this.settings().enabled)return this.state={status:'disconnected',message:'Gmail not connected'};
  const status=this.bridge.status();return this.state={status,email:this.settings().email,message:status==='connected'?'Chrome companion connected · account checked on each lookup':'Open the Gmail companion tab in regular Chrome.'};
 }
 async syncControl(){}
 async lookup({job,recipient,since,signal,checkpoint=async()=>{},challengeBound=false}){
  if(!this.settings().enabled)return null;
  assert(!this.reading,'An email check is already running.');this.reading=true;
  try{
   const policy=mailPolicy(job,recipient,since,{challengeBound});
   for(let attempt=0;attempt<3;attempt++){
    await checkpoint();signal?.throwIfAborted();const result=await this.bridge.read(policy,{signal,checkpoint});
    if(result.error){this.state={status:'attention',message:result.error};return null;}
    const code=verifiedCode(result.messages,policy);if(code)return code;
    if(attempt<2)await delay(3000,undefined,{signal});
   }
   this.state={status:'attention',message:'No unique, current verification code matched this application.'};return null;
  }finally{this.reading=false;}
 }
 async receipt({job,recipient,since,signal,checkpoint=async()=>{}}){
  assert(this.settings().enabled,'Connect the Gmail companion first.');const policy=mailPolicy(job,recipient,since,{kind:'receipt'});
  const result=await this.bridge.read(policy,{signal,checkpoint});assert(!result.error,result.error);return verifiedReceipt(result.messages,policy);
 }
 async disconnect(){this.bridge.cancel();this.save({enabled:false,transport:'chrome'});return this.state={status:'disconnected',message:'Disconnected. Chrome sign-in is unchanged.'};}
 async close(){this.bridge.cancel();}
}
