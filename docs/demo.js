import {startBackground} from './background.js';
const $=s=>document.querySelector(s);startBackground($('#field'),$('#mark')).setWorking(true);
const scenes=['listing','editor','form','receipt'];let start=performance.now(),done=new Set();
const show=id=>scenes.forEach(s=>$('#'+s).hidden=s!==id);
const move=(x,y,w=0,h=0)=>{const p=$('#pointer');p.style.left=x+'px';p.style.top=y+'px';const f=$('#focus');f.style.display=w?'block':'none';Object.assign(f.style,{left:x-12+'px',top:y-9+'px',width:w+'px',height:h+'px'});};
const step=(at,title,text)=>{const d=document.createElement('div');d.className='thought';d.innerHTML=`<time>00:${String(at).padStart(2,'0')} · scripted decision</time><p><strong>${title}</strong><br>${text}</p>`;$('#steps').append(d);while($('#steps').children.length>3)$('#steps').firstChild.remove();$('#activity').textContent=title;};
const script=String.raw`\documentclass{article}
\usepackage{xcolor,hyperref}
\pagecolor{black}
\color{white}

% SOURCE: fictional base CV
\name{Alex Jensen}
\profile{
 PhD, computational biology.
 Python data pipelines.
 Neural networks.
}

% Match documented evidence.
% Preserve dates and degrees.
% Never add missing experience.

\section{Selected experience}
Reproducible imaging workflow.
Tests. Evaluation. Documentation.

\projectlink{Spiral Jobs}
\end{document}`;
const actions=[
 [0,()=>{show('listing');step(0,'Read the entire listing','Capture the role, requirements and application instructions.');move(140,250,260,70);}],
 [4,()=>{step(4,'Scroll, then read again','The application instructions are below the first screen.');$('#listing').style.transform='translateY(-235px)';move(250,370,240,40);}],
 [9,()=>{step(9,'Match facts, not keywords','The CV supports Python and research ML. Do not claim cloud deployments.');$('#stage').textContent='Preparing documents';show('editor');move(210,270);}],
 [16,()=>{step(16,'Minimal, grounded changes','Keep the qualifications. Lead with the experience this role needs.');$('#build').textContent='compiling…';}],
 [20,()=>{step(20,'Compile and inspect','The PDF preserves real CV facts and uses the selected template.');$('#pdf').style.opacity='1';$('#pdf').style.transform='none';$('#build').textContent='PDF ready ✓';}],
 [24,()=>{show('form');$('#stage').textContent='Filling application';step(24,'Navigate the application','Identify visible controls, then fill verified profile values.');move(80,162,300,35);}],
 [27,()=>{$('#name').textContent='Alex Jensen';move(80,217,300,35);}],
 [29,()=>{$('#email').textContent='alex.jensen@example.com';move(80,272,300,35);}],
 [31,()=>{$('#city').textContent='Copenhagen, Denmark';step(31,'Attach the right files','Use the generated CV and requested short application, verified by file hash.');move(80,327,300,38);}],
 [34,()=>{$('#cv').textContent='✓  Alex_Jensen_CV.pdf';$('#cv').classList.add('done');move(80,385,300,38);}],
 [36,()=>{$('#letter').textContent='✓  Application.pdf';$('#letter').classList.add('done');step(36,'Check before submission','Required fields complete. Documents match. No previous application to this employer.');}],
 [40,()=>{move(120,449,185,38);$('#stage').textContent='Submitting';step(40,'Submit once','Auto apply was explicitly started. Wait for an employer receipt.');}],
 [44,()=>{show('receipt');move(410,390);$('#stage').textContent='Applied · simulated';step(44,'Record the result','Save the receipt, role, location and navigation recording. Block duplicates.');}]
];
function reset(){start=performance.now();done.clear();$('#steps').replaceChildren();$('#listing').style.transform='none';$('#pdf').style.opacity=0;$('#source').textContent='';for(const id of ['name','email','city'])$('#'+id).textContent='';for(const id of ['cv','letter']){$('#'+id).textContent='Drop a file or browse';$('#'+id).classList.remove('done');}$('#stage').textContent='Reading listing';$('#build').textContent='grounding facts…';}
$('#play').onclick=reset;
function tick(now){const t=Math.min(48,(now-start)/1000);for(const [at,fn]of actions)if(t>=at&&!done.has(at)){done.add(at);fn();}if(t>=9&&t<21)$('#source').textContent=script.slice(0,Math.round((t-9)/11*script.length));$('#clock').textContent='00:'+String(Math.floor(t)).padStart(2,'0')+' / 00:48';$('#bar').style.width=t/48*100+'%';requestAnimationFrame(tick);}requestAnimationFrame(tick);
