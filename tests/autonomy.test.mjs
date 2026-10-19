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
 return {service,posts,add,post,origin:app.origin};
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

async function until(check,message){const end=Date.now()+15000;while(Date.now()<end){if(await check())return;await new Promise(r=>setTimeout(r,30));}throw Error(message);}

test('pause during planning holds before rendering or exposure; resume finishes the same application',async t=>{
 const f=await fixture(t,()=>basic),j=f.add('Pause Planning');let ready,finish;
 const started=new Promise(r=>ready=r),model=new Promise(r=>finish=r),propose=f.service.proposeFn;let rendered=0;
 const render=f.service.renderDocumentsFn;f.service.renderDocumentsFn=async args=>{rendered++;return render(args);};
 f.service.proposeFn=async args=>{ready();await model;return propose(args);};
 await f.service.setAutonomy(true);await f.service.autoApply(j.id);await started;
 const runId=f.service.busy.id;
 assert.equal((await f.post('/api/control/pause',{runId:'stale'})).status,409);
 assert.equal((await f.post('/api/control/pause',{runId})).status,200);
 assert.equal(f.service.executionState().status,'pausing');finish();
 await until(()=>f.service.executionState()?.status==='paused','Run did not pause');
 assert.equal(rendered,0);assert.equal(f.posts.length,0);assert.equal(f.service.session(j.id).exposed,false);
 assert.equal((await f.post('/api/control/resume',{runId})).status,200);await f.service.running;
 assert.equal(f.posts.length,1);assert.equal(f.service.store.get(j.id).stage,'submitted');assert.equal(f.service.executionState(),null);
 assert.equal((await f.post('/api/control/resume',{runId})).status,409);
});

test('pause after filling holds uploads, shows the real target cursor, and resumes without refilling',async t=>{
 const f=await fixture(t,()=>basic),j=f.add('Pause After Field'),create=f.service.createNavigator;
 let filled=0,paused=false;
 f.service.createNavigator=options=>{const n=create({...options,onEvent:(action,detail)=>{options.onEvent(action,detail);if(action==='field_filled'&&detail.label==='Email'){filled++;if(!paused){paused=true;f.service.pauseExecution({runId:f.service.busy.id});}}}});return n;};
 await f.service.setAutonomy(true);await f.service.autoApply(j.id);
 await until(()=>f.service.executionState()?.status==='paused','Filling did not pause');
 const n=f.service.session(j.id);assert.equal(n.closed,false);assert.equal(await n.page.locator('[name=email]').inputValue(),profile.email);
 assert.equal(await n.page.locator('[name=cv]').evaluate(e=>e.files.length),0);assert.equal(f.posts.length,0);
 assert.ok(n.cursor?.x>0&&n.cursor?.y>0);assert.equal(await n.page.locator('[data-spiral-control]').count(),1);
 const observed=await (await import('../lib/navigator.mjs')).observe(n.page);assert.ok(!observed.snapshot.text.includes('AI paused'),'Overlay must not become model evidence');
 await f.post('/api/control/resume',{runId:f.service.busy.id});await f.service.running;
 assert.equal(filled,1);assert.equal(f.posts.length,1);assert.equal(f.service.store.applications().length,1);
});

test('stop while paused cannot resume or move on to the next employer',async t=>{
 const f=await fixture(t,()=>basic);const first=f.add('Pause Then Stop');f.add('Must Not Start','/next');let renders=0;
 const render=f.service.renderDocumentsFn;
 f.service.renderDocumentsFn=async args=>{renders++;const out=await render(args);f.service.pauseExecution({runId:f.service.busy.id});return out;};
 await f.service.setAutonomy(true);await f.service.autoRun();await until(()=>f.service.executionState()?.status==='paused','Preparation did not pause');
 const runId=f.service.busy.id;await f.service.stopAutonomy();await f.service.running;
 assert.equal(renders,1);assert.equal(f.posts.length,0);assert.equal(f.service.autoBatch.running,false);assert.equal((await f.post('/api/control/resume',{runId})).status,409);
 assert.notEqual(f.service.store.get(first.id).stage,'submitted');
});

test('dashboard pause controls the real executor and releases AI ownership after the receipt',async t=>{
 const f=await fixture(t,()=>basic),j=f.add('Control Preview'),create=f.service.createNavigator;let ready,finish;
 const deciding=new Promise(r=>ready=r),release=new Promise(r=>finish=r);
 f.service.createNavigator=options=>{const n=create(options),decide=n.decide;n.decide=async args=>{ready();await Promise.race([release,new Promise((_,reject)=>args.signal.addEventListener('abort',()=>reject(Error('Stopped')),{once:true}))]);return decide(args);};return n;};
 await f.service.setAutonomy(true);await f.service.autoApply(j.id);await deciding;
 const {browserSession}=await import('../lib/browser.mjs'),b=await browserSession({allowTest:true,headless:true});b.gate.approved=true;t.after(()=>b.browser.close());
 await b.page.goto(f.origin);await b.page.getByRole('button',{name:'Pause AI',exact:true}).waitFor();
 assert.equal(await b.page.locator('body').getAttribute('data-ai-control'),'active');
 await mkdir(path.resolve('.cache'),{recursive:true});await b.page.screenshot({path:path.resolve('.cache/app-ai-active.png')});
 await b.page.locator('#profileButton').click();await b.page.locator('dialog[open] #pauseAI').waitFor();
 await b.page.getByRole('button',{name:'Pause AI',exact:true}).click();await until(()=>f.service.executionState()?.status==='pausing','Pause was not received');finish();
 await b.page.getByRole('button',{name:'Resume AI',exact:true}).waitFor();
 assert.equal(f.service.executionState().status,'paused');assert.equal(f.posts.length,0);
 await b.page.locator('dialog[open] [data-close]').click();await b.page.screenshot({path:path.resolve('.cache/app-ai-paused.png')});
 await b.page.getByRole('button',{name:'Resume AI',exact:true}).click();await f.service.running;
 await b.page.waitForFunction(()=>document.querySelector('#aiControlBar').hidden);
 assert.equal(f.posts.length,1);assert.equal(await b.page.locator('body').getAttribute('data-ai-control'),'idle');
});

test('a changed final form during pause blocks sending',async t=>{
 const f=await fixture(t,()=>basic),j=f.add('Changed While Paused'),create=f.service.createNavigator;
 f.service.createNavigator=options=>{const n=create(options),before=n.beforeAction.bind(n);let held=false;n.beforeAction=async locator=>{if(n.final&&!n.finalClicked&&!held){held=true;f.service.pauseExecution({runId:f.service.busy.id});}return before(locator);};return n;};
 await f.service.setAutonomy(true);await f.service.autoApply(j.id);await until(()=>f.service.executionState()?.status==='paused','Final click did not pause');
 const n=f.service.session(j.id);await n.page.locator('[name=email]').fill('changed@example.test');await f.post('/api/control/resume',{runId:f.service.busy.id});await f.service.running;
 assert.equal(f.posts.length,0);assert.match(f.service.store.get(j.id).automatic.reason,/changed while paused/);
});

test('pausing after the final click resumes receipt checking without resubmission',async t=>{
 const f=await fixture(t,()=>basic),j=f.add('Pause Receipt'),create=f.service.createNavigator;
 f.service.createNavigator=options=>{const n=create(options),receipt=n.waitForReceipt.bind(n);n.waitForReceipt=async args=>{f.service.pauseExecution({runId:f.service.busy.id});return receipt(args);};return n;};
 await f.service.setAutonomy(true);await f.service.autoApply(j.id);await until(()=>f.service.executionState()?.status==='paused','Receipt check did not pause');
 assert.equal(f.posts.length,1);assert.equal(f.service.session(j.id).finalClicked,true);
 await f.post('/api/control/resume',{runId:f.service.busy.id});await f.service.running;
 assert.equal(f.posts.length,1);assert.equal(f.service.store.get(j.id).stage,'submitted');
});

test('changed attachments during a final pause invalidate sending',async t=>{
 const f=await fixture(t,()=>basic),j=f.add('Attachment Changed During Pause'),create=f.service.createNavigator;
 f.service.createNavigator=options=>{const n=create(options),before=n.beforeAction.bind(n);let held=false;n.beforeAction=async locator=>{if(n.final&&!n.finalClicked&&!held){held=true;f.service.pauseExecution({runId:f.service.busy.id});}return before(locator);};return n;};
 await f.service.setAutonomy(true);await f.service.autoApply(j.id);await until(()=>f.service.executionState()?.status==='paused','Final click did not pause');
 await writeFile(f.service.session(j.id).artifacts.cv,'changed while paused');await f.post('/api/control/resume',{runId:f.service.busy.id});await f.service.running;
 assert.equal(f.posts.length,0);assert.match(f.service.store.get(j.id).automatic.reason,/attachment changed/);
});

test('review mode prepares only; final approval mode fills but never sends until explicit approval',async t=>{
 const f=await fixture(t,()=>basic),j=f.add('Approval Modes Fixture');
 assert.equal((await f.post(`/api/jobs/${j.id}/auto-apply`,{mode:'review'})).status,200);await f.service.running;
 let saved=f.service.store.get(j.id);assert.equal(saved.navigation.status,'review');assert.equal(saved.navigation.approvalMode,'review');assert.equal(f.service.session(j.id).exposed,false);assert.equal(f.posts.length,0);
 assert.equal((await f.post(`/api/jobs/${j.id}/auto-apply`,{mode:'final'})).status,200);await f.service.running;
 saved=f.service.store.get(j.id);assert.equal(saved.navigation.status,'final_review',saved.error||saved.navigation.message);assert.equal(saved.navigation.approvalMode,'final');assert.ok(!f.service.session(j.id).closed);assert.equal(f.posts.length,0);
 await f.service.setAutonomy(true);assert.equal(f.posts.length,0,'changing the global full-auto switch does not submit a held application');
 assert.equal((await f.post(`/api/jobs/${j.id}/auto-apply`,{mode:'full'})).status,409,'cannot replay an exposed application');
 assert.equal((await f.post(`/api/jobs/${j.id}/approve-final`,{confirm:true,key:saved.navigation.finalReview.key})).status,200);await f.service.running;
 assert.equal(f.posts.length,1);assert.equal(f.service.store.get(j.id).stage,'submitted');
});

test('final approval mode keeps the first browser open and does not move on to another job',async t=>{
 const f=await fixture(t,()=>basic),first=f.add('First Approval'),second=f.add('Second Approval','/second');
 await f.service.autoRun({mode:'final'});await f.service.running;
 assert.equal(f.service.store.get(first.id).navigation.status,'final_review');assert.equal(f.service.store.get(second.id).navigation,undefined);assert.equal(f.posts.length,0);assert.ok(!f.service.session(first.id).closed);
});

test('invalid vision decisions retain the exposed browser and resume without refilling or changing approval mode',async t=>{
 for(const mode of ['full','final'])await t.test(mode,async t=>{
  const f=await fixture(t,()=>basic),first=f.add('Recoverable Vision '+mode),second=f.add('Later Employer '+mode,'/second'),create=f.service.createNavigator;let decisions=0,opens=0;
  f.service.createNavigator=options=>{opens++;const n=create(options),decide=n.decide;n.decide=async args=>{if(++decisions===1)throw new Error('The local model could not produce a valid result after formatting.');return decide(args);};return n;};
  if(mode==='full')await f.service.setAutonomy(true);
  await f.service.autoRun({jobIds:[first.id,second.id],mode});await f.service.running;
  const original=f.service.session(first.id),record=f.service.store.blocked(first),fills=f.service.store.events(first.id).filter(e=>e.action==='field_filled').length;
  assert.equal(original.state.status,'paused');assert.equal(original.state.recoverable,'model_decision');assert.equal(original.closed,false);assert.equal(original.exposed,true);assert.equal(original.finalClicked,false);assert.equal(record.status,'incomplete');assert.equal(f.posts.length,0);assert.equal(opens,1);assert.equal(f.service.autoBatch.skipped,0);assert.equal(f.service.store.get(second.id).navigation,undefined);
  assert.equal((await f.post(`/api/jobs/${first.id}/auto-apply`,{mode})).status,409,'an exposed paused application cannot be replayed');
  await f.service.resumeNavigation(first.id);await f.service.running;
  assert.equal(opens,1);assert.equal(f.service.store.blocked(first).id,record.id);assert.equal(f.service.store.events(first.id).filter(e=>e.action==='field_filled').length,fills,'resume does not repeat uploads or completed fields');
  if(mode==='final'){
   assert.equal(f.posts.length,0);assert.equal(f.service.session(first.id),original);assert.equal(original.state.status,'final_review');assert.equal(original.automatic,false);
   await f.service.finalNavigation(first.id,{confirm:true,key:original.final.key});await f.service.running;
  }
  assert.equal(f.posts.length,1);assert.equal(f.service.store.get(first.id).stage,'submitted');assert.equal(f.service.store.events(first.id).filter(e=>e.action==='final_submit_started').length,1);
 });
});

test('disabling automatic applications stops a browser held after a model failure',async t=>{
 const f=await fixture(t,()=>basic),job=f.add('Stopped Model Failure'),create=f.service.createNavigator;
 f.service.createNavigator=options=>{const n=create(options);n.decide=async()=>{throw new Error('No valid decision');};return n;};
 await f.service.setAutonomy(true);await f.service.autoApply(job.id);await f.service.running;
 const original=f.service.session(job.id);assert.equal(original.state.recoverable,'model_decision');await f.service.setAutonomy(false);
 assert.equal(original.closed,true);assert.equal(f.posts.length,0);assert.equal(f.service.store.blocked(job).status,'uncertain');await assert.rejects(async()=>f.service.resumeNavigation(job.id),/no longer open/);
});

test('Stop and disable cancel a resumed automatic decision even after its batch ended',async t=>{
 for(const control of ['stop','disable'])await t.test(control,async t=>{
  const f=await fixture(t,()=>basic),job=f.add('Resumed Stop '+control),create=f.service.createNavigator;let decisions=0,ready,release;
  const started=new Promise(r=>ready=r),pending=new Promise(r=>release=r);
  f.service.createNavigator=options=>{const n=create(options),decide=n.decide;n.decide=async args=>{if(++decisions===1)throw new Error('No valid decision');ready();await pending;return decide(args);};return n;};
  await f.service.setAutonomy(true);await f.service.autoApply(job.id);await f.service.running;
  const original=f.service.session(job.id),record=f.service.store.blocked(job);assert.equal(original.state.recoverable,'model_decision');assert.equal(f.service.autoBatch.running,false);
  await f.service.resumeNavigation(job.id);await started;assert.equal(original.state.status,'running');
  const fills=f.service.store.events(job.id).filter(e=>e.action==='field_filled').length,actions=f.service.store.events(job.id).filter(e=>e.action==='navigation_action').length;
  if(control==='disable')await f.service.setAutonomy(false);else await f.service.stopAutonomy();
  release();await f.service.running;
  assert.equal(f.service.autoBatch.stopping,true);assert.equal(f.service.autoAllowed(),false);assert.equal(original.closed,true);assert.equal(f.posts.length,0);
  assert.equal(f.service.store.get(job.id).navigation.status,'stopped');assert.equal(f.service.store.blocked(job).id,record.id);assert.equal(f.service.store.blocked(job).status,'uncertain');
  assert.equal(f.service.store.events(job.id).filter(e=>e.action==='field_filled').length,fills);assert.equal(f.service.store.events(job.id).filter(e=>e.action==='navigation_action').length,actions,'late model result cannot execute another action');
  assert.equal(f.service.store.events(job.id).filter(e=>e.action==='final_submit_started').length,0);await assert.rejects(async()=>f.service.resumeNavigation(job.id),/no longer open/);
 });
});

test('a submit button labelled Next cannot be clicked without final review',async t=>{
 const f=await fixture(t,()=>basic.replace('Submit application','Next')),job=f.add('Mislabelled Submit');
 await f.service.setAutonomy(true);await f.service.autoApply(job.id);await f.service.running;
 assert.equal(f.posts.length,0);assert.equal(f.service.store.blocked(job).status,'incomplete');
 assert.match(f.service.store.get(job.id).automatic.reason,/submit control requires final submission review/);
 assert.equal(f.service.store.events(job.id).filter(e=>e.action==='final_submit_started').length,0);
});
