import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {start} from '../server.mjs';
import {Navigator} from '../lib/navigator.mjs';
import {hash} from '../lib/core.mjs';
import {Service} from '../lib/service.mjs';
import {mailPolicy,verificationCodeAssessment} from '../lib/mail.mjs';

async function fixture(t){
 const dir=await mkdtemp(path.join(os.tmpdir(),'job-desk-verification-sessions-')),posts=[];
 const profile={name:'Fixture Person',email:'fixture@example.test',profile:'Python research.',facts:[],unknowns:[]};
 const form=action=>`<form method="post" action="${action}"><label>Email<input type="email" name="email" required></label><label>Resume<input type="file" name="resume" required></label><button>Submit application</button></form>`;
 const site=http.createServer(async(req,res)=>{
  let body='';for await(const data of req)body+=data;if(req.method==='POST')posts.push({url:req.url,body});
  res.setHeader('Content-Type','text/html');
  if(req.url==='/send-first')res.end(`<p>A verification code was sent to ${profile.email}.</p><form method="post" action="/verify-first"><label>Security code<input name="security-code" autocomplete="one-time-code" maxlength="6" required></label><button>Verify code</button></form>`);
  else if(req.url==='/send-second'||req.url==='/verify-first')res.end('Thank you for your application');
  else res.end(form(req.url==='/first'?'/send-first':'/send-second'));
 });
 await new Promise(r=>site.listen(0,'127.0.0.1',r));const app=await start({port:0,dataDir:dir}),service=app.service;
 let releaseSecond,secondStarted;const held=new Promise(r=>releaseSecond=r),started=new Promise(r=>secondStarted=r);let holdSecond=false,codeAvailable=false;
 t.after(async()=>{releaseSecond();await service.running;await service.stopAutonomy();for(const n of service.navigators?.values()||[])await n.close();await new Promise(r=>app.server.close(r));service.store.close();await new Promise(r=>site.close(r));await rm(dir,{recursive:true,force:true});});
 service.store.set('profile',profile);service.store.set('model','fixture');await service.setAutonomy(true);
 service.proposeFn=async({job})=>{if(holdSecond&&job.company==='Second Fixture'){secondStarted();await held;}return {model:'fixture',fit:'Fixture',evidenceIds:[],coverLetter:''};};
 service.renderDocumentsFn=async({dir})=>{await mkdir(dir,{recursive:true});const cv=path.join(dir,'CV.pdf');await writeFile(cv,'%PDF fixture CV');return {cv,letter:null,hashes:{cv:hash(await readFile(cv)),letter:null}};};
 service.createNavigator=options=>new Navigator({...options,allowTest:true,headless:true,decide:async({observation})=>({action:'final',target:observation.controls.find(c=>c.label==='Submit application').target,reason:'Fixture form complete.'})});
 service.mailbox.lookup=async()=>codeAvailable?{code:'123456'}:null;
 const add=(company,route)=>service.store.add({company,title:'Data Scientist',location:'Copenhagen',score:80,url:`http://127.0.0.1:${site.address().port}${route}`}).job;
 return {service,posts,first:add('First Fixture','/first'),second:add('Second Fixture','/second'),holdSecond(){holdSecond=true;return {started,release:releaseSecond};},enableCode(){codeAvailable=true;}};
}

test('a second authorized job runs while an idle email-verification browser stays intact for later completion',async t=>{
 const f=await fixture(t),s=f.service;
 await s.autoApply(f.first.id);await s.running;
 const original=s.session(f.first.id),reservation=s.store.blocked(f.first).id;
 assert.equal(original.state.status,'verification');assert.equal(original.state.verification.kind,'email');assert.equal(original.exposed,true);assert.equal(original.finalClicked,true);
 const gate=f.holdSecond();await s.autoApply(f.second.id);await gate.started;
 assert.equal(s.session(f.first.id),original);assert.equal(original.closed,false);assert.equal(s.store.blocked(f.first).id,reservation);
 await assert.rejects(s.checkVerification(f.first.id),/Another task is running/,'verification cannot run concurrently with the second application');
 assert.equal(f.posts.filter(p=>p.url==='/send-first').length,1);assert.equal(f.posts.filter(p=>p.url==='/verify-first').length,0);
 gate.release();await s.running;
 assert.equal(s.store.get(f.second.id).stage,'submitted');assert.equal(s.store.get(f.first.id).stage,'verification');assert.equal(s.session(f.first.id),original);assert.equal(original.closed,false);
 assert.equal(s.store.blocked(f.first).id,reservation);assert.equal(s.store.blocked(f.first).status,'verification');
 await assert.rejects(async()=>s.autoApply(f.first.id),/already in application history/,'the held submission cannot be replayed');
 f.enableCode();await s.checkVerification(f.first.id);await s.running;
 assert.equal(s.store.get(f.first.id).stage,'submitted');assert.equal(original.closed,true);assert.equal(s.store.blocked(f.first).id,reservation);
 assert.deepEqual(f.posts.map(p=>p.url),['/send-first','/send-second','/verify-first']);
 assert.equal(s.store.events(f.first.id).filter(e=>e.action==='final_submit_started').length,1);
 assert.ok(s.store.events(f.first.id).some(e=>e.action==='recording_saved'),'the original session is recorded when it completes');
});

test('an exposed final-review browser still blocks opening another employer',async t=>{
 const f=await fixture(t),s=f.service;await s.autoApply(f.first.id,'final');await s.running;
 const original=s.session(f.first.id);assert.equal(original.state.status,'final_review');assert.equal(original.exposed,true);
 await s.autoApply(f.second.id);await s.running;
 assert.equal(s.session(f.first.id),original);assert.equal(original.closed,false);assert.equal(original.state.status,'final_review');
 assert.equal(s.store.get(f.second.id).stage,'skipped');assert.match(s.store.get(f.second.id).error,/Finish or stop the current application/);assert.equal(f.posts.length,0);
});

test('held applications sharing an ATS cannot consume another employer’s code, even after that attempt closes',async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'job-desk-email-scope-')),s=new Service(dir,dir),recipient='fixture@example.test',clock=Date.now(),since=new Date(clock-5*60000).toISOString(),requests=[];
 t.after(async()=>{s.store.close();await rm(dir,{recursive:true,force:true});});s.store.set('profile',{email:recipient});s.store.set('model','fixture');
 s.createNavigator=options=>({profile:options.profile,state:{status:'review',phase:'fixture'},open:async()=>{},readListing:async()=>{},inspect:async()=>{},close:async function(){this.closed=true;}});
 const first=s.store.add({company:'First Fixture',title:'Scientist',url:'https://job-boards.greenhouse.io/first/jobs/1'}).job;
 const second=s.store.add({company:'Second Fixture',title:'Scientist',url:'https://job-boards.greenhouse.io/second/jobs/2'}).job;
 const message={id:'second-message',sender:'no-reply@greenhouse.io',date:new Date(clock-60000).toISOString(),subject:'Second Fixture: verify your email',body:'Security code: 654321',searchedRecipient:recipient};
 s.mailbox={lookup:async request=>{requests.push(request);const policy=mailPolicy(request.job,request.recipient,request.since,request);return verificationCodeAssessment([message],policy,clock).result;}};
 const expose=(job,n,date)=>{n.exposed=true;n.state={status:'verification',verification:{kind:'email'}};n.reservation=s.store.record({job,status:'verification',date});const saved=s.store.get(job.id);saved.draft={profile:{email:recipient}};saved.navigation={...n.state,exposed:true,updatedAt:date};s.store.save(saved);};
 await s.exploreJob(first.id);const original=s.session(first.id);expose(first,original,since);
 assert.equal(s.requiresCompanyEmailScope(first.id,recipient,since),false,'a sole bound challenge can use a generic provider email');
 await s.exploreJob(second.id);const other=s.session(second.id);expose(second,other,new Date(clock-60000).toISOString());
 assert.equal(s.session(first.id),original);
 assert.equal(await original.lookupEmailCode({recipient,since,challengeBound:true}),null,'the sole fresh B code must not fill A');assert.equal(requests.at(-1).requireCompanyScope,true);
 assert.equal((await other.lookupEmailCode({recipient,since:new Date(clock-61000).toISOString(),challengeBound:true})).messageId,'second-message');assert.equal(requests.at(-1).requireCompanyScope,true);
 await other.close();s.navigators.delete(second.id);s.store.application(other.reservation.id,{status:'submitted',submittedAt:new Date(clock).toISOString()});
 assert.equal(await original.lookupEmailCode({recipient,since,challengeBound:true}),null,'closing B does not remove its fresh email from A’s lookup');assert.equal(requests.at(-1).requireCompanyScope,true);
 const saved=s.store.get(second.id);saved.draft.profile.email='different@example.test';s.store.save(saved);
 assert.equal(s.requiresCompanyEmailScope(first.id,recipient,since),false,'a different account does not overlap');
 saved.draft.profile.email=recipient;saved.url='https://jobs.lever.co/second/role';s.store.save(saved);
 assert.equal(s.requiresCompanyEmailScope(first.id,recipient,since),false,'a different ATS does not overlap');
 saved.url=second.url;saved.navigation.updatedAt=new Date(clock-30*60000).toISOString();s.store.save(saved);s.store.application(other.reservation.id,{createdAt:new Date(clock-30*60000).toISOString(),submittedAt:new Date(clock-30*60000).toISOString()});
 assert.equal(s.requiresCompanyEmailScope(first.id,recipient,since),false,'an old completed attempt outside this challenge window does not overlap');
});
