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
test('additional facts enter model evidence and survive a replacement CV without duplication',async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'spiral-facts-')),service=new Service(path.resolve(import.meta.dirname,'..'),dir);await service.init();
 t.after(async()=>{service.store.close();await rm(dir,{recursive:true,force:true});});
 await saveProfile(service,{name:'Alex Jordan Jensen',firstName:'Alex Jordan',lastName:'Jensen',email:'alex@example.com',cvText:'MSc in applied mathematics. Built a Python data pipeline.',extraFacts:'Native English.\nAvailable from January.'});
 assert.deepEqual(service.store.settings().profile.facts.filter(f=>f.id.startsWith('extra-')).map(f=>f.text),['Native English.','Available from January.']);
 await saveProfile(service,{cvText:'Updated CV: MSc in applied mathematics. Built and tested a Python data pipeline.'});
 assert.equal(service.store.settings().profile.facts.length,3);
 assert.equal(service.store.settings().profile.firstName,'Alex Jordan');assert.equal(service.store.settings().profile.lastName,'Jensen');
 await saveProfile(service,{extraFacts:''});assert.equal(service.store.settings().profile.facts.length,1);
});

test('Spiral restyles imported content and gives both documents the same credentials and theme',()=>{
 const customCV='\\documentclass{article}\n\\begin{document}\n\\begin{center}Original header\\end{center}\nOriginal research evidence.\n\\end{document}';
 const profile={name:'Fixture Person',credentials:'MSc Physics',documentTheme:'spiral',profile:'Python research.'};
 const {cv,letter}=documentSources({customCV,profile,job:{title:'Engineer',company:'Fixture'},coverLetter:'Hello.'});
 assert.match(cv,/Original research evidence/);assert.ok(!cv.includes('Original header'));
 for(const source of [cv,letter]){assert.match(source,/MSc Physics/);assert.match(source,/\\definecolor\{paper\}\{HTML\}\{000000\}/);assert.doesNotMatch(source,/spiral jobs/i);}
});

test('document labels and saved project footers omit the app brand while preserving factual content and the source link',()=>{
 for(const projectFooterText of [undefined,'Prepared using Spiral Jobs, a local AI application pipeline.','Built and submitted with Spiral Jobs.']){
  for(const customCV of [undefined,'\\documentclass{article}\n\\begin{document}\nOriginal research evidence.\n\\end{document}']){
   const result=documentSources({customCV,profile:{name:'Fixture Person',documentTheme:'spiral',profile:'Original research evidence.',projectFooterText},job:{title:'Engineer',company:'Fixture'},coverLetter:'Hello.',projectLink:'https://github.com/edtireli/spiral-jobs'});
   assert.match(result.cv,/Original research evidence/);
   for(const source of [result.cv,result.letter]){
    assert.doesNotMatch(source,/spiral jobs/i);
    assert.match(source,/\\href\{https:\/\/github.com\/edtireli\/spiral-jobs\}\{Local open-weights AI workflow · built by Edis Tireli · source \\& demo\}/);
    assert.doesNotMatch(source,/Prepared using|Source \\& demo|\\colorbox/);
   }
  }
 }
});

test('generated prose can wrap slash-separated terms without modifying hyperlink targets or original CV content',()=>{
 const profile={name:'Fixture Person',profile:'Research with web/arXiv/PubMed.',facts:[{id:'logging',text:'model-call/token/throughput logging.'}],github:'https://github.com/fixture/repo',documentTheme:'spiral'};
 const input={profile,job:{title:'Engineer',company:'Fixture'},coverLetter:'Research with web/arXiv/PubMed and model-call/token/throughput logging.',projectLink:'https://example.com/r/fixture'};
 const {cv,letter}=documentSources(input);
 for(const source of [cv,letter]){
  assert.ok(source.includes('web/\\allowbreak{}arXiv/\\allowbreak{}PubMed'));
  assert.ok(source.includes('model-call/\\allowbreak{}token/\\allowbreak{}throughput'));
  assert.ok(source.includes('\\href{https://example.com/r/fixture}'));
  assert.ok(source.includes('\\href{https://github.com/fixture/repo}'));
 }
 const original='\\documentclass{article}\n\\begin{document}\nOriginal web/arXiv/PubMed content.\n\\end{document}';
 assert.ok(documentSources({...input,customCV:original}).cv.includes('Original web/arXiv/PubMed content.'));
});
