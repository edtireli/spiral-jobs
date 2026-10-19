import path from 'node:path';
import {readFile,copyFile} from 'node:fs/promises';
import {Navigator,isLetter,canInfer,inferAnswer} from './navigator.mjs';
import {assert,hash,now,publicURL} from './core.mjs';
import {factualLetter} from './model.mjs';
import {recordModelProgress} from './model-progress.mjs';
import {findVerifiedAnswer,rememberVerifiedAnswer} from './verified-answers.mjs';
import {mailProvider} from './mail.mjs';

export function draftProfileHash(profile){
 // Street details affect form answers, not the CV assessment or letter prose.
 const {city,country,postalCode,addressLine1,addressLine2,streetAddress,address,district,...rest}=profile;
 return hash({...rest,facts:rest.facts?.filter(f=>f.id!=='home-address')});
}

export const navigationMethods={
 createNavigator(options){return new Navigator({...options,infer:async request=>{
  if(!canInfer(request.field))return null;
  const records=this.store.settings().verifiedAnswers||[];
  const remembered=findVerifiedAnswer(request.field,request.profile,records);
  if(remembered){this.store.event(options.jobId||null,'verified_answer_reused',{label:request.field.label,evidenceIds:remembered.evidenceIds});return remembered;}
  const answer=await inferAnswer(request),record=rememberVerifiedAnswer(request.field,answer,request.profile);
  if(record)this.store.set('verifiedAnswers',[record,...records.filter(r=>r.key!==record.key)].slice(0,100));
  return answer;
 }});},
 session(jid){const n=this.navigators?.get(jid);assert(n&&!n.closed,'The live browser is no longer open. Inspect the website again. Existing exposed applications remain blocked.',409);return n;},
 requiresCompanyEmailScope(jid,recipient,since){
  const provider=mailProvider(this.store.get(jid).url),account=String(recipient||'').trim().toLowerCase(),start=Date.parse(since);
  if(!provider||!account||!Number.isFinite(start))return true;
  const sameAccount=email=>!email||String(email).trim().toLowerCase()===account;
  for(const [otherId,n] of this.navigators||[]){
   if(otherId===jid||n.closed||!n.exposed)continue;
   if(mailProvider(this.store.get(otherId).url)===provider&&sameAccount(n.profile?.email))return true;
  }
  // A completed/closed attempt can still have a fresh email in the inbox.
  // Include Gmail's minute precision at the start of this challenge window.
  for(const attempt of this.store.applications()){
   if(!attempt.jobId||attempt.jobId===jid)continue;
   const other=this.store.get(attempt.jobId);
   if(mailProvider(other.url)!==provider||!sameAccount(other.draft?.profile?.email))continue;
   const times=[attempt.createdAt,attempt.submittedAt,other.navigation?.exposed?other.navigation.updatedAt:null].map(Date.parse).filter(Number.isFinite);
   if(times.some(time=>time>=start-65000))return true;
  }
  return false;
 },
 explore(jid,options={}){return this.run('Finding the application form',jid,()=>this.exploreJob(jid,options));},
 async exploreJob(jid,{prepare=false,automatic=false,approvalMode=automatic?'full':'review'}={}){
  const j=this.store.get(jid);assert(!this.store.blocked(j),'This employer is already in application history.',409);
  this.navigators||=new Map();
  // Service.run serializes work. An idle email-verification browser must keep
  // its original submission session while a separately authorized job runs.
  const waitingForEmail=(key,n)=>key!==jid&&!n.closed&&n.exposed&&n.reservation&&n.state.status==='verification'&&['email','email_link'].includes(n.state.verification?.kind);
  for(const [key,n] of this.navigators)assert(waitingForEmail(key,n)||n.closed||!n.exposed||['submitted','uncertain'].includes(n.state.status),'Finish or stop the current application before opening another.',409);
  for(const [key,n] of this.navigators){if(waitingForEmail(key,n))continue;await n.close();this.navigators.delete(key);}
  const settings=this.store.settings(),dir=path.join(this.dataDir,'artifacts',jid);
  const n=this.createNavigator({dir,jobId:jid,checkpoint:()=>this.checkpoint(),controlState:()=>this.busy?.jobId===jid?this.executionState():null,model:settings.navigationModel||settings.model,reasoningModel:settings.model,profile:structuredClone(settings.profile),
   onUpdate:state=>{const latest=this.store.get(jid);latest.navigation={...state,modelRun:recordModelProgress(latest,state.modelRun)};latest.error=null;n.recordingReasoning=latest.reasoning||[];
    if(state.listing)latest.listing=state.listing;
    if(state.metadata)latest.jobDetails={...latest.jobDetails,...state.metadata};
    if(state.status==='review'&&state.phase==='inspect'&&state.snapshot){latest.snapshot=state.snapshot;latest.pageText=state.snapshot.text;latest.description||=state.snapshot.text;latest.revision++;delete latest.draft;latest.stage='inspected';}
    if(['needs_answer','needs_document','human','paused','final_review','running','submitting','verification'].includes(state.status)&&n.exposed)latest.stage=state.status;
    if(state.status==='verification'&&n.reservation)this.store.application(n.reservation.id,{status:'verification',note:state.message});
    if(['submitted','uncertain'].includes(state.status)){latest.stage=state.status;if(n.reservation)this.store.application(n.reservation.id,{status:state.status,note:state.message,receiptText:state.receiptText,submittedAt:state.status==='submitted'?now():null,location:latest.jobDetails?.location||latest.location,postcode:latest.jobDetails?.postcode||null,address:latest.jobDetails?.address||null,deadline:latest.jobDetails?.deadline||null,position:latest.title,sourceUrl:latest.jobDetails?.sourceUrl||latest.url});}
    this.store.save(latest);if(this.busy?.jobId===jid)this.busy.label=state.message;
   },onEvent:(action,detail)=>{
    this.store.event(jid,action,detail);
    if(action==='recording_saved'){
     const latest=this.store.get(jid),recording={...detail,url:`/artifacts/${jid}/${detail.file}`};latest.recordings=[...(latest.recordings||[]),recording];this.store.save(latest);
     if(n.reservation)this.store.application(n.reservation.id,{recordings:latest.recordings});
    }
   }});
  // Auto apply was explicitly authorized before opening this job. Let the site
  // initialize its form/session; filling still requires a checked draft and phase.
  n.mailOrigins=new Set([j.url,j.applyUrl].filter(Boolean).map(url=>new URL(url).origin));
  n.lookupEmailCode=request=>this.mailbox.lookup({...request,job:this.store.get(jid),requireCompanyScope:this.requiresCompanyEmailScope(jid,request.recipient,request.since),checkpoint:()=>this.checkpoint(),controlState:()=>this.executionState()});
  n.approvalMode=approvalMode;n.automatic=automatic;n.networkAuthorized=automatic&&this.autoAllowed();
  n.applicationSource=j.source;n.prepareDocuments=prepare;n.previousDraft=j.draft;n.previousListing=j.listing;this.navigators.set(jid,n);await n.open(j.url);await n.readListing();
  if(j.applyUrl&&j.applyUrl!==j.url){await publicURL(j.applyUrl,{allowTest:n.allowTest});await this.checkpoint();await n.page.goto(j.applyUrl,{waitUntil:'domcontentloaded',timeout:45000});}
  await n.inspect();
  await this.finishInspection(jid,n);
 },
 async finishInspection(jid,n){
  if(n.closed||n.state.phase!=='inspect'||n.state.status!=='review')return;
  await copyFile(path.join(n.dir,'live.jpg'),path.join(n.dir,'website.jpg')).catch(()=>{});
  if(n.prepareDocuments){
   this.busy.label='Preparing your CV and application for review';
   let reuse=n.previousListing?.complete&&n.previousListing.text===n.listing?.text&&n.previousDraft?.model===this.store.settings().model&&n.previousDraft?.profile&&draftProfileHash(n.previousDraft.profile)===draftProfileHash(this.store.settings().profile)?n.previousDraft:null;
   if(reuse)for(const key of ['cv','letter'])if(reuse?.artifacts?.[key]&&hash(await readFile(reuse.artifacts[key]).catch(()=>''))!==reuse.artifacts.hashes[key])reuse=null;
   await this.prepareDraft(jid,undefined,reuse);n.prepareDocuments=false;
  }
 },
 async approveFill(jid,body){
  assert(!this.busy,'Wait for the current task.',409);const j=this.store.get(jid),d=j.draft,n=this.session(jid);
  assert(d&&j.stage==='ready'&&d.snapshot.navigation,'Inspect this job with the live navigator and prepare its documents first.',409);
  assert(body.confirm===true&&body.revision===j.revision&&body.reviewHash===d.reviewHash,'Approval of the exact reviewed documents and answers is required.',409);
  assert(!this.store.blocked(j),'Repeat application blocked.',409);
  for(const k of ['cv','letter'])if(d.artifacts[k])assert(hash(await readFile(d.artifacts[k]))===d.artifacts.hashes[k],'An attachment changed. Review it again.',409);
  assert(!this.busy&&this.store.get(jid).revision===j.revision,'The review changed. Reload.',409);
  n.profile=structuredClone(d.profile||n.profile);
  n.reservation=this.store.record({job:j,status:'submitting',note:'Approved filling and uploads; final submission still requires approval.'});
  this.store.event(jid,'approved_fill',{revision:j.revision,reviewHash:d.reviewHash,hashes:d.artifacts.hashes,profile:n.profile});
  return this.run('Filling the approved application',jid,async()=>{
   try{await n.approve(d);}catch(e){if(!n.exposed){this.store.release(n.reservation.id);n.reservation=null;}else this.store.application(n.reservation.id,{status:'uncertain',note:e.message});throw e;}
  });
 },
 checkVerification(jid){const n=this.session(jid);assert(n.state.status==='verification','No open verification step.',409);assert(!n.automatic||this.autoAllowed(),'Automatic applications are off.',409);return this.run('Checking application verification',jid,async()=>{
  if(n.finalClicked)await n.waitForReceipt();else{await n.run(n.state.phase);await this.finishInspection(jid,n);if(n.automatic&&n.state.status==='review'&&!n.reservation)await this.autoApplyJob(jid,n.approvalMode||'full');if(n.automatic&&n.state.status==='final_review'&&this.autoAllowed()){if(n.approvalMode==='final'){n.automatic=false;n.update('final_review','Application filled. Your approval is required to submit.');}else await n.finalSubmit(n.final.key);}}
  if(['submitted','uncertain'].includes(n.state.status)){await n.close();this.navigators.delete(jid);}
 });},
 attemptCaptcha(jid,body={}){
  assert(!this.busy,'Wait for the current task.',409);const n=this.session(jid);
  assert(body.confirm===true&&Number.isInteger(body.sequence)&&body.sequence===n.state.sequence&&n.state.status==='verification'&&n.state.verification?.kind==='captcha'&&!n.state.verification.attempting,'Confirm the current CAPTCHA once.',409);
  const page=n.page,session=n.s,reservation=n.reservation,reservationId=reservation?.id,submittedAt=n.submissionStartedAt;
  const original=()=>{
   assert(this.navigators?.get(jid)===n&&!n.closed&&!n.abort?.signal.aborted&&page&&n.page===page&&!page.isClosed()&&n.s===session&&n.reservation===reservation&&reservationId&&n.reservation.id===reservationId&&n.submissionStartedAt===submittedAt&&Number.isFinite(Date.parse(submittedAt))&&n.finalClicked&&n.exposed&&session?.gate?.approved,'The original pending submission must still be open.',409);
   const automatic=n.automatic||['full','final'].includes(n.approvalMode);
   const full=n.approvalMode==='full'||n.automatic&&!['review','final'].includes(n.approvalMode);
   assert(!this.autoBatch?.stopping&&(!automatic||this.autoAllowed())&&(!full||this.store.settings().autoApply?.enabled),'Automatic applications are stopped or disabled.',409);
  };
  original();
  return this.run('Attempting the confirmed CAPTCHA',jid,async()=>{
   original();
   const result=await n.attemptCaptcha({sequence:body.sequence,confirm:true});
   await this.checkpoint();original();
   // This consent covers only the CAPTCHA. The final Submit control was
   // already activated; never refill or invoke that control again.
   if(result?.resolved)await n.waitForReceipt();
   if(['submitted','uncertain'].includes(n.state.status)){await n.close();this.navigators.delete(jid);}
  });
 },
 checkApplicationEmail(jid){
  const j=this.store.get(jid),record=this.store.blocked(j);assert(record&&['uncertain','verification'].includes(record.status),'No unresolved submission to check.',409);
  return this.run('Checking Gmail for this application receipt',jid,async()=>{
   const result=await this.mailbox.receipt({job:j,recipient:j.draft?.profile?.email||this.store.settings().profile.email,since:record.createdAt,checkpoint:()=>this.checkpoint()});
   const latest=this.store.get(jid),message=result?.kind==='receipt'?'A matching employer email confirms receipt.':result?.kind==='verification'?'An email asks for verification. This is not a submission receipt.':'No matching receipt found. The previous submission remains unresolved.';
   latest.error=null;latest.emailCheck={at:now(),kind:result?.kind||'not_found',message};
   if(result?.kind==='receipt'){
    latest.stage='submitted';latest.navigation={...latest.navigation,status:'submitted',message,sequence:(latest.navigation?.sequence||0)+1};
    this.store.application(record.id,{status:'submitted',note:message,emailReceipt:{messageId:result.messageId,receivedAt:result.receivedAt},submittedAt:result.receivedAt});
   }
   this.store.save(latest);this.store.event(jid,'application_email_checked',{kind:result?.kind||'not_found'});
  });
 },
 resumeNavigation(jid){const n=this.session(jid);assert(!['running','submitting','submitted','uncertain','verification'].includes(n.state.status),'This session cannot be resumed.',409);assert(!n.automatic||this.autoAllowed(),'Automatic applications are off.',409);return this.run('Resuming the application',jid,async()=>{
  await n.run(n.state.phase);await this.finishInspection(jid,n);
  await this.finishNavigationRun(jid,n);
 });},
 async finishNavigationRun(jid,n){
  if(n.automatic&&n.state.status==='review'&&n.state.phase==='inspect'&&!n.reservation&&!n.exposed)await this.autoApplyJob(jid,n.approvalMode||'full');
  if(n.automatic&&n.state.status==='final_review'){
   if(n.approvalMode==='full'&&this.autoAllowed()){this.store.event(jid,'automatic_submission_authorized',{key:n.final.key});await n.finalSubmit(n.final.key);}
   else{n.automatic=false;n.update('final_review','Application filled. Your approval is required to submit.');}
  }
  if(['submitted','uncertain'].includes(n.state.status)){await n.close();this.navigators.delete(jid);}
 },
 allowInteractiveStep(jid,body){
  assert(!this.busy,'Wait for the current task.',409);const n=this.session(jid);
  assert(body.confirm===true&&body.sequence===n.state.sequence&&['human','paused'].includes(n.state.status),'Approve the current manual browser step.',409);
  n.s.gate.approved=true;this.store.event(jid,'manual_browser_step_enabled',{url:n.page.url()});
  n.update('human','Interactive browser access enabled. Complete sign-in or verification yourself, then resume. The app will not fill or upload applicant information until you approve the application.',{interactiveEnabled:true});return {ok:true};
 },
 answerNavigation(jid,body){const n=this.session(jid);assert(body.confirm===true&&body.sequence===n.state.sequence,'Approve the current question.',409);assert(!n.automatic||this.autoAllowed(),'Automatic applications are off.',409);return this.run('Using your approved answer',jid,async()=>{await n.answer(body.value);await this.finishNavigationRun(jid,n);});},
 async finalNavigation(jid,body){
  assert(!this.busy,'Wait for the current task.',409);const n=this.session(jid);assert(body.confirm===true&&n.state.status==='final_review'&&body.key===n.final?.key,'Approve the current final page.',409);
  this.store.event(jid,'approved_final',{key:body.key});return this.run('Sending the reviewed application',jid,()=>n.finalSubmit(body.key));
 },
 async stopNavigation(jid){
  const n=this.session(jid);if(this.busy?.jobId===jid)this.execution?.cancel();await n.close();
  const j=this.store.get(jid);if(n.exposed&&!['submitted','uncertain'].includes(j.stage)){this.store.application(n.reservation.id,{status:'uncertain',note:'Stopped after filling or uploading. Check the employer site before considering another application.'});j.stage='uncertain';}
  j.navigation={...n.state,status:'stopped',message:n.exposed?'Browser stopped. Employer remains blocked to prevent duplicates.':'Browser stopped. No applicant data was entered.',updatedAt:now()};this.store.save(j);this.store.event(jid,'navigation_stopped',{exposed:n.exposed});return {ok:true};
 },
 prepareRequiredLetter(jid){const n=this.session(jid);assert(n.state.status==='needs_document','No additional document is required.');return this.run('Preparing the required short application letter',jid,async()=>{
  const j=this.store.get(jid),d={...j.draft,coverLetter:factualLetter(j,j.draft.evidenceIds||[],'',this.store.settings().profile),includeLetter:true};
  await this.render(j,d);n.update('document_review','Review the new application PDF, then approve attaching it.');
 });},
 async approveRequiredLetter(jid,body){
  assert(!this.busy,'Wait for the current task.',409);const n=this.session(jid),j=this.store.get(jid),d=j.draft;
  assert(n.state.status==='document_review'&&body.confirm===true&&body.revision===j.revision&&body.reviewHash===d.reviewHash,'Approve this exact application letter.',409);
  for(const k of ['cv','letter'])assert(hash(await readFile(d.artifacts[k]))===d.artifacts.hashes[k],'The documents changed.');
  assert(!this.busy&&this.store.get(jid).revision===j.revision,'The review changed.',409);
  n.artifacts=d.artifacts;n.includeLetter=true;n.coverLetter=d.coverLetter;for(const f of n.observation.snapshot.form.fields)if(isLetter(f))n.answers[f.key]=f.type==='file'?'@letter':d.coverLetter;
  assert(!n.automatic||this.autoAllowed(),'Automatic applications are off.',409);
  this.store.event(jid,'additional_document_approved',{revision:j.revision,hashes:d.artifacts.hashes});return this.run('Attaching the approved application letter',jid,async()=>{await n.run('fill');await this.finishNavigationRun(jid,n);});
 }
};
