import test from 'node:test';
import assert from 'node:assert/strict';
import {GmailMailbox} from '../lib/mail.mjs';
import {openGmailCompanion} from '../lib/gmail-reconnect.mjs';

const extensionId='a'.repeat(32),extensionOrigin='chrome-extension://'+extensionId,token='b'.repeat(64),recipient='fixture@example.test';
function fixture(options={}){
 let saved={enabled:true,transport:'chrome',bridgeToken:token,bridgeExtensionId:extensionId},opens=[];
 const mailbox=new GmailMailbox({settings:()=>saved,save:s=>saved=s,reconnectTimeoutMs:30,reconnectPollMs:5,openCompanion:async id=>{opens.push(id);mailbox.bridge.poll(extensionOrigin);},...options});
 return {mailbox,opens,settings:()=>saved,set:s=>saved=s};
}

test('Mac reopening uses only the authenticated extension identity and a fixed Chrome target',async()=>{
 const calls=[];await openGmailCompanion(extensionId,{platform:'darwin',run:async(...args)=>calls.push(args)});
 assert.deepEqual(calls[0].slice(0,2),['/usr/bin/open',['-b','com.google.Chrome',extensionOrigin+'/connector.html']]);
 assert.equal(calls[0][2].timeout,8000);
 for(const id of ['',extensionId+'/other','https://example.test','a'.repeat(31),'z'.repeat(32)])await assert.rejects(openGmailCompanion(id,{platform:'darwin',run:async()=>{throw Error('must not launch');}}),/verified extension identity/);
 await assert.rejects(openGmailCompanion(extensionId,{platform:'linux',run:async()=>{throw Error('must not launch');}}),/Mac app/);
 assert.equal(calls.length,1);
});

test('a missing heartbeat reopens the paired companion without replacing token or pending lookup',async()=>{
 const f=fixture(),pending=f.mailbox.bridge.read({recipient,query:'fixture query'});await new Promise(r=>setImmediate(r));
 const request=f.mailbox.bridge.pending,id=request.id;
 assert.equal(await f.mailbox.ensureConnected(),null);assert.deepEqual(f.opens,[extensionId]);assert.equal(f.settings().bridgeToken,token);
 assert.equal(f.mailbox.bridge.pending,request);assert.equal(f.mailbox.bridge.pending.id,id);
 f.mailbox.bridge.complete({id,account:recipient,messages:[]});assert.deepEqual(await pending,{messages:[]});
});

test('verification automatically reconnects once, then performs its existing scoped lookup',async()=>{
 const f=fixture();let reads=0;
 f.mailbox.bridge.read=async policy=>{reads++;assert.equal(f.mailbox.bridge.status(),'connected');assert.equal(policy.challengeBound,true);return {messages:[{id:'fixture',sender:'no-reply@greenhouse.io',date:new Date().toISOString(),subject:'Security code',body:'Security code: aBcDeFgH',searchedRecipient:recipient}]};};
 const result=await f.mailbox.lookup({job:{company:'Fixture Research',url:'https://job-boards.greenhouse.io/fixture/jobs/1'},recipient,since:new Date().toISOString(),challengeBound:true});
 assert.equal(result.code,'aBcDeFgH');assert.equal(reads,1);assert.equal(f.opens.length,1);assert.equal(f.settings().bridgeToken,token);
});

test('connected and legacy pairings do not open another window or invent an extension target',async()=>{
 const f=fixture();f.mailbox.bridge.poll(extensionOrigin);assert.equal(await f.mailbox.ensureConnected(),null);assert.equal(f.opens.length,0);
 f.mailbox.bridge.lastSeen=0;f.set({enabled:true,transport:'chrome',bridgeToken:token});assert.equal(await f.mailbox.ensureConnected(),null);assert.equal(f.opens.length,0);
 f.set({enabled:false,transport:'chrome',bridgeToken:token,bridgeExtensionId:extensionId});assert.match((await f.mailbox.ensureConnected()).error,/not connected/);assert.equal(f.opens.length,0);
});
test('saved authorization is visible before heartbeat and explicit disconnect clears it',async()=>{
 const f=fixture();assert.equal(f.mailbox.state.paired,true);assert.equal(f.mailbox.state.status,'closed');
 assert.equal((await f.mailbox.check()).paired,true);
 await f.mailbox.disconnect();assert.equal(f.mailbox.state.paired,false);assert.equal((await f.mailbox.check()).paired,false);
});

test('reconnection failure is bounded and preserves authorization and the pending request',async()=>{
 const f=fixture({openCompanion:async()=>{}}),pending=f.mailbox.bridge.read({recipient,query:'fixture query'});await new Promise(r=>setImmediate(r));
 const request=f.mailbox.bridge.pending,start=Date.now(),result=await f.mailbox.ensureConnected();
 assert.match(result.error,/did not reconnect/);assert.ok(Date.now()-start<500);assert.equal(f.settings().bridgeToken,token);assert.equal(f.mailbox.bridge.pending,request);
 f.mailbox.bridge.cancel();await pending;
 const unavailable=fixture({openCompanion:async()=>{throw Error('sensitive OS detail');}});const error=await unavailable.mailbox.ensureConnected();
 assert.match(error.error,/could not be reopened/);assert.doesNotMatch(error.error,/sensitive/);assert.equal(unavailable.settings().bridgeToken,token);
});

test('parallel recovery calls share one opening and disconnect during recovery cannot reauthorize',async()=>{
 let openCount=0,release;
 const opened=new Promise(r=>release=r),f=fixture({openCompanion:async()=>{openCount++;await opened;f.mailbox.bridge.poll(extensionOrigin);}});
 const first=f.mailbox.ensureConnected(),second=f.mailbox.ensureConnected();release();assert.deepEqual(await Promise.all([first,second]),[null,null]);assert.equal(openCount,1);
 const revoked=fixture({openCompanion:async()=>revoked.mailbox.disconnect()});assert.match((await revoked.mailbox.ensureConnected()).error,/pairing changed/);assert.equal(revoked.settings().enabled,false);assert.equal(revoked.settings().bridgeToken,undefined);
 const cancelled=fixture(),abort=new AbortController();abort.abort();await assert.rejects(cancelled.mailbox.ensureConnected({signal:abort.signal}));assert.equal(cancelled.opens.length,0);
});

test('only a valid authorized heartbeat can persist an extension target',()=>{
 const f=fixture();f.set({enabled:true,transport:'chrome',bridgeToken:token});
 assert.throws(()=>f.mailbox.bridge.poll('chrome-extension://'+extensionId+'/connector.html'),/authorized/);assert.equal(f.settings().bridgeExtensionId,undefined);
 f.mailbox.bridge.poll(extensionOrigin);assert.equal(f.settings().bridgeExtensionId,extensionId);assert.equal(f.settings().bridgeToken,token);
 f.set({enabled:false,transport:'chrome',bridgeToken:token});assert.throws(()=>f.mailbox.bridge.poll(extensionOrigin),/authorized/);assert.equal(f.settings().bridgeExtensionId,undefined);
});
