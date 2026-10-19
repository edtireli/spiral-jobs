import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {browserSession} from '../lib/browser.mjs';
import {detailKey} from '../public/view-state.js';
const root=path.resolve(import.meta.dirname,'../public');

test('progress ticks preserve preview nodes, scroll positions, open reasoning and listing section',async t=>{
 let tick=0;
 const job=()=>({id:'fixture',company:'Fixture',title:'AI role',location:'Copenhagen',url:'https://example.test/job',stage:'ready',revision:1,blocked:false,description:'Listing',navigation:{status:'review',phase:'inspect',sequence:tick,message:'Thinking tick '+tick,exposed:false,activity:[{time:new Date().toISOString(),message:'Thinking tick '+tick}]},listing:{complete:true,capturedAt:'now',text:'Read full listing',sections:[{image:'listing-01.jpg'},{image:'listing-02.jpg'}]},draft:{summary:'Fixture profile',model:'local-fixture',snapshot:{navigation:true,form:{fields:[]}},answers:{}},reasoning:[{id:'run-one',title:'Match CV',model:'local-fixture',phase:'Thinking',thinking:Array.from({length:150+tick},(_,i)=>'Model reasoning line '+i).join('\n'),content:'',done:false}]});
 const server=http.createServer(async(req,res)=>{
  if(req.url.startsWith('/api/state')){tick++;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({busy:{jobId:'fixture',label:'Thinking tick '+tick},jobs:[job()],history:[],settings:{navigationModel:'local-fixture'},candidate:{},runtime:{status:'ready'}}));return;}
  if(req.url.startsWith('/api/jobs/fixture')){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(job()));return;}
  if(req.url.startsWith('/artifacts/')){res.setHeader('Content-Type','image/png');res.end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jhS8AAAAASUVORK5CYII=','base64'));return;}
  const name=req.url==='/'?'index.html':req.url.slice(1);res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html');try{res.end((await readFile(path.join(root,name),'utf8')).replace('__CSRF__','test'));}catch{res.writeHead(404);res.end();}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const b=await browserSession({allowTest:true});t.after(async()=>{await b.browser.close();await new Promise(r=>server.close(r));});
 const errors=[];b.page.on('pageerror',e=>errors.push(e.message));await b.page.emulateMedia({reducedMotion:'reduce'});await b.page.goto(`http://127.0.0.1:${server.address().port}`);
 assert.equal(await b.page.locator('#thinkingPanel').evaluate(e=>e.open),true,'Live thoughts are expanded beside the browser by default');
 const pre=b.page.locator('.thinking-text');await pre.waitFor({state:'visible'});
 await pre.evaluate(e=>e.scrollTop=180);await b.page.locator('#detail').evaluate(e=>e.scrollTop=e.scrollHeight);
 const handle=await pre.elementHandle(),before=await b.page.evaluate(()=>({detail:document.querySelector('#detail').scrollTop,thought:document.querySelector('.thinking-text').scrollTop}));const from=tick;
 await b.page.waitForFunction(n=>Number(document.querySelector('#liveMessage')?.textContent.split(' ').at(-1))>=n,from+2);
 assert.equal(await handle.evaluate(e=>e.isConnected),true,'thinking DOM is not remounted by progress');
 const after=await b.page.evaluate(()=>({detail:document.querySelector('#detail').scrollTop,thought:document.querySelector('.thinking-text').scrollTop,open:document.querySelector('#thinkingPanel').open}));
 assert.ok(Math.abs(after.detail-before.detail)<=2,JSON.stringify({before,after}));assert.equal(after.thought,before.thought);assert.equal(after.open,true);
 await b.page.locator('[data-tab=website]').click();await b.page.locator('#nextSection').click();const image=await b.page.locator('#tabContent .screenshot').elementHandle();const start=tick;
 await b.page.waitForFunction(n=>Number(document.querySelector('#activity')?.textContent.split(' ').at(-1))>=n,start+2);
 assert.equal(await image.evaluate(e=>e.isConnected),true);assert.match(await b.page.locator('#tabContent .screenshot').getAttribute('src'),/listing-02/);assert.deepEqual(errors,[]);
});
test('structural changes invalidate the view but model progress does not',()=>{
 const j={id:'1',revision:1,stage:'ready',navigation:{status:'review',phase:'inspect',sequence:1,message:'first'}};
 assert.equal(detailKey(j),detailKey({...j,navigation:{...j.navigation,sequence:2,message:'thinking'}}));
 assert.notEqual(detailKey(j),detailKey({...j,revision:2}));
});

test('Find jobs only collects; Auto apply follows the current job live without extra approval',async t=>{
 let active=null;const posts=[];
 const job=id=>({id,company:'Fixture '+id,title:'Role '+id,location:'Copenhagen',url:'https://example.test/'+id,stage:'new',revision:1,blocked:false,navigation:{status:active===id?'running':'stopped',phase:'inspect',sequence:active===id?2:1,message:'Working on '+id,automatic:true,exposed:false}});
 const server=http.createServer(async(req,res)=>{
  if(req.method==='POST'){posts.push(req.url);if(req.url==='/api/autonomy/run')active='a';res.setHeader('Content-Type','application/json');res.end('{"queued":true}');return;}
  if(req.url==='/api/state'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({busy:active?{jobId:active,label:'Working on '+active}:null,jobs:['a','b'].map(job),history:[],settings:{navigationModel:'fixture'},candidate:{},runtime:{status:'ready'},autonomy:{enabled:true,available:2,running:!!active,currentJobId:active}}));return;}
  if(req.url.startsWith('/api/jobs/')){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(job(req.url.split('/').at(-1))));return;}
  if(req.url.startsWith('/artifacts/')){res.setHeader('Content-Type','image/png');res.end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jhS8AAAAASUVORK5CYII=','base64'));return;}
  const name=req.url==='/'?'index.html':req.url.slice(1);res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html');try{res.end((await readFile(path.join(root,name),'utf8')).replace('__CSRF__','test'));}catch{res.writeHead(404);res.end();}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const b=await browserSession({allowTest:true});t.after(async()=>{await b.browser.close();await new Promise(r=>server.close(r));});
 b.gate.approved=true; // Permit POSTs to the local dashboard fixture, never an employer.
 const errors=[];b.page.on('pageerror',e=>errors.push(e.message));await b.page.goto(`http://127.0.0.1:${server.address().port}`);
 await b.page.waitForFunction(()=>document.querySelector('#autoApplyButton')?.textContent.includes('2'));
 await Promise.all([b.page.waitForResponse(r=>r.url().endsWith('/api/scan')),b.page.locator('#scanButton').click()]);assert.deepEqual(posts,['/api/scan']);
 await b.page.locator('#autoApplyButton').click();assert.equal(await b.page.locator('#applyMode').isVisible(),true);assert.deepEqual(posts,['/api/scan']);await b.page.locator('input[name=mode][value=full]').check();await b.page.locator('#startApplyMode').click();await b.page.waitForFunction(()=>document.querySelector('#liveMessage')?.textContent==='Working on a');
 assert.deepEqual(posts,['/api/scan','/api/autonomy/run']);assert.equal(await b.page.locator('#stopAutoButton').isVisible(),true);assert.equal(await b.page.locator('#approve').isVisible(),false);
 active='b';await b.page.waitForFunction(()=>document.querySelector('#liveMessage')?.textContent==='Working on b');assert.equal(await b.page.locator('.detail-top h2').textContent(),'Role b');assert.deepEqual(errors,[]);
});

test('verification shows live Gmail connection state without asking paired users to connect again',async t=>{
 let gmail={status:'connected'},busy=false;const posts=[];
 const job={id:'fixture',company:'Fixture',title:'AI role',location:'Copenhagen',url:'https://example.test/job',stage:'verification',revision:1,blocked:false,navigation:{status:'verification',phase:'fill',sequence:1,message:'Email verification is pending.',exposed:true,verification:{kind:'email'}}};
 const server=http.createServer(async(req,res)=>{
  if(req.method==='POST'){posts.push(req.url);res.setHeader('Content-Type','application/json');res.end('{"queued":true}');return;}
  if(req.url==='/api/state'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({busy:busy?{jobId:job.id,label:'Checking email'}:null,jobs:[job],history:[],settings:{navigationModel:'fixture',sources:[]},candidate:{},runtime:{status:'ready'},gmail}));return;}
  if(req.url==='/api/jobs/fixture'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(job));return;}
  if(req.url==='/api/models'){res.setHeader('Content-Type','application/json');res.end('[]');return;}
  if(req.url.startsWith('/artifacts/')){res.setHeader('Content-Type','image/png');res.end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jhS8AAAAASUVORK5CYII=','base64'));return;}
  const name=req.url==='/'?'index.html':req.url.slice(1);res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html');try{res.end((await readFile(path.join(root,name),'utf8')).replace('__CSRF__','test'));}catch{res.writeHead(404);res.end();}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const b=await browserSession({allowTest:true});t.after(async()=>{await b.browser.close();await new Promise(r=>server.close(r));});b.gate.approved=true;
 const errors=[];b.page.on('pageerror',e=>errors.push(e.message));await b.page.goto(`http://127.0.0.1:${server.address().port}`);
 const status=async label=>b.page.waitForFunction(value=>document.querySelector('#verificationGmailStatus')?.textContent===value,label);
 await status('Gmail connected.');assert.equal(await b.page.locator('#verificationGmail').count(),0);
 gmail={status:'reconnecting'};busy=true;await status('Reconnecting Gmail…');assert.equal(await b.page.locator('#checkVerification').isDisabled(),true);assert.equal(await b.page.locator('#verificationGmail').count(),0);
 gmail={status:'attention'};busy=false;await status('Gmail needs attention.');assert.equal(await b.page.locator('#verificationGmail').textContent(),'Gmail settings');
 await b.page.locator('#verificationGmail').click();assert.equal(await b.page.locator('#settings').isVisible(),true);assert.equal(await b.page.locator('#gmailStatus').evaluate(e=>e.closest('details').open),true);assert.deepEqual(posts,[]);await b.page.locator('[data-close="settings"]').click();
 gmail={status:'closed'};await status('Gmail paired · open its companion in Chrome.');assert.equal(await b.page.locator('#verificationGmail').textContent(),'Gmail settings');
 gmail={status:'disconnected',paired:true};await status('Gmail paired · open its companion in Chrome.');await b.page.waitForTimeout(2300);assert.equal(await b.page.locator('#verificationGmail').textContent(),'Gmail settings');
 gmail={status:'disconnected',paired:false};await status('Gmail not connected.');assert.equal(await b.page.locator('#verificationGmail').textContent(),'Connect Gmail');
 gmail={status:'connected',lookup:{error:'No current code'}};await status('Gmail connected · lookup needs attention.');assert.equal(await b.page.locator('#verificationGmail').textContent(),'Gmail settings');
 assert.deepEqual(posts,[],'status changes never reconnect, retry or submit');await b.page.locator('#checkVerification').click();await b.page.waitForResponse(r=>r.url().endsWith('/api/state'));assert.deepEqual(posts,['/api/jobs/fixture/check-verification']);assert.deepEqual(errors,[]);
});

test('recoverable exposed application offers Resume same browser without automatic replay',async t=>{
 const posts=[],job={id:'fixture',company:'Fixture',title:'AI role',location:'Copenhagen',url:'https://example.test/job',stage:'paused',revision:1,blocked:{status:'incomplete'},navigation:{status:'paused',phase:'fill',sequence:1,message:'Resume to retry the decision in this same browser; completed fields stay filled.',exposed:true,recoverable:'model_decision',automatic:true,approvalMode:'final'}};
 const server=http.createServer(async(req,res)=>{
  if(req.method==='POST'){posts.push(req.url);res.setHeader('Content-Type','application/json');res.end('{"queued":true}');return;}
  if(req.url==='/api/state'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({busy:null,jobs:[job],history:[],settings:{navigationModel:'fixture'},candidate:{},runtime:{status:'ready'},autonomy:{enabled:true,running:false,available:0}}));return;}
  if(req.url==='/api/jobs/fixture'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(job));return;}
  if(req.url.startsWith('/artifacts/')){res.setHeader('Content-Type','image/png');res.end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jhS8AAAAASUVORK5CYII=','base64'));return;}
  const name=req.url==='/'?'index.html':req.url.slice(1);res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html');try{res.end((await readFile(path.join(root,name),'utf8')).replace('__CSRF__','test'));}catch{res.writeHead(404);res.end();}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const b=await browserSession({allowTest:true});t.after(async()=>{await b.browser.close();await new Promise(r=>server.close(r));});b.gate.approved=true;
 await b.page.goto(`http://127.0.0.1:${server.address().port}`);await b.page.locator('[data-id=fixture]').click();
 assert.match(await b.page.locator('#applicationAction').textContent(),/Resume same browser/);assert.equal(await b.page.locator('#resumeNavigation').textContent(),'Resume same browser');
 assert.equal(await b.page.locator('#inspect').isDisabled(),true);assert.equal(await b.page.locator('#draft').isDisabled(),true);assert.ok((await b.page.locator('#tabContent').textContent()).includes('Final send needs approval.'));
 assert.deepEqual(posts,[]);await b.page.locator('#resumeNavigation').click();await b.page.waitForResponse(r=>r.url().endsWith('/api/state'));assert.deepEqual(posts,['/api/jobs/fixture/resume-navigation']);
});
