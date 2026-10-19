import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {assert,hash,now,denmark,normal,companyKey} from './core.mjs';
import {discover} from './sources.mjs';
import {proposedAnswers} from './browser.mjs';
import {canInfer,isLetter} from './navigator.mjs';
import {factualLetter} from './model.mjs';

export function autoEligible(job){
 return denmark(job.location)&&job.score>=50&&!/director|head of|vice president|principal|\bstaff\b|team lead|engineering manager/.test(normal(job.title));
}

export const autonomyMethods={
 autoCandidates(){
  const profileHash=hash(this.store.settings().profile),companies=new Set();
  return this.store.jobs().filter(j=>{
   if(!autoEligible(j)||this.store.blocked(j)||['archived','closed','submitted','uncertain'].includes(j.stage)||(j.automatic&&j.automatic.profileHash===profileHash)||companies.has(companyKey(j.company)))return false;
   companies.add(companyKey(j.company));return true;
  });
 },
 autonomyState(){return {enabled:!!this.store.settings().autoApply?.enabled,available:this.autoCandidates().length,...this.autoBatch};},
 async setAutonomy(enabled){
  assert(typeof enabled==='boolean','Choose whether automatic applications are enabled.');
  this.store.set('autoApply',{enabled,updatedAt:now()});this.store.event(null,'automatic_applications_configured',{enabled});
  if(!enabled)await this.stopAutonomy();return this.autonomyState();
 },
 autoApply(jid){return this.autoRun({jobIds:[jid]});},
 autoRun({jobIds,search=false}={}){
  assert(this.store.settings().autoApply?.enabled,'Automatic applications are off.',409);
  assert(!this.busy,'Another task is running.',409);
  if(jobIds)assert(Array.isArray(jobIds)&&jobIds.length>0&&jobIds.length<=40&&jobIds.every(id=>typeof id==='string'),'Choose up to 40 jobs.');
  for(const id of jobIds||[])assert(!this.store.blocked(this.store.get(id)),'This employer is already in application history.',409);
  this.autoBatch={running:true,stopping:false,startedAt:now(),total:0,completed:0,skipped:0,currentJobId:null};
  return this.run('Starting automatic applications',null,async()=>{
   try{
    if(search){
     const found=await discover(this.store.settings().sources,message=>{this.busy.label=message;},this.store.settings().interests);let added=0;
     for(const job of found.jobs)if(this.store.add(job).added)added++;
     this.store.set('lastScan',{at:now(),added,total:found.jobs.length,errors:found.errors});
    }
    const profileHash=hash(this.store.settings().profile);
    const jobs=jobIds?jobIds.map(id=>this.store.get(id)):this.autoCandidates();
    this.autoBatch.total=jobs.length;
    for(const job of jobs){
     if(!this.autoAllowed())break;
     if(this.store.blocked(job)){this.autoBatch.skipped++;continue;}
     this.autoBatch.currentJobId=job.id;this.busy.jobId=job.id;
     try{
      await this.autoApplyJob(job.id);
     }catch(e){
      const n=this.navigators?.get(job.id);if(n&&!n.closed)this.skipAutomatic(job.id,n,e.message);
      else {const latest=this.store.get(job.id);if(!['submitted','uncertain'].includes(latest.stage))latest.stage='skipped';latest.error=e.message;latest.automatic={status:latest.stage,reason:e.message,profileHash,at:now()};this.store.save(latest);}
     }finally{
      const latest=this.store.get(job.id),n=this.navigators?.get(job.id);
      if(latest.stage==='submitted')this.autoBatch.completed++;else this.autoBatch.skipped++;
      // Never replay an exposed form. Keep its last screenshot and audit record.
      if(n&&n.state.status!=='verification'){await n.close();this.navigators.delete(job.id);}
     }
     if(this.navigators?.get(job.id)?.state.status==='verification')break;
    }
   }finally{this.autoBatch.running=false;this.autoBatch.currentJobId=null;this.autoBatch.finishedAt=now();}
  });
 },
 autoAllowed(){return !!this.store.settings().autoApply?.enabled&&!this.autoBatch?.stopping;},
 async stopAutonomy(){
  for(const [jid,n]of this.navigators||[])if(n.state.status==='verification'&&!n.closed)await this.stopNavigation(jid);
  if(this.autoBatch?.running){this.autoBatch.stopping=true;const jid=this.autoBatch.currentJobId;if(jid&&this.navigators?.has(jid))await this.stopNavigation(jid);}
  return this.autonomyState();
 },
 skipAutomatic(jid,n,reason){
  const j=this.store.get(jid);
  if(['submitted','uncertain'].includes(j.stage))return;
  if(n.reservation&&!['submitted','uncertain'].includes(j.stage))this.store.application(n.reservation.id,{status:n.finalClicked?'uncertain':'incomplete',note:reason+' Automatic retry blocked.',location:j.jobDetails?.location||j.location,postcode:j.jobDetails?.postcode,address:j.jobDetails?.address,deadline:j.jobDetails?.deadline});
  j.automatic={status:'skipped',reason,profileHash:hash(this.store.settings().profile),at:now()};j.stage=n.finalClicked?'uncertain':'skipped';j.error=null;
  j.navigation={...n.state,status:n.finalClicked?'uncertain':'skipped',message:reason,automatic:true,sequence:(j.navigation?.sequence||0)+1};
  n.state=j.navigation;n.sequence=j.navigation.sequence;this.store.save(j);this.store.event(jid,'automatic_application_skipped',{reason,exposed:n.exposed,finalClicked:n.finalClicked});
 },
 async autoApplyJob(jid){
  let n=this.navigators?.get(jid),j=this.store.get(jid);
  assert(this.autoAllowed(),'Automatic applications stopped.');
  assert(!this.store.blocked(j),'Repeat employer blocked.',409);
  if(!n||n.closed||n.state.status!=='review'||n.state.phase!=='inspect'||!j.draft){
   await this.exploreJob(jid,{prepare:true,automatic:true});n=this.session(jid);j=this.store.get(jid);
  }
  if(!this.autoAllowed()||n.closed)return;
  if(n.state.status!=='review'||!j.draft){this.skipAutomatic(jid,n,n.state.message||'Application form could not be completed.');return;}
  if(!j.listing?.complete){this.skipAutomatic(jid,n,'The full listing could not be read.');return;}
  n.applicationOrigins=new Set([j.url,j.applyUrl].filter(Boolean).map(url=>new URL(url).origin));
  if(!n.applicationOrigins.has(new URL(n.page.url()).origin)){this.skipAutomatic(jid,n,'The application moved to a destination that is not in the collected job links.');return;}
  n.automatic=true;n.profile=structuredClone(this.store.settings().profile);
  let d=j.draft;
  const answers={...d.answers,...proposedAnswers(d.snapshot,n.profile,d.includeLetter,j.source)};
  // Preserve explicit saved answers; standard fields reflect current confirmed facts.
  for(const [key,value] of Object.entries(d.answers))if(value!==''&&value!==false&&value!==undefined&&!answers[key])answers[key]=value;
  for(const f of d.snapshot.form?.fields||[]){
   if(!this.autoAllowed()||n.closed)return;
   if(answers[f.key]!==''&&answers[f.key]!==false&&answers[f.key]!==undefined)continue;
   if(!canInfer(f))continue;
   this.preparationProgress(jid,'Answering from your CV: '+f.label);
   const answer=await n.infer({field:f,profile:n.profile,model:n.reasoningModel,signal:n.abort.signal,onProgress:p=>this.preparationProgress(jid,`${p.evidenceCheck?'Verifying the answer':'Answering from your CV'} · ${p.phase.toLowerCase()} · ${p.elapsed}s`,{...p,title:(p.evidenceCheck?'Verify answer: ':'Answer: ')+f.label})});
   if(answer){answers[f.key]=answer.value;n.inferred.push({label:f.label,answer:answer.value,evidenceIds:answer.evidenceIds,evidence:answer.evidence,reason:answer.reason});this.store.event(jid,'answer_inferred',n.inferred.at(-1));}
  }
  const missing=d.snapshot.form?.fields.find(f=>f.required&&(answers[f.key]===''||answers[f.key]===false||answers[f.key]===undefined));
  if(missing){this.skipAutomatic(jid,n,'Required answer is not established: '+missing.label);return;}
  if(!this.autoAllowed()||n.closed)return;
  if(hash(answers)!==hash(d.answers)||hash(d.profile)!==hash(n.profile)){
   await this.render(this.store.get(jid),{...d,answers,profile:n.profile});j=this.store.get(jid);d=j.draft;
  }
  for(const key of ['cv','letter'])if(d.artifacts[key])assert(hash(await readFile(d.artifacts[key]))===d.artifacts.hashes[key],'A generated attachment changed.');
  assert(this.autoAllowed()&&!n.closed,'Automatic applications stopped.');
  n.reservation=this.store.record({job:j,status:'submitting',note:'Authorized by the applicant clicking Auto apply.'});
  j.automatic={status:'running',profileHash:hash(n.profile),at:now()};this.store.save(j);
  this.store.event(jid,'automatic_fill_authorized',{revision:j.revision,hashes:d.artifacts.hashes});
  try{await n.approve(d);}catch(e){if(!n.exposed){this.store.release(n.reservation.id);n.reservation=null;}throw e;}
  for(let step=0;step<4&&this.autoAllowed()&&!n.closed;step++){
   if(n.state.status==='needs_document'){
    const latest=this.store.get(jid),updated={...latest.draft,includeLetter:true,coverLetter:factualLetter(latest,latest.draft.evidenceIds||[],'',this.store.settings().profile)};
    await this.render(latest,updated);const ready=this.store.get(jid).draft;
    if(!this.autoAllowed()||n.closed)return;
    n.artifacts=ready.artifacts;n.includeLetter=true;n.coverLetter=ready.coverLetter;
    for(const f of n.observation.snapshot.form.fields)if(isLetter(f))n.answers[f.key]=f.type==='file'?'@letter':ready.coverLetter;
    this.store.event(jid,'automatic_letter_prepared',{revision:ready.revision,hashes:ready.artifacts.hashes});await n.run('fill');continue;
   }
   if(n.state.status==='final_review'){
    this.store.event(jid,'automatic_submission_authorized',{key:n.final.key});await n.finalSubmit(n.final.key);
   }
   break;
  }
  const latest=this.store.get(jid);
  if(['submitted','uncertain'].includes(n.state.status)){
   latest.automatic={status:n.state.status,profileHash:hash(n.profile),at:now()};this.store.save(latest);
  }else if(n.state.status==='verification'){latest.automatic={status:'verification',profileHash:hash(n.profile),at:now()};this.store.save(latest);
  }else if(!n.closed)this.skipAutomatic(jid,n,n.state.message||'The website needs attention.');
 }
};
