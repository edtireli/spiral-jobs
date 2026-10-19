import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import {mkdtemp,rm} from 'node:fs/promises';
import {Store} from '../lib/store.mjs';
import {collectJobs} from '../lib/collector.mjs';
test('offline collection saves and deduplicates jobs without models, browsers or submissions',async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'job-desk-collect-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const discoverFn=async()=>({jobs:[{title:'AI Engineer',company:'Fixture',url:'https://example.test/job',location:'Copenhagen',score:80}],errors:[]});
 assert.equal((await collectJobs(dir,{discoverFn})).added,1);assert.equal((await collectJobs(dir,{discoverFn})).added,0);
 const store=new Store(dir);assert.equal(store.jobs().length,1);assert.equal(store.applications().length,0);assert.equal(store.jobs()[0].draft,undefined);store.close();
});
