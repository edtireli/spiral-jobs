import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {open,mkdir,readFile,realpath,readdir,access} from 'node:fs/promises';
import {hash} from '../lib/core.mjs';
import {processLock} from '../lib/process-lock.mjs';
import {fileURLToPath} from 'node:url';

const root=path.resolve(import.meta.dirname,'..');
const emit=data=>process.stdout.write(JSON.stringify(data)+'\n');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function readable(p){try{await access(p);return true;}catch{return false;}}
async function localRequest(url,{timeout=2000,method='GET',headers={},body}={}){
 return new Promise(resolve=>{const request=http.request(url,{method,headers},response=>{let text='';response.setEncoding('utf8');response.on('data',chunk=>text+=chunk);response.on('end',()=>resolve({ok:response.statusCode>=200&&response.statusCode<300,text}));response.on('error',()=>resolve(null));});
  request.setTimeout(timeout,()=>request.destroy());request.on('error',()=>resolve(null));if(body)request.write(body);request.end();
 });
}
async function json(url,timeout=2000){try{const r=await localRequest(url,{timeout});return r?.ok?JSON.parse(r.text):null;}catch{return null;}}
export async function findExisting(dataDir){
 if(process.env.JOB_DESK_STARTUP_DEBUG)emit({event:'debug',message:'resolve data directory'});
 const dataId=hash(await realpath(dataDir));
 if(process.env.JOB_DESK_STARTUP_DEBUG)emit({event:'debug',message:'read runtime record'});
 const runtime=JSON.parse(await readFile(path.join(dataDir,'runtime.json'),'utf8').catch(()=>'{}'));
 if(process.env.JOB_DESK_STARTUP_DEBUG)emit({event:'debug',message:'runtime record read'});
 const candidates=[runtime.origin,'http://127.0.0.1:4317'].filter(Boolean);
 for(const origin of new Set(candidates)){
  if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin))continue;
  const health=await json(origin+'/api/health');
  if(process.env.JOB_DESK_STARTUP_DEBUG)emit({event:'debug',message:'health checked '+origin});
  if(health?.app==='job-desk'&&health.protocol===2&&health.dataId===dataId&&health.origin===origin)return health;
 }
 return null;
}
export async function findModelDirectory({home=os.homedir(),volumes='/Volumes',configured=process.env.OLLAMA_MODELS}={}){
 const paths=[configured,path.join(home,'.ollama/models')].filter(Boolean);
 for(const volume of await readdir(volumes).catch(()=>[]))paths.push(path.join(volumes,volume,'ollama-models'));
 for(const p of paths)if(await readable(path.join(p,'manifests')))return realpath(p);
 return null;
}
async function availablePort(preferred){
 const server=net.createServer();
 const listen=port=>new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',()=>{server.removeAllListeners('error');resolve(server.address().port);});});
 let port;try{port=await listen(preferred);}catch(e){if(e.code!=='EADDRINUSE')throw e;port=await listen(0);}
 await new Promise(r=>server.close(r));return port;
}
async function loggedProcess(executable,args,env,file){
 const log=await open(file,'a',0o600);const child=spawn(executable,args,{env,stdio:['ignore',log.fd,log.fd]});
 // Attach listeners before yielding: a fast child can emit spawn while the log closes.
 const spawned=new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});
 try{await spawned;return child;}finally{await log.close();}
}
async function stop(child){if(!child||child.exitCode!==null)return;child.kill('SIGTERM');for(let i=0;i<20&&child.exitCode===null;i++)await delay(100);if(child.exitCode===null)child.kill('SIGKILL');}
export async function ensureOllama({logDir,onStatus=()=>{},preferredEndpoint='http://127.0.0.1:11434'}){
 let endpoint=/^http:\/\/127\.0\.0\.1:\d+$/.test(preferredEndpoint)?preferredEndpoint:'http://127.0.0.1:11434';const tags=await json(endpoint+'/api/tags');
 if(Array.isArray(tags?.models))return {endpoint,child:null};
 const models=await findModelDirectory()||path.join(os.homedir(),'.ollama/models');await mkdir(models,{recursive:true});
 const binaries=[path.resolve(root,'../ollama/ollama'),'/Applications/Ollama.app/Contents/Resources/ollama','/usr/local/bin/ollama','/opt/homebrew/bin/ollama'];let binary;
 for(const b of binaries)if(await readable(b)){binary=b;break;}
 if(!binary)throw new Error('Ollama is not installed. Install Ollama, then reopen Spiral Jobs.');
 const port=await availablePort(11434);endpoint=`http://127.0.0.1:${port}`;onStatus('Starting local models…');
 const child=await loggedProcess(binary,['serve'],{...process.env,OLLAMA_HOST:`127.0.0.1:${port}`,OLLAMA_MODELS:models,OLLAMA_NO_CLOUD:'1'},path.join(logDir,'ollama.log'));
 for(let i=0;i<80;i++){const t=await json(endpoint+'/api/tags',700);if(Array.isArray(t?.models))return {endpoint,child};if(child.exitCode!==null)break;await delay(250);}
 await stop(child);throw new Error('Ollama could not start. Check the model drive and Ollama log.');
}
export async function launch({dataDir,noModels=false,onEvent=emit,watchSignals=false}={}){
 await mkdir(dataDir,{recursive:true});const unlock=await processLock(dataDir,'desktop.lock');let serverChild,ollamaChild,closed=false;
 const close=async()=>{if(closed)return;closed=true;await stop(serverChild);await stop(ollamaChild);await unlock();if(watchSignals)for(const s of ['SIGTERM','SIGINT'])process.off(s,signalStop);};
 const signalStop=async()=>{await close();process.exit(0);};if(watchSignals)for(const s of ['SIGTERM','SIGINT'])process.on(s,signalStop);
 try{
  onEvent({event:'status',message:'Opening your workspace…'});
  let existing=await findExisting(dataDir);
  if(existing){
   if(!noModels){
    const html=(await localRequest(existing.origin))?.text||'',token=html.match(/name="csrf-token" content="([^"]+)/)?.[1];
    if(token){const headers={Origin:existing.origin,'Content-Type':'application/json','X-Job-Desk-Token':token};
     try{const o=await ensureOllama({logDir:dataDir,preferredEndpoint:existing.ollamaURL});ollamaChild=o.child;
      if(o.endpoint!==existing.ollamaURL)await localRequest(existing.origin+'/api/runtime/ollama',{method:'POST',headers,body:JSON.stringify({endpoint:o.endpoint})});
     }catch(e){onEvent({event:'warning',message:e.message});}
     await localRequest(existing.origin+'/api/models/start',{method:'POST',headers,body:'{}'});
    }
   }
   onEvent({event:'ready',url:existing.origin,reused:true});
  }else{
   let endpoint='http://127.0.0.1:11434';
   if(!noModels)try{const o=await ensureOllama({logDir:dataDir,onStatus:message=>onEvent({event:'status',message})});endpoint=o.endpoint;ollamaChild=o.child;}catch(e){onEvent({event:'warning',message:e.message});}
   onEvent({event:'status',message:'Starting Spiral Jobs…'});
   serverChild=await loggedProcess(process.execPath,[path.join(root,'server.mjs')],{...process.env,JOB_DESK_DATA_DIR:dataDir,JOB_DESK_PORT:'4317',JOB_DESK_OLLAMA_URL:endpoint,JOB_DESK_AUTO_MODELS:noModels?'0':'1'},path.join(dataDir,'server.log'));
   for(let i=0;i<70;i++){existing=await findExisting(dataDir);if(existing)break;if(serverChild.exitCode!==null)throw new Error('The server could not start. See server.log in your workspace.');await delay(250);}
   if(!existing)throw new Error('The server did not become ready. Reopen Spiral Jobs to retry.');
   onEvent({event:'ready',url:existing.origin,reused:false});
  }
  return {close,health:existing,serverChild,ollamaChild};
 }catch(e){await close();throw e;}
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 try{
  const config=JSON.parse(await readFile(path.join(import.meta.dirname,'config.json'),'utf8').catch(()=>'{}'));
  const app=await launch({dataDir:process.env.JOB_DESK_DATA_DIR||config.dataDir||path.join(os.homedir(),'Library/Application Support/Spiral Jobs/data'),noModels:process.argv.includes('--no-models')||config.testWithoutModels===true,watchSignals:true});
  const timer=setInterval(async()=>{const health=await json(app.health.origin+'/api/health');if(health?.instanceId!==app.health.instanceId)emit({event:'error',message:'The local server stopped. Choose Reconnect from the Spiral Jobs menu.'});},15000);
 }catch(e){emit({event:'error',message:e.message});process.exitCode=1;}
}
