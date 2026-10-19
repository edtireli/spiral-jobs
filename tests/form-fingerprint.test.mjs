import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizedFormField,normalizedFormFingerprint,normalizedControlFingerprint} from '../lib/form-fingerprint.mjs';

const snapshot={url:'https://jobs.lever.co/fixture/job/apply',expired:false,form:{fields:[
 {key:'work-permission',target:'0:16',index:16,kind:'radio',type:'select-one',name:'work-permission',label:'Valid EU work permission?',required:true,formAssociated:true,options:[{value:'yes',label:'Yes',index:16},{value:'no',label:'No',index:17}]},
 {key:'english',target:'0:19',index:19,kind:'radio',type:'select-one',name:'english',label:'English proficiency',required:true,formAssociated:true,options:[{value:'native',label:'Native',index:19},{value:'fluent',label:'Fluent',index:20},{value:'intermediate',label:'Intermediate',index:21},{value:'basic',label:'Basic',index:22}]}
]}};

test('unrelated DOM insertion changes positions without invalidating reviewed form semantics',()=>{
 const shifted=structuredClone(snapshot);
 for(const field of shifted.form.fields){field.index+=2;field.target='0:'+field.index;for(const option of field.options)option.index+=2;}
 assert.equal(normalizedFormFingerprint(shifted),normalizedFormFingerprint(snapshot));
 assert.deepEqual(normalizedFormField(shifted.form.fields[0]),normalizedFormField(snapshot.form.fields[0]));
 assert.equal(snapshot.form.fields[0].options[0].index,16,'normalization must not mutate locator indices');
 assert.equal(shifted.form.fields[0].options[0].index,18);
});

test('choice values, labels, order and membership remain part of exact approval',()=>{
 for(const change of [
  f=>f.options[0].value='not-yes',
  f=>f.options[0].label='No',
  f=>f.options.reverse(),
  f=>f.options.pop(),
  f=>f.options.push({value:'unknown',label:'Unknown',index:99})
 ]){
  const changed=structuredClone(snapshot);change(changed.form.fields[0]);
  assert.notEqual(normalizedFormFingerprint(changed),normalizedFormFingerprint(snapshot));
 }
});

test('field identity, requirements, constraints and form association cannot be normalized away',()=>{
 for(const change of [
  f=>f.key='different-question',
  f=>f.label='Do you need EU work sponsorship?',
  f=>f.name='sponsorship',
  f=>f.required=false,
  f=>f.type='text',
  f=>f.formAssociated=false,
  f=>f.maxLength=1,
  f=>f.accept='.exe',
  f=>f.href='https://different.example/submit'
 ]){
  const changed=structuredClone(snapshot);change(changed.form.fields[0]);
  assert.notEqual(normalizedFormFingerprint(changed),normalizedFormFingerprint(snapshot));
 }
});

test('destination, closed listing, field order and field membership still invalidate approval',()=>{
 for(const change of [
  s=>s.url='https://jobs.lever.co/another/job/apply',
  s=>s.expired=true,
  s=>s.form.fields.reverse(),
  s=>s.form.fields.pop(),
  s=>s.form.fields.push({key:'new-consent',type:'checkbox',label:'Consent',required:true})
 ]){
  const changed=structuredClone(snapshot);change(changed);
  assert.notEqual(normalizedFormFingerprint(changed),normalizedFormFingerprint(snapshot));
 }
});

test('normalization does not require every field to have options or an element position',()=>{
 const field={key:'city',name:'city',label:'Current city',type:'text',required:true};
 assert.deepEqual(normalizedFormField(field),field);
 assert.equal(normalizedFormFingerprint({url:snapshot.url,expired:false,form:{fields:[field]}}),normalizedFormFingerprint({url:snapshot.url,expired:false,form:{fields:[{...field,index:50,target:'0:50'}]}}));
});

test('final review tolerates reindexing and scrolling while binding the actual filled controls',()=>{
 const controls=[
  {...structuredClone(snapshot.form.fields[0]),value:'yes',invalid:false,inViewport:false},
  {key:'cv',name:'resume',label:'Resume',type:'file',value:'CV.pdf',files:['CV.pdf'],required:true,formAssociated:true,index:30,target:'0:30',inViewport:false},
  {key:'consent',label:'Consent',type:'checkbox',value:true,checked:true,required:true,formAssociated:true,index:31,target:'0:31',inViewport:false},
  {key:'submit',label:'Submit application',type:'submit',formAssociated:true,index:32,target:'0:32',inViewport:false}
 ];
 const moved=structuredClone(controls);
 for(const control of moved){control.index+=2;control.target='0:'+control.index;control.inViewport=true;for(const option of control.options||[])option.index+=2;}
 assert.equal(normalizedControlFingerprint(moved),normalizedControlFingerprint(controls));
 for(const change of [
  c=>c[0].value='no',
  c=>c[0].invalid=true,
  c=>c[0].validationMessage='The answer is invalid',
  c=>c[0].options[0].label='No',
  c=>c[1].value='Changed CV.pdf',
  c=>c[1].files=['Changed CV.pdf'],
  c=>c[2].checked=false,
  c=>c[2].value=false,
  c=>c[3].label='Send to another employer',
  c=>c[3].formAssociated=false,
  c=>c[3].required=true
 ]){
  const changed=structuredClone(controls);change(changed);
  assert.notEqual(normalizedControlFingerprint(changed),normalizedControlFingerprint(controls));
 }
 assert.equal(controls[0].inViewport,false,'normalization must not mutate observations');
});
