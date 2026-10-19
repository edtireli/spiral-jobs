import test from 'node:test';
import assert from 'node:assert/strict';
import {validVisionAction,visionChoices} from '../lib/navigator.mjs';
import {localJSON} from '../lib/ollama-json.mjs';
const observation={controls:[{target:'0:4',label:'Cover letter',type:'file',isField:true,pending:true},{target:'0:5',label:'Submit application',type:'submit',isField:false},{target:'0:6',label:'Next',type:'button',isField:false}]};
test('vision must select an observed control of the correct kind before acting',()=>{
 const action={action:'final',reason:'Form complete.'};
 for(const target of [undefined,'Submit application','q123','0:999','0:4'])assert.equal(validVisionAction({...action,target},observation,'fill'),false);
 assert.equal(validVisionAction({...action,target:'0:5'},observation,'fill'),true);
 assert.equal(validVisionAction({...action,target:'0:5'},observation,'inspect'),false);
 assert.equal(validVisionAction({action:'click',target:'0:5',reason:'Submit'},observation,'fill'),false);
 assert.equal(validVisionAction({action:'click',target:'0:6',reason:'Continue'},observation,'fill'),true);
 assert.equal(validVisionAction({action:'fill',target:'0:5',reason:'Fill'},observation,'fill'),false);
 assert.equal(validVisionAction({action:'fill',target:'0:4',reason:'Attach'},observation,'fill'),true);
});
test('vision cannot refill an already completed zero-years answer',()=>{
 const completed={controls:[{target:'0:4',label:'Years of consulting experience',type:'text',isField:true,filled:true,pending:false,invalid:false}]};
 assert.equal(validVisionAction({action:'fill',target:'0:4',reason:'Zero is invalid'},completed,'fill'),false);
});
test('LinkedIn import cannot become a navigation or submit action',()=>{
 for(const control of [{label:'Apply with LinkedIn',type:'submit'},{label:'Continue',href:'https://www.linkedin.com/oauth/v2/authorization'}]){
  const o={controls:[{...control,target:'0:1',isField:false}]};
  for(const action of ['click','final'])for(const phase of ['inspect','fill'])assert.equal(validVisionAction({action,target:'0:1',reason:'Use LinkedIn'},o,phase),false);
 }
 const o={controls:[{target:'0:2',label:'LinkedIn Profile',isField:true,required:false,pending:true}]};
 assert.equal(validVisionAction({action:'fill',target:'0:2',reason:'Add profile'},o,'fill'),false);
});

test('semantic correction lists permitted pairs and retries only the model result',async()=>{
 const completed={controls:observation.controls.map(c=>({...c,pending:false}))},choices=visionChoices(completed,'fill');
 assert.ok(!choices.some(c=>c.action==='fill'));assert.ok(!choices.some(c=>c.action==='click'&&c.target==='0:5'));assert.ok(choices.some(c=>c.action==='final'&&c.target==='0:5'));
 const requests=[],body={model:'fixture',messages:[{role:'user',content:'Choose one observed action.'}]};
 const repairInstruction='Choose an allowed action/target pair: '+JSON.stringify(choices);
 const result=await localJSON(body,{repairInstruction,validate:d=>validVisionAction(d,completed,'fill'),chat:async request=>{requests.push(request);return {message:{content:JSON.stringify(requests.length===1?{action:'fill',target:'0:4',reason:'Refill'}:{action:'final',target:'0:5',reason:'Form complete'})}};}});
 assert.equal(requests.length,2);assert.equal(result.action,'final');assert.match(requests[1].messages.at(-1).content,/failed validation/);assert.ok(requests[1].messages.at(-1).content.includes(repairInstruction));
 let calls=0;await assert.rejects(localJSON(body,{repairInstruction,validate:d=>validVisionAction(d,completed,'fill'),chat:async()=>{calls++;return {message:{content:JSON.stringify({action:'click',target:'0:5',reason:'Submit'})}};}}),/could not produce/);assert.equal(calls,2,'invalid submit clicks are rejected after a bounded model-only retry');
});

test('submit controls labelled Next still require the final action after filling',()=>{
 for(const label of ['Next','Continue','Review'])for(const formAssociated of [true,undefined]){
  const o={controls:[{target:'0:1',label,type:'submit',isField:false,formAssociated}]},choices=visionChoices(o,'fill');
  assert.equal(validVisionAction({action:'click',target:'0:1',reason:'Continue'},o,'fill'),false);
  assert.ok(!choices.some(c=>c.action==='click'));assert.ok(choices.some(c=>c.action==='final'&&c.target==='0:1'));
 }
});

test('default submit type outside a form is a navigation button, not a final control',()=>{
 const o={controls:[{target:'0:1',label:'Next',type:'submit',isField:false,formAssociated:false}]},choices=visionChoices(o,'fill');
 assert.equal(validVisionAction({action:'click',target:'0:1',reason:'Continue'},o,'fill'),true);
 assert.equal(validVisionAction({action:'final',target:'0:1',reason:'Submit'},o,'fill'),false);
 assert.ok(choices.some(c=>c.action==='click'&&c.target==='0:1'));assert.ok(!choices.some(c=>c.action==='final'));
});
