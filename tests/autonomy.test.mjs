import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {start} from '../server.mjs';
import {Navigator} from '../lib/navigator.mjs';
import {hash} from '../lib/core.mjs';
import {autoEligible} from '../lib/autonomy.mjs';

const profile={name:'Fixture Person',firstName:'Fixture',lastName:'Person',email:'fixture@example.test',location:'Copenhagen, Denmark',currentCompany:'Not employed',consultingYears:0,profile:'Fixture CV',facts:[{id:'python',text:'Academic Python MRI research.'}],unknowns:['work authorisation']};
async function fixture(t,html){
 const dir=await mkdtemp(path.join(os.tmpdir(),'job-desk-auto-')),posts=[];
 const site=http.createServer(async(req,res)=>{let body='';for await(const data of req)body+=data;if(req.method==='POST'){posts.push({url:req.url,body});res.end('Thank you for your application');return;}res.setHeader('Content-Type','text/html');res.end(html(req));});
 await new Promise(r=>site.listen(0,'127.0.0.1',r));const app=await start({port:0,dataDir:dir}),service=app.service;
 t.after(async()=>{await service.stopAutonomy();await service.running;for(const n of service.navigators?.values()||[])await n.close();await new Promise(r=>app.server.close(r));service.store.close();await new Promise(r=>site.close(r));await rm(dir,{recursive:true,force:true});});
 service.store.set('profile',profile);service.store.set('model','fixture');
 service.proposeFn=async()=>({model:'fixture',fit:'Relevant academic data work',evidenceIds:['python'],coverLetter:'I would like to contribute to practical data work.'});
 service.renderDocumentsFn=async({dir,includeLetter})=>{await mkdir(dir,{recursive:true});const cv=path.join(dir,'CV.pdf'),letter=includeLetter?path.join(dir,'Application.pdf'):null;await writeFile(cv,'%PDF fixture CV');if(letter)await writeFile(letter,'%PDF fixture letter');return {cv,letter,hashes:{cv:hash(await readFile(cv)),letter:letter?hash(await readFile(letter)):null}};};
 service.createNavigator=options=>new Navigator({...options,allowTest:true,headless:true,infer:async()=>({value:'My experience is academic Python MRI research.',evidenceIds:['python'],evidence:[{factId:'python',quote:profile.facts[0].text}],reason:'Verified research fact.'}),decide:async({observation})=>{
  const next=observation.controls.find(c=>c.label==='Next'),button=next||observation.controls.find(c=>c.label==='Submit application');return {action:next?'click':'final',target:button.target,reason:next?'Continue to the next form step.':'All fields are complete.'};
 }});
 const add=(company,route='/')=>service.store.add({company,title:'Data Scientist',location:'Copenhagen',score:80,url:`http://127.0.0.1:${site.address().port}${route}`}).job;
 const post=(route,body={})=>fetch(app.origin+route,{method:'POST',headers:{Origin:app.origin,'Content-Type':'application/json','X-Job-Desk-Token':app.csrf},body:JSON.stringify(body)});
 return {service,posts,add,post};
}
const basic=`<form method=post action=/send enctype=multipart/form-data><label>Email<input type=email name=email required></label><label>Resume<input type=file name=cv required></label><button type=submit>Submit application</button></form>`;

test('one Auto apply request infers answers, uploads both documents across steps and submits once',async t=>{
 const f=await fixture(t,()=>`<h1>Data Scientist</h1><script type="application/ld+json">{"@type":"JobPosting","jobLocation":{"address":{"postalCode":"2100","streetAddress":"Fixture Street 4","addressLocality":"Copenhagen"}},"validThrough":"2026-12-01"}</script><form method=post action=/send enctype=multipart/form-data><section id=one><label>Email<input type=email name=email required></label><label>Resume<input type=file name=cv required></label><label>Describe your Python experience<textarea name=experience required></textarea></label><label>Current company<input name=company required></label><label>Years of consulting experience<input name=years required></label><button type=button onclick="one.hidden=true;two.hidden=false">Next</button></section><section id=two hidden><label>Cover letter<input name=letter type=file required></label><button type=submit>Submit application</button></section></form>`);
 const j=f.add('Auto Fixture');
 assert.equal((await f.post(`/api/jobs/${j.id}/auto-apply`)).status,409);
 assert.equal((await f.post('/api/autonomy',{enabled:true})).status,200);assert.equal(f.posts.length,0,'enabling the button does not send anything');
 assert.equal((await f.post(`/api/jobs/${j.id}/auto-apply`)).status,200);await f.service.running;
 const done=f.service.store.get(j.id);assert.equal(done.stage,'submitted',done.navigation?.message||done.error);assert.equal(f.posts.length,1);
 for(const text of ['fixture@example.test','academic Python MRI research','Not employed','CV.pdf','Application.pdf','fixture letter'])assert.match(f.posts[0].body,new RegExp(text));
 assert.equal(done.draft.includeLetter,true);assert.equal(done.automatic.status,'submitted');
 const history=f.service.store.blocked(done);assert.equal(history.postcode,'2100');assert.equal(history.address,'Fixture Street 4');assert.equal(history.deadline,'2026-12-01');
 assert.equal((await f.post(`/api/jobs/${j.id}/auto-apply`)).status,409);assert.equal(f.posts.length,1);
 assert.ok(f.service.store.events(j.id).some(e=>e.action==='automatic_submission_authorized'));assert.ok(!f.service.store.events(j.id).some(e=>e.action==='approved_final'));
});

test('unknown required facts are skipped before exposure and the queue continues',async t=>{
 const f=await fixture(t,req=>req.url==='/unknown'?basic.replace('<button','<label>Work authorisation<input name=permission required></label><button'):basic);
 const unknown=f.add('Unknown Fixture','/unknown'),known=f.add('Known Fixture','/known');f.add('Known Fixture','/duplicate');
 await f.service.setAutonomy(true);assert.equal(f.service.autoCandidates().length,2);
 await f.service.autoRun();await f.service.running;
 const skipped=f.service.store.get(unknown.id);assert.equal(skipped.stage,'skipped');assert.equal(skipped.navigation.exposed,false);assert.match(skipped.automatic.reason,/Work authorisation/);assert.equal(f.service.store.blocked(skipped),null);
 assert.equal(f.service.store.get(known.id).stage,'submitted');assert.equal(f.posts.length,1);assert.deepEqual([f.service.autoBatch.completed,f.service.autoBatch.skipped],[1,1]);assert.equal(f.service.autoCandidates().length,0);
});

test('stop cancels preparation and prevents later jobs from starting',async t=>{
 const f=await fixture(t,()=>basic);f.add('First Fixture');f.add('Second Fixture','/second');let started;
 const ready=new Promise(r=>started=r);let calls=0;
 f.service.proposeFn=async({signal})=>{calls++;started();await new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('Stopped')),{once:true}));};
 await f.service.setAutonomy(true);await f.service.autoRun();await ready;await f.service.stopAutonomy();await f.service.running;
 assert.equal(f.posts.length,0);assert.equal(calls,1);assert.equal(f.service.autoBatch.running,false);
});

test('changed document bytes block automatic exposure',async t=>{
 const f=await fixture(t,()=>basic),j=f.add('Changed File Fixture');const render=f.service.renderDocumentsFn;
 f.service.renderDocumentsFn=async options=>{const result=await render(options);await writeFile(result.cv,'changed');return result;};
 await f.service.setAutonomy(true);await f.service.autoApply(j.id);await f.service.running;
 assert.equal(f.posts.length,0);assert.match(f.service.store.get(j.id).automatic.reason,/attachment changed/);assert.equal(f.service.store.blocked(j),null);
});

test('stopping during a later document preparation preserves the exposed application record',async t=>{
 const f=await fixture(t,()=>`<form method=post action=/send><section id=one><label>Email<input type=email name=email required></label><label>Resume<input type=file name=cv required></label><button type=button onclick="one.hidden=true;two.hidden=false">Next</button></section><section id=two hidden><label>Cover letter<input type=file name=letter required></label><button type=submit>Submit application</button></section></form>`);
 const j=f.add('Stop After Filling'),render=f.service.renderDocumentsFn;let signalReady,finishRender;
 const ready=new Promise(r=>signalReady=r),finish=new Promise(r=>finishRender=r);
 f.service.renderDocumentsFn=async options=>{if(options.includeLetter){signalReady();await finish;}return render(options);};
 await f.service.setAutonomy(true);await f.service.autoApply(j.id);await ready;
 await f.service.stopAutonomy();finishRender();await f.service.running;
 assert.equal(f.posts.length,0);assert.equal(f.service.store.get(j.id).stage,'uncertain');assert.equal(f.service.store.blocked(j).status,'uncertain');
 assert.equal(f.service.store.get(j.id).navigation.status,'stopped');assert.equal(f.service.autoBatch.running,false);
});

test('an unknown required fact on a later page stops that application without submitting',async t=>{
 const f=await fixture(t,()=>`<form method=post action=/send><section id=one><label>Email<input type=email name=email required></label><label>Resume<input type=file name=cv required></label><button type=button onclick="one.hidden=true;two.hidden=false">Next</button></section><section id=two hidden><label>Work authorisation<input name=permission required></label><button type=submit>Submit application</button></section></form>`);
 const j=f.add('Later Unknown');await f.service.setAutonomy(true);await f.service.autoApply(j.id);await f.service.running;
 assert.equal(f.posts.length,0);assert.equal(f.service.store.get(j.id).stage,'skipped');assert.match(f.service.store.get(j.id).automatic.reason,/Work authorisation/);assert.equal(f.service.store.blocked(j).status,'incomplete');
 assert.equal((await f.post(`/api/jobs/${j.id}/auto-apply`)).status,409);
});

test('automatic shortlist stays in Denmark and excludes leadership roles',()=>{
 assert.equal(autoEligible({title:'Data Scientist',location:'Copenhagen',score:80}),true);
 assert.equal(autoEligible({title:'Data Scientist',location:'London',score:80}),false);
 assert.equal(autoEligible({title:'Data Scientist Team Lead',location:'Copenhagen',score:80}),false);
 assert.equal(autoEligible({title:'Backend Engineer',location:'Copenhagen',score:39}),false);
});

test('reopening an unchanged application retains the saved CV-grounded answer',async t=>{
 const f=await fixture(t,()=>basic.replace('<button','<label>Describe your Python experience<textarea name=experience required></textarea></label><button'));
 const j=f.add('Reopened Application');await f.service.explore(j.id,{prepare:true});await f.service.running;
 let ready=f.service.store.get(j.id);const field=ready.draft.snapshot.form.fields.find(f=>f.name==='experience');
 const value='My experience is academic Python MRI research.';
 await f.service.edit(j.id,{revision:ready.revision,summary:ready.draft.summary,coverLetter:ready.draft.coverLetter,includeLetter:ready.draft.includeLetter,answers:{...ready.draft.answers,[field.key]:value}});await f.service.running;
 await f.service.session(j.id).close();
 const create=f.service.createNavigator;f.service.createNavigator=options=>{const n=create(options);n.infer=async()=>{throw new Error('The saved answer was lost.');};return n;};
 await f.service.setAutonomy(true);await f.service.autoApply(j.id);await f.service.running;
 assert.equal(f.service.store.get(j.id).stage,'submitted',f.service.store.get(j.id).automatic?.reason);
 assert.equal(f.posts.length,1);assert.ok(f.posts[0].body.includes(value));
});

test('Lever-style labels and yes/no checkbox groups use confirmed facts and record submission',async t=>{
 const question=(text,control)=>`<div><div class="application-label full-width"><div class=text>${text}<span>✱</span></div></div><div class="application-field full-width required-field">${control}</div></div>`;
 const html=`<form method=post action=/send novalidate><label>Email<input type=email name=email required></label><label>Resume<input type=file name=cv></label>`+
 question('Do you have a valid work permit in the EU?',`<ul><li><label><input type=checkbox name=permit value=Yes required>Yes</label></li><li><label><input type=checkbox name=permit value=No required>No</label></li></ul>`)+
 question('If you are not living in Copenhagen, are you willing to relocate?',`<input name=relocation placeholder="Type your response" required>`)+
 question('How would you rate your English language skills?',`<label><input type=radio name=english value=Fluent required>Fluent</label><label><input type=radio name=english value=Native required>Native</label>`)+
 question('Where did you hear about us?',`<select name=source required><option value="">Select...</option><option>Job Board</option><option>Linkedin</option></select>`)+
 `<label><input type=checkbox name=marketing>Contact me about future opportunities</label><button type=submit>Submit application</button></form>`;
 const f=await fixture(t,()=>html),j=f.add('Lever Controls Fixture');j.source='lever';f.service.store.save(j);f.service.store.set('profile',{...profile,englishProficiency:'Native',euWorkPermission:true});
 await f.service.setAutonomy(true);await f.service.autoApply(j.id);await f.service.running;
 const done=f.service.store.get(j.id);assert.equal(done.stage,'submitted',done.automatic?.reason);assert.equal(f.posts.length,1);
 const body=new URLSearchParams(f.posts[0].body);assert.deepEqual(body.getAll('permit'),['Yes']);assert.equal(body.get('english'),'Native');assert.equal(body.get('relocation'),'I already live in Copenhagen.');assert.equal(body.get('source'),'Job Board');assert.equal(body.has('marketing'),false);assert.equal(f.service.store.blocked(done).status,'submitted');
});
