let connection=null,busy=false,lastId=null,lastResult='Connected · waiting for an application';
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
   try{page=await script(tab.id,query=>({queryMatch:document.querySelector('input[name=q]')?.value===query&&decodeURIComponent(location.hash.slice('#search/'.length))===query&&/search results|søgeresultater/i.test(document.title),title:document.title,main:!!document.querySelector('[role=main]'),rows:document.querySelectorAll('[role=main] tr[role=row]').length,empty:/No conversations|No results|Ingen samtaler|Ingen resultater/i.test(document.body.innerText)}),[job.query]);}catch{continue;}
   if(page.queryMatch&&page.main&&matchesAccount(page.title,job.recipient)&&(page.rows||page.empty))break;
  }
  if(!page?.queryMatch||!page?.main||!matchesAccount(page.title,job.recipient))throw Error('Sign in to the matching Gmail account in regular Chrome.');
  if(page.rows>5)throw Error('Several matching conversations need review.');
  if(!page.rows)return {account:job.recipient,messages:[]};
  const messages=[];
  for(let i=0;i<page.rows;i++){
   if(i){await chrome.tabs.update(tab.id,{url});await sleep(900);}
   const clicked=await script(tab.id,index=>{const row=document.querySelectorAll('[role=main] tr[role=row]')[index];if(!row)return false;row.click();return true;},[i]);
   if(!clicked)throw Error('Gmail results changed. Check again.');
   let found=[];
   for(let wait=0;wait<20;wait++){await sleep(350);found=await script(tab.id,()=>[...document.querySelectorAll('[data-message-id]')].filter(n=>n.querySelector('.a3s')).map(n=>({id:n.getAttribute('data-message-id'),sender:n.querySelector('.gD[email]')?.getAttribute('email'),date:n.querySelector('.g3[title]')?.getAttribute('title'),subject:document.querySelector('h2.hP')?.textContent||'',body:[...n.querySelectorAll('.a3s')].map(x=>x.innerText).join('\n').slice(0,20000)})));if(found.length)break;}
   if(!found.length)throw Error('Gmail message content could not be read.');
   messages.push(...found);if(messages.length>10)throw Error('Too many messages to verify automatically.');
  }
  return {account:job.recipient,messages};
 }finally{await chrome.tabs.remove(tab.id).catch(()=>{});}
}
async function poll(){
 if(!connection||busy)return;busy=true;
 try{const {request:job}=await request('poll');status.textContent=lastResult;
  if(job&&job.id!==lastId){lastId=job.id;status.textContent='Checking the requested application email…';let result;try{result=await readMail(job);}catch(e){result={error:e.message};}await request('result',{id:job.id,...result});lastResult=result.error||'Email check complete · waiting for an application';status.textContent=lastResult;}
 }catch(e){status.textContent=e.message;}finally{busy=false;}
}
form.onsubmit=async e=>{e.preventDefault();try{connection=validate(JSON.parse(document.querySelector('#code').value));await chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});await chrome.storage.local.set({connection});document.querySelector('#code').value='';form.hidden=true;disconnect.hidden=false;await poll();}catch(e){status.textContent=e.message;}};
disconnect.onclick=async()=>{connection=null;await chrome.storage.local.remove('connection');form.hidden=false;disconnect.hidden=true;status.textContent='Disconnected';};
chrome.storage.local.get('connection').then(({connection:c})=>{if(c){try{connection=validate(c);form.hidden=true;disconnect.hidden=false;poll();}catch{}}});
setInterval(poll,2000);
