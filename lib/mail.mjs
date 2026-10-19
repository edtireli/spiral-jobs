import {setTimeout as delay} from 'node:timers/promises';
import {assert} from './core.mjs';
import {MailBridge,mailSearchDiagnostic} from './mail-bridge.mjs';
import {openGmailCompanion,validExtensionId} from './gmail-reconnect.mjs';
const domainOf=email=>String(email).toLowerCase().split('@').at(-1);
const isPaired=settings=>!!(settings.enabled&&settings.transport==='chrome'&&/^[a-f0-9]{64}$/.test(settings.bridgeToken||''));
const normal=value=>String(value||'').normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
export const verificationText=/(?:verification|security|confirmation|one[ -]time|single[ -]use|authentication) code|(?:verify|confirm) (?:your )?(?:email|e-mail)|(?:verification|confirmation) link/i;
export const receiptText=/thank you for (applying|your application)|application (has been |was )?(successfully )?(submitted|received)|we.have received your application|tak for din ansøgning/i;
export function mailProvider(url){
 let host;try{host=new URL(url).hostname;}catch{return null;}
 return host==='greenhouse.io'||host.endsWith('.greenhouse.io')?'greenhouse.io':host==='jobs.lever.co'?'lever.co':host==='jobs.ashbyhq.com'?'ashbyhq.com':null;
}
export function mailPolicy(job,recipient,since,{kind='code',challengeBound=false,requireCompanyScope=false}={}){
 const provider=mailProvider(job.url),domains=provider==='greenhouse.io'?['greenhouse.io','greenhouse-mail.io']:provider?[provider]:[];
 assert(domains.length,'Automatic email verification is not supported for this application host.');
 assert(/^[^\s<>"(){}]+@[^\s<>"(){}]+$/.test(recipient),'Set your application email first.');
 const company=String(job.company).replace(/[^\p{L}\p{N} .-]/gu,' ').trim();
 assert(company.length>=2&&Number.isFinite(Date.parse(since)),'Missing application identity.');
 const scope=challengeBound&&!requireCompanyScope&&kind==='code'?'':` "${company}"`;
 const terms=kind==='receipt'?'':` {"verification code" "security code" "confirmation code" "one-time code" "single-use" "verify your email" "confirm your email"}`;
 return {domains,company,title:job.title,recipient:recipient.toLowerCase(),since:Date.parse(since),challengeBound,requireCompanyScope,query:`in:anywhere to:(${recipient}) after:${Math.floor(Date.parse(since)/1000)-5} {${domains.map(d=>'from:('+d+')').join(' ')}}${scope}${terms}`};
}
function matchingProblem(m,policy,clock,maxAge){
 const when=Date.parse(m.date),domain=domainOf(m.sender);
 // Gmail's displayed timestamp may omit seconds. Treat that explicitly marked
 // value as a minute interval only for the scoped, recipient-bound challenge.
 const minute=policy.challengeBound&&m.searchedRecipient===policy.recipient&&m.datePrecision==='minute';
 const latest=when+(minute?59999:0);
 if(!policy.domains.some(d=>domain===d||domain.endsWith('.'+d)))return 'sender';
 if(m.searchedRecipient&&m.searchedRecipient!==policy.recipient||m.recipient&&String(m.recipient).toLowerCase()!==policy.recipient)return 'recipient';
 if(!Number.isFinite(when))return 'timestamp';
 if(latest<policy.since-5000)return 'beforeSubmission';
 if(when>clock+60000)return 'future';
 if(clock-when>maxAge)return 'expired';
 return null;
}
const matching=(m,policy,clock,maxAge)=>matchingProblem(m,policy,clock,maxAge)===null;
export function verificationCodeAssessment(messages,policy,clock=Date.now()){
 const matches=[],diagnostic={messages:messages.length,currentCodes:0,rejected:{}};
 const reject=reason=>diagnostic.rejected[reason]=(diagnostic.rejected[reason]||0)+1;
 for(const m of messages){
  const body=String(m.body||''),context=String(m.subject||'')+' '+body;
  const problem=matchingProblem(m,policy,clock,10*60000);if(problem){reject(problem);continue;}
  if((!policy.challengeBound||policy.requireCompanyScope)&&!normal(context).includes(normal(policy.company))){reject('company');continue;}
  if(!verificationText.test(context)){reject('context');continue;}
  const codes=new Set();
  for(const re of [/(?:verification|security|confirmation|one[ -]time|single[ -]use|authentication) code(?:\s+is)?\s*[:\-]?\s*([A-Z0-9]{4,12})\b/gi,/^\s*([A-Z0-9]{4,12})\s*$/gm,/\b([A-Z0-9]{4,12})\s+is your (?:verification|security|confirmation|one[ -]time) code/gi])for(const hit of body.matchAll(re))if(/[0-9]/.test(hit[1]))codes.add(hit[1]);
  // Alphabetic codes are valid, but ordinary standalone words (including the
  // sender's name) are not. Require an explicit adjacent code label and a
  // complete token line, preserving the provider's case.
  for(const hit of body.matchAll(/(?:verification|security|confirmation|one[ -]time|single[ -]use|authentication) code(?:(?:[ \t]+is)?[ \t]*[:\-]\s*|[ \t]+is[ \t]+|[ \t]*\r?\n\s*)([A-Z]{4,12})(?=[ \t]*[.!]?(?:\r?\n|$))/gi))codes.add(hit[1]);
  for(const hit of body.matchAll(/(?:copy and paste|enter) (?:this|the following) code into (?:the )?(?:verification|security|confirmation) code field on your application:\s*([A-Z0-9]{4,12})(?=\s*(?:[.!]?(?:\r?\n|$)|After you enter\b))/gi))codes.add(hit[1]);
  if(codes.size===1)matches.push({code:[...codes][0],messageId:m.id});else reject(codes.size?'ambiguousCode':'codeFormat');
 }
 // Ambiguous or expired codes are not guessed or reused.
 diagnostic.currentCodes=matches.length;
 return {result:matches.length===1?matches[0]:null,diagnostic};
}
export const verifiedCode=(messages,policy,clock=Date.now())=>verificationCodeAssessment(messages,policy,clock).result;
export function verifiedReceipt(messages,policy,clock=Date.now()){
 const matches=messages.filter(m=>matching(m,policy,clock,14*86400000));
 const receipts=matches.filter(m=>{const text=m.subject+' '+m.body;return normal(text).includes(normal(policy.company))&&policy.title&&normal(text).includes(normal(policy.title))&&receiptText.test(text)&&!verificationText.test(text);});
 if(receipts.length===1)return {kind:'receipt',messageId:receipts[0].id,receivedAt:new Date(Date.parse(receipts[0].date)).toISOString()};
 if(matches.some(m=>normal(m.subject+' '+m.body).includes(normal(policy.company))&&verificationText.test(m.subject+' '+m.body)))return {kind:'verification'};
 return null;
}
export class GmailMailbox {
 constructor({dataDir,settings,save,openCompanion=openGmailCompanion,reconnectTimeoutMs=12000,reconnectPollMs=250}){Object.assign(this,{dataDir,settings,save,openCompanion,reconnectTimeoutMs,reconnectPollMs});this.bridge=new MailBridge({settings,save});const paired=isPaired(settings());this.state={paired,status:paired?'closed':'disconnected',message:paired?'Gmail companion paired · waiting to reconnect':'Gmail not connected'};}
 connect(origin){
  const previous=this.settings(),paired=previous.enabled&&previous.transport==='chrome'&&/^[a-f0-9]{64}$/.test(previous.bridgeToken||'');
  const connection=this.bridge.connect(origin),status=paired?this.bridge.status():'setup';
  this.state={status,paired:isPaired(this.settings()),message:status==='connected'?'Chrome companion connected · existing pairing preserved':paired?'Gmail companion is already paired. Open its tab in regular Chrome to reconnect.':'Load the Gmail companion in regular Chrome, then paste the connection code.'};return {...this.state,connection};
 }
 async check(){
  if(!isPaired(this.settings()))return this.state={status:'disconnected',paired:false,message:'Gmail not connected'};
  const status=this.bridge.status();return this.state={status,paired:true,email:this.settings().email,lookup:this.lastLookup,message:status==='connected'?(this.lastLookup?.error||'Chrome companion connected · account checked on each lookup'):'Open the Gmail companion tab in regular Chrome.'};
 }
 async syncControl(){}
 async ensureConnected({signal,checkpoint=async()=>{}}={}){
  const paired=this.settings();
  if(!paired.enabled||paired.transport!=='chrome'||!/^[a-f0-9]{64}$/.test(paired.bridgeToken||''))return {error:'Gmail is not connected. Connect the Gmail companion to check this application.'};
  if(this.bridge.status()==='connected')return null;
  // Older pairings can still heartbeat normally; do not guess an extension ID.
  if(!validExtensionId(paired.bridgeExtensionId))return null;
  if(this.reconnecting)return this.reconnecting;
  this.reconnecting=(async()=>{
   await checkpoint();signal?.throwIfAborted();
   const unchanged=()=>{const current=this.settings();return current.enabled&&current.bridgeToken===paired.bridgeToken&&current.bridgeExtensionId===paired.bridgeExtensionId;};
   if(!unchanged())return {error:'Gmail pairing changed while reconnecting. Check the current connection.'};
   this.state={status:'reconnecting',paired:true,message:'Reopening your paired Gmail companion in regular Chrome…'};
   try{await (this.openCompanion||openGmailCompanion)(paired.bridgeExtensionId);}catch{return {error:'The paired Gmail companion could not be reopened in Google Chrome. Check that Chrome and the companion are available in your usual profile.'};}
   const deadline=Date.now()+(this.reconnectTimeoutMs??12000);
   do{
    await checkpoint();signal?.throwIfAborted();
    if(!unchanged())return {error:'Gmail pairing changed while reconnecting. Check the current connection.'};
    if(this.bridge.status()==='connected'){this.state={status:'connected',paired:true,message:'Your paired Gmail companion reconnected.'};return null;}
    await delay(Math.min(this.reconnectPollMs??250,Math.max(1,deadline-Date.now())),undefined,{signal});
   }while(Date.now()<deadline);
   return {error:'The paired Gmail companion did not reconnect. Check its Chrome profile and saved local app address. If the app restarted on a different port, update its connection code in Gmail settings; the existing pairing is preserved.'};
  })();
  try{return await this.reconnecting;}finally{this.reconnecting=null;}
 }
 async lookup({job,recipient,since,signal,checkpoint=async()=>{},challengeBound=false,requireCompanyScope=false}){
  if(!isPaired(this.settings())){this.state={status:'disconnected',paired:false,message:'Gmail is not connected. Connect the Gmail companion to check this application.'};return {error:this.state.message};}
  assert(!this.reading,'An email check is already running.');this.reading=true;this.lastLookup=null;
  try{
   const policy=mailPolicy(job,recipient,since,{challengeBound,requireCompanyScope});let diagnostic;
   const reconnect=await this.ensureConnected({signal,checkpoint});
   if(reconnect?.error){this.lastLookup={error:reconnect.error,diagnostic:{transport:true,reconnect:true}};this.state={status:'attention',paired:isPaired(this.settings()),message:reconnect.error,lookup:this.lastLookup};return this.lastLookup;}
   for(let attempt=0;attempt<3;attempt++){
    await checkpoint();signal?.throwIfAborted();const result=await this.bridge.read(policy,{signal,checkpoint});
    if(result.error){const search=mailSearchDiagnostic(result.diagnostic?.search);this.lastLookup={error:String(result.error).slice(0,200),diagnostic:{transport:true,...(search?{search}:{})}};this.state={status:'attention',paired:isPaired(this.settings()),message:this.lastLookup.error,lookup:this.lastLookup};return this.lastLookup;}
    const assessment=verificationCodeAssessment(result.messages,policy);diagnostic=assessment.diagnostic;
    if(assessment.result){this.lastLookup={diagnostic};this.state={status:'connected',paired:isPaired(this.settings()),message:'Gmail returned a current verification code for this application.',lookup:this.lastLookup};return assessment.result;}
    if(attempt<2)await delay(3000,undefined,{signal});
   }
   let message='Gmail was checked, but no unique, current verification code matched this application.';
   if(diagnostic.currentCodes>1||diagnostic.rejected.ambiguousCode)message='Gmail returned more than one possible current verification code; none was selected.';
   else if(diagnostic.rejected.expired)message='The code is older than the app’s 10-minute freshness limit. Gmail found no unique current code. The original application stays open.';
   else if(diagnostic.rejected.timestamp)message='Gmail’s message date could not be verified. No code was used.';
   else if(diagnostic.rejected.beforeSubmission)message='No verification email could be matched to this submission time. No code was used.';
   else if(diagnostic.rejected.codeFormat)message='Gmail returned a current email, but its verification code format could not be read. No code was used.';
   this.lastLookup={error:message,diagnostic};this.state={status:'attention',paired:isPaired(this.settings()),message,lookup:this.lastLookup};return this.lastLookup;
  }finally{this.reading=false;}
 }
 async receipt({job,recipient,since,signal,checkpoint=async()=>{}}){
  assert(this.settings().enabled,'Connect the Gmail companion first.');const policy=mailPolicy(job,recipient,since,{kind:'receipt'});
  const reconnect=await this.ensureConnected({signal,checkpoint});assert(!reconnect?.error,reconnect?.error);
  const result=await this.bridge.read(policy,{signal,checkpoint});assert(!result.error,result.error);return verifiedReceipt(result.messages,policy);
 }
 async disconnect(){this.bridge.cancel();this.lastLookup=null;this.save({enabled:false,transport:'chrome'});return this.state={status:'disconnected',paired:false,message:'Disconnected. Chrome sign-in is unchanged.'};}
 async close(){this.bridge.cancel();}
}
