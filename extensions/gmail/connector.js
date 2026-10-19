let connection=null,busy=false,lastId=null,ownsReader=false,lastResult='Connected · waiting for an application';
const matchesAccount=(title,recipient)=>(String(title).match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)||[]).some(e=>e.toLowerCase()===recipient.toLowerCase());
const status=document.querySelector('#status'),form=document.querySelector('#pair'),disconnect=document.querySelector('#disconnect');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function validate(c){const u=new URL(c.origin);if(u.protocol!=='http:'||u.hostname!=='127.0.0.1'||u.pathname!=='/'||u.username||u.password||u.search||u.hash||!/^\d+$/.test(u.port)||!/^\w{64}$/.test(c.token))throw Error('Use the connection code from your local Spiral Jobs app.');return {origin:u.origin,token:c.token};}
async function request(route,body={}){const r=await fetch(connection.origin+'/api/gmail/bridge/'+route,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+connection.token},body:JSON.stringify(body),signal:AbortSignal.timeout(8000)});if(!r.ok)throw Error('Connection expired. Get a new code from Spiral Jobs.');return r.json();}
async function script(tabId,func,args=[]){const [r]=await chrome.scripting.executeScript({target:{tabId},world:'ISOLATED',func,args});return r.result;}
async function readMail(job){
 const tabs=await chrome.tabs.query({url:'https://mail.google.com/*'});
 const existing=tabs.find(t=>matchesAccount(t.title,job.recipient));
 const base=existing?new URL(existing.url).pathname:'mail/u/0/';
 const url='https://mail.google.com/'+base.replace(/^\//,'').replace(/\/?$/,'/')+'#search/'+encodeURIComponent(job.query);
 const tab=await chrome.tabs.create({url,active:true});
 // This tab belongs to the lookup; the user's existing mailbox tab is untouched.
 try{
  let page;
  for(let i=0;i<45;i++){
   await sleep(700);
   if(Date.now()>job.expiresAt)throw Error('Email lookup expired.');
   const tabState=await chrome.tabs.get(tab.id);
   if(!tabState.url?.startsWith('https://mail.google.com/')){if(tabState.url?.startsWith('https://accounts.google.com/'))throw Error('Sign in to Gmail in regular Chrome, then check again.');continue;}
   try{page=await script(tab.id,(query,recipient)=>{
    // Gmail can canonicalize operator parentheses and whitespace, and a
    // direct search URL can leave its existing input blank. The route must
    // match exactly; a missing input or nonempty mismatch is never accepted.
    const normalize=q=>String(q||'').replace(/\b(to|from):\(([^()\s]+)\)/g,'$1:$2').replace(/\s+/g,' ').trim();
    const routeIsSearch=location.hash.startsWith('#search/');let route=null;
    try{if(routeIsSearch)route=decodeURIComponent(location.hash.slice('#search/'.length).replace(/\+/g,' '));}catch{}
    const input=document.querySelector('input[name=q]'),inputPresent=!!input,inputMatches=inputPresent&&normalize(input.value)===normalize(query),routeMatches=route!==null&&normalize(route)===normalize(query);
    const accountMatches=(document.title.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)||[]).some(email=>email.toLowerCase()===recipient.toLowerCase());
    return {routeIsSearch,inputPresent,inputMatches,routeMatches,accountMatches,queryMatch:routeMatches&&inputPresent&&(inputMatches||normalize(input.value)===''),main:!!document.querySelector('[role=main]'),rows:document.querySelectorAll('[role=main] tr[role=row]').length,empty:/No conversations|No results|No messages matched|Ingen samtaler|Ingen resultater/i.test(document.body.innerText)};
   },[job.query,job.recipient]);}catch{continue;}
   if(page.queryMatch&&(page.main||page.empty)&&page.accountMatches&&(page.rows||page.empty))break;
  }
  if(!page?.queryMatch||!page.accountMatches){
   const search=Object.fromEntries(['routeIsSearch','inputPresent','inputMatches','routeMatches','accountMatches'].map(key=>[key,page?.[key]===true]));
   throw Object.assign(Error('Gmail did not show the requested search in the matching account.'),{diagnostic:{search}});
  }
  if(!page.main&&!page.empty||!page.rows&&!page.empty)throw Error('Gmail search results did not finish loading. Check again.');
  if(page.rows>5)throw Error('Several matching conversations need review.');
  if(!page.rows)return {account:job.recipient,messages:[]};
  const messages=[];
  for(let i=0;i<page.rows;i++){
   if(i){await chrome.tabs.update(tab.id,{url});await sleep(900);}
   const clicked=await script(tab.id,index=>{const row=document.querySelectorAll('[role=main] tr[role=row]')[index];if(!row)return false;row.click();return true;},[i]);
   if(!clicked)throw Error('Gmail results changed. Check again.');
   let found=[];
   for(let wait=0;wait<20;wait++){await sleep(350);found=await script(tab.id,()=>[...document.querySelectorAll('[data-message-id]')].filter(n=>n.querySelector('.a3s')).map(n=>{
    const date=n.querySelector('.g3[title]')?.getAttribute('title')||'';
    const datePrecision=Number.isFinite(Date.parse(date))&&/(?:^|[\s,T])\d{1,2}:\d{2}(?!:|\d)/.test(date)?'minute':'exact';
    return {id:n.getAttribute('data-message-id'),sender:n.querySelector('.gD[email]')?.getAttribute('email'),date,datePrecision,subject:document.querySelector('h2.hP')?.textContent||'',body:[...n.querySelectorAll('.a3s')].map(x=>x.innerText).join('\n').slice(0,20000)};
   }));if(found.length)break;}
   if(!found.length)throw Error('Gmail message content could not be read.');
   messages.push(...found);if(messages.length>10)throw Error('Too many messages to verify automatically.');
  }
  return {account:job.recipient,messages};
 }finally{await chrome.tabs.remove(tab.id).catch(()=>{});}
}
async function poll(){
 if(!ownsReader||!connection||busy)return;busy=true;
 try{const {request:job}=await request('poll');status.textContent=lastResult;
  if(job&&job.id!==lastId){lastId=job.id;status.textContent='Checking the requested application email…';let result;try{result=await readMail(job);}catch(e){result={error:e.message,diagnostic:e.diagnostic};}await request('result',{id:job.id,...result});lastResult=result.error||'Email check complete · waiting for an application';status.textContent=lastResult;}
 }catch(e){status.textContent=e.message;}finally{busy=false;}
}
form.onsubmit=async e=>{e.preventDefault();try{connection=validate(JSON.parse(document.querySelector('#code').value));await chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});await chrome.storage.local.set({connection});document.querySelector('#code').value='';form.hidden=true;disconnect.hidden=false;await poll();}catch(e){status.textContent=e.message;}};
disconnect.onclick=async()=>{connection=null;await chrome.storage.local.remove('connection');form.hidden=false;disconnect.hidden=true;status.textContent='Disconnected';};
async function start(){
 // A tab's age does not show whether its script is alive. Hold one atomic
 // origin-scoped reader lock; only its responsive owner may receive focus.
 const current=await chrome.tabs.getCurrent();
 chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(ownsReader&&sender.id===chrome.runtime.id&&message?.type==='spiral-gmail-reader')respond({tabId:current.id});
 });
 await navigator.locks.request('spiral-gmail-reader',{ifAvailable:true},async lock=>{
  if(!lock){
   for(let attempt=0;attempt<10;attempt++){
    const owner=await chrome.runtime.sendMessage({type:'spiral-gmail-reader'}).catch(()=>null);
    if(Number.isInteger(owner?.tabId)&&owner.tabId!==current?.id){
     const tab=await chrome.tabs.update(owner.tabId,{active:true});
     if(tab.windowId!==undefined)await chrome.windows.update(tab.windowId,{focused:true});
     await chrome.tabs.remove(current.id);return;
    }
    await sleep(100);
   }
   status.textContent='A Gmail companion is already running. Waiting for that tab to respond.';return;
  }
  ownsReader=true;
  const {connection:c}=await chrome.storage.local.get('connection');
  if(c){try{connection=validate(c);form.hidden=true;disconnect.hidden=false;await poll();}catch{}}
  setInterval(poll,2000);
  // The browser releases the lock when this document closes or reloads.
  await new Promise(()=>{});
 });
}
start().catch(()=>{status.textContent='The Gmail companion could not reconnect. Open it again from its Chrome toolbar button.';});
