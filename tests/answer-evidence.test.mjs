import test from 'node:test';
import assert from 'node:assert/strict';
import {checkAnswerEvidence} from '../lib/answer-evidence.mjs';
const profile={facts:[{id:'phd',text:'PhD in Neuroscience. Academic quantitative MRI research.'}],unknowns:['Pharma industry employment']};
const field={label:'Do you have experience from the pharma/life science industry?',type:'text'};
const run=result=>checkAnswerEvidence({field,profile,model:'fixture',answer:'My background is academic neuroscience research.',chat:async()=>({message:{content:JSON.stringify(result)}})});
test('generated answers need a positive evidence check and verbatim CV support',async()=>{
 const checked=await run({supported:true,unsupportedClaims:[],evidence:[{factId:'phd',quote:'Academic quantitative MRI research.'}]});assert.equal(checked.supported,true);
 assert.equal((await run({supported:true,unsupportedClaims:[],evidence:[{factId:'phd',quote:'Three years of pharma consulting'}]})).supported,false);
 assert.equal((await run({supported:true,unsupportedClaims:[],evidence:[]})).supported,false);
});
test('inflated or unsupported industry claims are rejected even with a real academic citation',async()=>{
 assert.equal((await run({supported:false,unsupportedClaims:['Academic research does not establish industry employment.'],evidence:[{factId:'phd',quote:'Academic quantitative MRI research.'}]})).supported,false);
});

test('current unemployment and zero consulting years do not prove no industry experience',async()=>{
 const p={...profile,facts:[...profile.facts,{id:'employment-status',text:'Not currently employed after completing the PhD. No consulting experience.'}]};
 let calls=0;const chat=async()=>{calls++;return {message:{content:JSON.stringify({supported:true,unsupportedClaims:[],evidence:[{factId:'employment-status',quote:p.facts[1].text}]})}};};
 for(const answer of ['No, I do not have pharma/life science industry employment. My life-sciences experience is academic.','I have no industry experience.','I have never worked in the pharma industry.']){
  const result=await checkAnswerEvidence({field,profile:p,model:'fixture',answer,chat});assert.equal(result.supported,false);
 }
 assert.equal(calls,0,'Unsupported negative claims are rejected even if the model would approve them.');
});

test('supported transferable experience need not quote the CV verbatim',async()=>{
 const p={facts:[{id:'pbrain',text:'Built a Python pipeline for MRI analysis with CNN classification and segmentation.'}],unknowns:[]};
 const answer='I have experience building biomedical data-analysis software.';
 const result=await checkAnswerEvidence({field:{label:'Describe your relevant experience',type:'text'},answer,profile:p,model:'fixture',chat:async body=>{
  assert.match(body.messages[0].content,/Reasonable, evidence-backed extrapolation is allowed/);
  return {message:{content:JSON.stringify({supported:true,unsupportedClaims:[],evidence:[{factId:'pbrain',quote:p.facts[0].text}]})}};
 }});assert.equal(result.supported,true);
});

test('workflow placeholders fail before any model evidence check',async()=>{
 for(const answer of ['human missing information','needs_answer','Location: human review required','[insert your location]']){
  const result=await checkAnswerEvidence({field,profile,answer,model:'fixture',chat:async()=>{throw new Error('Must not call the model');}});assert.equal(result.supported,false);
 }
});
