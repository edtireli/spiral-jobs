import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,rm,mkdir,writeFile,symlink,realpath} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {start} from '../server.mjs';
import {ModelRuntime,setOllamaURL,ollamaURL} from '../lib/runtime.mjs';
import {findExisting,findModelDirectory,launch} from '../desktop/launch.mjs';

async function temp(t){const dir=await mkdtemp(path.join(os.tmpdir(),'job-desk-desktop-'));t.after(()=>rm(dir,{recursive:true,force:true}));return dir;}
test('occupied port falls back automatically; dynamic origin and CSRF still enforce local actions',async t=>{
 const dir=await temp(t),blocker=http.createServer((q,r)=>r.end('different application'));await new Promise(r=>blocker.listen(0,'127.0.0.1',r));t.after(()=>blocker.close());
 const app=await start({dataDir:dir,port:blocker.address().port,fallbackPort:true});t.after(async()=>{await new Promise(r=>app.server.close(r));await app.unlock();app.service.store.close();});
 assert.notEqual(new URL(app.origin).port,String(blocker.address().port));const health=await(await fetch(app.origin+'/api/health')).json();assert.equal(health.app,'job-desk');assert.equal(health.origin,app.origin);
 const r=await fetch(app.origin+'/api/history',{method:'POST',headers:{Origin:app.origin,'X-Job-Desk-Token':app.csrf,'Content-Type':'application/json'},body:'{"company":"Fixture"}'});assert.equal(r.status,200);
 await assert.rejects(start({dataDir:dir,port:0}),/already running/);
 await writeFile(path.join(dir,'runtime.json'),JSON.stringify(health));assert.equal((await findExisting(dir)).instanceId,app.instanceId);
 const reused=await launch({dataDir:dir,noModels:true,onEvent:()=>{}});assert.equal(reused.health.instanceId,app.instanceId);assert.equal(reused.serverChild,undefined);await reused.close();
 assert.equal((await fetch(app.origin+'/api/health')).status,200);
});
test('model warmup loads one model for both roles and never downloads',async()=>{
 const requests=[];const runtime=new ModelRuntime({settings:()=>({model:'qwen-test',navigationModel:'qwen-test'}),request:async(url,options={})=>{requests.push({url,body:options.body});if(url.endsWith('/api/tags'))return Response.json({models:[{name:'qwen-test'}]});if(url.endsWith('/api/show'))return Response.json({capabilities:['vision','thinking']});return Response.json({done:true});}});
 runtime.start();runtime.start();await runtime.pending;
 assert.equal(runtime.state.status,'ready');assert.equal(requests.filter(r=>r.url.endsWith('/api/generate')).length,1);assert.ok(!requests.some(r=>r.url.includes('pull')));
});
test('missing drives or cloud models fail without a model load',async()=>{
 let generates=0;const runtime=new ModelRuntime({settings:()=>({model:'missing'}),request:async(url)=>{if(url.includes('generate'))generates++;return Response.json({models:[]});}});runtime.start();await runtime.pending;assert.equal(runtime.state.status,'error');assert.equal(generates,0);
 const remote=new ModelRuntime({settings:()=>({model:'remote'}),request:async(url)=>Response.json(url.includes('tags')?{models:[{name:'remote'}]}:{capabilities:['vision'],remote_host:'cloud'})});remote.start();await remote.pending;assert.equal(remote.state.status,'error');
});
test('model directory discovery follows mounted drives and ignores broken symlinks',async t=>{
 const dir=await temp(t),home=path.join(dir,'home'),volumes=path.join(dir,'Volumes');await mkdir(path.join(home,'.ollama'),{recursive:true});await symlink('/missing-model-drive',path.join(home,'.ollama/models'));const actual=path.join(volumes,'Renamed disk','ollama-models');await mkdir(path.join(actual,'manifests'),{recursive:true});assert.equal(await findModelDirectory({home,volumes,configured:'/missing'}),await realpath(actual));
});
test('Ollama endpoint cannot be redirected off-device',()=>{
 for(const u of ['http://10.0.0.2:11434','https://example.com','http://user:pass@127.0.0.1:11434'])assert.throws(()=>setOllamaURL(u));
 const original=ollamaURL;setOllamaURL('http://127.0.0.1:12345');assert.equal(ollamaURL,'http://127.0.0.1:12345');setOllamaURL(original);
});
test('cold native launcher waits for a real child server and cleans up its own process',async t=>{
 const dir=await temp(t),events=[];const app=await launch({dataDir:dir,noModels:true,onEvent:e=>events.push(e)});t.after(()=>app.close());
 assert.ok(app.serverChild?.pid);assert.ok(events.some(e=>e.event==='ready'));
 const state=await(await fetch(app.health.origin+'/api/state')).json();assert.equal(state.runtime.status,'idle');assert.equal(state.history.length,0);
 await app.close();assert.notEqual(app.serverChild.exitCode,null);
 await assert.rejects(fetch(app.health.origin+'/api/health'));
});
