import {startBackground} from './background.js';
const $=s=>document.querySelector(s),field=startBackground($('#field'),$('#mark'));
let started=performance.now(),done=new Set(),typeTimer,codeTimer,activeText="",paused=false,pausedAt=0,run=0,motion=0;
const pace=1.3;let mouse={x:innerWidth*.78,y:innerHeight*.7},toolActivity='';
const show=(id,on=true)=>$(id).hidden=!on;
function activeDelay(ms){const epoch=run;return new Promise(resolve=>{let previous=performance.now(),elapsed=0;function step(now){if(epoch!==run)return resolve(false);if(!paused)elapsed+=now-previous;previous=now;if(elapsed>=ms)return resolve(true);requestAnimationFrame(step);}requestAnimationFrame(step);});}
function point(selector){const el=$(selector),r=el.getBoundingClientRect(),end={x:r.left+r.width*.47,y:r.top+r.height*.55},from={...mouse};const dx=end.x-from.x,dy=end.y-from.y,distance=Math.hypot(dx,dy),bend=Math.min(30,distance*.07),control={x:(from.x+end.x)/2-dy/Math.max(1,distance)*bend,y:(from.y+end.y)/2+dx/Math.max(1,distance)*bend},duration=Math.min(520,180+Math.sqrt(distance)*9),id=++motion,epoch=run;return new Promise(resolve=>{let previous=performance.now(),elapsed=0;function move(now){if(id!==motion||epoch!==run)return resolve(false);if(!paused)elapsed+=now-previous;previous=now;const progress=Math.min(1,elapsed/duration),u=progress*progress*(3-2*progress);mouse={x:(1-u)**2*from.x+2*(1-u)*u*control.x+u*u*end.x,y:(1-u)**2*from.y+2*(1-u)*u*control.y+u*u*end.y};$('#cursor').style.transform=`translate(${mouse.x}px,${mouse.y}px)`;if(progress===1)resolve(true);else requestAnimationFrame(move);}requestAnimationFrame(move);});}
async function click(selector,fn=()=>{}){const epoch=run;if(!await point(selector)||!await activeDelay(90)||epoch!==run)return;const el=$(selector);$('#cursor').classList.add('pressed');el.classList.add('demo-pressed');fn();await activeDelay(110);$('#cursor').classList.remove('pressed');el.classList.remove('demo-pressed');}
function archiveThought(){clearInterval(typeTimer);const text=$('#thought').textContent;if(text){const p=document.createElement('p');p.textContent=text;$('#thoughtHistory').prepend(p);$('#thoughtHistory').scrollTop=0;}activeText='';$('#thought').textContent='';}
function control(active){document.body.dataset.control=active?'ai':'user';$('#controlTitle').textContent=paused?'AI paused':'AI in control';show('#aiControl',active);$('#cursorLabel').textContent=active?'AI':'you';}
function activity(label){toolActivity=label;$('#controlActivity').textContent=label;}
function modelState(label='Model idle',active=false){$('#thinkingTitle').textContent=label;$('#modelSidebar').dataset.active=String(active);$('#controlActivity').textContent=active?(label==='Thinking'?'Thinking…':label):toolActivity;}
function beginAutoApply(){control(true);activity('Reading the role');field.setWorking(true);$('#auto').textContent='AI applying…';think('Read the full role, check the source CV and saved facts, then prepare only the changes this application needs.');}
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
function prepareDocuments(){activity('Preparing documents');show('#employerBrowser',false);show('#generation');$('#surfaceLabel').textContent='Document workspace';$('#surfaceMeta').textContent='generated from your profile';$('#fileActivity').textContent='Source CV + saved facts';$('#codeStatus').textContent='planning…';
 think('Use a compact white layout that matches the source CV. Tailor only the profile; keep education and project facts unchanged. Give the short letter matching typography. Generate editable LaTeX, then compile both PDFs.',generate);
}
function generate(){archiveThought();modelState('Generating LaTeX',true);$('#codeStatus').textContent='generating locally…';$('#codeOutput').classList.add('typing');let i=0;codeTimer=setInterval(()=>{if(paused)return;$('#codeOutput').textContent=latex.slice(0,i+=8);$('#codeOutput').scrollTop=$('#codeOutput').scrollHeight;if(i>=latex.length){clearInterval(codeTimer);$('#codeOutput').classList.remove('typing');$('#codeStatus').textContent='compiling PDFs…';activity('Compiling PDFs');idle();activeDelay(600).then(current=>{if(!current)return;$('#codeOutput').scrollTop=0;$('#codeStatus').textContent='PDFs ready';show('#outputs');show('#letterFile');$('#fileActivity').textContent='✓ CV.tex → CV.pdf\n✓ Application.tex → Application.pdf';activity('Previewing documents');});}},30);}
function employerForm(){activity('Filling the application');show('#generation',false);show('#employerBrowser');show('#listing',false);show('#application');$('#surfaceLabel').textContent='Employer website';$('#surfaceMeta').textContent='external';$('#url').textContent='careers.nordsignal.example/apply';think('Map name, email and city to saved facts; attach the two generated PDFs.');}
$('#interests').onclick=$('#editInterests').onclick=()=>show('#interestLayer');$('#saveInterests').onclick=()=>show('#interestLayer',false);
$('#profile').onclick=$('#sourceFacts').onclick=()=>show('#profileLayer');$('#saveProfile').onclick=()=>show('#profileLayer',false);
$('#cvFile').onclick=$('#sourceFile').onclick=()=>openDocument('source');$('#letterFile').onclick=$('#previewLetter').onclick=()=>openDocument('letter');$('#previewCV').onclick=()=>openDocument('cv');$('#closeDoc').onclick=()=>show('#documentLayer',false);$('#openInbox').onclick=()=>show('#mailLayer');$('#closeMail').onclick=()=>show('#mailLayer',false);
const actions=[
 [.9,()=>click('#editInterests',()=>{show('#interestLayer');})],
 [2.5,()=>click('#saveInterests',()=>{show('#interestLayer',false);$('#preferences').textContent='Copenhagen · Aarhus · AI · data · life sciences';})],
 [3.3,()=>click('#profile',()=>show('#profileLayer'))],
 [5.5,()=>click('#saveProfile',()=>show('#profileLayer',false))],
 [6.3,()=>click('#find',()=>{field.setWorking(true);$('#find').textContent='finding jobs…';})],
 [7.5,()=>{show('#noJobs',false);show('#jobs');show('#toast');$('#toast').textContent='3 new jobs matching your interests';$('#scanInfo').textContent='3 matches · just now';field.setWorking(false);}],
 [8.5,()=>click('#job',()=>{show('#start',false);show('#selected');show('#toast',false);$('#job').classList.add('selected');})],
 [10,()=>click('#auto',beginAutoApply)],
 [12,()=>{point('#listing h4');$('#listing').style.transform='translateY(-205px)';think('Research experience is welcome. Azure and GxP are preferred. A CV and short application are required.');}],
 [13.8,()=>click('#cvFile',()=>{activity('Checking the source CV');openDocument('source');})],
 [14.6,()=>think('p-Brain supports MRI pipelines and CNN experience. Spiral supports agents, retrieval and evaluation. These facts come from the source CV.')],
 [16.6,()=>click('#closeDoc',()=>show('#documentLayer',false))],
 [17.2,()=>{$('#matchStatus').textContent='Matches your experience';$('#jobStatus').textContent='matched';}],
 [17.5,prepareDocuments],
 [23,async()=>{while($('#outputs').hidden){if(!await activeDelay(50))return;}click('#previewCV',()=>openDocument('cv'));}],
 [25.5,()=>click('#closeDoc',()=>show('#documentLayer',false))],
 [26,()=>{activity('Opening the application');show('#generation',false);show('#employerBrowser');$('#surfaceLabel').textContent='Employer website';$('#surfaceMeta').textContent='external';}],
 [26.3,()=>click('#employerApply',employerForm)],
 [27.1,()=>click('#name',()=>{$('#name').textContent='Edis Tireli';})],
 [27.8,()=>click('#email',()=>{$('#email').textContent='demo@example.com';})],
 [28.5,()=>click('#city',()=>{$('#city').textContent='Copenhagen, Denmark';})],
 [29.5,()=>click('#cv',()=>{activity('Attaching documents');$('#cv').textContent='✓ CV.pdf';$('#cv').classList.add('done');})],
 [30.8,()=>click('#letter',()=>{$('#letter').textContent='✓ Application.pdf';$('#letter').classList.add('done');think('Required fields are complete. Both attachments are the generated outputs. No previous application to this employer.');})],
 [32.5,()=>click('#submit',()=>{$('#submit').textContent='Submitting…';activity('Submitting the application');idle();})],
 [34.3,()=>{show('#application',false);show('#verification');think('This employer requires an email code. Check the connected inbox for the matching application message.');}],
 [35.5,()=>click('#openInbox',()=>{show('#mailLayer');activity('Checking verification email');idle();})],
 [36.7,()=>click('#mailSearch',()=>{$('#mailSearch').textContent='Nordsignal Research · verification';})],
 [38.1,()=>click('#mailRow',()=>{show('#mailList',false);show('#mailMessage');})],
 [40,()=>click('#closeMail',()=>show('#mailLayer',false))],
 [40.8,()=>click('#verificationCode',()=>{activity('Verifying the application');$('#verificationCode').textContent='••••••';})],
 [41.8,()=>click('#verify',()=>{$('#verify').textContent='Verifying…';})],
 [43.7,()=>{show('#verification',false);show('#receipt');$('#jobStatus').textContent='applied';$('#applied').textContent='1';$('#auto').textContent='applied ✓';$('#matchStatus').textContent='Receipt saved';idle();field.setWorking(false);control(false);}],
 [46.5,()=>{$('#cursor').style.opacity=0;}]
];
function reset(){run++;motion++;paused=false;activeText="";control(false);activity('');document.body.dataset.paused='false';$('#cursor').classList.remove('pressed');document.querySelectorAll('.demo-pressed').forEach(el=>el.classList.remove('demo-pressed'));$("#pause").textContent="pause";$("#modelSidebar").dataset.paused="false";clearInterval(typeTimer);clearInterval(codeTimer);started=performance.now();done.clear();for(const s of ['#jobs','#selected','#toast','#documentLayer','#interestLayer','#profileLayer','#mailLayer','#mailMessage','#letterFile','#application','#receipt','#verification','#generation','#outputs'])show(s,false);for(const s of ['#start','#noJobs','#listing','#employerBrowser','#mailList'])show(s);$('#find').textContent='find jobs ↗';$('#job').classList.remove('selected');$('#jobStatus').textContent='new match';$('#applied').textContent='0';$('#matchStatus').textContent='Ready to review';$('#auto').textContent='auto apply ↗';$('#scanInfo').textContent='Denmark · data & AI';$('#preferences').textContent='Denmark · data · AI · life sciences';$('#url').textContent='careers.nordsignal.example/ai-engineer';$('#surfaceLabel').textContent='Employer website';$('#surfaceMeta').textContent='external';$('#listing').style.transform='none';$('#thought').textContent='';$('#thoughtHistory').replaceChildren();$('#fileActivity').textContent='';$('#codeOutput').textContent='';$('#codeOutput').classList.remove('typing');$('#codeStatus').textContent='generating locally…';modelState();for(const s of ['#name','#email','#city','#verificationCode'])$(s).textContent='';for(const s of ['#cv','#letter']){$(s).textContent='Choose file';$(s).classList.remove('done');}$('#submit').textContent='Submit application ↗';$('#verify').textContent='Verify application ↗';$('#cursor').style.opacity=1;mouse={x:innerWidth*.78,y:innerHeight*.7};$('#cursor').style.transform=`translate(${mouse.x}px,${mouse.y}px)`;$('#mailSearch').textContent='Search mail';field.setWorking(false);modelState();}
$('#play').onclick=reset;$('#pause').onclick=()=>{if(paused){started+=performance.now()-pausedAt;paused=false;}else{pausedAt=performance.now();paused=true;}$('#pause').textContent=paused?'resume':'pause';$('#modelSidebar').dataset.paused=String(paused);document.body.dataset.paused=String(paused);$('#controlTitle').textContent=paused?'AI paused':'AI in control';};
function frame(now){const t=(now-started)/1000/pace;if(!paused)for(const [at,fn]of actions)if(t>=at&&!done.has(at)){done.add(at);fn();}requestAnimationFrame(frame);}reset();requestAnimationFrame(frame);
