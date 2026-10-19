import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {start} from '../server.mjs';
import {browserSession} from '../lib/browser.mjs';

async function fixture(t){
 const dir=await mkdtemp(path.join(os.tmpdir(),'captcha-api-')),app=await start({port:0,dataDir:dir}),s=app.service;
 t.after(async()=>{s.execution?.cancel();await s.running;await s.mailbox.close();app.server.closeAllConnections();await new Promise(r=>app.server.close(r));await app.unlock();s.store.close();await rm(dir,{recursive:true,force:true});});
 const job=s.store.add({company:'Fixture',title:'Engineer',location:'Copenhagen',url:'https://example.test/fixture'}).job;
 s.store.set('autoApply',{enabled:true});const calls={attempt:0,receipt:0,close:0};
 const n={closed:false,exposed:true,finalClicked:true,automatic:true,approvalMode:'full',submissionStartedAt:new Date().toISOString(),abort:new AbortController(),page:{isClosed:()=>n.closed},s:{gate:{approved:true}},reservation:s.store.record({job,status:'verification'}),state:{status:'verification',phase:'fill',sequence:7,verification:{kind:'captcha',canAttempt:true}},syncControl:async()=>{},async attemptCaptcha(body){calls.attempt++;assert.deepEqual(body,{sequence:7,confirm:true});this.state.sequence++;return {resolved:false};},async waitForReceipt(){calls.receipt++;},async close(){calls.close++;this.closed=true;this.abort.abort();},run(){throw new Error('Application continuation forbidden');},finalSubmit(){throw new Error('Application resubmission forbidden');}};
 s.navigators=new Map([[job.id,n]]);
 const post=(body,headers={})=>fetch(app.origin+`/api/jobs/${job.id}/attempt-captcha`,{method:'POST',headers:{Origin:app.origin,'Content-Type':'application/json','X-Job-Desk-Token':app.csrf,...headers},body:JSON.stringify(body)});
 return {s,n,job,calls,post};
}

test('CAPTCHA API requires same-origin token and current explicit challenge confirmation',async t=>{
 const {s,n,post,calls}=await fixture(t);
 for(const headers of [{Origin:'https://example.test'},{'X-Job-Desk-Token':'wrong'}])assert.equal((await post({sequence:7,confirm:true},headers)).status,403);
 for(const body of [{},{sequence:7,confirm:false},{sequence:6,confirm:true},{sequence:'7',confirm:true}])assert.equal((await post(body)).status,409);
 n.state.verification.kind='email';assert.equal((await post({sequence:7,confirm:true})).status,409);n.state.verification.kind='captcha';
 n.state.verification.attempting=true;assert.equal((await post({sequence:7,confirm:true})).status,409);n.state.verification.attempting=false;
 s.busy={label:'Other work'};assert.equal((await post({sequence:7,confirm:true})).status,409);s.busy=null;
 assert.equal(calls.attempt,0);
});

test('CAPTCHA consent cannot create, replace, or retry an application submission',async t=>{
 const {s,n,job,post,calls}=await fixture(t),reservation=n.reservation,page=n.page,session=n.s;
 for(const [key,value] of [['finalClicked',false],['exposed',false],['reservation',null],['submissionStartedAt',null],['closed',true]]){
  const before=n[key];n[key]=value;assert.equal((await post({sequence:7,confirm:true})).status,409,key);n[key]=before;
 }
 n.s.gate.approved=false;assert.equal((await post({sequence:7,confirm:true})).status,409);n.s.gate.approved=true;
 assert.equal((await post({sequence:7,confirm:true})).status,200);await s.running;
 assert.deepEqual(calls,{attempt:1,receipt:0,close:0});assert.equal(n.page,page);assert.equal(n.s,session);assert.equal(n.reservation,reservation);assert.equal(n.finalClicked,true);assert.equal(s.navigators.get(job.id),n);
 assert.equal((await post({sequence:7,confirm:true})).status,409);assert.equal(s.store.applications().length,1);
});

test('resolved CAPTCHA only checks receipt in the same original browser',async t=>{
 const {s,n,post,calls}=await fixture(t),reservation=n.reservation,page=n.page,session=n.s;
 n.attemptCaptcha=async()=>{calls.attempt++;assert.equal(s.executionState().status,'active');return {resolved:true};};
 assert.equal((await post({sequence:7,confirm:true})).status,200);await s.running;
 assert.deepEqual(calls,{attempt:1,receipt:1,close:0});assert.equal(n.reservation,reservation);assert.equal(n.page,page);assert.equal(n.s,session);assert.equal(n.finalClicked,true);
});

test('changed original session after CAPTCHA never continues to receipt handling',async t=>{
 for(const change of [n=>n.page={isClosed:()=>false},n=>n.s={gate:{approved:true}},n=>n.reservation={...n.reservation},n=>n.reservation.id='changed',n=>n.submissionStartedAt=new Date(0).toISOString(),n=>n.finalClicked=false]){
  await t.test(String(change),async t=>{
   const {s,n,post,calls}=await fixture(t);n.attemptCaptcha=async()=>{calls.attempt++;change(n);return {resolved:true};};
   assert.equal((await post({sequence:7,confirm:true})).status,200);await s.running;assert.equal(calls.receipt,0);assert.match(s.lastError,/original pending submission/);
  });
 }
});

test('Full and Final origin retain Stop and disable boundaries even when automatic is false',async t=>{
 const {s,n,post,calls}=await fixture(t);n.automatic=false;s.autoBatch={mode:'final',stopping:false};s.store.set('autoApply',{enabled:false});
 assert.equal((await post({sequence:7,confirm:true})).status,409,'a stale Final batch cannot enable disabled Full mode');
 n.approvalMode='final';s.autoBatch.stopping=true;assert.equal((await post({sequence:7,confirm:true})).status,409);
 s.autoBatch.stopping=false;await s.setAutonomy(false);assert.equal(n.closed,true);assert.equal((await post({sequence:7,confirm:true})).status,409);assert.equal(calls.attempt,0);
});

test('Stop during a controlled CAPTCHA attempt prevents receipt continuation',async t=>{
 const {s,n,job,post,calls}=await fixture(t);let entered,release;const ready=new Promise(r=>entered=r),pending=new Promise(r=>release=r);
 n.automatic=false;n.approvalMode='final';s.autoBatch={mode:'final',running:false,stopping:false};
 n.attemptCaptcha=async()=>{calls.attempt++;entered();await pending;return {resolved:true};};
 assert.equal((await post({sequence:7,confirm:true})).status,200);await ready;await s.stopAutonomy();release();await s.running;
 assert.equal(n.closed,true);assert.equal(calls.receipt,0);assert.equal(s.store.blocked(job).status,'uncertain');assert.match(s.lastError,/stopped/);
});

test('CAPTCHA dashboard requests current-challenge consent and never posts on refresh',{timeout:30000},async t=>{
 const root=path.resolve(import.meta.dirname,'../public'),posts=[],dialogs=[];let busy=false;
 const job={id:'fixture',company:'Fixture',title:'Engineer',location:'Copenhagen',url:'https://example.test/fixture',stage:'verification',revision:1,navigation:{status:'verification',phase:'fill',sequence:7,message:'Current CAPTCHA',exposed:true,verification:{kind:'captcha',canAttempt:true}}};
 const server=http.createServer(async(req,res)=>{
  if(req.method==='POST'){let raw='';for await(const chunk of req)raw+=chunk;posts.push({url:req.url,body:JSON.parse(raw)});res.setHeader('Content-Type','application/json');res.end('{"queued":true}');return;}
  if(req.url==='/api/state'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({busy:busy?{jobId:job.id,label:'Attempting CAPTCHA'}:null,jobs:[job],history:[],settings:{navigationModel:'fixture'},candidate:{},runtime:{status:'ready'},autonomy:{enabled:true,running:false,available:0}}));return;}
  if(req.url==='/api/jobs/fixture'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(job));return;}
  if(req.url.startsWith('/artifacts/')){res.setHeader('Content-Type','image/png');res.end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jhS8AAAAASUVORK5CYII=','base64'));return;}
  const name=req.url==='/'?'index.html':req.url.slice(1);res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html');try{res.end((await readFile(path.join(root,name),'utf8')).replace('__CSRF__','test'));}catch{res.writeHead(404);res.end();}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const b=await browserSession({allowTest:true});t.after(async()=>{await b.browser.close();await new Promise(r=>server.close(r));});b.gate.approved=true;
 const errors=[];let accept=false;b.page.on('pageerror',e=>errors.push(e.message));b.page.removeAllListeners('dialog');b.page.on('dialog',async d=>{dialogs.push(d.message());if(accept)await d.accept();else await d.dismiss();});
 await b.page.goto(`http://127.0.0.1:${server.address().port}`);const button=b.page.locator('#attemptCaptcha');await button.waitFor();assert.equal(await button.textContent(),'Let AI handle this CAPTCHA');assert.deepEqual(posts,[]);
 await button.click();assert.equal(dialogs.length,1);assert.match(dialogs[0],/currently shown for Fixture once/);assert.match(dialogs[0],/will not submit the application again/);assert.deepEqual(posts,[]);
 job.navigation.sequence=8;await b.page.waitForFunction(()=>JSON.parse(document.querySelector('#navigationAction').dataset.verification)[1]===8);accept=true;
 await Promise.all([b.page.waitForResponse(r=>r.url().endsWith('/attempt-captcha')),button.click()]);assert.deepEqual(posts,[{url:'/api/jobs/fixture/attempt-captcha',body:{confirm:true,sequence:8}}]);
 busy=true;await b.page.waitForFunction(()=>document.querySelector('#attemptCaptcha')?.disabled);assert.equal(await b.page.locator('#checkVerification').isDisabled(),true);
 busy=false;job.navigation.sequence++;job.navigation.verification.attempting=true;await b.page.waitForResponse(r=>r.url().endsWith('/api/jobs/fixture'));assert.equal(await button.isDisabled(),true);
 job.navigation.sequence++;job.navigation.verification={kind:'captcha',canAttempt:false};await b.page.waitForFunction(()=>!document.querySelector('#attemptCaptcha'));
 job.navigation.sequence++;job.navigation.verification={kind:'email'};await b.page.waitForFunction(()=>document.querySelector('#verificationGmailStatus'));assert.equal(await button.count(),0);assert.equal(posts.length,1);assert.deepEqual(errors,[]);
});
