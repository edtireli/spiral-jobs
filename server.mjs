import http from 'node:http';
import {saveProfile} from './lib/profile.mjs';
import {configureTracking,trackingVisits} from './lib/tracking.mjs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readFile,writeFile,realpath,rm} from 'node:fs/promises';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {Service} from './lib/service.mjs';
import {models} from './lib/model.mjs';
import {assert,publicURL,hash,id} from './lib/core.mjs';
import {ModelRuntime,ollamaURL,setOllamaURL} from './lib/runtime.mjs';
import {processLock} from './lib/process-lock.mjs';
const root=path.dirname(fileURLToPath(import.meta.url));
export async function start({port=Number(process.env.JOB_DESK_PORT||4317),dataDir=process.env.JOB_DESK_DATA_DIR||path.join(root,'data'),autoModels=false,fallbackPort=false}={}){
 const unlock=await processLock(dataDir);let service;try{service=new Service(root,dataDir);await service.init();}catch(e){await unlock();throw e;}
 const runtime=new ModelRuntime({settings:()=>service.store.settings()});const instanceId=id(),dataId=hash(await realpath(dataDir));
 const csrf=randomBytes(32).toString('hex');let origin=`http://127.0.0.1:${port}`;
 const json=(res,data,status=200)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
 const server=http.createServer(async(req,res)=>{
  try{
   assert(req.headers.host===`127.0.0.1:${port}`, 'Invalid host.',403);
   res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
   res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; frame-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'");
   const url=new URL(req.url,origin), p=url.pathname;
   if(p.startsWith('/api/gmail/bridge/')){
    const extensionOrigin=req.headers.origin;
    assert(!extensionOrigin||/^chrome-extension:\/\/[a-p]{32}$/.test(extensionOrigin),'Gmail companion origin required.',403);
    if(extensionOrigin){res.setHeader('Access-Control-Allow-Origin',extensionOrigin);res.setHeader('Vary','Origin');}
    if(req.method==='OPTIONS'){res.setHeader('Access-Control-Allow-Methods','POST');res.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type');res.writeHead(204);return res.end();}
    assert(req.method==='POST'&&service.mailbox.bridge.authorized(req.headers.authorization),'Gmail connection expired.',403);
    assert(req.headers['content-type']?.startsWith('application/json'),'JSON required.',415);
    let raw='';for await(const chunk of req){raw+=chunk;assert(raw.length<240000,'Email result too large.',413);}const body=JSON.parse(raw||'{}');
    if(p==='/api/gmail/bridge/poll'){const pending=service.mailbox.bridge.poll(extensionOrigin);await service.mailbox.check();return json(res,pending);}
    if(p==='/api/gmail/bridge/result')return json(res,service.mailbox.bridge.complete(body));
    throw Object.assign(new Error('Unknown companion action.'),{status:404});
   }
   assert(!req.headers.origin||req.headers.origin===origin,'Cross-origin requests are not allowed.',403);
   if(req.method==='POST'){
    assert(req.headers.origin===origin,'A same-origin dashboard action is required.',403);
    assert(req.headers['x-job-desk-token']===csrf,'Dashboard token missing. Reload the page.',403);
    assert(req.headers['content-type']?.startsWith('application/json'),'JSON required.',415);
    let raw='';for await(const chunk of req){raw+=chunk;assert(raw.length<120000,'Request too large.',413);}const body=JSON.parse(raw||'{}');
    if(p==='/api/profile')return json(res,await saveProfile(service,body));
    if(p==='/api/tracking')return json(res,await configureTracking(service,body));
    if(p==='/api/models/download')return json(res,runtime.download(body.model));
    if(p==='/api/gmail/connect'){assert(body.confirm===true,'Confirm Gmail access.');return json(res,{...await service.mailbox.connect(origin),extensionDirectory:path.join(root,'extensions/gmail')});}
    if(p==='/api/gmail/check')return json(res,await service.mailbox.check());
    if(p==='/api/gmail/disconnect')return json(res,await service.mailbox.disconnect());
    if(p==='/api/models/start')return json(res,runtime.start());
    if(p==='/api/models/cancel')return json(res,runtime.cancel());
    if(p==='/api/autonomy')return json(res,await service.setAutonomy(body.enabled));
    if(p==='/api/autonomy/run')return json(res,await service.autoRun({search:body.search===true,mode:body.mode}));
    if(p==='/api/control/pause')return json(res,service.pauseExecution(body));
    if(p==='/api/control/resume')return json(res,service.resumeExecution(body));
    if(p==='/api/autonomy/stop')return json(res,await service.stopAutonomy());
    if(p==='/api/runtime/ollama'){assert(!service.busy,'Wait for the current task.',409);runtime.cancel();await runtime.pending;runtime.endpoint=setOllamaURL(body.endpoint);return json(res,{ok:true});}
    if(p==='/api/scan')return json(res,await service.scan());
    if(p==='/api/jobs'){await publicURL(body.url);return json(res,service.add(body));}
    if(p==='/api/history')return json(res,service.history(body));
    if(p==='/api/settings')return json(res,service.settings(body));
    const m=p.match(/^\/api\/jobs\/([\w-]+)\/(check-application-email|check-verification|auto-apply|prepare|inspect|draft|edit|approve-fill|resume-navigation|allow-interactive|answer-navigation|approve-final|stop-navigation|prepare-letter|approve-letter|archive|apply-url)$/);assert(m,'Unknown action.',404);
    const [,jid,action]=m;
    if(action==='check-application-email')return json(res,await service.checkApplicationEmail(jid));
    if(action==='check-verification')return json(res,await service.checkVerification(jid));
    if(action==='auto-apply')return json(res,await service.autoApply(jid,body.mode));
    if(action==='prepare')return json(res,await service.explore(jid,{prepare:true}));
    if(action==='inspect')return json(res,await service.explore(jid));
    if(action==='draft')return json(res,await service.draft(jid,body.includeLetter));
    if(action==='edit')return json(res,await service.edit(jid,body));
    if(action==='approve-fill')return json(res,await service.approveFill(jid,body));
    if(action==='resume-navigation')return json(res,await service.resumeNavigation(jid));
    if(action==='allow-interactive')return json(res,await service.allowInteractiveStep(jid,body));
    if(action==='answer-navigation')return json(res,await service.answerNavigation(jid,body));
    if(action==='approve-final')return json(res,await service.finalNavigation(jid,body));
    if(action==='stop-navigation')return json(res,await service.stopNavigation(jid));
    if(action==='prepare-letter')return json(res,await service.prepareRequiredLetter(jid));
    if(action==='approve-letter')return json(res,await service.approveRequiredLetter(jid,body));
    if(action==='apply-url'){assert(!service.busy,'Wait for the current task.',409);await publicURL(body.url);const j=service.store.get(jid);assert(!service.store.blocked(j),'Already applied to this employer.',409);j.applyUrl=body.url;delete j.draft;delete j.snapshot;j.revision++;j.stage='new';service.store.save(j);return json(res,await service.explore(jid));}
    if(action==='archive'){assert(!service.busy,'Wait for the current task.',409);const j=service.store.get(jid);assert(!service.store.blocked(j),'Applied jobs are kept in history.',409);j.stage='archived';service.store.save(j);return json(res,{ok:true});}
   }
   assert(req.method==='GET','Method not allowed.',405);
   if(p==='/api/health')return json(res,{app:'job-desk',protocol:2,instanceId,dataId,origin,ollamaURL});
   if(p==='/api/state')return json(res,{...service.state(),autonomy:service.autonomyState(),runtime:runtime.state,lastScan:service.store.settings().lastScan,lastError:service.lastError||null});
   if(p==='/api/profile')return json(res,service.store.settings().profile);
   if(/^\/api\/jobs\/[\w-]+\/visits$/.test(p))return json(res,await trackingVisits(service,p.split('/')[3]));
   if(p==='/api/models')return json(res,await models());
   if(p==='/api/history.csv'){
    const columns=['company','position','location','postcode','address','deadline','status','submittedAt','url'];
    const cell=v=>'"'+String(v??'Not listed').replace(/^[=+@-]/,"'$&").replaceAll('"','""')+'"';
    const csv=[columns.join(','),...service.store.applications().map(a=>columns.map(k=>cell(a[k])).join(','))].join('\r\n');
    res.writeHead(200,{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="application-history.csv"','Cache-Control':'no-store'});return res.end(csv);
   }
   if(/^\/api\/jobs\/[\w-]+$/.test(p))return json(res,service.detail(p.split('/').pop()));
   if(p.startsWith('/artifacts/')){
    const rel=p.slice('/artifacts/'.length);assert(/^[\w-]+\/(?:r\d+\/)?[\w.-]+$/.test(rel),'Invalid artifact path.',404);
    const file=path.join(dataDir,'artifacts',rel);const ext=path.extname(file);
    const mime={'.pdf':'application/pdf','.png':'image/png','.jpg':'image/jpeg','.tex':'text/plain','.webm':'video/webm','.json':'application/json'}[ext];assert(mime,'File type unavailable.',404);
    let bytes;try{bytes=await readFile(file);}catch{throw Object.assign(new Error('Artifact not found.'),{status:404});}
    const headers={'Content-Type':mime,'Cache-Control':'no-store'};
    if(ext==='.webm'){
     headers['Accept-Ranges']='bytes';
     if(req.headers.range){
      const match=/^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
      let start=match?.[1]?Number(match[1]):0,end=match?.[2]?Number(match[2]):bytes.length-1;
      if(match&&!match[1]&&match[2]){start=Math.max(0,bytes.length-Number(match[2]));end=bytes.length-1;}
      if(!match||(!match[1]&&!match[2])||start>end||start>=bytes.length){res.writeHead(416,{...headers,'Content-Range':`bytes */${bytes.length}`});return res.end();}
      end=Math.min(end,bytes.length-1);res.writeHead(206,{...headers,'Content-Range':`bytes ${start}-${end}/${bytes.length}`,'Content-Length':end-start+1});return res.end(bytes.subarray(start,end+1));
     }
    }
    res.writeHead(200,{...headers,'Content-Length':bytes.length});return res.end(bytes);
   }
   if(p==='/'){let html=await readFile(path.join(root,'public/index.html'),'utf8');html=html.replace('__CSRF__',csrf);res.writeHead(200,{'Content-Type':'text/html','Cache-Control':'no-store'});return res.end(html);}
   const files={'/execution.js':'text/javascript','/app.js':'text/javascript','/workflow.js':'text/javascript','/view-state.js':'text/javascript','/style.css':'text/css','/background.js':'text/javascript'};assert(files[p],'Not found.',404);res.writeHead(200,{'Content-Type':files[p],'Cache-Control':'no-store'});res.end(await readFile(path.join(root,'public',p.slice(1))));
  }catch(e){json(res,{error:e.message},e.status||500);}
 });
 const listen=p=>new Promise((resolve,reject)=>{const fail=e=>{server.off('listening',ready);reject(e);};const ready=()=>{server.off('error',fail);resolve();};server.once('error',fail);server.once('listening',ready);server.listen(p,'127.0.0.1');});
 try{try{await listen(port);}catch(e){if(!fallbackPort||e.code!=='EADDRINUSE')throw e;await listen(0);}}catch(e){service.store.close();await unlock();throw e;}
 port=server.address().port;origin=`http://127.0.0.1:${port}`;
 server.on('close',()=>{runtime.cancel();unlock().catch(()=>{});});
 if(autoModels)runtime.start();
 return {server,service,runtime,csrf,origin,instanceId,dataId,unlock};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const dataDir=process.env.JOB_DESK_DATA_DIR||path.join(root,'data');
 const app=await start({dataDir,autoModels:process.env.JOB_DESK_AUTO_MODELS==='1',fallbackPort:true});
 const record={origin:app.origin,pid:process.pid,instanceId:app.instanceId,dataId:app.dataId,protocol:2};
 await writeFile(path.join(dataDir,'runtime.json'),JSON.stringify(record),{mode:0o600});
 console.log(JSON.stringify({event:'ready',...record}));let closing=false;
 for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{
  if(closing)return;closing=true;app.runtime.cancel();
  for(const [jid,n] of app.service.navigators||[])if(!n.closed)await app.service.stopNavigation(jid).catch(()=>{});
  await app.service.mailbox.close();
  app.server.closeAllConnections();app.server.close();await app.unlock();
  if((JSON.parse(await readFile(path.join(dataDir,'runtime.json'),'utf8').catch(()=>'{}'))).instanceId===app.instanceId)await rm(path.join(dataDir,'runtime.json'),{force:true});
  process.exit(0);
 });
}
