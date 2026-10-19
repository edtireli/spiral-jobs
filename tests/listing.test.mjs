import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {browserSession} from '../lib/browser.mjs';
import {readListing} from '../lib/listing.mjs';
import {listingEvidence} from '../lib/model.mjs';

test('scrolls to lazy-loaded bottom content and through inner panes; shows incomplete captures',async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'job-desk-listing-'));
 const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end(`<style>body{margin:0}section{height:800px}</style><h1>Full job listing</h1><section>Top introduction</section><section>Middle requirements</section><section>Further requirements</section><div style="height:220px;overflow:auto"><p>Inner panel top</p><p style="margin-top:600px">Inner panel bottom requirement</p></div><script>onscroll=()=>{if(scrollY>1400&&!document.getElementById('late')){let d=document.createElement('section');d.id='late';d.innerHTML='<h2>Application deadline: 1 December 2026</h2><p>Bottom requirement: microscopy experience.</p>';document.body.append(d);}}</script>`);});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const b=await browserSession({allowTest:true});
 t.after(async()=>{await b.browser.close();await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});});
 await b.page.goto(`http://127.0.0.1:${server.address().port}`);
 const result=await readListing(b.page,{dir});
 assert.equal(result.complete,true);assert.ok(result.sections.length>=5);assert.match(result.text,/Bottom requirement: microscopy/);assert.match(result.text,/Inner panel bottom requirement/);
 assert.ok(result.sections.some(s=>s.top>1400&&s.text.includes('Bottom requirement')));
 for(const s of result.sections)assert.ok((await readFile(path.join(dir,s.image))).length>1000);
 assert.equal(await b.page.evaluate(()=>scrollY),0);
 const partial=await readListing(b.page,{dir,maxSections:2});assert.equal(partial.complete,false);assert.equal(partial.sections.length,2);
});

test('every captured image and the final text chunk are passed to the local model',async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'job-desk-evidence-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const sections=[];for(let i=0;i<7;i++){const image=`listing-${i}.jpg`;await writeFile(path.join(dir,image),'image '+i);sections.push({image,text:'Section '+i});}
 const calls=[],text='A'.repeat(17000)+'Required at bottom: MRI analysis.';
 const result=await listingEvidence({listing:{sections,text},dir,model:'local-fixture',chat:async(body)=>{calls.push(body);return {message:{content:JSON.stringify({summary:'Evidence '+calls.length})}};}});
 assert.equal(result.length,3);assert.equal(calls.flatMap(c=>c.messages[0].images||[]).length,7);
 assert.match(calls.at(-1).messages[0].content,/Required at bottom: MRI analysis/);
});
