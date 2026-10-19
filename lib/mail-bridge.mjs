import {randomBytes,timingSafeEqual} from 'node:crypto';
import {assert} from './core.mjs';
import {validExtensionId} from './gmail-reconnect.mjs';

// Only fixed booleans may leave the companion as search diagnostics. Never
// persist its query, title, account, message content or arbitrary extra fields.
export function mailSearchDiagnostic(value){
 const keys=['routeIsSearch','inputPresent','inputMatches','routeMatches','accountMatches'];
 return value&&keys.every(key=>typeof value[key]==='boolean')?Object.fromEntries(keys.map(key=>[key,value[key]])):undefined;
}

// The companion can exchange only a pending mail lookup, never dashboard commands.
export class MailBridge {
 constructor({settings,save}){Object.assign(this,{settings,save});this.lastSeen=0;this.pending=null;}
 connect(origin){
  const current=this.settings();
  if(current.enabled&&current.transport==='chrome'&&/^[a-f0-9]{64}$/.test(current.bridgeToken||''))return {origin,token:current.bridgeToken};
  const token=randomBytes(32).toString('hex');this.cancel();this.save({enabled:true,transport:'chrome',bridgeToken:token});return {origin,token};
 }
 authorized(value){const token=this.settings().bridgeToken;if(!this.settings().enabled||!token||typeof value!=='string')return false;const a=Buffer.from(value),b=Buffer.from('Bearer '+token);return a.length===b.length&&timingSafeEqual(a,b);}
 status(){return this.settings().enabled&&Date.now()-this.lastSeen<12000?'connected':'closed';}
 poll(extensionOrigin){
  // The HTTP route supplies this only after validating its bearer token.
  if(extensionOrigin!==undefined){
   const id=String(extensionOrigin).match(/^chrome-extension:\/\/([a-p]{32})$/)?.[1],current=this.settings();
   assert(validExtensionId(id)&&current.enabled&&current.transport==='chrome'&&/^[a-f0-9]{64}$/.test(current.bridgeToken||''),'An authorized Gmail companion heartbeat is required.',403);
   if(current.bridgeExtensionId!==id)this.save({...current,bridgeExtensionId:id});
  }
  this.lastSeen=Date.now();const p=this.pending;return {request:p&&!p.done?{id:p.id,query:p.query,recipient:p.recipient,expiresAt:p.expiresAt}:null};
 }
 complete(body){const p=this.pending;assert(p&&!p.done&&body.id===p.id&&Date.now()<p.expiresAt,'This email lookup has expired.',409);assert(body.error||String(body.account).toLowerCase()===p.recipient,'Gmail account did not match the applicant.',409);assert(body.error||Array.isArray(body.messages)&&body.messages.length<=10,'Invalid email result.');const search=mailSearchDiagnostic(body.diagnostic?.search);p.done=true;p.resolve(body.error?{error:String(body.error).slice(0,200),...(search?{diagnostic:{search}}:{})}:{messages:body.messages.map(m=>({id:String(m.id||'').slice(0,200),sender:String(m.sender||'').slice(0,300),date:String(m.date||'').slice(0,200),datePrecision:m.datePrecision==='minute'?'minute':'exact',subject:String(m.subject||'').slice(0,500),body:String(m.body||'').slice(0,20000),searchedRecipient:p.recipient}))});return {ok:true};}
 async read(policy,{signal,checkpoint=async()=>{}}={}){assert(!this.pending,'An email check is already running.');await checkpoint();signal?.throwIfAborted();let resolve;const promise=new Promise(r=>resolve=r);const p={id:randomBytes(16).toString('hex'),query:policy.query,recipient:policy.recipient,expiresAt:Date.now()+90000,resolve};this.pending=p;const abort=()=>resolve({error:'Email lookup stopped.'});signal?.addEventListener('abort',abort,{once:true});const timer=setTimeout(()=>resolve({error:'Gmail companion did not finish. Open its tab in Chrome and check its connection.'}),90000);try{return await promise;}finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);if(this.pending===p)this.pending=null;}}
 cancel(){this.pending?.resolve({error:'Gmail disconnected.'});this.pending=null;this.lastSeen=0;}
}
