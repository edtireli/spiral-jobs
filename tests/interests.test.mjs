import test from 'node:test';
import assert from 'node:assert/strict';
import {preferenceRank,validateInterests} from '../lib/interests.mjs';
import {discover} from '../lib/sources.mjs';
test('interests select roles, cities and excluded titles without loose AI substring matches',()=>{
 const p=validateInterests({roles:['AI'],locations:['Copenhagen'],exclude:['director']});
 assert.ok(preferenceRank({title:'Machine Learning Engineer',location:'København',description:''},p).score>=50);
 assert.equal(preferenceRank({title:'Chair designer',location:'Copenhagen'},p).score,0);
 assert.equal(preferenceRank({title:'AI director',location:'Copenhagen'},p).score,0);
 assert.equal(preferenceRank({title:'AI Engineer',location:'Aarhus'},p).score,0);
 assert.throws(()=>validateInterests({roles:[],locations:['Denmark']}));
});
test('job discovery applies saved interests to actual board rows',async t=>{
 t.mock.method(globalThis,'fetch',async()=>Response.json({jobs:[{id:'a',title:'Clinical Researcher',location:{name:'Aarhus'},content:'Biomedical work',absolute_url:'https://example.com/a'},{id:'b',title:'AI Engineer',location:{name:'Copenhagen'},content:'Software work',absolute_url:'https://example.com/b'}]}));
 const result=await discover([{kind:'greenhouse',slug:'fixture',company:'Fixture'}],()=>{},{roles:['clinical'],locations:['Aarhus'],exclude:[]});
 assert.deepEqual(result.jobs.map(j=>j.title),['Clinical Researcher']);assert.deepEqual(result.errors,[]);
});
