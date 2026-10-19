import test from 'node:test';
import assert from 'node:assert/strict';
import {MailBridge,mailSearchDiagnostic} from '../lib/mail-bridge.mjs';
import {GmailMailbox} from '../lib/mail.mjs';

const search={routeIsSearch:true,inputPresent:true,inputMatches:false,routeMatches:true,accountMatches:true};
test('search diagnostics accept only the fixed boolean schema',()=>{
 assert.deepEqual(mailSearchDiagnostic({...search,query:'private',recipient:'private',code:'private',body:'private'}),search);
 for(const value of [undefined,null,{},'private',{...search,inputMatches:'private'}])assert.equal(mailSearchDiagnostic(value),undefined);
});
test('bridge and mailbox retain search booleans without forwarding arbitrary diagnostic data',async()=>{
 const settings={enabled:true,transport:'chrome',bridgeToken:'a'.repeat(64)};
 const mailbox=new GmailMailbox({settings:()=>settings,save:()=>{}});mailbox.bridge.lastSeen=Date.now();
 const pending=mailbox.lookup({job:{company:'Fixture Research',url:'https://job-boards.greenhouse.io/fixture/jobs/1'},recipient:'fixture@example.test',since:new Date().toISOString(),challengeBound:true});
 await new Promise(resolve=>setImmediate(resolve));
 mailbox.bridge.complete({id:mailbox.bridge.pending.id,error:'Gmail did not show the requested search in the matching account.',diagnostic:{search:{...search,query:'private query',code:'private code'},recipient:'private recipient',body:'private body'}});
 const result=await pending;
 assert.deepEqual(result.diagnostic,{transport:true,search});assert.deepEqual((await mailbox.check()).lookup.diagnostic,{transport:true,search});
 assert.doesNotMatch(JSON.stringify(result),/private/);assert.equal(result.code,undefined);
 const bridge=new MailBridge({settings:()=>settings,save:()=>{}}),read=bridge.read({recipient:'fixture@example.test',query:'fixture'});await new Promise(resolve=>setImmediate(resolve));
 bridge.complete({id:bridge.pending.id,error:'Lookup failed.',diagnostic:{search:{...search,accountMatches:'private'},body:'private'}});
 assert.deepEqual(await read,{error:'Lookup failed.'});
});
