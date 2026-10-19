import test from 'node:test';
import assert from 'node:assert/strict';
import {mailPolicy,verifiedCode} from '../lib/mail.mjs';
const since='2026-10-19T09:00:00Z',clock=Date.parse(since)+60000;
const policy=mailPolicy({company:'Fictional Research',url:'https://job-boards.greenhouse.io/fictional/jobs/1'},'fixture@example.test',since);
const message={id:'fixture',sender:'no-reply@greenhouse.io',date:'2026-10-19T09:00:30Z',subject:'Security code for Fictional Research',body:'Fictional Research\nYour security code: A2B3C4D5'};
test('email codes require a recent matching employer and a trusted sender',()=>{assert.equal(verifiedCode([message],policy,clock).code,'A2B3C4D5');for(const change of [{sender:'attacker@greenhouse.io.evil.test'},{date:'2026-10-18T09:00:30Z'},{subject:'Another employer',body:'Another employer\nsecurity code: A2B3C4D5'},{date:'invalid'}])assert.equal(verifiedCode([{...message,...change}],policy,clock),null);assert.equal(verifiedCode([message,message],policy,clock),null);assert.throws(()=>mailPolicy({company:'Fictional Research',url:'https://attacker.test'},'fixture@example.test',since));});

import {verifiedReceipt} from '../lib/mail.mjs';
import {emailChallenge} from '../lib/email-verification.mjs';
import {MailBridge} from '../lib/mail-bridge.mjs';
test('a bound challenge accepts a generic provider code, but not another account or an old code',()=>{
 const bound=mailPolicy({company:'Fictional Research',url:'https://job-boards.greenhouse.io/fictional/jobs/1'},'fixture@example.test',since,{challengeBound:true});
 const generic={...message,subject:'Greenhouse security code',body:'Your security code is: 12345678',searchedRecipient:'fixture@example.test'};
 assert.equal(verifiedCode([generic],bound,clock)?.code,'12345678');
 assert.equal(verifiedCode([generic],policy,clock),null);
 assert.equal(verifiedCode([{...generic,searchedRecipient:'other@example.test'}],bound,clock),null);
 assert.equal(verifiedCode([{...generic,date:'2026-10-19T08:59:00Z'}],bound,clock),null);
});
test('verification is not a receipt and receipts require the exact employer and role',()=>{
 const p={...policy,title:'Data Scientist'};
 const receipt={...message,subject:'Fictional Research — Data Scientist',body:'We have received your application for Data Scientist at Fictional Research.'};
 assert.equal(verifiedReceipt([receipt],p,clock)?.kind,'receipt');
 assert.equal(verifiedReceipt([{...receipt,body:receipt.body+' Please verify your email.'}],p,clock)?.kind,'verification');
 assert.equal(verifiedReceipt([{...receipt,subject:'Fictional Research — Engineer',body:'We have received your application for Engineer at Fictional Research.'}],p,clock),null);
 assert.equal(verifiedReceipt([{...receipt,sender:'fake@greenhouse.io.evil.test'}],p,clock),null);
});
test('email challenges bind to the entered recipient and never confuse a link with a receipt',()=>{
 const field={key:'otp',isField:true,label:'Security code',name:'otp',autocomplete:'one-time-code'};
 const o={snapshot:{url:'https://job-boards.greenhouse.io/fictional/jobs/1',text:'We sent a security code to your email.'},controls:[field]};
 assert.equal(emailChallenge(o,'fixture@example.test').blocked,true);
 assert.equal(emailChallenge(o,'fixture@example.test',{recipientBound:true}).blocked,false);
 assert.equal(emailChallenge({...o,snapshot:{...o.snapshot,text:'Security code sent to another@example.test'}},'fixture@example.test',{recipientBound:true}).blocked,true);
 assert.equal(emailChallenge({...o,snapshot:{...o.snapshot,text:'Verify your email: check your inbox, fixture@example.test'},controls:[]},'fixture@example.test').kind,'email_link');
});
test('companion is token scoped, accepts only the pending lookup and is revoked on reconnect',async()=>{
 let settings={};const bridge=new MailBridge({settings:()=>settings,save:s=>settings=s});
 const connection=bridge.connect('http://127.0.0.1:4317');assert.equal(bridge.authorized('Bearer '+connection.token),true);assert.equal(bridge.authorized('Bearer wrong'),false);
 const promise=bridge.read(policy);await new Promise(r=>setImmediate(r));const {request}=bridge.poll();assert.equal(request.recipient,policy.recipient);assert.equal(request.token,undefined);
 assert.throws(()=>bridge.complete({id:'stale',account:policy.recipient,messages:[]}));
 assert.throws(()=>bridge.complete({id:request.id,account:'another@example.test',messages:[]}));
 bridge.complete({id:request.id,account:policy.recipient,messages:[message]});const r=await promise;assert.equal(r.messages[0].searchedRecipient,policy.recipient);
 bridge.connect(connection.origin);assert.equal(bridge.authorized('Bearer '+connection.token),false);
});

test('official Greenhouse regional mail domains are searched and validated',()=>{
 assert.match(policy.query,/from:\(greenhouse-mail\.io\)/);
 for(const sender of ['no-reply@us.greenhouse-mail.io','no-reply@eu.greenhouse-mail.io'])assert.equal(verifiedCode([{...message,sender}],policy,clock)?.code,'A2B3C4D5');
 assert.equal(verifiedCode([{...message,sender:'no-reply@us.greenhouse-mail.io.attacker.test'}],policy,clock),null);
});
