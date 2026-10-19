import test from 'node:test';
import assert from 'node:assert/strict';
import {mailPolicy,verificationCodeAssessment} from '../lib/mail.mjs';

const since='2026-10-19T12:12:57Z',clock=Date.parse('2026-10-19T17:00:00Z');
const recipient='fixture@example.test';
const job={company:'Fixture Research',title:'Data Scientist',url:'https://job-boards.greenhouse.io/fixture/jobs/1'};
const proof={kind:'original-pending-submission',recipient,submittedAt:since,challengeUrl:job.url,reservationId:'fixture-reservation',fingerprint:'a'.repeat(64)};
const message={id:'original-message',sender:'no-reply@eu.greenhouse-mail.io',date:'2026-10-19T12:13:15Z',subject:'Security code for your application to Fixture Research',body:'Security code: aBcDeFgH',searchedRecipient:recipient};
const policy=(originalPendingSubmission=proof,options={})=>mailPolicy(job,recipient,since,{challengeBound:true,originalPendingSubmission,...options});
const assess=(messages=[message],p=policy(),at=clock)=>verificationCodeAssessment(messages,p,at);

test('one older employer-identified code can be tried only with original pending-submission proof',()=>{
 const {result,diagnostic}=assess();
 assert.equal(result?.code,'aBcDeFgH');assert.equal(result.messageId,message.id);
 assert.deepEqual(result.originalPendingSubmission,proof);
 assert.equal(diagnostic.currentCodes,1);
 assert.equal(assess([message],policy(null)).result,null);
 assert.equal(assess([message],policy(proof,{challengeBound:false})).result,null);
 for(const secret of [message.id,message.body,message.sender,'aBcDeFgH'])assert.ok(!JSON.stringify(diagnostic).includes(secret));
});

test('the recovery window does not invent a maximum provider delivery delay',()=>{
 const delayed={...message,date:'2026-10-19T12:30:00Z'};
 assert.equal(assess([delayed]).result?.messageId,message.id);
});

test('malformed or mismatched original-submission proof cannot relax freshness',()=>{
 for(const invalid of [
  true,{},
  {...proof,kind:'pending'},
  {...proof,recipient:'other@example.test'},
  {...proof,submittedAt:'2026-10-19T12:00:00Z'},
  {...proof,submittedAt:'invalid'},
  {...proof,challengeUrl:'https://jobs.lever.co/other/1'},
  {...proof,challengeUrl:'https://greenhouse.io.attacker.test/fixture'},
  {...proof,challengeUrl:'not-a-url'},
  {...proof,reservationId:''},
  {...proof,fingerprint:''},
  {...proof,fingerprint:'not-a-fingerprint'}
 ])assert.equal(assess([message],policy(invalid)).result,null,JSON.stringify(invalid));
});

test('older recovery requires an explicit employer in the subject, not a body mention or substring',()=>{
 for(const subject of [
  'Greenhouse security code',
  'Security code for your application to Another Research',
  'Security code for your application to NonFixture Researcher'
 ])assert.equal(assess([{...message,subject,body:'Fixture Research\nSecurity code: aBcDeFgH'}]).result,null,subject);
 const shortJob={...job,company:'If'},shortPolicy=mailPolicy(shortJob,recipient,since,{challengeBound:true,originalPendingSubmission:proof});
 assert.equal(assess([{...message,subject:'Verification code for a different employer'}],shortPolicy).result,null,'If must not match inside verification/different');
 assert.equal(assess([{...message,subject:'If you requested this security code'}],shortPolicy).result,null,'a conditional word is not an employer association');
 assert.equal(assess([{...message,subject:'Security code for your application to If'}],shortPolicy).result?.code,'aBcDeFgH');
 assert.equal(assess([{...message,subject:'Fixture Research — Application security code'}]).result?.code,'aBcDeFgH');
});

test('original-session recovery still rejects the wrong account, provider and time window',()=>{
 for(const changed of [
  {searchedRecipient:'other@example.test'},
  {searchedRecipient:undefined},
  {recipient:'other@example.test'},
  {sender:'no-reply@greenhouse.io.attacker.test'},
  {sender:'no-reply@lever.co'},
  {date:'2026-10-19T12:12:51Z'},
  {date:'invalid'},
  {date:'2026-10-19T17:01:01Z'}
 ])assert.equal(assess([{...message,...changed}]).result,null,JSON.stringify(changed));
});

test('declared minute precision permits only an interval intersecting the original submission window',()=>{
 assert.equal(assess([{...message,date:'2026-10-19T12:12:00Z',datePrecision:'minute'}]).result?.messageId,message.id);
 assert.equal(assess([{...message,date:'2026-10-19T12:11:00Z',datePrecision:'minute'}]).result,null);
 assert.equal(assess([{...message,date:'2026-10-19T12:12:00Z',datePrecision:'exact'}]).result,null);
 assert.equal(assess([{...message,date:'2026-10-19T12:12:00Z',datePrecision:'minute',searchedRecipient:undefined}]).result,null);
});

test('recovery never selects between multiple matching codes or messages',()=>{
 const second={...message,id:'second-message',date:'2026-10-19T12:14:00Z',body:'Security code: hGfEdCbA'};
 assert.equal(assess([message,second]).result,null);
 assert.equal(assess([message,{...message,id:'duplicate-message'}]).result,null);
 assert.equal(assess([{...message,body:'Security code: aBcDeFgH\nSecurity code: hGfEdCbA'}]).result,null);
});

test('an explicitly rejected employer code cannot use the age exception',()=>{
 for(const rejection of ['Your security code is invalid.','The verification code has expired.','This code was already used.']){
  assert.equal(assess([{...message,body:message.body+'\n'+rejection}]).result,null,rejection);
 }
});

test('generic provider codes retain the normal ten-minute freshness limit',()=>{
 const generic={...message,subject:'Greenhouse security code'};
 assert.equal(assess([generic]).result,null);
 const fresh={...generic,date:'2026-10-19T16:59:00Z'};
 const result=assess([fresh],policy(null)).result;
 assert.equal(result?.code,'aBcDeFgH');assert.equal(result.originalPendingSubmission,undefined);
 assert.equal(assess([fresh],policy()).result?.code,'aBcDeFgH');
});
