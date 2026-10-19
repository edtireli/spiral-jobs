import { startBackground } from './background.js';
import { applicationAction } from './workflow.js';
import { detailKey } from './view-state.js';
const $=s=>document.querySelector(s), token=$('meta[name="csrf-token"]').content;
const background=startBackground($('#field'),$('#mark'));
let state,selected=null,current=null,filter='all',tab='website',dirty=false,previousBusy=false,initialSelection=false,listingSection=0;
let thinkingOpen=true,followedAutoJob=null;const expandedThoughts=new Set(),thoughtPositions=new Map();
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function api(url,body){const r=await fetch(url,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json','X-Job-Desk-Token':token},body:JSON.stringify(body)});const d=await r.json();if(!r.ok)throw new Error(d.error||'Request failed');return d;}
function notice(msg){$('#notice').textContent=msg;$('#notice').hidden=!msg;}
async function action(url,body={}){try{notice('');const r=await api(url,body);await refresh();return r;}catch(e){notice(e.message);return null;}}
function artifact(name,revision=current?.revision){return `/artifacts/${selected}/${revision?'r'+revision+'/':''}${name}`;}
function recordingsHTML(recordings=[]){return recordings.length?'<details class="recordings"><summary>Replay application · '+recordings.length+'</summary>'+recordings.map(r=>`<p class="small">${esc(new Date(r.startedAt).toLocaleString())} · ${esc(r.status)}</p><video controls preload="none" playsinline src="${esc(r.url)}"></video><p class="small"><a href="${esc(r.url)}" download>Download recording</a> · <a href="${esc(r.url.replace(/-\d+\.webm$/,'.json'))}" download>Model output & actions</a></p>`).join('')+'</details>':'';}
function badge(j){if(j.stage==='skipped')return 'Skipped';if(j.navigation?.exposed&&!['submitted','uncertain','stopped'].includes(j.navigation.status))return {final_review:'Final review',needs_answer:'Answer needed',needs_document:'Letter needed',document_review:'Review letter',human:'Your attention',paused:'Paused'}[j.navigation.status]||'In progress';if(j.blocked)return 'Applied / blocked';return {new:'New',inspected:'Inspected',ready:'Ready',needs_review:'Review again',uncertain:'Check outcome',submitted:'Applied',archived:'Archived',closed:'Closed',skipped:'Skipped'}[j.stage]||j.stage;}
async function refresh(){try{const oldAuto=state?.autonomy?.enabled;state=await api('/api/state');if(oldAuto!==undefined&&oldAuto!==state.autonomy?.enabled&&!dirty)current=null;$('#autoApplyButton').hidden=!state.autonomy?.enabled;$('#autoApplyButton').disabled=!!state.busy||!state.autonomy?.available;$('#autoApplyButton').textContent='auto apply'+(state.autonomy?.available?' · '+state.autonomy.available:'')+' ↗';$('#stopAutoButton').hidden=!state.autonomy?.running;$('#activity').hidden=!state.busy;$('#activity').textContent=state.busy?.label||'';$('#scanButton').disabled=!!state.busy;background.setWorking(!!state.busy||state.runtime?.status==='loading');$('#runtimeStatus').textContent=state.runtime?.status==='loading'?'loading '+(state.runtime.model||'models')+'…':state.runtime?.status==='error'?'models need attention':state.runtime?.status==='ready'?(state.autonomy?.enabled?'local · auto apply ready':'local · models ready'):'local · approval required';$('#runtimeStatus').title=state.runtime?.message||'Models and settings';if($('#gmailStatus'))$('#gmailStatus').textContent=state.gmail?.message||'Not connected';if($('#modelStatus'))$('#modelStatus').textContent=state.runtime?.message||'';$('#readyCount').textContent=state.jobs.filter(j=>j.stage==='ready'&&!j.blocked).length;$('#historyCount').textContent=state.history.length;
 $('#scanInfo').textContent=state.lastScan?`${state.lastScan.total} matches · ${new Date(state.lastScan.at).toLocaleDateString()}${state.lastScan.errors.length?' · check sources':''}`:'Denmark · data & AI';
 renderList();if(filter==='history')renderHistory();
 const autoJob=state.autonomy?.running&&state.autonomy.currentJobId;
 if(autoJob&&autoJob!==followedAutoJob&&!dirty){followedAutoJob=autoJob;filter='all';document.querySelectorAll('[data-filter]').forEach(x=>x.classList.toggle('active',x.dataset.filter==='all'));tab='live';current=null;await select(autoJob,false);}
 if(!state.autonomy?.running)followedAutoJob=null;
 if(selected&&(!current||(previousBusy&&!state.busy)||state.jobs.find(j=>j.id===selected)?.navigation?.sequence!==current?.navigation?.sequence||state.jobs.find(j=>j.id===selected)?.revision!==current?.revision)&&!dirty)await select(selected,false);
 if(!initialSelection){initialSelection=true;const remembered=localStorage.getItem('selectedJob');const first=state.jobs.find(j=>j.id===(state.busy?.jobId||remembered))||state.jobs.filter(j=>j.navigation&&!j.blocked).sort((a,b)=>new Date(b.updatedAt)-new Date(a.updatedAt))[0]||state.jobs.find(j=>j.draft&&!j.blocked);if(first)await select(first.id);}
 previousBusy=!!state.busy;
 }catch(e){notice('Dashboard connection lost. '+e.message);}}
function renderList(){const listPosition=$('#jobList').scrollTop;const q=$('#search').value.toLowerCase();const jobs=state.jobs.filter(j=>(filter!=='ready'||j.stage==='ready')&&(filter==='history'||j.stage!=='archived')&&`${j.company} ${j.title}`.toLowerCase().includes(q));
 $('#jobList').innerHTML=filter==='history'?'<p class="small">Repeat employers are blocked.</p>':jobs.map(j=>`<button class="job-card ${selected===j.id?'selected':''}" data-id="${j.id}"><div class="company"><span>${esc(j.company)}</span><span class="badge ${j.blocked?'blocked':''}">${esc(badge(j))}</span></div><h3>${esc(j.title)}</h3><div class="location">${esc(j.location)}</div></button>`).join('')||'<p class="small">No roles here yet.</p>';
 document.querySelectorAll('.job-card').forEach(b=>b.onclick=()=>select(b.dataset.id));$('#jobList').scrollTop=listPosition;}
async function select(jid,reset=true){
 if(dirty&&!confirm('Discard unsaved draft edits?'))return;
 dirty=false;selected=jid;localStorage.setItem('selectedJob',jid);const previous=current;current=await api('/api/jobs/'+jid);
 if(reset){listingSection=0;tab=current.navigation&&!['stopped','submitted','uncertain'].includes(current.navigation.status)?'live':current.draft?'cv':'website';}
 renderList();
 if(!reset&&previous&&detailKey(previous)===detailKey(current))updateProgress();else renderDetail();
 if(reset)$('#detail').scrollTop=0;
}

function renderHistory(){current=null;selected=null;const signature=JSON.stringify(state.history);if($('#detail').dataset.history===signature&&$('#detail .history-table'))return;$('#detail').dataset.history=signature;$('#detail').innerHTML=`<h2>Applications.</h2><div class="preview-links"><a href="/api/history.csv" download>export CSV ↗</a></div><div class="table-scroll"><table class="history-table"><thead><tr><th>Employer / position</th><th>Job location</th><th>Deadline</th><th>Status</th></tr></thead><tbody>${state.history.map(a=>`<tr><td><strong>${esc(a.company)}</strong><br>${esc(a.position||a.title||'Position not recorded')}<br><span class="small">${a.submittedAt?esc(new Date(a.submittedAt).toLocaleString()):''}</span></td><td>${esc(a.location||'Location not listed')}<br>${esc(a.postcode?'Postcode '+a.postcode:'Postcode not listed')}<br><span class="small">${esc(a.address||'Address not listed')}</span></td><td>${esc(a.deadline||'Not listed')}</td><td>${esc(a.status)}${recordingsHTML(a.recordings)}<details><summary>Details</summary>${esc(a.note)}${a.url?`<p><a href="${esc(a.url)}" target="_blank" rel="noreferrer">Job listing ↗</a></p>`:''}</details></td></tr>`).join('')}</tbody></table></div><button id="addHistory" class="history-button">record application</button>`;$('#addHistory').onclick=()=>$('#past').showModal();}
function jobMetadata(j){const m=j.jobDetails||{};return `<div class="job-metadata">${[m.postcode,m.address,m.deadline?'Deadline: '+m.deadline:null].filter(Boolean).map(v=>`<span>${esc(v)}</span>`).join('')}</div>`;}
function renderDetail(){const j=current,d=j.draft,busy=!!state.busy,next=applicationAction(j,busy,!!state.autonomy?.enabled),position=$('#detail').scrollTop;rememberThoughtPositions();
 $('#detail').innerHTML=`<div class="detail-top"><div><p class="detail-company">${esc(j.company)}</p><h2>${esc(j.title)}</h2><div class="detail-meta">${esc(j.location)}<a href="${esc(j.url)}" target="_blank" rel="noreferrer">listing ↗</a></div></div><span><span class="badge ${j.blocked?'blocked':''}">${esc(badge(j))}</span></span></div>
 ${j.blocked&&!j.navigation?.exposed?`<div class="callout warn">Already applied to ${esc(j.blocked.company)}. Repeat blocked.</div>`:''}
 ${jobMetadata(j)}
 ${j.error?`<div class="callout error">${esc(j.error)}</div>`:''}
 <div class="actions"><button id="applicationAction" class="primary" ${next.disabled||dirty?'disabled':''}>${esc(next.label)} ↗</button>${d?'<button id="reviewDocuments">review documents</button>':''}<details class="more-actions"><summary>more</summary><button id="inspect" ${busy||j.blocked?'disabled':''}>restart browser</button><button id="draft" ${busy||j.blocked||!j.snapshot?.navigation||j.navigation?.status!=='review'?'disabled':''}>refresh documents</button><button id="manualApplied" ${busy||j.blocked?'disabled':''}>mark applied</button><button id="archive" class="quiet" ${busy||j.blocked?'disabled':''}>archive</button></details></div><p class="small workflow-hint">${esc(next.hint)}</p>
 ${d?.fit?`<details class="fit"><summary>fit & requirements</summary><p>${esc(d.fit)}</p>${d.gaps?.length?`<p class="small">Check requirements: ${esc(d.gaps.join(' · '))}</p>`:''}</details>`:''}
 <div class="tabs"><button data-tab="live" ${!j.navigation?'disabled':''}>live</button><button data-tab="website">listing</button><button data-tab="cv" ${!d?'disabled':''}>CV</button><button data-tab="letter" ${!d?'disabled':''}>letter</button><button data-tab="answers" ${!d?'disabled':''}>review</button></div><div id="tabContent"></div>`;
 document.querySelectorAll('[data-tab]').forEach(b=>{b.classList.toggle('active',b.dataset.tab===tab);b.onclick=()=>{if(dirty&&!confirm('Discard unsaved draft edits?'))return;dirty=false;tab=b.dataset.tab;renderDetail();};});
 $('#applicationAction').onclick=performApplicationAction;
 if($('#reviewDocuments'))$('#reviewDocuments').onclick=()=>{tab='cv';renderDetail();};
 $('#inspect').onclick=()=>{tab='live';current=null;action(`/api/jobs/${j.id}/prepare`);};
 $('#draft').onclick=()=>{current=null;action(`/api/jobs/${j.id}/draft`,{});};
 $('#archive').onclick=async()=>{await action(`/api/jobs/${j.id}/archive`);selected=null;current=null;$('#detail').innerHTML='<div class="empty"><h2>Archived.</h2></div>';};
 $('#manualApplied').onclick=async()=>{if(confirm(`Record that you have already submitted an application to ${j.company}? This blocks future applications to the employer.`)){await action('/api/history',{jobId:j.id});await select(j.id,false);}};
 renderTab();$('#detail').scrollTop=position;}
function renderTab(){const j=current,d=j.draft,el=$('#tabContent');
 if(tab==='live'){renderLive(el);return;}else if(tab==='website'){
  if(j.listing?.sections?.length){renderListing(el,j.listing);return;}
  el.innerHTML=j.snapshot?`<a href="${artifact('website.jpg',null)}" target="_blank"><img class="screenshot" src="${artifact('website.jpg',null)}?v=${j.revision}" alt="Captured employer job website"></a><p class="small">${esc(new Date(j.snapshot.capturedAt).toLocaleDateString())} · saved listing</p>${j.snapshot.reason?'<p class="small">Start the application to check the current form.</p>':''}${j.snapshot.links?.length?`<details><summary>Application links found on the page</summary>${j.snapshot.links.map(l=>`<p><a href="${esc(l.url)}" target="_blank" rel="noreferrer">${esc(l.text)}</a> <button class="use-link" data-url="${esc(l.url)}">Inspect this link</button></p>`).join('')}</details>`:''}<details><summary>Job description</summary><div class="source-text">${esc(j.description)}</div></details>`:`<p class="intro"></p><div class="source-text">${esc(j.description)}</div>`;
  document.querySelectorAll('.use-link').forEach(b=>b.onclick=()=>action(`/api/jobs/${j.id}/apply-url`,{url:b.dataset.url}));
 }else if(tab==='cv'){
  el.innerHTML=`<div class="preview-links"><a href="${artifact('CV.pdf')}" target="_blank">Open PDF ↗</a><a href="${artifact('CV.tex')}" download>LaTeX source</a></div><iframe title="Proposed English CV" class="pdf-preview" src="${artifact('CV.pdf')}"></iframe><label>Short profile<textarea id="summary" rows="3">${esc(d.summary)}</textarea></label><p class="small">Original layout. Changes require review.</p><button id="saveSummary">save CV</button>`;
  $('#summary').oninput=()=>dirty=true;$('#saveSummary').onclick=()=>saveEdits({summary:$('#summary').value});
 }else if(tab==='letter'){
  el.innerHTML=`<label class="check"><input id="includeLetter" type="checkbox" ${d.includeLetter?'checked':''}> Include an application letter</label><label>English application<textarea id="coverLetter" rows="9">${esc(d.coverLetter)}</textarea></label><p class="small">${esc(d.letterReason||'Only include a letter when the form requests one.')} A résumé is the CV. Review wording before approving.</p><button id="saveLetter">save letter</button>${d.includeLetter?`<div class="preview-links" style="margin-top:18px"><a href="${artifact('Application.pdf')}" target="_blank">Open application PDF ↗</a></div><iframe title="Proposed application letter" class="pdf-preview" src="${artifact('Application.pdf')}"></iframe>`:''}`;
  $('#coverLetter').oninput=()=>dirty=true;$('#includeLetter').onchange=()=>dirty=true;$('#saveLetter').onclick=()=>saveEdits({coverLetter:$('#coverLetter').value,includeLetter:$('#includeLetter').checked});
 }else{
  const fields=d.snapshot.form?.fields||[];
  el.innerHTML=`${!d.snapshot.navigation?'<p class="small">This is a saved draft. Prepare application opens the current form and reconnects your documents.</p>':''}<p class="small">Answers use your CV and confirmed facts. Unestablished required facts flag the application.</p><div class="form-fields">${fields.map(f=>fieldHTML(f,d.answers[f.key])).join('')}</div>${fields.length?'<button id="saveAnswers">save answers</button>':''}<div class="review-footer"><p>Revision ${j.revision} · ${esc(d.model)}<br>${d.includeLetter?'CV + application PDF':'CV only'} · ${state.autonomy?.enabled?'Sent when you start Auto apply.':'No sending until you approve this exact version.'}</p><button id="approveButton" class="primary" ${!d.snapshot.navigation||!j.navigation||j.navigation.status!=='review'||j.blocked||state.busy?'disabled':''}>approve filling ↗</button></div>${d.pageObservation?`<p class="small">Model’s website observation: ${esc(d.pageObservation)}</p>`:''}<details><summary>Activity</summary>${j.events.map(e=>`<p class="small">${esc(new Date(e.time).toLocaleString())} · ${esc(e.action)}</p>`).join('')}</details>${j.stage==='submitted'||j.stage==='uncertain'?`<a href="${artifact('receipt.jpg',null)}" target="_blank">View submission screenshot</a>`:''}`;
  document.querySelectorAll('[data-field]').forEach(e=>e.oninput=()=>{dirty=true;$('#approveButton').disabled=true;});
  if($('#saveAnswers'))$('#saveAnswers').onclick=()=>{const answers={};document.querySelectorAll('[data-field]').forEach(e=>answers[e.dataset.field]=e.type==='checkbox'?e.checked:e.value);saveEdits({answers});};
  $('#approveButton').textContent=state.autonomy?.enabled?'auto apply ↗':'approve filling ↗';$('#approveButton').onclick=state.autonomy?.enabled?performApplicationAction:openApproval;
 }
}
function renderListing(el,listing){
 const pages=listing.sections;listingSection=Math.min(listingSection,pages.length-1);const section=pages[listingSection];
 el.innerHTML=`<div class="listing-controls"><button id="previousSection" ${listingSection===0?'disabled':''}>←</button><span class="small">section ${listingSection+1} / ${pages.length}</span><button id="nextSection" ${listingSection===pages.length-1?'disabled':''}>→</button><span class="small">${listing.complete?'full listing captured':'reading incomplete · check remaining content'}</span></div><a href="${artifact(section.image,null)}" target="_blank"><img class="screenshot" src="${artifact(section.image,null)}?v=${listing.capturedAt||current.navigation?.sequence}" alt="Job listing section ${listingSection+1} of ${pages.length}"></a><details><summary>Read listing text</summary><div class="source-text">${esc(listing.text||section.text)}</div></details>`;
 $('#previousSection').onclick=()=>{listingSection--;renderListing(el,listing);};$('#nextSection').onclick=()=>{listingSection++;renderListing(el,listing);};
}
function openApproval(){
 if(dirty)return notice('Save your edits before approval.');
 const j=current,d=j.draft;
 if(applicationAction(j,!!state.busy,!!state.autonomy?.enabled).action!=='approve')return notice('Prepare the live application first.');
 $('#approvalSummary').innerHTML=`<p><strong>${esc(j.company)}</strong><br>${esc(j.title)}</p><p class="small">${esc(d.snapshot.url)}</p><p class="small">${Object.values(state.candidate).map(esc).join('<br>')}</p><p>Attachments: <strong>CV${d.includeLetter?' + application letter':''}</strong><br>Reviewed version: ${j.revision}</p>`;
 $('#reviewed').checked=false;$('#confirmSubmit').disabled=true;$('#approve').showModal();
}
function renderLive(el){
 const j=current,n=j.navigation,busy=!!state.busy,automatic=!!n?.automatic||!!state.autonomy?.enabled;
 const reading=n?.message?.match(/Reading listing (\d+)\//),modelImages=reading?j.listing?.sections?.slice((Number(reading[1])-1)*3,Number(reading[1])*3)||[]:[];
 if(!n){el.innerHTML='<p class="intro">Choose Prepare application to start.</p>';return;}
 el.innerHTML=`<div class="live-status"><span class="live-dot"></span><strong id="liveMessage">${esc(n.message||'Browser ready')}</strong></div><p class="small live-url">${esc(n.url||j.url)}</p><div class="live-layout"><div><a href="${artifact('live.jpg',null)}" target="_blank"><img id="liveImage" class="screenshot" src="${artifact('live.jpg',null)}?t=${Date.now()}" alt="Live application browser, updated while it navigates"></a><p class="small">Live · also open in Chrome. ${automatic?'Auto apply fills and submits when started.':n.exposed?'Filling approved. Final send needs approval.':'Awaiting filling approval.'}</p><div id="modelInputs">${modelImages.length?`<p class="small">The model is reading these captures</p><div class="model-images">${modelImages.map(p=>`<a href="${artifact(p.image,null)}" target="_blank"><img src="${artifact(p.image,null)}" alt="Captured listing section being read by the model"></a>`).join('')}</div>`:''}</div></div><div class="agent-sidebar"><div id="agentActivity" class="agent-activity"><p class="small">live activity · ${esc(state.settings.navigationModel)}</p><ol>${(n.activity||[{message:n.message, time:n.updatedAt}]).slice(-8).reverse().map(a=>`<li><time>${esc(new Date(a.time).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'}))}</time><span>${esc(a.message)}</span></li>`).join('')}</ol></div><details id="thinkingPanel" open><summary>Model reasoning</summary><div id="thinkingRuns"></div></details></div></div><div id="recordings">${recordingsHTML(j.recordings)}</div><div id="navigationAction"></div><div class="actions">${['paused','human','final_review'].includes(n.status)?`<button id="resumeNavigation" ${busy?'disabled':''}>${n.status==='human'?'I completed the step — resume':'resume'}</button>`:''}${!['stopped','submitted','uncertain','skipped'].includes(n.status)?'<button id="stopNavigation" class="danger">stop</button>':''}</div>`;
 syncThinking();
 const area=$('#navigationAction');if(automatic){area.innerHTML='<div class="callout">'+esc(n.status==='skipped'?n.message:n.status==='review'&&!state.busy?'Ready. Auto apply completes and submits this application.':state.autonomy?.running?'Automatic application in progress. You can stop the run.':n.message)+'</div>';}
 if(['human','paused'].includes(n.status)&&n.phase==='inspect'&&!n.interactiveEnabled){area.innerHTML='<div class="callout">Sign-in and verification can need network requests. Enable this manual step, complete it in Chrome, then resume.</div><button id="allowInteractive">Allow this manual browser step</button>';$('#allowInteractive').onclick=()=>action(`/api/jobs/${j.id}/allow-interactive`,{confirm:true,sequence:n.sequence});}
 if(n.status==='verification'){area.innerHTML='<div class=callout>'+esc(n.message)+'</div><button id=checkVerification>Check code / result</button><button id=verificationGmail>Connect Gmail</button>';$('#checkVerification').onclick=()=>action(`/api/jobs/${j.id}/check-verification`);$('#verificationGmail').onclick=()=>$('#settingsButton').click();}
 if(n.status==='review'&&!automatic)area.innerHTML=`<div class="callout">${j.draft?'Your application is ready for review. Approve & fill application starts filling and uploads.':'Preparing your documents for review.'}</div>`;
 if(n.status==='needs_answer'&&!automatic){
  area.innerHTML=`<div class="callout">Your answer is needed.</div>${fieldHTML(n.question,'')}<button id="answerNavigation" class="primary" ${busy?'disabled':''}>approve & continue</button>`;
  $('#answerNavigation').onclick=()=>{const input=area.querySelector('[data-field]');action(`/api/jobs/${j.id}/answer-navigation`,{sequence:n.sequence,confirm:true,value:input.type==='checkbox'?input.checked:input.value});};
 }
 if(n.status==='needs_document'&&!automatic){
  area.innerHTML='<div class="callout">The application requires a letter. It will be drafted for review before being uploaded.</div><button id="prepareRequiredLetter" class="primary">Prepare required letter</button>';
  $('#prepareRequiredLetter').onclick=()=>action(`/api/jobs/${j.id}/prepare-letter`);
 }
 if(n.status==='document_review'&&!automatic){
  area.innerHTML=`<div class="callout">Review the new letter in the letter tab before approving its upload.</div><a href="${artifact('Application.pdf')}" target="_blank">Review required application PDF ↗</a><p><button id="approveRequiredLetter" class="primary">Approve this letter & continue</button></p>`;
  $('#approveRequiredLetter').onclick=()=>action(`/api/jobs/${j.id}/approve-letter`,{confirm:true,revision:j.revision,reviewHash:j.draft.reviewHash});
 }
 if(j.trackingToken){const visits=document.createElement('details');visits.innerHTML='<summary>Project link visits</summary><button type=button>Load visits</button><div></div>';visits.querySelector('button').onclick=async()=>{try{const data=await api(`/api/jobs/${j.id}/visits`);visits.querySelector('div').innerHTML='<p class=small>Visits may come from security scanners or shared links.</p>'+(data.visits.length?data.visits.map(v=>`<p class=small>${esc(v.time)} · ${esc(v.ip)} · ${esc(v.classification)}</p>`).join(''):'<p>No visits yet.</p>');}catch(e){notice(e.message);}};el.appendChild(visits);}
 if(n.inferredAnswers?.length){const details=document.createElement('details');details.innerHTML='<summary>Answers inferred from your CV</summary>'+n.inferredAnswers.map(a=>`<p><strong>${esc(a.label)}</strong><br>${esc(a.answer)}<br><span class="small">${esc(a.reason)}</span></p>`).join('');el.appendChild(details);}
 if(n.status==='final_review'&&!automatic){
  area.innerHTML=`<div class="callout">The application is filled. Review the live page and your documents. Final control: <strong>${esc(n.finalReview.label)}</strong>.</div><label class="check"><input id="finalReviewed" type="checkbox"> I have reviewed the filled application and want to submit it to ${esc(j.company)}.</label><button id="sendFinal" class="primary" disabled>Submit application</button>`;
  $('#finalReviewed').onchange=()=>$('#sendFinal').disabled=!$('#finalReviewed').checked||busy;
  $('#sendFinal').onclick=()=>action(`/api/jobs/${j.id}/approve-final`,{confirm:true,key:n.finalReview.key});
 }
 if(['submitted','uncertain'].includes(n.status))area.innerHTML=`<div class="callout ${n.status==='uncertain'?'warn':''}">${esc(n.message)}</div>${jobMetadata(j)}<p class="small">${esc(j.title)} · ${esc(j.company)} · saved to application history</p><a href="/api/history.csv" download>Download application log</a>`;
 if($('#resumeNavigation'))$('#resumeNavigation').onclick=()=>action(`/api/jobs/${j.id}/resume-navigation`);
 if($('#stopNavigation'))$('#stopNavigation').onclick=()=>action(state.autonomy?.running?'/api/autonomy/stop':`/api/jobs/${j.id}/stop-navigation`);
}
function performApplicationAction(){
 const j=current,next=applicationAction(j,!!state.busy,!!state.autonomy?.enabled);if(next.disabled)return;
 if(next.action==='approve')return openApproval();
 if(next.action==='live'){tab='live';renderDetail();$('#navigationAction')?.scrollIntoView({block:'center'});return;}
 tab='live';current=null;action(`/api/jobs/${j.id}/${next.action}`);
}
function updateProgress(){
 const position=$('#detail').scrollTop,next=applicationAction(current,!!state.busy,!!state.autonomy?.enabled),button=$('#applicationAction');
 if(button){button.textContent=next.label+' ↗';button.disabled=!!next.disabled||dirty;}
 if($('.workflow-hint'))$('.workflow-hint').textContent=next.hint;
 if(tab==='live'){
  const n=current.navigation;
  if($('#liveMessage'))$('#liveMessage').textContent=n.message||'Browser ready';
  if($('.live-url'))$('.live-url').textContent=n.url||current.url;
  if($('#agentActivity ol'))$('#agentActivity ol').innerHTML=(n.activity||[]).slice(-8).reverse().map(a=>`<li><time>${esc(new Date(a.time).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'}))}</time><span>${esc(a.message)}</span></li>`).join('');
  const reading=n.message?.match(/Reading listing (\d+)\//),group=reading?Number(reading[1]):null;
  const inputs=$('#modelInputs');
  if(inputs&&group&&inputs.dataset.group!==String(group)){
   inputs.dataset.group=group;inputs.innerHTML='<p class="small">The model is reading these captures</p><div class="model-images">'+(current.listing?.sections?.slice((group-1)*3,group*3)||[]).map(p=>`<a href="${artifact(p.image,null)}" target="_blank"><img src="${artifact(p.image,null)}" alt="Captured listing section being read by the model"></a>`).join('')+'</div>';
  }else if(inputs&&!group&&inputs.querySelector('p'))inputs.querySelector('p').textContent='Captured listing';
  syncThinking();
 }
 $('#detail').scrollTop=position;
}
function rememberThoughtPositions(){
 const panel=$('#thinkingPanel');if(panel)thinkingOpen=panel.open;
 document.querySelectorAll('[data-thought-run]').forEach(el=>{if(el.open)expandedThoughts.add(el.dataset.thoughtRun);else expandedThoughts.delete(el.dataset.thoughtRun);});
 document.querySelectorAll('[data-thought-text]').forEach(el=>{if(el.clientHeight)thoughtPositions.set(el.dataset.thoughtText,{top:el.scrollTop,bottom:el.scrollHeight-el.clientHeight-el.scrollTop<12});});
}
function syncThinking(){
 const panel=$('#thinkingPanel'),container=$('#thinkingRuns');if(!panel||!container)return;
 if(!panel.dataset.bound){panel.open=thinkingOpen;panel.ontoggle=()=>thinkingOpen=panel.open;panel.dataset.bound='yes';}
 const runs=current.reasoning||[];
 panel.querySelector('summary').textContent=`Model reasoning${runs.length?' · '+runs.length+' steps':''}`;
 if(!runs.length){if(!container.children.length)container.innerHTML='<p class="small" id="noThinking">Thinking text will appear here for new model calls. Earlier calls were not recorded.</p>';return;}
 $('#noThinking')?.remove();
 for(const run of runs){
  let el=document.querySelector(`[data-thought-run="${run.id}"]`);
  if(!el){
   el=document.createElement('details');el.dataset.thoughtRun=run.id;el.className='thought-run';el.open=expandedThoughts.has(run.id)||!run.done;
   el.innerHTML='<summary class="run-title"></summary><pre class="thinking-text" data-thought-text="'+run.id+'"></pre><details><summary>Model output</summary><pre class="model-output"></pre></details>';
   el.ontoggle=()=>{if(el.open)expandedThoughts.add(run.id);else expandedThoughts.delete(run.id);};container.prepend(el);
  }
  el.querySelector('.run-title').textContent=`${run.title||'Model call'} · ${run.model||'Local model'} · ${run.error?'error':run.doneReason==='length'?'token limit reached':run.done?'complete':run.phase?.toLowerCase()||'working'}`;
  const pre=el.querySelector('.thinking-text'),text=run.thinking||'This step has not emitted thinking text.';
  const saved=pre.clientHeight?{top:pre.scrollTop,bottom:pre.scrollHeight-pre.clientHeight-pre.scrollTop<12}:thoughtPositions.get(run.id);
  if(pre.textContent!==text){pre.textContent=text;if(saved)pre.scrollTop=saved.bottom?pre.scrollHeight:saved.top;}
  el.querySelector('.model-output').textContent=run.content||run.error||'Waiting for output.';
 }
}
function fieldHTML(f,v){const label=esc(f.label.replace(/\*+$/,'').trim())+(f.required?' *':'');if(f.type==='checkbox')return `<label class="check"><input type="checkbox" data-field="${f.key}" ${v===true?'checked':''}>${label}</label>`;let options;
 if(f.type==='file')options=[{value:'',label:'No attachment'},{value:'@cv',label:'Prepared CV.pdf'},...(current.draft?.includeLetter?[{value:'@letter',label:'Prepared Application.pdf'}]:[])];
 if(f.type==='select-one')options=[{value:'',label:'Choose an answer'},...f.options.filter(x=>x.value)];
 return `<label>${label}${options?`<select data-field="${f.key}">${options.map(o=>`<option value="${esc(o.value)}" ${o.value===v?'selected':''}>${esc(o.label)}</option>`).join('')}</select>`:f.type==='textarea'?`<textarea data-field="${f.key}" rows="3">${esc(v)}</textarea>`:`<input data-field="${f.key}" value="${esc(v)}">`}</label>`;}
async function saveEdits(patch){const d=current.draft;dirty=false;const result=await action(`/api/jobs/${selected}/edit`,{revision:current.revision,summary:d.summary,coverLetter:d.coverLetter,includeLetter:d.includeLetter,answers:d.answers,...patch});if(result)current=null;}
$('#reviewed').onchange=()=>$('#confirmSubmit').disabled=!$('#reviewed').checked;
$('#confirmSubmit').onclick=async()=>{const j=current;tab='live';$('#confirmSubmit').disabled=true;$('#approve').close();await action(`/api/jobs/${j.id}/approve-fill`,{revision:j.revision,reviewHash:j.draft.reviewHash,confirm:true});current=null;};
$('#autoApplyButton').onclick=()=>action('/api/autonomy/run',{});$('#stopAutoButton').onclick=()=>action('/api/autonomy/stop');
$('#scanButton').onclick=()=>action('/api/scan');$('#emptyScan').onclick=()=>action('/api/scan');
$('#search').oninput=renderList;
document.querySelectorAll('[data-filter]').forEach(b=>b.onclick=()=>{if(dirty&&!confirm('Discard unsaved changes?'))return;dirty=false;filter=b.dataset.filter;document.querySelectorAll('[data-filter]').forEach(x=>x.classList.toggle('active',x===b));if(filter==='history')renderHistory();else{selected=null;current=null;$('#detail').innerHTML='<div class="empty"><h2>Select a role to review.</h2></div>';}renderList();});
$('#addButton').onclick=()=>$('#add').showModal();
document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>$('#'+b.dataset.close).close());
$('#addForm').onsubmit=async e=>{e.preventDefault();const body=Object.fromEntries(new FormData(e.target));const r=await action('/api/jobs',body);if(r){$('#add').close();await select(r.job.id);}};
$('#pastForm').onsubmit=async e=>{e.preventDefault();const r=await action('/api/history',Object.fromEntries(new FormData(e.target)));if(r){$('#past').close();e.target.reset();}};
$('#settingsButton').onclick=async()=>{$('#settings').showModal();$('#autoApplyEnabled').checked=!!state.autonomy?.enabled;try{const ms=await api('/api/models');$('#modelSelect').innerHTML=ms.map(m=>`<option value="${esc(m.name)}" ${m.name===state.settings.model?'selected':''}>${esc(m.name)} · ${(m.size/1e9).toFixed(1)} GB</option>`).join('');$('#navigationModel').innerHTML=ms.map(m=>`<option value="${esc(m.name)}" ${m.name===state.settings.navigationModel?'selected':''}>${esc(m.name)} · ${(m.size/1e9).toFixed(1)} GB</option>`).join('');}catch{ $('#navigationModel').innerHTML=`<option>${esc(state.settings.navigationModel)}</option>`;$('#modelSelect').innerHTML=`<option>${esc(state.settings.model)}</option>`;}
 $('#availability').value=state.settings.availability;$('#salary').value=state.settings.salary;$('#sources').value=JSON.stringify(state.settings.sources,null,2);$('#trackingEnabled').checked=!!state.settings.tracking?.enabled;$('#trackingOrigin').value=state.settings.tracking?.origin||'';$('#trackingKey').value='';$('#settings').showModal();if(state.lastScan?.errors?.length)notice(state.lastScan.errors.map(x=>`${x.source}: ${x.error}`).join(' · '));};
$('#settingsForm').onsubmit=async e=>{e.preventDefault();try{const r=await action('/api/settings',{model:$('#modelSelect').value,navigationModel:$('#navigationModel').value,availability:$('#availability').value,salary:$('#salary').value,sources:JSON.parse($('#sources').value)});if(r){await action('/api/autonomy',{enabled:$('#autoApplyEnabled').checked});$('#settings').close();}}catch(e){notice(e.message);}};
$('#runtimeStatus').onclick=()=>$('#settingsButton').click();
$('#loadModels').onclick=()=>action('/api/models/start');
$('#cancelModels').onclick=()=>action('/api/models/cancel');
window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
await refresh();setInterval(refresh,2200);setInterval(()=>{const img=$('#liveImage');if(img&&current?.navigation&&!['stopped'].includes(current.navigation.status))img.src=artifact('live.jpg',null)+'?t='+Date.now();},1400);

$('#connectGmail').onclick=()=>action('/api/gmail/connect',{confirm:true});
$('#checkGmail').onclick=()=>action('/api/gmail/check');
$('#disconnectGmail').onclick=()=>action('/api/gmail/disconnect');

$('#profileButton').onclick=async()=>{const p=await api('/api/profile');for(const key of ['name','email','phone','location','profile','cvText','documentTheme'])$('#p'+key).value=(key==='cvText'?(p.cvText||p.facts?.map(f=>f.text).join('\n\n')):p[key])||'';$('#pprojectFooter').checked=!!p.projectFooter;$('#profileDialog').showModal();};
$('#profileForm').onsubmit=async e=>{e.preventDefault();const body=Object.fromEntries(['name','email','phone','location','profile','cvText','documentTheme'].map(k=>[k,$('#p'+k).value]));body.projectFooter=$('#pprojectFooter').checked;if($('#pcvTemplate').files[0])body.cvTemplate=await $('#pcvTemplate').files[0].text();if(await action('/api/profile',body))$('#profileDialog').close();};
$('#downloadModelButton').onclick=()=>action('/api/models/download',{model:$('#downloadModel').value.trim()});
$('#saveTracking').onclick=()=>action('/api/tracking',{enabled:$('#trackingEnabled').checked,origin:$('#trackingOrigin').value.trim(),key:$('#trackingKey').value.trim()});
