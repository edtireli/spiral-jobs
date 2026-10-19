import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {mkdtemp,rm} from 'node:fs/promises';
import {Navigator} from '../lib/navigator.mjs';
import {captureCaptcha,validCaptchaAction} from '../lib/captcha.mjs';
import {ExecutionControl} from '../lib/execution-control.mjs';

const challenge=`<style>body{margin:0;padding:10px}canvas{display:block}button{margin:10px}</style><p>Drag the square to its outline.</p><canvas width=480 height=300></canvas><button id=verify>Verify</button><script>
const c=document.querySelector('canvas'),ctx=c.getContext('2d');ctx.fillStyle='#fafafa';ctx.fillRect(0,0,480,300);ctx.fillStyle='#232';ctx.fillRect(20,30,60,60);ctx.strokeRect(300,150,60,60);c.onpointerdown=()=>parent.moves++;c.onpointerup=()=>parent.drops++;document.querySelector('button').onclick=()=>{parent.verifies++;if(!parent.keepChallenge){parent.document.querySelector('iframe').remove();parent.document.querySelector('p').textContent='Thank you for your application';}};</script>`;
async function fixture(t,decide){
 const dir=await mkdtemp(path.join(os.tmpdir(),'captcha-local-')),server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end(req.url==='/captcha-fixture?wrapper'?'<style>body{margin:0}</style><iframe src="/captcha-fixture?inner" style="width:520px;height:500px;border:0"></iframe>':req.url.startsWith('/captcha-fixture')?challenge:`<p>Application pending verification.</p><button onclick="submits++">Submit application</button><iframe src=/captcha-fixture style="width:520px;height:500px;border:0"></iframe><script>window.submits=0;window.moves=0;window.drops=0;window.verifies=0;window.keepChallenge=false;</script>`);});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const control=new ExecutionControl('fixture'),events=[],n=new Navigator({dir,allowTest:true,headless:true,model:'fixture',captchaDecide:decide,checkpoint:()=>control.checkpoint(),controlState:()=>control.state(),onEvent:(action,detail)=>events.push({action,detail})});n.networkAuthorized=true;await n.open(`http://127.0.0.1:${server.address().port}`);n.exposed=true;n.finalClicked=true;n.reservation={id:'original'};n.update('verification','Current CAPTCHA',{verification:{kind:'captcha'},phase:'fill'});
 t.after(async()=>{await n.close();await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});});return {n,control,events};
}
const point=(surface,x,y)=>({x:surface.x+surface.width*x,y:surface.y+surface.height*y});

test('CAPTCHA decisions are bounded to observed puzzle surfaces and known verify controls',()=>{
 const scene={surfaces:[{target:'s0',x:10,y:10,width:700,height:700}],buttons:[{target:'b0',label:'Verify'}]};
 assert.equal(validCaptchaAction({action:'drag',target:'s0',from:{x:100,y:100},to:{x:500,y:500},reason:'Matching shape'},scene),true);
 for(const a of [{action:'click',target:'application-submit',from:{x:100,y:100}},{action:'drag',target:'s0',from:{x:100,y:100},to:{x:900,y:500}},{action:'verify',target:'application-submit'},{action:'click',target:'s0',from:{x:NaN,y:100}}])assert.equal(validCaptchaAction({...a,reason:'Unsupported'},scene),false);
});
test('one explicitly confirmed drag and Verify preserves the original submission without replaying Submit',{timeout:30000},async t=>{
 let calls=0;const {n,events}=await fixture(t,async({scene})=>++calls===1?{action:'drag',target:'s0',from:point(scene.surfaces[0],.1,.2),to:point(scene.surfaces[0],.7,.6),reason:'Square matches its outline'}:{action:'verify',target:scene.buttons[0].target,reason:'The puzzle has been arranged'});
 const sequence=n.state.sequence;await assert.rejects(n.attemptCaptcha({sequence,confirm:false}),/Confirm/);await assert.rejects(n.attemptCaptcha({sequence:sequence-1,confirm:true}),/Confirm/);assert.equal(calls,0);
 const result=await n.attemptCaptcha({sequence,confirm:true});assert.equal(result.resolved,true);assert.deepEqual(await n.page.evaluate(()=>({submits,moves,drops,verifies})),{submits:0,moves:1,drops:1,verifies:1});
 assert.equal(n.reservation.id,'original');assert.equal(n.finalClicked,true);assert.equal(n.closed,false);assert.equal(events.filter(e=>e.action==='captcha_action').length,2);await assert.rejects(n.attemptCaptcha({sequence,confirm:true}),/Confirm/);
});
test('a new CAPTCHA after Verify needs new confirmation rather than another model attempt',{timeout:30000},async t=>{
 let calls=0;const {n}=await fixture(t,async({scene})=>{calls++;return {action:'verify',target:scene.buttons[0].target,reason:'Fixture arranged'};});await n.page.evaluate(()=>window.keepChallenge=true);
 const result=await n.attemptCaptcha({sequence:n.state.sequence,confirm:true});assert.equal(result.resolved,false);assert.equal(calls,1);assert.equal(await n.page.evaluate(()=>verifies),1);assert.equal(n.closed,false);assert.equal(n.state.verification.attempting,false);
});
test('Stop during CAPTCHA reasoning discards the pending decision before any browser mutation',{timeout:30000},async t=>{
 let started,release;const ready=new Promise(r=>started=r),pending=new Promise(r=>release=r);const {n,control}=await fixture(t,async({scene})=>{started();await pending;return {action:'click',target:'s0',from:point(scene.surfaces[0],.1,.2),reason:'Fixture tile'};});
 const running=n.attemptCaptcha({sequence:n.state.sequence,confirm:true});await ready;control.cancel();release();await running;assert.deepEqual(await n.page.evaluate(()=>({submits,moves,drops,verifies})),{submits:0,moves:0,drops:0,verifies:0});assert.equal(n.closed,false);
});
test('a changed puzzle discards stale coordinates and model attempts remain bounded',{timeout:30000},async t=>{
 let calls=0;const {n,events}=await fixture(t,async({scene})=>{calls++;await n.page.frames()[1].evaluate(i=>{const ctx=document.querySelector('canvas').getContext('2d');ctx.fillStyle=i%2?'red':'blue';ctx.fillRect(0,0,10,10);},calls);return {action:'click',target:'s0',from:point(scene.surfaces[0],.1,.2),reason:'Fixture tile'};});
 const result=await n.attemptCaptcha({sequence:n.state.sequence,confirm:true});assert.equal(result.resolved,false);assert.equal(calls,6);assert.equal(events.filter(e=>e.action==='captcha_stale_decision_discarded').length,6);assert.equal(await n.page.evaluate(()=>moves+verifies+submits),0);
});
test('CAPTCHA frame discovery does not treat arbitrary same-origin application frames as puzzles',{timeout:30000},async t=>{
 const {n}=await fixture(t,()=>{throw new Error('Must not call model');});await n.page.locator('iframe').evaluate(e=>e.src='/application-form');await n.page.waitForTimeout(200);assert.equal(await captureCaptcha(n.page,{allowTest:true}),null);
 const result=await n.attemptCaptcha({sequence:n.state.sequence,confirm:true});assert.equal(result.resolved,false);assert.match(result.reason,/No supported CAPTCHA/);assert.equal(n.closed,false);
});
test('nested trusted CAPTCHA frames are captured with image geometry only',{timeout:30000},async t=>{
 const {n}=await fixture(t,()=>{throw new Error('No model call');});await n.page.locator('iframe').evaluate(e=>e.src='/captcha-fixture?wrapper');await n.page.waitForTimeout(300);
 const captured=await captureCaptcha(n.page,{allowTest:true});assert.ok(captured);assert.match(captured.url,/inner/);assert.equal(captured.scene.text,undefined);assert.equal(captured.scene.surfaces.length,1);
 await n.page.locator('iframe').evaluate(e=>e.style.position='absolute');await n.page.locator('iframe').evaluate(e=>e.style.top='-9999px');assert.equal(await captureCaptcha(n.page,{allowTest:true}),null);
});
test('replacing the original challenge after an action consumes no second puzzle under that confirmation',{timeout:30000},async t=>{
 let calls=0;const {n}=await fixture(t,async({scene})=>{calls++;return {action:'click',target:'s0',from:point(scene.surfaces[0],.1,.2),reason:'Fixture tile'};});
 await n.page.frames()[1].evaluate(()=>document.querySelector('canvas').onpointerup=()=>{const old=parent.document.querySelector('iframe'),fresh=old.cloneNode();fresh.src='/captcha-fixture?new';old.replaceWith(fresh);});
 const result=await n.attemptCaptcha({sequence:n.state.sequence,confirm:true});assert.equal(result.resolved,false);assert.match(result.reason,/different CAPTCHA/);assert.equal(calls,1);assert.equal(await n.page.evaluate(()=>submits+verifies),0);assert.equal(n.closed,false);
});
test('CAPTCHA Verify may navigate to a receipt without another application action',{timeout:30000},async t=>{
 let calls=0;const {n,events}=await fixture(t,async({scene})=>{calls++;return {action:'verify',target:scene.buttons[0].target,reason:'Fixture arranged'};});
 await n.page.frames()[1].evaluate(()=>document.querySelector('button').onclick=()=>{parent.history.pushState({},'', '/receipt');parent.document.querySelector('p').textContent='Thank you for your application';parent.document.querySelector('iframe').remove();});
 const result=await n.attemptCaptcha({sequence:n.state.sequence,confirm:true});assert.equal(result.resolved,true);assert.match(n.page.url(),/\/receipt$/);assert.equal(calls,1);assert.equal(events.filter(e=>e.action==='captcha_action').length,1);assert.equal(await n.page.evaluate(()=>submits),0);assert.equal(n.finalClicked,true);
});
