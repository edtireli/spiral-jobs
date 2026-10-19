import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {observe} from '../lib/navigator.mjs';
import {emailChallenge,enterVerification} from '../lib/email-verification.mjs';

let browser;
before(async()=>{browser=await chromium.launch({headless:true});});
after(async()=>{await browser?.close();});
const recipient='fixture@example.test',code='A1B2C3D4';
const prompt=`<p>A verification code was sent to ${recipient}. To submit your application, enter the 8-character code to confirm you’re a human.</p>`;
const inputs=(count=8,prefix='box',attributes='')=>Array.from({length:count},(_,i)=>`<input id="${prefix}-${i}" name="${prefix}-${i}" maxlength="1" ${attributes}>`).join('');
const group=(count=8,prefix='box',label='Security code')=>`<section><label for="${prefix}-0">${label}</label><div>${inputs(count,prefix)}</div></section>`;
async function fixture(t,html,{finalClicked=true,beforeAction=async()=>{}}={}){
 const page=await browser.newPage();t.after(()=>page.close());
 await page.route('**/*',route=>route.abort());
 await page.setContent(prompt+html);
 const events=[];
 const n={page,profile:{email:recipient},finalClicked,checkpoint:async()=>{},beforeAction,checkDocuments:async()=>{},onEvent:(name,detail)=>events.push({name,detail})};
 const challenge=emailChallenge(await observe(page),recipient);
 return {page,n,challenge,events};
}
const button=(label='Submit application')=>`<button type="button" onclick="window.confirmations=(window.confirmations||0)+1">${label}</button>`;
async function confirmations(page){return page.evaluate(()=>window.confirmations||0);}

test('observed split codes require one local labelled group',async t=>{
 const variants={
  shared:`<label>Security code</label><div>${inputs()}</div>`,
  firstOnly:group(),
  aria:`<span id="code-label">Security code</span><div role="group" aria-labelledby="code-label">${inputs()}</div>`,
  legend:`<fieldset><legend>Security code</legend>${inputs()}</fieldset>`,
  individual:`<div>${inputs(8,'box','aria-label="OTP character"')}</div>`,
  minimum:group(4),maximum:group(12),
 };
 for(const [name,html]of Object.entries(variants))await t.test(name,async t=>{
  const {page,challenge}=await fixture(t,html+button());
  const o=await observe(page),fields=o.controls.filter(c=>c.isField);
  assert.equal(challenge.blocked,false);assert.equal(challenge.keys.length,fields.length);
  assert.equal(new Set(fields.map(c=>c.otpGroup)).size,1);assert.ok(fields.every(c=>c.otpGroup!==undefined));
 });
});

test('unlabelled, ambiguous and incomplete split groups cannot be entered',async t=>{
 const variants={
  unlabelled:`<div>${inputs()}</div>`,
  namedOnly:`<div>${inputs(8,'security-code')}</div>`,
  ambiguous:group(4,'first')+group(4,'second'),
  lone:'<label>Security code<input maxlength="1" name="security-code"></label>',
  tooFew:group(3),tooMany:group(13),
  unrelated:`<section><label>Security code</label><div>${inputs(4)}<label>Phone<input name="phone"></label></div></section>`,
  formIsNotGroup:`<form><label>Security code</label>${inputs()}</form>`,
 };
 for(const [name,html]of Object.entries(variants))await t.test(name,async t=>{
  const {page,n,challenge}=await fixture(t,html+button());
  assert.equal(challenge.blocked,true);assert.equal(challenge.kind,'email');
  assert.equal(await enterVerification(n,challenge,{code},observe),false);
  assert.equal(await confirmations(page),0);assert.ok((await page.locator('input').evaluateAll(es=>es.map(e=>e.value))).every(v=>v===''));
 });
});

test('shared-label and first-input-only groups enter all characters before confirming once',async t=>{
 for(const html of [`<label>Security code</label><div>${inputs()}</div>`,group()])await t.test(html.startsWith('<label>')?'shared':'firstOnly',async t=>{
  const {page,n,challenge,events}=await fixture(t,html+button());
  assert.equal(await enterVerification(n,challenge,{code},observe),true);
  assert.deepEqual(await page.locator('input').evaluateAll(es=>es.map(e=>e.value)),[...code]);
  assert.ok((await page.locator('input').evaluateAll(es=>es.map(e=>e.style.webkitTextSecurity))).every(v=>v==='disc'));
  assert.equal(await confirmations(page),1);assert.deepEqual(events,[{name:'email_verification_entered',detail:{}}]);
  assert.ok(!JSON.stringify(events).includes(code));assert.ok(!JSON.stringify((await observe(page)).snapshot).includes(code));
 });
});

test('code length and complete values are checked before any confirmation',async t=>{
 const variants={
  wrongLength:{html:group(6)},
  shortSingle:{html:'<label>Security code<input name="security-code" maxlength="6"></label>'},
  droppedCharacter:{html:group()+'<script>document.querySelector("#box-7").oninput=()=>document.querySelector("#box-0").value="";</script>'},
  changedCharacter:{html:group()+'<script>document.querySelector("#box-7").oninput=()=>document.querySelector("#box-0").value="Z";</script>'},
  invalidCharacter:{html:group()+'<script>document.querySelector("#box-7").oninput=()=>document.querySelector("#box-0").setAttribute("aria-invalid","true");</script>'},
  changedBeforeClick:{html:group(),mutate:true},
  ambiguousButtons:{html:group()+button('Verify code')},
 };
 for(const [name,{html,mutate}]of Object.entries(variants))await t.test(name,async t=>{
  const f=await fixture(t,html+button());
  if(mutate)f.n.beforeAction=async locator=>{if(await locator.evaluate(e=>e.tagName==='BUTTON'))await f.page.locator('#box-0').evaluate(e=>e.value='');};
  assert.equal(await enterVerification(f.n,f.challenge,{code},observe),false);assert.equal(await confirmations(f.page),0);assert.deepEqual(f.events,[]);
 });
});

test('verification respects recipient binding and pre-submit approval',async t=>{
 const f=await fixture(t,group()+button(),{finalClicked:false});
 assert.equal(await enterVerification(f.n,f.challenge,{code},observe),false);assert.equal(await confirmations(f.page),0);
 const confirm=await fixture(t,group()+button('Verify code'),{finalClicked:false});
 assert.equal(await enterVerification(confirm.n,confirm.challenge,{code},observe),true);assert.equal(await confirmations(confirm.page),1);
 const o=await observe(confirm.page);assert.equal(emailChallenge(o,'other@example.test').blocked,true);
 const changed=await fixture(t,group()+button());
 await changed.page.locator('p').evaluate(e=>e.textContent='A verification code was sent to another@example.test.');
 assert.equal(await enterVerification(changed.n,changed.challenge,{code},observe),false);assert.equal(await confirmations(changed.page),0);
});

test('a normal single code field still verifies, while a verification link stays manual',async t=>{
 const f=await fixture(t,'<label>Security code<input name="security-code" maxlength="8"></label>'+button());
 assert.equal(await enterVerification(f.n,f.challenge,{code},observe),true);assert.equal(await confirmations(f.page),1);
 assert.equal(emailChallenge({snapshot:{text:`Please verify your email via the confirmation link sent to ${recipient}.`},controls:[]},recipient).kind,'email_link');
});

test('a verified letters-only code preserves case across all eight inputs',async t=>{
 const f=await fixture(t,group()+button()),letters='aBcDeFgH';
 assert.equal(await enterVerification(f.n,f.challenge,{code:letters},observe),true);
 assert.deepEqual(await f.page.locator('input').evaluateAll(es=>es.map(e=>e.value)),[...letters]);
 assert.equal(await confirmations(f.page),1);assert.ok(!JSON.stringify(f.events).includes(letters));
});
