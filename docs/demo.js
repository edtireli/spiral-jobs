import {startBackground} from './background.js';
const $=s=>document.querySelector(s);startBackground($('#field'),$('#mark')).setWorking(true);
const duration=72,scenes=['listing','cvview','editor','form','receipt'];let start=performance.now(),done=new Set();
const show=id=>{scenes.forEach(s=>$('#'+s).hidden=s!==id);document.querySelectorAll('#phases span').forEach(s=>s.classList.toggle('active',s.dataset.phase===(id==='cvview'?'cv':id==='receipt'?'form':id)));$('#pointer').style.opacity=['listing','form'].includes(id)?1:0;};
const move=(x,y)=>{const p=$('#pointer');p.style.left=x+'px';p.style.top=y+'px';};
const step=(at,title,text)=>{const d=document.createElement('div');d.className='thought';d.innerHTML=`<time>${Math.floor(at/60)}:${String(at%60).padStart(2,'0')} · scripted</time><p><strong>${title}</strong><br>${text}</p>`;$('#steps').append(d);while($('#steps').children.length>3)$('#steps').firstChild.remove();$('#activity').textContent=title;};
const script=String.raw`% Original CV → selected profile
% Degrees and dates unchanged.

\name{Edis Tireli}
\profile{
 PhD in Neuroscience.
 Theoretical & quantum physics.
 Data, AI and software.
}

\project{p-Brain}
Python MRI pipelines.
CNNs. Modelling. Quality control.

\project{Spiral}
LLM agents. RAG. Evaluation.

% No claim of Azure or GxP.
% Short application from CV facts.

\projectlink{Spiral Jobs}`;
const actions=[
 [0,()=>{show('listing');step(0,'Read the role','Scientific Python, biomedical pipelines and practical AI.');move(350,270);}],
 [5,()=>{step(5,'Read beyond the first screen','Capture requirements, location, deadline and requested documents.');$('#listing').style.transform='translateY(-230px)';move(380,430);}],
 [10,()=>{step(10,'Separate required and preferred','Azure and GxP are preferred. The role welcomes research experience.');$('#listing').style.transform='translateY(-360px)';}],
 [14,()=>{show('cvview');$('#url').textContent='local / original CV';$('#stage').textContent='Checking CV evidence';step(14,'Open the original CV','Read the actual professional background. Keep contact details private in this demo.');}],
 [20,()=>{$('#cv-python').classList.add('selected');step(20,'Scientific data + ML','p-Brain supports Python pipelines, MRI analysis and CNN experience.');}],
 [25,()=>{$('#cv-agents').classList.add('selected');step(25,'Agents + software','Spiral supports LLM agents and retrieval. Tests and packaging support software delivery.');}],
 [30,()=>{$('#match').classList.add('visible');step(30,'A supported match','Relevant research and project experience. Azure and GxP remain unverified.');}],
 [37,()=>{show('editor');$('#url').textContent='local / documents';$('#stage').textContent='Preparing documents';step(37,'Keep changes small','Retain the original facts. Lead with data, AI and scientific software.');}],
 [43,()=>{step(43,'Write the short application','Use documented projects. Express interest without adding qualifications.');$('#build').textContent='compiling…';}],
 [47,()=>{$('#pdf').style.opacity=1;$('#pdf').style.transform='none';$('#build').textContent='PDF ready ✓';step(47,'Inspect the PDFs','CV and short application prepared from the same verified source.');}],
 [52,()=>{show('form');$('#url').textContent='careers.nordsignal.example/apply';$('#stage').textContent='Filling application';step(52,'Open the application','Read the visible fields and use confirmed profile values.');move(100,175);}],
 [55,()=>{$('#name').textContent='Edis Tireli';move(100,232);}],
 [57,()=>{$('#email').textContent='demo@example.com';move(100,290);}],
 [59,()=>{$('#city').textContent='Copenhagen, Denmark';move(110,355);step(59,'Attach the prepared files','Select the CV and application generated for this role.');}],
 [61,()=>{$('#cv').textContent='✓  Edis_Tireli_CV.pdf';$('#cv').classList.add('done');move(110,416);}],
 [63,()=>{$('#letter').textContent='✓  Application.pdf';$('#letter').classList.add('done');step(63,'Check the completed form','Required fields and file hashes match. No previous application to this employer.');}],
 [66,()=>{move(130,484);$('#stage').textContent='Submitting';step(66,'Submit once','Auto apply was started. Wait for confirmation before recording success.');}],
 [69,()=>{show('receipt');$('#stage').textContent='Applied · simulated';step(69,'Save the result','Store role, location, deadline and recording. Block another application.');}]
];
function reset(){start=performance.now();done.clear();$('#steps').replaceChildren();$('#listing').style.transform='none';$('#pdf').style.opacity=0;$('#source').textContent='';$('#match').classList.remove('visible');document.querySelectorAll('.cv-entry').forEach(e=>e.classList.remove('selected'));for(const id of ['name','email','city'])$('#'+id).textContent='';for(const id of ['cv','letter']){$('#'+id).textContent='Choose file';$('#'+id).classList.remove('done');}$('#stage').textContent='Reading listing';$('#build').textContent='preparing…';$('#url').textContent='careers.nordsignal.example/ai-engineer';}
$('#play').onclick=reset;
function tick(now){const t=Math.min(duration,(now-start)/1000);for(const [at,fn]of actions)if(t>=at&&!done.has(at)){done.add(at);fn();}if(t>=37&&t<48)$('#source').textContent=script.slice(0,Math.round((t-37)/9*script.length));$('#clock').textContent=String(Math.floor(t/60)).padStart(2,'0')+':'+String(Math.floor(t%60)).padStart(2,'0')+' / 01:12';$('#bar').style.width=t/duration*100+'%';requestAnimationFrame(tick);}requestAnimationFrame(tick);
