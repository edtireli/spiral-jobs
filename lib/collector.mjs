import path from 'node:path';
import {readFile,realpath} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import {Store} from './store.mjs';
import {discover,defaultSources} from './sources.mjs';
import {processLock} from './process-lock.mjs';
import {hash,now} from './core.mjs';

async function runningApp(dataDir){
 try{
  const runtime=JSON.parse(await readFile(path.join(dataDir,'runtime.json'),'utf8')),url=new URL(runtime.origin);
  if(url.hostname!=='127.0.0.1'||url.protocol!=='http:')return null;
  const health=await (await fetch(runtime.origin+'/api/health',{signal:AbortSignal.timeout(1500)})).json();
  return health.app==='job-desk'&&health.instanceId===runtime.instanceId&&health.dataId===hash(await realpath(dataDir))?runtime.origin:null;
 }catch{return null;}
}
async function collectThroughApp(origin){
 const state=await (await fetch(origin+'/api/state')).json();
 if(state.busy)return {status:'skipped',reason:'Spiral Jobs is busy; collection did not interrupt it.'};
 const html=await (await fetch(origin)).text(),token=html.match(/name="csrf-token" content="([^"]+)"/)?.[1];
 if(!token)throw new Error('Spiral Jobs dashboard token is unavailable.');
 const response=await fetch(origin+'/api/scan',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','X-Job-Desk-Token':token},body:'{}'});
 if(!response.ok)throw new Error(await response.text());
 const deadline=Date.now()+150000;
 while(Date.now()<deadline){
  await new Promise(r=>setTimeout(r,1000));const current=await (await fetch(origin+'/api/state')).json();
  if(current.lastScan?.at!==state.lastScan?.at)return {status:'collected',...current.lastScan};
  if(!current.busy)throw new Error(current.lastError||'Collection stopped before recording a result.');
 }
 return {status:'running',reason:'Collection continues in Spiral Jobs.'};
}
export async function collectJobs(dataDir,{discoverFn=discover}={}){
 const active=await runningApp(dataDir);if(active)return collectThroughApp(active);
 let sources=defaultSources,interests;
 try{const db=new DatabaseSync(path.join(dataDir,'jobs.sqlite'),{readOnly:true});try{const row=db.prepare("SELECT value FROM settings WHERE key='sources'").get();if(row)sources=JSON.parse(row.value);const pref=db.prepare("SELECT value FROM settings WHERE key='interests'").get();if(pref)interests=JSON.parse(pref.value);}finally{db.close();}}catch{}
 // Network discovery needs no browser, model, native app or server.
 const found=await discoverFn(sources,()=>{},interests);let unlock;
 try{unlock=await processLock(dataDir);}catch(e){const active=await runningApp(dataDir);if(active)return collectThroughApp(active);throw e;}
 let store;
 try{
  store=new Store(dataDir);let added=0;
  for(const job of found.jobs)if(store.add(job).added)added++;
  const scan={at:now(),added,total:found.jobs.length,errors:found.errors};store.set('lastScan',scan);return {status:'collected',...scan};
 }finally{store?.close();await unlock();}
}
