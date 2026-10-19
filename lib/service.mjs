import path from 'node:path';
import {ExecutionControl} from './execution-control.mjs';
import {defaultInterests,validateInterests,preferenceRank} from './interests.mjs';
import {trackedProjectLink} from './tracking.mjs';
import {GmailMailbox} from './mail.mjs';
import {mkdir,readFile,readdir,writeFile} from 'node:fs/promises';
import {id,hash,now,assert,rank} from './core.mjs';
import {Store} from './store.mjs';
import {discover,defaultSources} from './sources.mjs';
import {models,propose,factualLetter} from './model.mjs';
import {capture,proposedAnswers,validateAnswers,dispatch} from './browser.mjs';
import {renderDocuments,profiles} from './documents.mjs';
import {navigationMethods} from './navigation-service.mjs';
import {isLetter} from './navigator.mjs';
import {recordModelProgress} from './model-progress.mjs';
import {autonomyMethods} from './autonomy.mjs';
export class Service {
 constructor(root,dataDir,{dispatchFn=dispatch,proposeFn=propose,renderDocumentsFn=renderDocuments}={}){this.root=root;this.dataDir=dataDir;this.store=new Store(dataDir);this.busy=null;Object.assign(this,{dispatchFn,proposeFn,renderDocumentsFn});}
 async init(){
  this.mailbox=new GmailMailbox({dataDir:this.dataDir,settings:()=>({...this.store.settings().gmail,email:this.store.settings().profile?.email}),save:value=>this.store.set('gmail',value)});
  if(!this.store.settings().interests)this.store.set('interests',defaultInterests);
  if(!this.store.settings().sources)this.store.set('sources',defaultSources);
  if(!this.store.settings().model)this.store.set('model','');
  if(!this.store.settings().profile)this.store.set('profile',JSON.parse(await readFile(path.join(this.root,'resources/profile.json'),'utf8')));
  if(!this.store.settings().navigationModel)this.store.set('navigationModel','');
  for(const j of this.store.jobs())if(j.navigation&&!['submitted','uncertain','stopped','skipped'].includes(j.navigation.status)){
   j.navigation={...j.navigation,status:'stopped',message:'The app restarted. Browser sessions are not replayed.'};
   if(this.store.blocked(j)){j.stage='uncertain';j.error='The previous browser session ended after approval. Check the employer site; repeat applications are blocked.';}
   this.store.save(j);
  }

 }
 state(){const settings=this.store.settings();return {control:this.executionState(),gmail:this.mailbox?.state,busy:this.busy,jobs:this.store.jobs().map(j=>({...j,description:undefined,pageText:undefined,listing:undefined,reasoning:undefined,navigation:j.navigation?{status:j.navigation.status,sequence:j.navigation.sequence,exposed:j.navigation.exposed}:null,draft:j.draft?{revision:j.revision,includeLetter:j.draft.includeLetter}:null,snapshot:undefined,blocked:this.store.blocked(j)})),history:this.store.applications(),settings:{interests:settings.interests,tracking:{enabled:!!settings.tracking?.enabled,origin:settings.tracking?.origin||''},model:settings.model,navigationModel:settings.navigationModel,sources:settings.sources,availability:settings.profile.availability,salary:settings.profile.salary},candidate:Object.fromEntries(['name','email','phone','location','github','availability','salary'].map(k=>[k,settings.profile[k]])),historyPolicy:'One application per employer. Uncertain submissions also block retries.'};}
 detail(jid){const j=this.store.get(jid);return {...j,blocked:this.store.blocked(j),events:this.store.events(jid)};}
 executionState(){return this.execution?{...this.execution.state(),jobId:this.busy?.jobId,approvalMode:this.navigators?.get(this.busy?.jobId)?.approvalMode||this.autoBatch?.mode||'review',label:this.busy?.label}:null;}
 async checkpoint(){return this.execution?.checkpoint();}
 syncBrowserControl(){this.mailbox?.syncControl?.().catch(()=>{});for(const n of this.navigators?.values()||[])n.syncControl?.().catch(()=>{});}
 pauseExecution({runId}){assert(this.execution&&this.busy?.id===runId,'This run has ended. Reload its current state.',409);this.store.event(this.busy.jobId,'application_pause_requested',{});return this.execution.pause();}
 resumeExecution({runId}){assert(this.execution&&this.busy?.id===runId,'This run has ended. Reload its current state.',409);assert(!this.autoBatch?.running||this.autoAllowed(),'Automatic applications are stopped.',409);const state=this.execution.resume();this.store.event(this.busy.jobId,'application_resumed',{});return state;}
 async run(label,jid,fn,{controlled=!!jid}={}){assert(!this.busy,'Another task is running. Wait for it to finish.',409);this.lastError=null;this.busy={id:id(),label,jobId:jid,startedAt:now()};
  this.execution=controlled?new ExecutionControl(this.busy.id,()=>this.syncBrowserControl()):null;
  const p=(async()=>{try{await this.checkpoint();await fn();}catch(e){this.store.event(jid,'error',{message:e.message});if(jid){const j=this.store.get(jid);j.error=e.message;this.store.save(j);}this.lastError=e.message;}finally{this.execution?.finish();this.execution=null;this.busy=null;this.syncBrowserControl();}})();this.running=p;return {queued:true};}

 scan(){return this.run('Finding Denmark roles',null,async()=>{const r=await discover(this.store.settings().sources,msg=>{this.busy.label=msg;},this.store.settings().interests);let added=0;for(const j of r.jobs)if(this.store.add(j).added)added++;this.store.set('lastScan',{at:now(),added,total:r.jobs.length,errors:r.errors});});}
 add(data){assert(!this.busy,'Wait for the current task.',409);assert(typeof data.url==='string'&&typeof data.company==='string'&&typeof data.title==='string','URL, company and title are required.');const job={...data,location:data.location||'Denmark',description:'',source:'manual'};return this.store.add({...job,...preferenceRank(job,this.store.settings().interests)});}
 inspect(jid){return this.run('Capturing job website',jid,async()=>{
  const j=this.store.get(jid);assert(!this.store.blocked(j),'This employer is already in your application history.',409);
  const dir=path.join(this.dataDir,'artifacts',jid);await mkdir(dir,{recursive:true});
  const s=await capture(j.applyUrl||j.url,path.join(dir,'website.jpg'));
  j.snapshot=s;j.pageText=s.text;j.description=j.description||s.text;j.error=null;j.stage=s.expired?'closed':'inspected';j.revision++;delete j.draft;
  Object.assign(j,preferenceRank(j,this.store.settings().interests));this.store.save(j);this.store.event(jid,'inspected',{supported:s.supported,url:s.url});
 });}
 draft(jid,includeLetter){return this.run('Preparing the application documents',jid,()=>this.prepareDraft(jid,includeLetter));}
 async prepareDraft(jid,includeLetter,reuse=null){
  const j=this.store.get(jid);assert(!this.store.blocked(j),'Already applied to this employer.',409);
  assert(j.snapshot&&!j.snapshot.expired,'Inspect a live job page first.');
  const {profile,model,navigationModel}=this.store.settings(),signal=this.navigators?.get(jid)?.abort.signal;
  if(reuse)this.preparationProgress(jid,'Reusing your CV; updating the application review.');
  await this.checkpoint();
  const ai=reuse?{...reuse,coverLetter:reuse.coverLetter||factualLetter(j,reuse.evidenceIds||[],'',profile)}:await this.proposeFn({job:j,profile,model,navigationModel,signal,screenshot:path.join(this.dataDir,'artifacts',jid,'website.jpg'),onProgress:(message,run)=>this.preparationProgress(jid,message,run)});
  await this.checkpoint();
  assert(!signal?.aborted,'Application preparation stopped.');
  const letterRequired=(j.snapshot.form?.fields||[]).some(f=>f.required&&isLetter(f));
  includeLetter=includeLetter??(letterRequired||reuse?.includeLetter||false);
  const answers=proposedAnswers(j.snapshot,profile,includeLetter,j.source);
  // Reopening the same form must retain verified answers that the profile cannot
  // fill directly. A changed question/options or profile requires fresh answers.
  if(reuse?.snapshot?.fingerprint===j.snapshot.fingerprint&&reuse?.profile&&hash(reuse.profile)===hash(profile)){
   for(const f of j.snapshot.form?.fields||[])if(!['file','checkbox'].includes(f.type)&&!answers[f.key]&&typeof reuse.answers?.[f.key]==='string')answers[f.key]=reuse.answers[f.key];
  }
  const draft={...ai,profile:structuredClone(profile),focus:'original',summary:reuse?.summary||profile.profile,coverLetter:includeLetter?ai.coverLetter:'',includeLetter,letterReason:letterRequired?'Required by the application form.':'No application letter is required on this step.',answers,snapshot:j.snapshot};
  for(const f of j.snapshot.form?.fields||[])if(includeLetter&&isLetter(f)&&f.type!=='file')draft.answers[f.key]=draft.coverLetter;
  await this.render(j,draft);this.preparationProgress(jid,'Documents ready. Review, then approve filling.');this.store.event(jid,'drafted',{model,evidenceIds:ai.evidenceIds});
 }
 preparationProgress(jid,message,run){
  if(this.busy)this.busy.label=message;
  const n=this.navigators?.get(jid);if(!n||n.closed)return;
  const latest=this.store.get(jid),activity=[...(latest.navigation?.activity||[])];
  const modelRun=run?recordModelProgress(latest,run):latest.navigation?.modelRun;
  const item={time:now(),message,phase:'prepare'};
  if(activity.at(-1)?.message.replace(/ · \d+s$/,'')===message.replace(/ · \d+s$/,''))activity[activity.length-1]=item;else activity.push(item);
  latest.navigation={...latest.navigation,modelRun,activity:activity.slice(-40),message,sequence:(latest.navigation?.sequence||0)+1};
  n.state=latest.navigation;n.sequence=latest.navigation.sequence;this.store.save(latest);
 }
 async render(j,draft){
  await this.checkpoint();
  const navigator=this.navigators?.get(j.id),signal=navigator&&!navigator.closed?navigator.abort.signal:null;
  this.busy.label='Compiling English CV and application';const rev=this.store.get(j.id).revision+1;
  const folder=path.join(this.dataDir,'artifacts',j.id,'r'+rev);
  const profile=this.store.settings().profile;const projectLink=profile.projectFooter?await trackedProjectLink(this,j):null;
  const renderJob=this.store.get(j.id);
  const artifacts=await this.renderDocumentsFn({root:this.root,dataDir:this.dataDir,dir:folder,job:renderJob,profile,...draft,projectLink});
  await this.checkpoint();
  assert(!signal?.aborted,'Document preparation stopped.');
  draft.artifacts=artifacts;draft.revision=rev;draft.reviewHash=hash({url:renderJob.url,company:renderJob.company,summary:draft.summary,coverLetter:draft.coverLetter,includeLetter:draft.includeLetter,answers:draft.answers,snapshot:draft.snapshot.fingerprint,hashes:artifacts.hashes,profile:this.store.settings().profile});
  const latest=this.store.get(j.id);
  Object.assign(latest,{draft,revision:rev,stage:'ready',error:null});this.store.save(latest);Object.assign(j,latest);
 }
 edit(jid,body){return this.run('Updating review documents',jid,async()=>{
  const j=this.store.get(jid);assert(j.draft,'Create a draft first.');assert(body.revision===j.revision,'This draft changed. Reload before editing.',409);assert(!this.store.blocked(j),'Already applied to this employer.',409);
  assert(typeof body.summary==='string'&&body.summary.length<1500,'Keep the profile under 1,500 characters.');
  assert(typeof body.coverLetter==='string'&&body.coverLetter.length<6000,'Keep the application under 6,000 characters.');
  const answers={};for(const f of j.draft.snapshot.form?.fields||[])answers[f.key]=body.answers?.[f.key]??'';
  await this.render(j,{...j.draft,summary:body.summary,coverLetter:body.coverLetter,includeLetter:!!body.includeLetter,answers});
  this.store.event(jid,'edited',{revision:j.revision,approvalInvalidated:true});
 });}
 async submit(jid,body){
  assert(!this.busy,'Wait for the current task.',409);const j=this.store.get(jid),d=j.draft;
  assert(d&&j.stage==='ready','A reviewed, rendered draft is required.',409);
  assert(body.confirm===true&&body.reviewHash===d.reviewHash&&body.revision===j.revision,'Explicit approval of this exact revision is required.',409);
  assert(!this.store.blocked(j),'Repeat application blocked: employer already in history.',409);
  validateAnswers(d.snapshot,d.answers,d.includeLetter);
  for(const key of ['cv','letter'])if(d.artifacts[key])assert(hash(await readFile(d.artifacts[key]))===d.artifacts.hashes[key],'An attachment changed. Render and review again.',409);
  // Recheck after asynchronous file reads; a competing request may have acquired the lock.
  assert(!this.busy,'Another task started. Reload and try again.',409);
  const fresh=this.store.get(jid);assert(fresh.revision===body.revision&&fresh.draft.reviewHash===body.reviewHash,'Draft changed during approval.',409);
  const reservation=this.store.record({job:j,status:'submitting',note:'Manual approval of revision '+j.revision});
  this.store.event(jid,'approved',{revision:j.revision,reviewHash:d.reviewHash,hashes:d.artifacts.hashes});
  return this.run('Submitting your approved application',jid,async()=>{
   try{
    const result=await this.dispatchFn({job:j,draft:d,artifacts:d.artifacts,afterFile:path.join(this.dataDir,'artifacts',jid,'receipt.jpg'),onDispatch:()=>this.store.event(jid,'dispatch_started',{revision:j.revision})});
    this.store.application(reservation.id,result);j.stage=result.status;this.store.save(j);this.store.event(jid,result.status,result);
   }catch(e){
    if(e.attempted){this.store.application(reservation.id,{status:'uncertain',note:e.message});j.stage='uncertain';}
    else{this.store.release(reservation.id);j.stage='needs_review';}
    j.error=e.message;this.store.save(j);this.store.event(jid,e.attempted?'uncertain':'approval_expired',{message:e.message});
   }
  });
 }
 history(body){assert(!this.busy,'Wait for the current task.',409);let job;if(body.jobId)job=this.store.get(body.jobId);const a=this.store.record({job,company:body.company,title:body.title||'',status:'applied',note:body.note||'Recorded manually by the applicant.'});if(job){job.stage='applied';this.store.save(job);}return a;}
 settings(body){assert(!this.busy,'Wait for the current task.',409);if(body.interests){const interests=validateInterests(body.interests);this.store.set('interests',interests);for(const j of this.store.jobs()){Object.assign(j,preferenceRank(j,interests));this.store.save(j);}}if(body.model){assert(typeof body.model==='string'&&body.model.length<180,'Invalid model.');this.store.set('model',body.model);}
  if(body.contact){
   const keys=['city','country','postalCode','addressLine1','addressLine2','district'];
   assert(typeof body.contact==='object'&&!Array.isArray(body.contact)&&Object.keys(body.contact).every(k=>keys.includes(k)),'Invalid contact fields.');
   assert(keys.every(k=>typeof body.contact[k]==='string'&&body.contact[k].trim().length<200),'Provide the confirmed address fields.');
   const contact=Object.fromEntries(keys.map(k=>[k,body.contact[k].trim()]));
   assert(contact.city&&contact.country&&contact.postalCode&&contact.addressLine1,'City, country, postcode and street are required.');
   const p={...this.store.settings().profile,...contact};
   p.location=[p.city,p.country].join(', ');p.streetAddress=[p.addressLine1,p.addressLine2].filter(Boolean).join(', ');
   p.address=[p.streetAddress,[p.postalCode,p.district||p.city].join(' '),p.country].join(', ');
   p.facts=[...p.facts.filter(f=>f.id!=='home-address'),{id:'home-address',text:`Lives in ${p.location}. Home address: ${p.address}. Confirmed directly by the applicant.`}];
   this.store.set('profile',p);this.store.event(null,'confirmed_contact_updated',{contact});
  }
  if(body.navigationModel){assert(typeof body.navigationModel==='string'&&body.navigationModel.length<180,'Invalid model.');this.store.set('navigationModel',body.navigationModel);}
  if(body.sources){assert(Array.isArray(body.sources)&&body.sources.length<=40,'At most 40 job boards.');for(const s of body.sources)assert(['greenhouse','lever','ashby'].includes(s.kind)&&/^[a-zA-Z0-9_-]{1,80}$/.test(s.slug)&&typeof s.company==='string','Invalid job board.');this.store.set('sources',body.sources);}
  if(body.availability||body.salary){const p=this.store.settings().profile;if(body.availability)p.availability=String(body.availability).slice(0,300);if(body.salary)p.salary=String(body.salary).slice(0,500);this.store.set('profile',p);}
  return this.state().settings;
 }
}
Object.assign(Service.prototype,navigationMethods);
Object.assign(Service.prototype,autonomyMethods);
