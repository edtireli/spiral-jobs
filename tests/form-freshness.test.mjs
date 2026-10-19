import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {start} from '../server.mjs';
import {Navigator,observe,formChangeSummary} from '../lib/navigator.mjs';
import {hash} from '../lib/core.mjs';

const profile={name:'Fixture Person',firstName:'Fixture',lastName:'Person',email:'fixture@example.test',location:'Copenhagen, Denmark',englishProficiency:'Native',euWorkPermission:true,profile:'Fixture CV',facts:[{id:'python',text:'Python research pipelines.'}],unknowns:[]};
const basic='<form method=post action=/send><label>Email<input name=email type=email required></label><label>Resume<input name=cv type=file required></label><button type=submit>Submit application</button></form>';
async function fixture(t,html=basic){
 const dir=await mkdtemp(path.join(os.tmpdir(),'job-desk-freshness-')),posts=[];
 const site=http.createServer(async(req,res)=>{let body='';for await(const data of req)body+=data;if(req.method==='POST'){posts.push(body);res.end('We have received your application');return;}res.setHeader('Content-Type','text/html');res.end(html);});await new Promise(r=>site.listen(0,'127.0.0.1',r));
 const app=await start({port:0,dataDir:dir}),service=app.service;
 t.after(async()=>{await service.stopAutonomy();await service.running;for(const n of service.navigators?.values()||[])await n.close();await new Promise(r=>app.server.close(r));service.store.close();await new Promise(r=>site.close(r));await rm(dir,{recursive:true,force:true});});
 const f={service,posts,renders:0,proposals:0,opens:0,inferences:0,afterRender:async()=>{}};
 service.store.set('profile',profile);service.store.set('model','fixture');
 service.proposeFn=async()=>{f.proposals++;return {model:'fixture',fit:'Relevant Python research',evidenceIds:['python'],coverLetter:''};};
 service.renderDocumentsFn=async({dir,includeLetter})=>{f.renders++;await mkdir(dir,{recursive:true});const cv=path.join(dir,'CV.pdf'),letter=includeLetter?path.join(dir,'Application.pdf'):null;await writeFile(cv,'%PDF fixture');if(letter)await writeFile(letter,'%PDF fixture letter');const artifacts={cv,letter,hashes:{cv:hash(await readFile(cv)),letter:letter?hash(await readFile(letter)):null}};await f.afterRender(f.renders);return artifacts;};
 service.createNavigator=options=>{f.opens++;return new Navigator({...options,headless:true,allowTest:true,infer:async()=>{f.inferences++;return {value:'I built Python research pipelines.',evidenceIds:['python'],evidence:[{factId:'python',quote:profile.facts[0].text}],reason:'Verified fact.'};},decide:async({observation})=>({action:'final',target:observation.controls.find(c=>c.label==='Submit application').target,reason:'Fields complete.'})});};
 f.job=service.store.add({company:'Freshness Fixture',title:'Data Scientist',location:'Copenhagen',score:80,url:`http://127.0.0.1:${site.address().port}/`}).job;
 f.events=()=>service.store.events(f.job.id).map(e=>({...e,detail:JSON.parse(e.detail)}));return f;
}

test('diagnostics name changed properties without copying field labels, choices or values',()=>{
 const old={url:'https://example.test',form:{fields:[{key:'q1',label:'private label',options:[{value:'private value'}]}]}},fresh=structuredClone(old);fresh.form.fields[0].required=true;delete fresh.form.fields[0].options;
 const diff=formChangeSummary(old,fresh);assert.deepEqual(diff.changed,[{key:'q1',properties:['options','required']}]);assert.ok(!JSON.stringify(diff).includes('private'));
});

test('a changed form refreshes before exposure and keeps Full or Final approval mode',async t=>{
 for(const mode of ['full','final'])await t.test(mode,async t=>{
  const f=await fixture(t);f.afterRender=async count=>{if(count===1)await f.service.session(f.job.id).page.locator('form').evaluate(el=>el.insertAdjacentHTML('beforeend','<label>Describe your Python experience<textarea name=skills required></textarea></label>'));};
  if(mode==='full')await f.service.setAutonomy(true);await f.service.autoApply(f.job.id,mode);await f.service.running;
  assert.equal(f.renders,3);assert.equal(f.proposals,1);assert.equal(f.opens,1);assert.equal(f.inferences,1);assert.equal(f.events().filter(e=>e.action==='automatic_form_refreshed').length,1);
  if(mode==='final'){const n=f.service.session(f.job.id);assert.equal(n.state.status,'final_review');assert.equal(f.posts.length,0);await f.service.finalNavigation(f.job.id,{confirm:true,key:n.final.key});await f.service.running;}
  assert.equal(f.posts.length,1);assert.match(f.posts[0],/Python/);assert.equal(f.service.store.get(f.job.id).stage,'submitted');assert.equal(f.service.store.applications().length,1);
 });
});

test('fresh option labels are remapped from facts instead of reusing stale choice values',async t=>{
 const f=await fixture(t,basic.replace('<button','<label>Do you have a valid work permit in the EU?<select name=permit required><option value="">Select</option><option value=a>Yes</option><option value=b>No</option></select></label><button'));
 f.afterRender=async count=>{if(count===1)await f.service.session(f.job.id).page.locator('select').evaluate(el=>{el.options[1].text='No';el.options[2].text='Yes';});};
 await f.service.setAutonomy(true);await f.service.autoApply(f.job.id);await f.service.running;
 assert.equal(f.renders,2);assert.equal(f.posts.length,1);assert.equal(new URLSearchParams(f.posts[0]).get('permit'),'b');
});

test('new unsupported required facts stop before exposure, and unstable forms have a fixed refresh limit',async t=>{
 for(const kind of ['unknown','unstable'])await t.test(kind,async t=>{
  const f=await fixture(t);f.afterRender=async count=>{if(kind==='unknown'&&count>1)return;await f.service.session(f.job.id).page.locator('form').evaluate((el,{count,kind})=>el.insertAdjacentHTML('beforeend',`<label>${kind==='unknown'?'Do you require visa sponsorship?':'Describe your Python experience'}<textarea name=extra${count} required></textarea></label>`),{count,kind});};
  await f.service.setAutonomy(true);await f.service.autoApply(f.job.id);await f.service.running;
  assert.equal(f.posts.length,0);assert.equal(f.service.store.blocked(f.job),null);assert.equal(f.service.store.get(f.job.id).navigation.exposed,false);assert.equal(f.opens,1);assert.equal(f.renders,kind==='unknown'?2:5);assert.equal(f.events().filter(e=>e.action==='automatic_form_refreshed').length,kind==='unknown'?1:2);
  assert.match(f.service.store.get(f.job.id).automatic.reason,kind==='unknown'?/Required answer is not established/:/kept changing/);
 });
});

test('manual reviewed approval does not automatically accept a changed form',async t=>{
 const f=await fixture(t);await f.service.explore(f.job.id,{prepare:true});await f.service.running;const d=f.service.store.get(f.job.id).draft,n=f.service.session(f.job.id);
 await n.page.locator('form').evaluate(el=>el.insertAdjacentHTML('beforeend','<label>New question<input name=new required></label>'));
 await f.service.approveFill(f.job.id,{confirm:true,revision:d.revision,reviewHash:d.reviewHash});await f.service.running;
 assert.equal(f.posts.length,0);assert.equal(n.exposed,false);assert.equal(f.renders,1);assert.equal(f.events().filter(e=>e.action==='automatic_form_refreshed').length,0);assert.match(f.service.store.get(f.job.id).error,/form changed/);
});

test('a form refresh cannot replace altered attachment bytes and continue',async t=>{
 const f=await fixture(t),create=f.service.createNavigator;
 f.service.createNavigator=options=>{const n=create(options),approve=n.approve.bind(n);n.approve=async draft=>{try{return await approve(draft);}catch(e){if(e.code==='FORM_CHANGED')await writeFile(draft.artifacts.cv,'changed attachment');throw e;}};return n;};
 f.afterRender=async count=>{if(count===1)await f.service.session(f.job.id).page.locator('form').evaluate(el=>el.insertAdjacentHTML('beforeend','<input name=added>'));};
 await f.service.setAutonomy(true);await f.service.autoApply(f.job.id);await f.service.running;
 assert.equal(f.renders,1);assert.equal(f.posts.length,0);assert.equal(f.service.store.blocked(f.job),null);assert.match(f.service.store.get(f.job.id).automatic.reason,/attachment changed/);
});

test('Stop during refreshed document preparation prevents any subsequent exposure',async t=>{
 const f=await fixture(t);let ready,release;const started=new Promise(r=>ready=r),pending=new Promise(r=>release=r);
 f.afterRender=async count=>{if(count===1)await f.service.session(f.job.id).page.locator('form').evaluate(el=>el.insertAdjacentHTML('beforeend','<input name=added>'));else{ready();await pending;}};
 await f.service.setAutonomy(true);await f.service.autoApply(f.job.id);await started;await f.service.stopAutonomy();release();await f.service.running;
 assert.equal(f.renders,2);assert.equal(f.posts.length,0);assert.equal(f.service.store.blocked(f.job),null);assert.equal(f.service.store.get(f.job.id).navigation.exposed,false);assert.equal(f.service.autoAllowed(),false);
});

test('upload processing text does not create a new CV field or repeat attachment',async t=>{
 const html=basic.replace('<label>Resume<input name=cv type=file required></label>','<div><div class=application-label>Resume/CV</div><div class=application-field><label id=upload for=cv>ATTACH RESUME/CV</label><input id=cv name=cv type=file required onchange="upload.textContent=\'CV.PDF Analyzing resume...\';window.uploads=(window.uploads||0)+1"></div></div>');
 const f=await fixture(t,html);await f.service.autoApply(f.job.id,'final');await f.service.running;const n=f.service.session(f.job.id);
 assert.equal(n.state.status,'final_review',n.state.message);assert.equal(await n.page.evaluate(()=>window.uploads),1);assert.equal(f.events().filter(e=>e.action==='field_filled'&&e.detail.attachment==='@cv').length,1);assert.equal(f.posts.length,0);
});

test('radio positions are resolved again after a pause shifts DOM controls',async t=>{
 const f=await fixture(t,basic.replace('<button','<fieldset><legend>How would you rate your English language skills?</legend><label><input type=radio name=english value=Fluent required>Fluent</label><label><input type=radio name=english value=Native required>Native</label></fieldset><button'));
 const create=f.service.createNavigator;let ready,paused=false;const started=new Promise(r=>ready=r);
 f.service.createNavigator=options=>{const n=create(options),before=n.beforeAction.bind(n);n.beforeAction=async locator=>{await before(locator);if(!paused&&locator&&await locator.evaluate(el=>el.type==='radio'&&el.value==='Native')){paused=true;f.service.pauseExecution({runId:f.service.busy.id});ready();await n.checkpoint();}};return n;};
 await f.service.autoApply(f.job.id,'final');await started;const n=f.service.session(f.job.id);
 await n.page.locator('form').evaluate(el=>el.insertAdjacentHTML('afterbegin','<input name=transient type=hidden><button type=button hidden>Inserted</button>'));
 f.service.resumeExecution({runId:f.service.busy.id});await f.service.running;
 assert.equal(n.state.status,'final_review',n.state.message);assert.equal(await n.page.locator('[value=Native]').isChecked(),true);assert.equal(await n.page.locator('[value=Fluent]').isChecked(),false);assert.equal(f.posts.length,0);
 const original=n.final.key;await n.page.locator('form').evaluate(el=>el.insertAdjacentHTML('afterbegin','<input type=hidden name=late>'));await n.finalSubmit(original);
 assert.equal(n.state.status,'submitted');assert.equal(f.posts.length,1);assert.equal(new URLSearchParams(f.posts[0]).get('english'),'Native');
});
