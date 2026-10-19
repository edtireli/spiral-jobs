import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,stat} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Service} from '../lib/service.mjs';
import {saveProfile} from '../lib/profile.mjs';
import {documentSources} from '../lib/documents.mjs';
test('saving an actual CV invalidates previous drafts and retains zero-valued facts',async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'spiral-profile-')),service=new Service(path.resolve(import.meta.dirname,'..'),dir);await service.init();
 t.after(async()=>{service.store.close();await rm(dir,{recursive:true,force:true});});
 const job=service.add({company:'Fictional Research',title:'Data Engineer',url:'https://example.com/role'}).job;job.draft={summary:'Old profile'};job.revision=1;service.store.save(job);
 const cv='MSc in applied mathematics at Example University.\n\nBuilt a Python data pipeline for a research project.';
 await saveProfile(service,{name:'Alex Jensen',email:'alex@example.com',cvText:cv,consultingYears:0,documentTheme:'spiral'});
 const p=service.store.settings().profile;assert.equal(p.consultingYears,0);assert.equal(p.facts.map(f=>f.text).join('\n\n'),cv);assert.equal(p.firstName,'Alex');assert.equal(service.store.get(job.id).draft,undefined);assert.equal(service.store.get(job.id).revision,2);assert.equal((await stat(dir)).mode&0o777,0o700);
 service.navigators=new Map([['active',{exposed:true,closed:false}]]);await assert.rejects(saveProfile(service,{name:'Changed'}),/Finish the active application/);
});
test('original LaTeX layouts retain their body and can carry the project link',()=>{
 const source='\\documentclass{article}\n\\begin{document}\nOriginal content.\n\\end{document}';
 const {cv}=documentSources({customCV:source,profile:{name:'Alex',profile:'Actual profile'},job:{title:'Data Engineer',company:'Fictional Research'},projectLink:'https://github.com/edtireli/spiral-jobs'});
 assert.ok(cv.includes('Original content.'));assert.ok(cv.includes('\\href{https://github.com/edtireli/spiral-jobs}'));assert.equal((cv.match(/\\end\{document\}/g)||[]).length,1);
});
