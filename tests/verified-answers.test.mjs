import test from 'node:test';
import assert from 'node:assert/strict';
import {rememberVerifiedAnswer,findVerifiedAnswer} from '../lib/verified-answers.mjs';
import {navigationMethods,draftProfileHash} from '../lib/navigation-service.mjs';
const field={label:'Do you have experience from the pharma/life science industry?*',type:'text'};
const profile={facts:[{id:'phd',text:'PhD in Neuroscience. Research in quantitative MRI.'}],englishProficiency:'Fluent'};
const answer={value:'My life-sciences experience is academic neuroscience research using quantitative MRI.',evidenceIds:['phd'],evidence:[{factId:'phd',quote:'PhD in Neuroscience. Research in quantitative MRI.'}],reason:'Verified against the CV.'};
test('adding a home address preserves the CV assessment, while qualifications and contact identity invalidate it',()=>{
 const changed={...profile,city:'Copenhagen',country:'Denmark',postalCode:'2100',streetAddress:'Fixture Street 1',facts:[...profile.facts,{id:'home-address',text:'Confirmed fixture address.'}]};
 assert.equal(draftProfileHash(profile),draftProfileHash(changed));
 assert.notEqual(draftProfileHash(profile),draftProfileHash({...changed,email:'different@example.test'}));
 assert.notEqual(draftProfileHash(profile),draftProfileHash({...changed,englishProficiency:'Native'}));
 assert.notEqual(draftProfileHash(profile),draftProfileHash({...changed,facts:[...changed.facts,{id:'skill',text:'A new qualification.'}]}));
});
test('a checked answer survives unrelated profile changes but not changed CV evidence',()=>{
 const record=rememberVerifiedAnswer(field,answer,profile);assert.ok(record);
 assert.deepEqual(findVerifiedAnswer(field,{...profile,englishProficiency:'Native',euCitizen:true},[record]),answer);
 assert.equal(findVerifiedAnswer(field,{facts:[{id:'phd',text:'PhD in Physics.'}]},[record]),null);
 assert.equal(findVerifiedAnswer({...field,label:'How many years of pharma consulting experience?'},profile,[record]),null);
 assert.equal(findVerifiedAnswer({...field,type:'select-one',options:[{value:'Yes',label:'Yes'},{value:'No',label:'No'}]},profile,[record]),null);
});
test('missing, fabricated or changed supporting evidence cannot be cached or reused',()=>{
 assert.equal(rememberVerifiedAnswer(field,{...answer,evidence:[]},profile),null);
 assert.equal(rememberVerifiedAnswer(field,{...answer,evidence:[{factId:'phd',quote:'Ten years of pharmaceutical industry employment.'}]},profile),null);
 const record=rememberVerifiedAnswer(field,answer,profile);record.answer.evidence[0].quote='Ten years of pharmaceutical industry employment.';assert.equal(findVerifiedAnswer(field,profile,[record]),null);
});
test('the live navigator reuses checked facts without another model call and logs the source',async()=>{
 const events=[],store={settings:()=>({verifiedAnswers:[rememberVerifiedAnswer(field,answer,profile)]}),event:(...args)=>events.push(args)};
 const n=navigationMethods.createNavigator.call({store},{jobId:'fixture',dir:'/unused',profile});
 assert.deepEqual(await n.infer({field,profile,model:'nonexistent-test-model'}),answer);
 assert.deepEqual(events[0],['fixture','verified_answer_reused',{label:field.label,evidenceIds:['phd']}]);
 assert.equal(await n.infer({field:{label:'EU work permit experience?',type:'text'},profile}),null);
});
