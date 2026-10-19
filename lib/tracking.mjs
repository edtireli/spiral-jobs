import {randomBytes} from 'node:crypto';
import {assert,publicURL} from './core.mjs';
export const projectURL='https://github.com/edtireli/spiral-jobs';
export async function trackedProjectLink(service,job){
 const config=service.store.settings().tracking;
 if(!config?.enabled)return projectURL;
 await publicURL(config.origin);assert(new URL(config.origin).protocol==='https:','Tracking requires HTTPS.');
 const current=service.store.get(job.id);
 if(current.projectLink){Object.assign(job,{projectLink:current.projectLink,trackingToken:current.trackingToken});return current.projectLink;}
 const token=randomBytes(24).toString('hex');
 const response=await fetch(config.origin+'/api/links',{method:'POST',headers:{Authorization:'Bearer '+config.key,'Content-Type':'application/json'},body:JSON.stringify({token}),signal:AbortSignal.timeout(8000)});
 assert(response.ok,'The tracking service could not create this link. Disable tracking or reconnect before generating documents.');
 // Model/browser progress can update the job while link creation is pending.
 // Persist only the link fields on a fresh record, never the caller's snapshot.
 const latest=service.store.get(job.id);
 if(!latest.projectLink){latest.projectLink=config.origin+'/r/'+token;latest.trackingToken=token;service.store.save(latest);}
 Object.assign(job,{projectLink:latest.projectLink,trackingToken:latest.trackingToken});return latest.projectLink;
}
export async function trackingVisits(service,jid){
 const j=service.store.get(jid),c=service.store.settings().tracking;
 if(!j.trackingToken||!c?.origin||!c?.key)return {visits:[]};
 const r=await fetch(c.origin+'/api/visits/'+j.trackingToken,{headers:{Authorization:'Bearer '+c.key},signal:AbortSignal.timeout(8000)});assert(r.ok,'Could not load link visits.');return r.json();
}
export async function configureTracking(service,body){
 assert(!service.busy,'Wait for the current task.',409);
 if(body.enabled===false){service.store.set('tracking',{...service.store.settings().tracking,enabled:false});return {ok:true};}
 await publicURL(body.origin);const u=new URL(body.origin);assert(u.protocol==='https:'&&u.pathname==='/'&&!u.username&&!u.password&&!u.search&&!u.hash,'Use the HTTPS service origin.');
 const key=body.key||service.store.settings().tracking?.key;assert(typeof key==='string'&&/^[a-f0-9]{64}$/.test(key),'Use the service’s 64-character access key.');
 const r=await fetch(u.origin+'/api/status',{headers:{Authorization:'Bearer '+key},signal:AbortSignal.timeout(8000)});assert(r.ok,'Tracking connection failed.');const info=await r.json();assert(info.service==='spiral-jobs-tracking','This is not a Spiral Jobs tracking service.');
 service.store.set('tracking',{origin:u.origin,key,enabled:true});return {ok:true};
}
