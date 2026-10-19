import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Service} from '../lib/service.mjs';
import {trackedProjectLink} from '../lib/tracking.mjs';

async function fixture(t){
 const dir=await mkdtemp(path.join(os.tmpdir(),'spiral-tracking-state-'));
 const service=new Service(dir,dir);t.after(async()=>{service.store.close();await rm(dir,{recursive:true,force:true});});
 service.store.set('tracking',{enabled:true,origin:'https://203.0.113.9',key:'fixture'});
 service.store.set('profile',{projectFooter:true,profile:'Fixture profile',facts:[],unknowns:[]});
 service.store.set('model','fixture-draft-model');service.store.set('navigationModel','fixture-listing-model');
 const job=service.store.add({url:'https://example.test/job',company:'Fixture Company',title:'Researcher',location:'Denmark',snapshot:{fingerprint:'fixture',text:'Fixture listing',form:{fields:[]}},reasoning:[{id:'old'}],navigation:{status:'review',sequence:1,activity:[]},listing:{text:'Old listing'},notes:'old',temporary:'remove me'}).job;
 service.navigators=new Map([[job.id,{closed:false,abort:new AbortController()}]]);
 const patch=values=>{const latest=service.store.get(job.id);Object.assign(latest,values);delete latest.temporary;service.store.save(latest);return latest;};
 return {service,job,patch};
}

test('tracking creation patches the freshest record and never saves the stale caller',async t=>{
 const {service,job,patch}=await fixture(t);
 patch({reasoning:[{id:'new-listing'}],listing:{text:'Fresh listing'},navigation:{status:'preparing',sequence:9},notes:'fresh'});
 t.mock.method(globalThis,'fetch',async()=>{patch({reasoning:[{id:'new-listing'},{id:'draft'}],navigation:{status:'preparing',sequence:10},notes:'arrived during tracking'});return {ok:true};});
 const link=await trackedProjectLink(service,job),latest=service.store.get(job.id);
 assert.match(link,/^https:\/\/203\.0\.113\.9\/r\/[a-f0-9]{48}$/);
 assert.equal(latest.projectLink,link);assert.equal(job.projectLink,link);
 assert.deepEqual(latest.reasoning,[{id:'new-listing'},{id:'draft'}]);assert.deepEqual(latest.listing,{text:'Fresh listing'});
 assert.equal(latest.navigation.sequence,10);assert.equal(latest.notes,'arrived during tracking');assert.equal(latest.temporary,undefined);
});

test('tracking reuses the current link and preserves a link saved during an awaited request',async t=>{
 const {service,job,patch}=await fixture(t),link='https://203.0.113.9/r/current';
 patch({projectLink:link,trackingToken:'current',notes:'current'});
 const request=t.mock.method(globalThis,'fetch',async()=>{throw Error('Existing link must not trigger a request');});
 job.projectLink='https://203.0.113.9/r/stale';assert.equal(await trackedProjectLink(service,job),link);assert.equal(request.mock.callCount(),0);
 patch({projectLink:null,trackingToken:null});
 request.mock.mockImplementation(async()=>{patch({projectLink:link,trackingToken:'current',notes:'saved during request'});return {ok:true};});
 assert.equal(await trackedProjectLink(service,job),link);assert.equal(service.store.get(job.id).notes,'saved during request');
});

test('a tracking failure preserves progress recorded during the failed request',async t=>{
 const {service,job,patch}=await fixture(t);
 t.mock.method(globalThis,'fetch',async()=>{patch({reasoning:[{id:'fresh'}],notes:'progress before tracking failed'});return {ok:false};});
 await assert.rejects(trackedProjectLink(service,job),/could not create this link/);
 const latest=service.store.get(job.id);assert.deepEqual(latest.reasoning,[{id:'fresh'}]);assert.equal(latest.notes,'progress before tracking failed');assert.equal(latest.projectLink,undefined);
});

for(const fails of [false,true])test(`preparation preserves model and browser updates when rendering ${fails?'fails':'succeeds'}`,async t=>{
 const {service,job,patch}=await fixture(t);
 t.mock.method(globalThis,'fetch',async()=>{patch({notes:'tracking complete',listing:{text:'Latest listing'}});return {ok:true};});
 service.proposeFn=async({onProgress})=>{
  for(const id of ['listing-1','listing-2','listing-3','draft'])onProgress('Finished '+id,{id,model:id==='draft'?'fixture-draft-model':'fixture-listing-model',content:'Fixture '+id,done:true});
  return {evidenceIds:[],coverLetter:'',model:'fixture-draft-model'};
 };
 service.renderDocumentsFn=async({job:renderJob})=>{
  assert.deepEqual(renderJob.reasoning.map(r=>r.id),['old','listing-1','listing-2','listing-3','draft']);
  assert.equal(renderJob.listing.text,'Latest listing');assert.equal(renderJob.notes,'tracking complete');
  service.preparationProgress(job.id,'Rendering complete',{id:'render-progress',model:'fixture',content:'Latest progress',done:true});
  patch({notes:'latest notes',listing:null,jobDetails:{location:'Latest location'},navigation:{...service.store.get(job.id).navigation,status:'paused',latestMarker:'retained'},anotherRuntimeField:{value:'keep'}});
  if(fails)throw Error('Fixture compile overflow');
  return {hashes:{cv:'fixture'}};
 };
 await service.draft(job.id,false);await service.running;
 const latest=service.store.get(job.id);
 assert.deepEqual(latest.reasoning.map(r=>r.id),['old','listing-1','listing-2','listing-3','draft','render-progress']);
 assert.equal(latest.notes,'latest notes');assert.equal(latest.listing,null);assert.equal(latest.temporary,undefined);
 assert.equal(latest.navigation.latestMarker,'retained');assert.equal(latest.navigation.status,'paused');
 assert.deepEqual(latest.jobDetails,{location:'Latest location'});assert.deepEqual(latest.anotherRuntimeField,{value:'keep'});
 assert.ok(latest.projectLink);assert.ok(latest.trackingToken);
 if(fails){assert.equal(latest.error,'Fixture compile overflow');assert.equal(latest.draft,undefined);assert.equal(latest.revision,0);}
 else{assert.equal(latest.error,null);assert.equal(latest.stage,'ready');assert.equal(latest.revision,1);assert.equal(latest.draft.revision,1);}
});
