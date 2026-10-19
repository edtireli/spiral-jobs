import test from 'node:test';
import assert from 'node:assert/strict';
import {mailPolicy,mailProvider,verifiedCode,verificationCodeAssessment} from '../lib/mail.mjs';
import {MailBridge} from '../lib/mail-bridge.mjs';

const since='2026-10-19T12:12:57Z',clock=Date.parse(since)+30000;
const policy=mailPolicy({company:'Fixture Research',url:'https://job-boards.greenhouse.io/fixture/jobs/1'},'fixture@example.test',since,{challengeBound:true});
const message={id:'fixture',sender:'no-reply@eu.greenhouse-mail.io',date:'2026-10-19T12:13:00Z',subject:'Greenhouse security code',searchedRecipient:'fixture@example.test'};

test('letters-only tokens require explicit code context and preserve case',()=>{
 for(const body of ['Your security code: aBcDeFgH','Your security code is aBcDeFgH','Your security code is:\n\naBcDeFgH\n\nGreenhouse','Security code\naBcDeFgH\nGreenhouse','Copy and paste this code into the security code field on your application: aBcDeFgH After you enter the code, resubmit your application.','Copy and paste this code into the security code field on your application:\n\naBcDeFgH\n\nAfter you enter the code, resubmit your application.']){
  assert.equal(verifiedCode([{...message,body}],policy,clock)?.code,'aBcDeFgH');
 }
});
test('minute precision is explicit, recipient scoped and cannot admit an earlier minute',()=>{
 const rounded={...message,body:'Security code: aBcDeFgH',date:'2026-10-19T12:12:00Z',datePrecision:'minute'};
 assert.equal(verifiedCode([rounded],policy,clock)?.code,'aBcDeFgH');
 for(const change of [{datePrecision:undefined},{datePrecision:'exact'},{date:'2026-10-19T12:11:00Z'},{searchedRecipient:undefined},{searchedRecipient:'other@example.test'}])assert.equal(verifiedCode([{...rounded,...change}],policy,clock),null);
 assert.equal(verifiedCode([rounded],{...policy,challengeBound:false},clock),null);
 assert.equal(verifiedCode([rounded,{...rounded,id:'second'}],policy,clock),null);
 assert.equal(verifiedCode([{...message,body:'Security code: aBcDeFgH',date:'2026-10-19T12:12:51Z',datePrecision:'exact'}],policy,clock),null);
});
test('mail bridge preserves only declared timestamp precision and binds the search recipient',async()=>{
 const bridge=new MailBridge({settings:()=>({}),save:()=>{}});
 const pending=bridge.read(policy);await new Promise(r=>setImmediate(r));
 const request=bridge.poll().request;
 bridge.complete({id:request.id,account:policy.recipient,messages:[{...message,datePrecision:'minute'},{...message,datePrecision:'unknown'},{...message}]});
 const result=await pending;
 assert.deepEqual(result.messages.map(m=>m.datePrecision),['minute','exact','exact']);
 assert.ok(result.messages.every(m=>m.searchedRecipient===policy.recipient));
});
test('ordinary words, unrelated tokens and ambiguous alphabetic codes are not guessed',()=>{
 for(const body of ['Your security code expires soon.\nGreenhouse','Security code\nexpires in ten minutes.','Please verify your email.\nGreenhouse','Your security code is ready for use.','Your security code: aBcDeFgH\nSecurity code: iJkLmNoP'])assert.equal(verifiedCode([{...message,body}],policy,clock),null);
 assert.equal(verifiedCode([{...message,body:'Security code: aBcDeFgH'},{...message,id:'another',body:'Security code: aBcDeFgH'}],policy,clock),null);
});
test('alphabetic tokens retain the trusted sender, recipient and current-time requirements',()=>{
 const valid={...message,body:'Security code: aBcDeFgH'};
 for(const change of [{sender:'attacker@greenhouse-mail.io.evil.test'},{searchedRecipient:'other@example.test'},{date:'2026-10-19T12:10:00Z'},{date:'invalid'}])assert.equal(verifiedCode([{...valid,...change}],policy,clock),null);
});
test('overlapping application contexts require the requested company in search and mail content',()=>{
 const scoped=mailPolicy({company:'First Fixture',url:'https://job-boards.greenhouse.io/fixture/jobs/1'},policy.recipient,since,{challengeBound:true,requireCompanyScope:true});
 assert.match(scoped.query,/"First Fixture"/);
 const other={...message,subject:'Second Fixture: verify your email',body:'Security code: aBcDeFgH'};
 assert.deepEqual(verificationCodeAssessment([other],scoped,clock),{result:null,diagnostic:{messages:1,currentCodes:0,rejected:{company:1}}});
 assert.equal(verifiedCode([{...other,subject:'Greenhouse security code'}],scoped,clock),null);
 assert.equal(verifiedCode([{...other,subject:'First Fixture: verify your email'}],scoped,clock)?.code,'aBcDeFgH');
 assert.equal(verifiedCode([{...other,subject:'Greenhouse security code'}],policy,clock)?.code,'aBcDeFgH','an unambiguous bound challenge still supports generic provider mail');
 assert.equal(mailProvider('https://boards.greenhouse.io/fixture/jobs/1'),'greenhouse.io');assert.equal(mailProvider('https://jobs.lever.co/fixture/1'),'lever.co');assert.equal(mailProvider('https://jobs.ashbyhq.com/fixture/1'),'ashbyhq.com');
 for(const url of ['invalid','https://greenhouse.io.evil.test/jobs/1','https://example.test/jobs/1'])assert.equal(mailProvider(url),null);
});
test('verification diagnostics identify freshness and parsing failures without message content',()=>{
 const valid={...message,body:'Security code: aBcDeFgH'};
 const cases=[['expired',valid,Date.parse(valid.date)+11*60000],['beforeSubmission',{...valid,date:'2026-10-19T12:11:00Z'},clock],['timestamp',{...valid,date:'unparseable'},clock],['sender',{...valid,sender:'attacker@example.test'},clock],['recipient',{...valid,searchedRecipient:'other@example.test'},clock],['codeFormat',{...valid,body:'Your security code could not be issued.'},clock],['ambiguousCode',{...valid,body:'Security code: aBcDeFgH\nSecurity code: iJkLmNoP'},clock]];
 for(const [reason,item,at]of cases){
  const {result,diagnostic}=verificationCodeAssessment([item],policy,at);
  assert.equal(result,null);assert.deepEqual(diagnostic,{messages:1,currentCodes:0,rejected:{[reason]:1}});
  for(const secret of [item.body,item.sender,item.id,'aBcDeFgH'])assert.ok(!JSON.stringify(diagnostic).includes(secret));
 }
 const ambiguous=verificationCodeAssessment([valid,{...valid,id:'second'}],policy,clock);assert.equal(ambiguous.result,null);assert.equal(ambiguous.diagnostic.currentCodes,2);
});
