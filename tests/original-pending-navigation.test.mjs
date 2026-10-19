import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {Navigator,observe} from '../lib/navigator.mjs';
import {emailChallenge,rejectedVerification} from '../lib/email-verification.mjs';
import {mailPolicy,verifiedCode} from '../lib/mail.mjs';

const recipient='fixture@example.test',url='https://job-boards.greenhouse.io/fixture/jobs/1',since='2026-10-19T12:12:57Z';
function pending(){
 const n=new Navigator({profile:{email:recipient}});Object.assign(n,{initialOrigin:new URL(url).origin,finalClicked:true,exposed:true,reservation:{id:'fixture-reservation'},page:{url:()=>url},s:{},final:{url},submissionStartedAt:since,verificationSince:since});
 const observation={snapshot:{url,text:'A security code was sent to '+recipient},controls:[{key:'otp',isField:true,label:'Security code',name:'otp',maxLength:8,value:'',invalid:true}]};
 return {n,observation,challenge:emailChallenge(observation,recipient)};
}
test('original proof comes from the same live final submission and empty pending challenge',()=>{
 const {n,observation,challenge}=pending(),proof=n.pendingSubmissionProof(observation,challenge);
 assert.equal(proof.kind,'original-pending-submission');assert.equal(proof.submittedAt,since);assert.equal(proof.reservationId,n.reservation.id);
 assert.equal(n.originalSubmissionStillPending(observation,challenge,proof),true,'empty required fields may be invalid before typing');
 for(const change of [n=>n.emailCodeAttempted=true,n=>n.finalClicked=false,n=>n.exposed=false,n=>n.closed=true,n=>n.abort.abort(),n=>n.reservation=null,n=>n.s=null,n=>n.page=null,n=>n.verificationSince='2026-10-19T12:13:00Z',n=>n.final.url=url+'?changed']){
  const f=pending();change(f.n);assert.equal(f.n.pendingSubmissionProof(f.observation,f.challenge),null);
 }
});
test('a changed page, session, reservation, challenge or recipient cannot reuse the proof',()=>{
 for(const change of [f=>f.n.page={},f=>f.n.s={},f=>f.n.reservation={id:'other'},f=>f.n.profile.email='other@example.test',f=>f.observation.snapshot.text+=' A new code was sent.',f=>f.observation.controls[0].key='other',f=>f.n.submissionStartedAt='2026-10-19T12:13:00Z']){
  const f=pending(),proof=f.n.pendingSubmissionProof(f.observation,f.challenge);change(f);
  const challenge=emailChallenge(f.observation,f.n.profile.email);assert.equal(f.n.originalSubmissionStillPending(f.observation,challenge||{blocked:true},proof),false);
  assert.equal(f.n.pendingSubmissionProof(f.observation,challenge||{blocked:true}),null);
 }
});
test('explicit code errors stop lookup while ordinary expiry instructions do not',async()=>{
 for(const text of ['Your security code is invalid.','The verification code has expired.','Incorrect security code.']){
  assert.equal(rejectedVerification(text),true);const f=pending();f.observation.snapshot.text+=' '+text;f.n.live=async()=>{};let lookups=0;f.n.lookupEmailCode=async()=>{lookups++;};
  await f.n.handleVerification(f.observation);await f.n.handleVerification(f.observation);assert.equal(lookups,0);assert.equal(f.n.emailVerificationStopped,true);
 }
 for(const text of ['Your code is valid for 10 minutes.','The code expires after 10 minutes.']){
  assert.equal(rejectedVerification(text),false);const f=pending();f.observation.snapshot.text+=' '+text;
  assert.equal(f.n.pendingSubmissionProof(f.observation,f.challenge),null,'stated provider expiry rules out the age exception without blocking ordinary fresh-code checks');
 }
 assert.equal(rejectedVerification('Enter the code to confirm your application.'),false);
});
test('the original employer-subject code is entered once and provider rejection stops further attempts',async t=>{
 const browser=await chromium.launch({headless:true});t.after(()=>browser.close());const page=await browser.newPage();
 const html=`<p>A security code was sent to ${recipient}. Enter the code to confirm your application.</p><fieldset><legend>Security code</legend>${Array.from({length:8},(_,i)=>`<input id="otp-${i}" name="otp-${i}" maxlength="1" required>`).join('')}</fieldset><button onclick="window.confirmations=(window.confirmations||0)+1;document.querySelector('p').textContent+=' The security code has expired.'">Submit application</button>`;
 await page.route('**/*',route=>route.fulfill({contentType:'text/html',body:html}));await page.goto(url);
 const f=pending(),n=f.n;Object.assign(n,{page,live:async()=>{},beforeAction:async()=>{},checkDocuments:async()=>{}});let lookups=0;const events=[];n.onEvent=(name,detail)=>events.push({name,detail});
 n.lookupEmailCode=async request=>{lookups++;return verifiedCode([{id:'fixture',sender:'no-reply@greenhouse.io',searchedRecipient:recipient,date:since,subject:'Security code for your application to Fixture Research',body:'Security code: aBcDeFgH'}],mailPolicy({company:'Fixture Research',url},recipient,since,request),Date.parse(since)+60*60000);};
 assert.equal(await n.handleVerification(await observe(page)),false);assert.equal(n.emailCodeAttempted,true);assert.equal(await page.evaluate(()=>window.confirmations),1);
 await n.handleVerification(await observe(page));await n.handleVerification(await observe(page));assert.equal(lookups,1);assert.equal(await page.evaluate(()=>window.confirmations),1);assert.equal(n.emailVerificationStopped,true);
 assert.doesNotMatch(JSON.stringify({events,state:n.state}),/aBcDeFgH/);
});
