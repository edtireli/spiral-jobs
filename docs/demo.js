import {startBackground} from './background.js';
const $=s=>document.querySelector(s),field=startBackground($('#field'),$('#mark'));
let started=performance.now(),done=new Set(),typeTimer,codeTimer,activeText="",paused=false,pausedAt=0,run=0,motion=0;
const pace=1.3;let mouse={x:innerWidth*.78,y:innerHeight*.7};
const show=(id,on=true)=>$(id).hidden=!on;
function activeDelay(ms){const epoch=run;return new Promise(resolve=>{let previous=performance.now(),elapsed=0;function step(now){if(epoch!==run)return resolve(false);if(!paused)elapsed+=now-previous;previous=now;if(elapsed>=ms)return resolve(true);requestAnimationFrame(step);}requestAnimationFrame(step);});}
function point(selector){const el=$(selector),r=el.getBoundingClientRect(),end={x:r.left+r.width*.47,y:r.top+r.height*.55},from={...mouse};const dx=end.x-from.x,dy=end.y-from.y,distance=Math.hypot(dx,dy),bend=Math.min(30,distance*.07),control={x:(from.x+end.x)/2-dy/Math.max(1,distance)*bend,y:(from.y+end.y)/2+dx/Math.max(1,distance)*bend},duration=Math.min(520,180+Math.sqrt(distance)*9),id=++motion,epoch=run;return new Promise(resolve=>{let previous=performance.now(),elapsed=0;function move(now){if(id!==motion||epoch!==run)return resolve(false);if(!paused)elapsed+=now-previous;previous=now;const progress=Math.min(1,elapsed/duration),u=progress*progress*(3-2*progress);mouse={x:(1-u)**2*from.x+2*(1-u)*u*control.x+u*u*end.x,y:(1-u)**2*from.y+2*(1-u)*u*control.y+u*u*end.y};$('#cursor').style.transform=`translate(${mouse.x}px,${mouse.y}px)`;if(progress===1)resolve(true);else requestAnimationFrame(move);}requestAnimationFrame(move);});}
async function click(selector,fn=()=>{}){const epoch=run;if(!await point(selector)||!await activeDelay(90)||epoch!==run)return;const el=$(selector);$('#cursor').classList.add('pressed');el.classList.add('demo-pressed');fn();await activeDelay(110);$('#cursor').classList.remove('pressed');el.classList.remove('demo-pressed');}
function archiveThought(){clearInterval(typeTimer);const text=$('#thought').textContent;if(text){const p=document.createElement('p');p.textContent=text;$('#thoughtHistory').prepend(p);$('#thoughtHistory').scrollTop=0;}activeText='';$('#thought').textContent='';}
function modelState(label='Model idle',active=false){$('#thinkingTitle').textContent=label;$('#modelSidebar').dataset.active=String(active);}
function idle(){archiveThought();modelState();}
function think(text,onComplete){archiveThought();activeText=text;modelState('Thinking',true);let i=0;typeTimer=setInterval(()=>{if(paused)return;$('#thought').textContent=text.slice(0,i+=2);if(i>=text.length){clearInterval(typeTimer);if(onComplete)onComplete();else idle();}},28);}
function openDocument(kind){show('#documentLayer');show('#cvPaper',kind!=='letter');show('#letterPaper',kind==='letter');$('#documentTitle').textContent=kind==='source'?'Source · Edis_Tireli_CV.pdf':kind==='cv'?'Generated · CV.pdf':'Generated · Application.pdf';$('#paperProfile').textContent=kind==='source'?'Experience in Python, biomedical data analysis, application development and AI.':'PhD in Neuroscience with experience in biomedical Python pipelines, neural networks and practical AI applications.';$('#cvCaption').textContent=kind==='source'?'Source document · professional CV excerpt · contacts omitted':'Generated output · profile tailored from the saved CV · qualifications preserved';}
const latex=String.raw`\documentclass[11pt]{article}
\usepackage{fontspec,geometry}
\setmainfont{Latin Modern Sans}
\geometry{margin=22mm}
\begin{document}
{\LARGE Edis Tireli}

\section*{Profile}
PhD in Neuroscience with experience in biomedical Python
pipelines, neural networks and practical AI applications.

\section*{Selected projects}
\textbf{p-Brain} — MRI pipelines, CNNs and quality control.
\textbf{Spiral} — LLM agents, retrieval and evaluation.

\section*{Education}
PhD in Neuroscience · MSc and BSc in Physics
\end{document}`;
function prepareDocuments(){show('#employerBrowser',false);show('#generation');$('#surfaceLabel').textContent='Document workspace';$('#surfaceMeta').textContent='generated from your profile';$('#fileActivity').textContent='Source CV + saved facts';$('#codeStatus').textContent='planning…';
 think('Use a compact white layout that matches the source CV. Tailor only the profile; keep education and project facts unchanged. Give the short letter matching typography. Generate editable LaTeX, then compile both PDFs.',generate);
}
function generate(){archiveThought();modelState('Generating LaTeX',true);$('#codeStatus').textContent='generating locally…';$('#codeOutput').classList.add('typing');let i=0;codeTimer=setInterval(()=>{if(paused)return;$('#codeOutput').textContent=latex.slice(0,i+=8);$('#codeOutput').scrollTop=$('#codeOutput').scrollHeight;if(i>=latex.length){clearInterval(codeTimer);$('#codeOutput').classList.remove('typing');$('#codeStatus').textContent='compiling PDFs…';idle();activeDelay(600).then(current=>{if(!current)return;$('#codeOutput').scrollTop=0;$('#codeStatus').textContent='PDFs ready';show('#outputs');show('#letterFile');$('#fileActivity').textContent='✓ CV.tex → CV.pdf\n✓ Application.tex → Application.pdf';});}},30);}
function employerForm(){show('#generation',false);show('#employerBrowser');show('#listing',false);show('#application');$('#surfaceLabel').textContent='Employer website';$('#surfaceMeta').textContent='external';$('#url').textContent='careers.nordsignal.example/apply';$('#auto').textContent='applying…';think('Map name, email and city to saved facts; attach the two generated PDFs.');}
$('#interests').onclick=$('#editInterests').onclick=()=>show('#interestLayer');$('#saveInterests').onclick=()=>show('#interestLayer',false);
$('#profile').onclick=$('#sourceFacts').onclick=()=>show('#profileLayer');$('#saveProfile').onclick=()=>show('#profileLayer',false);
$('#cvFile').onclick=$('#sourceFile').onclick=()=>openDocument('source');$('#letterFile').onclick=$('#previewLetter').onclick=()=>openDocument('letter');$('#previewCV').onclick=()=>openDocument('cv');$('#closeDoc').onclick=()=>show('#documentLayer',false);$('#openInbox').onclick=()=>show('#mailLayer');$('#closeMail').onclick=()=>show('#mailLayer',false);
const actions=[
 [.9,()=>click('#editInterests',()=>{show('#interestLayer');})],
 [2.5,()=>click('#saveInterests',()=>{show('#interestLayer',false);$('#preferences').textContent='Copenhagen · Aarhus · AI · data · life sciences';})],
 [3.3,()=>click('#find',()=>{field.setWorking(true);$('#find').textContent='finding jobs…';})],
 [4.5,()=>{show('#noJobs',false);show('#jobs');show('#toast');$('#toast').textContent='3 new jobs matching your interests';$('#scanInfo').textContent='3 matches · just now';}],
 [5.5,()=>click('#job',()=>{show('#start',false);show('#selected');show('#toast',false);$('#job').classList.add('selected');think('Scientific Python and applied AI. Read the full requirements, then compare them with the saved CV.');})],
 [7.5,()=>{point('#listing h4');$('#listing').style.transform='translateY(-205px)';think('Research experience is welcome. Azure and GxP are preferred. A CV and short application are required.');}],
 [9.2,()=>click('#cvFile',()=>openDocument('source'))],
 [10,()=>think('p-Brain supports MRI pipelines and CNN experience. Spiral supports agents, retrieval and evaluation. These facts come from the source CV.')],
 [11.8,()=>click('#closeDoc',()=>show('#documentLayer',false))],
 [12.2,()=>click('#profile',()=>{show('#profileLayer');idle();})],
 [14,()=>click('#saveProfile',()=>show('#profileLayer',false))],
 [14.5,()=>{$('#matchStatus').textContent='Matches your experience';$('#jobStatus').textContent='matched';}],
 [15.3,()=>click('#auto',()=>{$('#auto').textContent='preparing…';prepareDocuments();})],
 [20.6,async()=>{while($('#outputs').hidden){if(!await activeDelay(50))return;}click('#previewCV',()=>openDocument('cv'));}],
 [23,()=>click('#closeDoc',()=>show('#documentLayer',false))],
 [23.5,()=>{show('#generation',false);show('#employerBrowser');$('#surfaceLabel').textContent='Employer website';$('#surfaceMeta').textContent='external';}],
 [23.8,()=>click('#employerApply',employerForm)],
 [24.6,()=>click('#name',()=>{$('#name').textContent='Edis Tireli';})],
 [25.3,()=>click('#email',()=>{$('#email').textContent='demo@example.com';})],
 [26,()=>click('#city',()=>{$('#city').textContent='Copenhagen, Denmark';})],
 [27,()=>click('#cv',()=>{$('#cv').textContent='✓ CV.pdf';$('#cv').classList.add('done');})],
 [28.3,()=>click('#letter',()=>{$('#letter').textContent='✓ Application.pdf';$('#letter').classList.add('done');think('Required fields are complete. Both attachments are the generated outputs. No previous application to this employer.');})],
 [30,()=>click('#submit',()=>{$('#submit').textContent='Submitting…';idle();})],
 [31.8,()=>{show('#application',false);show('#verification');think('This employer requires an email code. Check the connected inbox for the matching application message.');}],
 [33,()=>click('#openInbox',()=>{show('#mailLayer');idle();})],
 [34.2,()=>click('#mailSearch',()=>{$('#mailSearch').textContent='Nordsignal Research · verification';})],
 [35.6,()=>click('#mailRow',()=>{show('#mailList',false);show('#mailMessage');})],
 [37.5,()=>click('#closeMail',()=>show('#mailLayer',false))],
 [38.3,()=>click('#verificationCode',()=>{$('#verificationCode').textContent='••••••';})],
 [39.3,()=>click('#verify',()=>{$('#verify').textContent='Verifying…';})],
 [41.2,()=>{show('#verification',false);show('#receipt');$('#jobStatus').textContent='applied';$('#applied').textContent='1';$('#auto').textContent='applied ✓';$('#matchStatus').textContent='Receipt saved';idle();field.setWorking(false);point('#job');}],
 [44,()=>{$('#cursor').style.opacity=0;}]
];
function reset(){run++;motion++;paused=false;activeText="";$("#pause").textContent="pause";$("#modelSidebar").dataset.paused="false";clearInterval(typeTimer);clearInterval(codeTimer);started=performance.now();done.clear();for(const s of ['#jobs','#selected','#toast','#documentLayer','#interestLayer','#profileLayer','#mailLayer','#mailMessage','#letterFile','#application','#receipt','#verification','#generation','#outputs'])show(s,false);for(const s of ['#start','#noJobs','#listing','#employerBrowser','#mailList'])show(s);$('#find').textContent='find jobs ↗';$('#job').classList.remove('selected');$('#jobStatus').textContent='new match';$('#applied').textContent='0';$('#matchStatus').textContent='Checking the role';$('#auto').textContent='auto apply ↗';$('#scanInfo').textContent='Denmark · data & AI';$('#preferences').textContent='Denmark · data · AI · life sciences';$('#url').textContent='careers.nordsignal.example/ai-engineer';$('#surfaceLabel').textContent='Employer website';$('#surfaceMeta').textContent='external';$('#listing').style.transform='none';$('#thought').textContent='';$('#thoughtHistory').replaceChildren();$('#fileActivity').textContent='';$('#codeOutput').textContent='';$('#codeStatus').textContent='generating locally…';modelState();for(const s of ['#name','#email','#city','#verificationCode'])$(s).textContent='';for(const s of ['#cv','#letter']){$(s).textContent='Choose file';$(s).classList.remove('done');}$('#submit').textContent='Submit application ↗';$('#verify').textContent='Verify application ↗';$('#cursor').style.opacity=1;mouse={x:innerWidth*.78,y:innerHeight*.7};$('#cursor').style.transform=`translate(${mouse.x}px,${mouse.y}px)`;$('#mailSearch').textContent='Search mail';field.setWorking(false);modelState();}
$('#play').onclick=reset;$('#pause').onclick=()=>{if(paused){started+=performance.now()-pausedAt;paused=false;}else{pausedAt=performance.now();paused=true;}$('#pause').textContent=paused?'resume':'pause';$('#modelSidebar').dataset.paused=String(paused);};
function frame(now){const t=(now-started)/1000/pace;if(!paused)for(const [at,fn]of actions)if(t>=at&&!done.has(at)){done.add(at);fn();}requestAnimationFrame(frame);}reset();requestAnimationFrame(frame);
