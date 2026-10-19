import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {Store} from '../lib/store.mjs';
import {Service} from '../lib/service.mjs';
import {companyKey,canonical,publicURL,hash} from '../lib/core.mjs';
import {browserSession,capture,dispatch,validateAnswers,proposedAnswers} from '../lib/browser.mjs';
import {tex} from '../lib/documents.mjs';
import {factualLetter} from '../lib/model.mjs';
const root=path.resolve(import.meta.dirname,'..');
async function temporary(t){const p=await mkdtemp(path.join(os.tmpdir(),'job-desk-test-'));t.after(()=>rm(p,{recursive:true,force:true}));return p;}
test('employer aliases and tracking URLs deduplicate',()=>{
 assert.equal(companyKey('Amsterdam Data Collective'),companyKey('ADC Consulting'));
 assert.equal(companyKey('Amsterdam Data Collective (ADC)'),companyKey('ADC'));
 assert.equal(companyKey('H. Lundbeck A/S'),companyKey('Lundbeck'));
 assert.equal(companyKey('If Insurance'),companyKey('If'));
 assert.equal(companyKey('Alipes Capital ApS'),companyKey('Alipes'));
 assert.equal(canonical('https://example.com/job/1/?utm_source=x#apply'),'https://example.com/job/1');
 assert.throws(()=>canonical('javascript:alert(1)'));
});
test('persistent history blocks different roles and URLs at the same employer',async t=>{
 const dir=await temporary(t);let s=new Store(dir);const j=s.add({url:'https://example.com/job/1',company:'ADC',title:'AI Engineer',location:'Denmark'}).job;
 s.record({job:j,status:'applied'});s.close();s=new Store(dir);t.after(()=>s.close());
 const other=s.add({url:'https://other.example/job/2',company:'Amsterdam Data Collective',title:'Data Scientist',location:'Copenhagen'}).job;
 assert.equal(s.blocked(other).company,'ADC');assert.throws(()=>s.record({job:other}),/already/);
 const same=s.add({...j,url:'https://example.com/job/1?utm_source=linkedin'});assert.equal(same.added,false);
});
test('crash during a submission keeps employer blocked as uncertain',async t=>{
 const dir=await temporary(t);let s=new Store(dir);s.record({company:'Example',status:'submitting'});s.close();s=new Store(dir);t.after(()=>s.close());assert.equal(s.applications()[0].status,'uncertain');assert.ok(s.blocked({company:'Example',title:'Different role'}));
});
test('restarting after a completed pre-submit failure preserves its incomplete outcome',async t=>{
 const dir=await temporary(t);let service=new Service(root,dir);await service.init();
 const j=service.store.add({company:'Incomplete Fixture',title:'AI Engineer',location:'Copenhagen',url:'https://example.com/incomplete'}).job;
 j.stage='skipped';j.navigation={status:'skipped',exposed:true,message:'Dropdown failed before submission.'};service.store.save(j);service.store.record({job:j,status:'incomplete'});service.store.close();
 service=new Service(root,dir);await service.init();t.after(()=>service.store.close());
 assert.equal(service.store.get(j.id).stage,'skipped');assert.equal(service.store.blocked(j).status,'incomplete');
});
test('private network addresses and credential URLs are rejected',async()=>{
 for(const url of ['http://127.0.0.1:4317','http://localhost','http://10.1.1.1','http://169.254.169.254','file:///etc/passwd','https://user:pass@example.com'])await assert.rejects(publicURL(url));
});
test('consent is never autofilled; unknown eligibility remains blank',()=>{
 const snap={supported:true,form:{fields:[{key:'a',type:'checkbox',label:'I agree',required:true},{key:'b',type:'text',label:'Work authorisation',required:true}]}};
 const a=proposedAnswers(snap,{});assert.equal(a.a,false);assert.equal(a.b,'');assert.throws(()=>validateAnswers(snap,a,true),/required/);
});
test('internal statuses are rejected by the legacy submission path too',()=>{
 const snap={supported:true,form:{fields:[{key:'city',type:'text',label:'Location',required:true}]}};
 assert.throws(()=>validateAnswers(snap,{city:'human missing information'},false),/internal status/);
});
test('confirmed contact updates preserve employment facts and application history',async t=>{
 const dir=await temporary(t),service=new Service(root,dir);await service.init();t.after(()=>service.store.close());
 const before=service.store.applications(),phd=service.store.settings().profile.facts.find(f=>f.id==='phd');
 service.settings({contact:{city:'Copenhagen',country:'Denmark',postalCode:'2100',addressLine1:'Example Street 12',addressLine2:'2. 4',district:'København Ø'}});
 const p=service.store.settings().profile;assert.equal(p.location,'Copenhagen, Denmark');assert.equal(p.address,'Example Street 12, 2. 4, 2100 København Ø, Denmark');assert.deepEqual(p.facts.find(f=>f.id==='phd'),phd);assert.deepEqual(service.store.applications(),before);
 assert.throws(()=>service.settings({contact:{city:'Aarhus',qualifications:'invented'}}),/Invalid contact/);assert.equal(service.store.settings().profile.city,'Copenhagen');
 service.busy={label:'Applying'};assert.throws(()=>service.settings({contact:{city:'Aarhus'}}),/Wait/);
});
test('generated text cannot inject LaTeX commands',()=>{const s=tex('A & B \\input{/etc/passwd} 100%');assert.ok(s.includes('\\textbackslash{}input\\{'));assert.ok(s.includes('100\\%'));});
test('model cannot turn a completed PhD into candidacy or invent production experience',()=>{
 const s=factualLetter({title:'AI Engineer',company:'Example'},['phd','pbrain','spiral'],'I would like to use my production-grade experience as a PhD candidate.',{facts:[{id:'phd',text:'PhD in Neuroscience, completed.'},{id:'pbrain',text:'p-Brain: an academic software project.'},{id:'spiral',text:'Spiral: a personal AI project.'}]});
 assert.ok(s.includes('PhD in Neuroscience'));assert.ok(s.includes('p-Brain'));assert.ok(s.includes('Spiral'));assert.ok(!s.includes('candidate'));assert.ok(!s.includes('production-grade'));
});
async function reviewFixture(t,dispatchFn=async()=>({status:'submitted'})){
 const dir=await temporary(t),service=new Service(root,dir,{dispatchFn});await service.init();t.after(()=>service.store.close());
 const j=service.store.add({company:'Fixture Employer',title:'AI Engineer',location:'Denmark',url:'https://example.com/apply'}).job;
 const file=path.join(dir,'CV.pdf');await writeFile(file,'fixture-pdf');
 j.stage='ready';j.revision=2;j.draft={revision:2,reviewHash:'reviewed-hash',snapshot:{supported:true,fingerprint:'schema',form:{fields:[]}},answers:{},includeLetter:false,artifacts:{cv:file,letter:null,hashes:{cv:hash('fixture-pdf'),letter:null}}};service.store.save(j);return {service,j,file,approval:{confirm:true,reviewHash:'reviewed-hash',revision:2}};
}
test('missing approval, stale revision and wrong review digest never dispatch',async t=>{
 let calls=0;const {service,j}=await reviewFixture(t,async()=>{calls++;});
 for(const b of [{},{confirm:true,revision:1,reviewHash:'reviewed-hash'},{confirm:true,revision:2,reviewHash:'wrong'}])await assert.rejects(service.submit(j.id,b));
 assert.equal(calls,0);assert.equal(service.store.applications().length,0);
});
test('modified document bytes invalidate approval',async t=>{
 const {service,j,file,approval}=await reviewFixture(t);await writeFile(file,'changed');await assert.rejects(service.submit(j.id,approval),/attachment changed/);
});
test('simultaneous approvals dispatch only once',async t=>{
 let calls=0;const {service,j,approval}=await reviewFixture(t,async()=>{calls++;await new Promise(r=>setTimeout(r,60));return {status:'submitted'};});
 const results=await Promise.allSettled([service.submit(j.id,approval),service.submit(j.id,approval)]);await service.running;
 assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(calls,1);await assert.rejects(service.submit(j.id,approval));
});
test('ambiguous dispatch blocks all retries',async t=>{
 const {service,j,approval}=await reviewFixture(t,async()=>{throw Object.assign(new Error('Connection lost after upload'),{attempted:true});});await service.submit(j.id,approval);await service.running;
 assert.equal(service.store.get(j.id).stage,'uncertain');assert.equal(service.store.blocked(j).status,'uncertain');
});
test('a changed form before any candidate data leaves no applied record',async t=>{
 const {service,j,approval}=await reviewFixture(t,async()=>{throw Object.assign(new Error('Form changed'),{attempted:false});});await service.submit(j.id,approval);await service.running;
 assert.equal(service.store.get(j.id).stage,'needs_review');assert.equal(service.store.blocked(j),null);
});
test('browser refuses writes while inspecting; approved fixture sends once and captures confirmation',async t=>{
 const dir=await temporary(t);let posts=0;
 const html=`<html><head><title>Fixture AI Engineer</title></head><body><h1>AI Engineer</h1><form action='/submit' method='post' enctype='multipart/form-data'><label>Email<input name='email' type='email' required></label><label>CV<input name='cv' type='file' required></label><button type='submit'>Submit application</button></form><script>fetch('/tracker',{method:'POST',body:'no candidate data'}).catch(()=>{});</script></body></html>`;
 const server=http.createServer((req,res)=>{if(req.method==='POST'){posts++;req.resume();res.end('Thank you for your application');}else{res.setHeader('Content-Type','text/html');res.end(html);}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>server.close());const url=`http://127.0.0.1:${server.address().port}`;
 const snap=await capture(url,path.join(dir,'site.jpg'),{allowTest:true});assert.equal(posts,0);assert.equal(snap.supported,true);
 const f=path.join(dir,'CV.pdf');await writeFile(f,'%PDF fixture');const answers=proposedAnswers(snap,{email:'fixture@example.test'});
 const result=await dispatch({job:{},draft:{snapshot:snap,answers,includeLetter:false},artifacts:{cv:f},afterFile:path.join(dir,'receipt.jpg'),allowTest:true});
 assert.equal(posts,1);assert.equal(result.status,'submitted');
});
