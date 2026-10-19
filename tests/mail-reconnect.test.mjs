import test from 'node:test';
import assert from 'node:assert/strict';
import {MailBridge} from '../lib/mail-bridge.mjs';
import {GmailMailbox} from '../lib/mail.mjs';
import {Navigator} from '../lib/navigator.mjs';

const origin='http://127.0.0.1:4317',recipient='fixture@example.test';
const policy={query:'fixture query',recipient},job={company:'Fixture Research',url:'https://job-boards.greenhouse.io/fixture/jobs/1'};
function fixture(){let settings={};const mailbox=new GmailMailbox({settings:()=>settings,save:s=>settings=s});return {mailbox,settings:()=>settings};}

test('reconnecting a paired companion preserves its token, heartbeat and active lookup',async()=>{
 const {mailbox,settings}=fixture(),first=mailbox.connect(origin).connection;
 const pending=mailbox.bridge.read(policy);await new Promise(r=>setImmediate(r));
 const request=mailbox.bridge.poll().request,lastSeen=mailbox.bridge.lastSeen;
 const reconnected=mailbox.connect(origin);
 assert.equal(reconnected.connection.token,first.token);assert.equal(reconnected.status,'connected');assert.match(reconnected.message,/existing pairing preserved/);
 assert.equal(mailbox.bridge.lastSeen,lastSeen);assert.equal(mailbox.bridge.pending.id,request.id);assert.equal(settings().bridgeToken,first.token);
 mailbox.bridge.complete({id:request.id,account:recipient,messages:[]});assert.deepEqual(await pending,{messages:[]});
});

test('explicit disconnect revokes authorization and the next connection gets a fresh token',async()=>{
 const {mailbox,settings}=fixture(),first=mailbox.connect(origin).connection;
 const pending=mailbox.bridge.read(policy);await new Promise(r=>setImmediate(r));
 await mailbox.disconnect();assert.equal(settings().bridgeToken,undefined);assert.equal(mailbox.bridge.authorized('Bearer '+first.token),false);
 assert.match((await pending).error,/disconnected/);
 const next=mailbox.connect(origin);assert.notEqual(next.connection.token,first.token);assert.equal(next.status,'setup');
});

test('invalid, disabled or other-transport credentials cannot be reused',()=>{
 for(const initial of [{enabled:true,transport:'chrome',bridgeToken:'invalid'},{enabled:false,transport:'chrome',bridgeToken:'a'.repeat(64)},{enabled:true,transport:'legacy',bridgeToken:'a'.repeat(64)}]){
  let saved=initial;const bridge=new MailBridge({settings:()=>saved,save:s=>saved=s});
  const connection=bridge.connect(origin);assert.match(connection.token,/^[a-f0-9]{64}$/);assert.notEqual(connection.token,initial.bridgeToken);
 }
});

test('a paired companion without a recent heartbeat needs reopening, not new setup',()=>{
 const {mailbox}=fixture(),first=mailbox.connect(origin).connection;
 const result=mailbox.connect(origin);assert.equal(result.connection.token,first.token);assert.equal(result.status,'closed');assert.match(result.message,/already paired/);assert.doesNotMatch(result.message,/paste/);
});

function navigator(lookup){
 const n=new Navigator({profile:{email:recipient}});n.initialOrigin='https://job-boards.greenhouse.io';n.exposed=true;n.lookupEmailCode=lookup;n.live=async()=>{};
 const observation={snapshot:{url:n.initialOrigin+'/fixture/jobs/1',text:'A security code was sent to '+recipient},controls:[{key:'otp',isField:true,label:'Security code',name:'otp',maxLength:8}]};
 return {n,observation};
}
test('mailbox setup and transport diagnostics reach navigation without consuming a code attempt',async()=>{
 const {mailbox}=fixture();
 const run=async()=>mailbox.lookup({job,recipient,since:new Date().toISOString(),challengeBound:true});
 const {n,observation}=navigator(run);
 await n.handleVerification(observation);assert.match(n.state.message,/not connected/);assert.equal(n.emailCodeAttempted,undefined);
 mailbox.connect(origin);
 for(const message of ['Sign in to Gmail in regular Chrome, then check again.','Gmail did not show the requested search in the matching account.','Gmail companion did not finish. Open its tab in Chrome and check its connection.']){
  mailbox.bridge.read=async()=>({error:message});await n.handleVerification(observation);
  assert.equal(n.state.message,message);assert.equal(n.state.status,'verification');assert.equal(n.emailCodeAttempted,undefined);assert.equal(mailbox.reading,false);
 }
});

test('a connected but unmatched mailbox reports the code result instead of requesting setup',async()=>{
 const {mailbox}=fixture();mailbox.connect(origin);mailbox.bridge.poll();let reads=0;
 mailbox.bridge.read=async()=>{reads++;return {messages:[]};};
 const {n,observation}=navigator(()=>mailbox.lookup({job,recipient,since:new Date().toISOString(),challengeBound:true}));
 await n.handleVerification(observation);
 assert.equal(reads,3);assert.match(n.state.message,/Gmail was checked, but no unique, current verification code/);assert.doesNotMatch(n.state.message,/Connect the Gmail companion/);assert.equal(n.emailCodeAttempted,undefined);
});

test('unexpected lookup failures retain the open verification state and allow another check',async()=>{
 const {n,observation}=navigator(async()=>{throw Error('fixture transport failure');});
 await n.handleVerification(observation);assert.match(n.state.message,/could not finish/);assert.equal(n.state.status,'verification');assert.equal(n.emailCodeAttempted,undefined);
 n.lookupEmailCode=async()=>({error:'Gmail search is still loading.'});await n.handleVerification(observation);assert.equal(n.state.message,'Gmail search is still loading.');
});

test('expired-code diagnostics survive companion polling and reach the original verification state',async()=>{
 const {mailbox}=fixture();mailbox.connect(origin);mailbox.bridge.poll();
 const sent=Date.now()-11*60000;
 mailbox.bridge.read=async()=>({messages:[{id:'private-message-id',sender:'no-reply@greenhouse.io',date:new Date(sent).toISOString(),subject:'Security code',body:'Security code: aBcDeFgH',searchedRecipient:recipient}]});
 const {n,observation}=navigator(()=>mailbox.lookup({job,recipient,since:new Date(sent-1000).toISOString(),challengeBound:true}));
 await n.handleVerification(observation);
 assert.match(n.state.message,/older than.*10-minute freshness limit/);assert.equal(n.emailCodeAttempted,undefined);
 assert.deepEqual(n.state.verification.mail,{messages:1,currentCodes:0,rejected:{expired:1}});
 const checked=await mailbox.check();assert.match(checked.message,/older than.*freshness limit/);assert.equal(checked.lookup.diagnostic.rejected.expired,1);
 for(const secret of ['aBcDeFgH','private-message-id','no-reply@greenhouse.io'])assert.ok(!JSON.stringify({state:checked,navigation:n.state}).includes(secret));
});
