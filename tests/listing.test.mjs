import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {browserSession} from '../lib/browser.mjs';
import {readListing} from '../lib/listing.mjs';
import {listingEvidence,propose} from '../lib/model.mjs';
import {ollamaURL,setOllamaURL} from '../lib/runtime.mjs';
import {Service} from '../lib/service.mjs';

async function modelFixture(t,info=()=>({capabilities:['vision','thinking']})){
 const previous=ollamaURL,calls=[];
 const server=http.createServer(async(req,res)=>{
  let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);calls.push({url:req.url,...body});
  if(req.url==='/api/show'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(info(body.model)));return;}
  assert.equal(req.url,'/api/chat');
  const result=body.format==='json'?{summary:'Captured listing evidence',requirements:['Python'],applicationInstructions:[]}:{focus:'ai',motivation:'I would like to work with research data.',fit:'Relevant academic work',gaps:[],evidenceIds:['python','invented'],pageObservation:'Application form visible'};
  res.setHeader('Content-Type','application/x-ndjson');res.end(JSON.stringify({done:true,message:{content:JSON.stringify(result)}})+'\n');
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));setOllamaURL(`http://127.0.0.1:${server.address().port}`);
 t.after(async()=>{setOllamaURL(previous);await new Promise(r=>server.close(r));});return calls;
}

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
 await modelFixture(t);
 const dir=await mkdtemp(path.join(os.tmpdir(),'job-desk-evidence-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const sections=[];for(let i=0;i<7;i++){const image=`listing-${i}.jpg`;await writeFile(path.join(dir,image),'image '+i);sections.push({image,text:'Section '+i});}
 const calls=[],text='A'.repeat(17000)+'Required at bottom: MRI analysis.';
 const result=await listingEvidence({listing:{sections,text},dir,model:'local-fixture',chat:async(body)=>{calls.push(body);return {message:{content:JSON.stringify({summary:'Evidence '+calls.length})}};}});
 assert.equal(result.length,3);assert.equal(calls.flatMap(c=>c.messages[0].images||[]).length,7);
 assert.match(calls.at(-1).messages[0].content,/Required at bottom: MRI analysis/);
});

test('listing screenshots use the selected vision reader while CV matching stays on the planner',async t=>{
 const calls=await modelFixture(t),dir=await mkdtemp(path.join(os.tmpdir(),'job-desk-routing-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 await writeFile(path.join(dir,'listing.jpg'),'captured screenshot');
 const options={job:{company:'Fixture',title:'Data Scientist',description:'Academic Python work',listing:{sections:[{image:'listing.jpg',text:'Python required'}],text:'Full listing'}},profile:{facts:[{id:'python',text:'Academic Python research.'}],unknowns:[]},screenshot:path.join(dir,'website.jpg'),model:'planner-27b'};
 for(const navigationModel of ['vision-8b','']){
  calls.length=0;const result=await propose({...options,navigationModel}),chats=calls.filter(c=>c.url==='/api/chat');
  assert.deepEqual(chats.map(c=>c.model),[navigationModel||'planner-27b','planner-27b']);
  assert.equal(chats[0].think,false);assert.equal(chats[0].messages[0].images.length,1);
  assert.equal(chats[1].messages[0].images,undefined);assert.equal(chats[1].think,true);
  assert.match(chats[1].messages[0].content,/Captured listing evidence/);
  assert.deepEqual(result.evidenceIds,['python'],'matching still filters unknown candidate facts');assert.equal(result.model,'planner-27b');
 }
});

test('a nonvision or cloud-backed listing reader is rejected before sending screenshots or facts',async t=>{
 const calls=await modelFixture(t,model=>model==='text-only'?{capabilities:['completion']}:model==='cloud-reader'?{capabilities:['vision'],remote_host:'cloud.example'}:{capabilities:['vision'],remote_model:'remote-vision'});
 for(const model of ['text-only','cloud-reader','remote-reader']){
  await assert.rejects(listingEvidence({listing:{sections:[],text:'Required qualifications'},dir:'/unused',model}),model==='text-only'?/supports vision/:/local listing reader/);
 }
 assert.equal(calls.filter(c=>c.url==='/api/chat').length,0);
});

test('document preparation forwards the separately selected reader without changing the planning model',async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'job-desk-preparation-routing-')),calls=[];
 const service=new Service(dir,dir,{proposeFn:async args=>{calls.push(args);return {evidenceIds:[],coverLetter:'',model:args.model};},renderDocumentsFn:async()=>({hashes:{}})});
 t.after(async()=>{service.store.close();await rm(dir,{recursive:true,force:true});});
 service.store.set('profile',{name:'Fixture Person',facts:[],unknowns:[]});service.store.set('model','planner-27b');service.store.set('navigationModel','vision-8b');service.busy={};
 const job=service.store.add({company:'Fixture',title:'Data Scientist',url:'https://example.test/job',description:''}).job;job.snapshot={fingerprint:'fixture',form:{fields:[]}};service.store.save(job);
 await service.prepareDraft(job.id,false);
 assert.equal(calls.length,1);assert.equal(calls[0].model,'planner-27b');assert.equal(calls[0].navigationModel,'vision-8b');
});
