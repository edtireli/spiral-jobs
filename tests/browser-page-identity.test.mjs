import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {Navigator} from '../lib/navigator.mjs';
import {navigationMethods} from '../lib/navigation-service.mjs';

async function fixture(t){
 const dir=await mkdtemp(path.join(os.tmpdir(),'job-desk-page-identity-')),events=[],requests=[];
 const server=http.createServer(async(req,res)=>{if(req.method==='POST')requests.push(req.url);res.setHeader('Content-Type','text/html');res.end('<h1>Fixture application</h1><form method="post"><button>Submit application</button></form>');});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const n=new Navigator({dir,allowTest:true,headless:true,onEvent:(action,detail)=>events.push({action,detail})});
 t.after(async()=>{await n.close();await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});});
 const url=`http://127.0.0.1:${server.address().port}/apply`;await n.open(url);
 const original=n.page;
 const hold=()=>{n.adoptAnchoredPage(original);n.exposed=true;n.finalClicked=true;n.s.gate.approved=true;n.reservation={id:'original-reservation'};n.final={url};n.update('verification','Fixture CAPTCHA',{verification:{kind:'captcha',canAttempt:true}});};
 const service={navigators:new Map([['fixture',n]])};
 return {n,url,dir,original,hold,events,requests,session:()=>navigationMethods.session.call(service,'fixture')};
}

test('an incidental same-URL tab cannot replace or close a pending application',async t=>{
 const f=await fixture(t),{n,original}=f;f.hold();const reservation=n.reservation;
 const other=await n.s.context.newPage();await other.goto(f.url);
 assert.equal(n.page,original);assert.equal(n.applicationPage,original);assert.ok(n.recordingPages.includes(other));
 await other.close();await n.live();assert.equal(f.session(),n);
 assert.equal(n.closed,false);assert.equal(original.isClosed(),false);assert.equal(n.state.status,'verification');assert.equal(n.state.verification.canAttempt,true);
 assert.equal(n.reservation,reservation);assert.equal(n.finalClicked,true);assert.deepEqual(f.requests,[]);
 assert.ok(f.events.some(e=>e.action==='additional_browser_page_ignored'));
});

test('legacy repair requires demonstrated original page identity, never a same-URL substitute',async t=>{
 const f=await fixture(t),{n,original}=f;
 const other=await n.s.context.newPage();await other.goto(f.url);assert.equal(n.page,other);
 n.exposed=true;n.finalClicked=true;n.final={url:f.url};n.reservation={id:'original-reservation'};
 assert.throws(()=>n.adoptAnchoredPage(other),/original page identity/);
 await other.close();assert.equal(n.closed,false,'closing an unanchored legacy incidental tab cannot close the actual application');
 assert.equal(n.adoptAnchoredPage(original),original);assert.equal(n.page,original);assert.equal(n.applicationPage,original);
 const third=await n.s.context.newPage();await third.goto(f.url);
 assert.throws(()=>n.adoptAnchoredPage(third),/different application page/);
 n.page=other;assert.equal(f.session(),n);assert.equal(n.page,original,'service restores the proven anchor before using the browser');
 assert.deepEqual(f.requests,[]);
});

test('closing the original pending page records uncertainty and retains the same reservation',async t=>{
 const f=await fixture(t),{n,original}=f;f.hold();const reservation=n.reservation;
 const other=await n.s.context.newPage();await other.goto(f.url);
 await original.close();await n.close();
 assert.equal(n.closed,true);assert.equal(n.abort.signal.aborted,true);assert.equal(n.state.status,'uncertain');assert.equal(n.state.browserClosed,true);
 assert.equal(n.state.verification,null);assert.equal(n.state.finalReview,null);assert.equal(n.reservation,reservation);assert.equal(n.finalClicked,true);
 assert.throws(f.session,/no longer open/);assert.deepEqual(f.requests,[]);
 const saved=f.events.filter(e=>e.action==='recording_saved');assert.equal(saved.length,2);
 assert.ok((await readFile(path.join(f.dir,saved[0].detail.file))).length>1000);
 const transcript=f.events.find(e=>e.action==='recording_transcript_saved');assert.ok(transcript);
 assert.equal(JSON.parse(await readFile(path.join(f.dir,transcript.detail.file))).status,'uncertain');
 assert.equal(f.events.filter(e=>e.action==='application_browser_closed').length,1);
});

test('a confirmed receipt survives original-page closure',async t=>{
 const f=await fixture(t);f.hold();f.n.update('submitted','The employer confirmed receipt.');
 await f.original.close();await f.n.close();assert.equal(f.n.state.status,'submitted');assert.deepEqual(f.requests,[]);
});

test('inspection can follow a popup and closing its obsolete opener does not stop it',async t=>{
 const f=await fixture(t),{n,original}=f;const popup=await n.s.context.newPage();await popup.goto(f.url);
 assert.equal(n.page,popup);assert.equal(n.applicationPage,undefined);
 await original.close();assert.equal(n.closed,false);assert.equal(f.session(),n);
 n.adoptAnchoredPage(popup);n.exposed=true;assert.equal(n.applicationPage,popup);assert.deepEqual(f.requests,[]);
});
