import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import {mkdtemp,rm} from 'node:fs/promises';
import {chromium} from 'playwright';
import {start} from '../server.mjs';

test('real Chrome extension reads only a requested fixture email through its isolated Gmail page',async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'spiral-extension-')),extension=path.resolve('extensions/gmail');
 const app=await start({port:0,dataDir:path.join(dir,'data')});
 const context=await chromium.launchPersistentContext(path.join(dir,'browser'),{channel:'chromium',headless:true,args:['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1','--disable-extensions-except='+extension,'--load-extension='+extension]});
 t.after(async()=>{await context.close();await app.service.mailbox.close();await app.service.running;await new Promise(r=>app.server.close(r));app.service.store.close();await rm(dir,{recursive:true,force:true});});
 let gmailReads=0;const recipient='fixture@example.test',code='aBcDeFgH',date=new Date().toISOString();
 const displayedDate=new Date(date).toLocaleString('en-US',{year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
 const message=`<h2 class=hP>Greenhouse security code</h2><div data-message-id=fixture><span class=gD email=no-reply@greenhouse.io></span><span class=g3 title="${displayedDate}"></span><div class=a3s>Copy and paste this code into the security code field on your application:\n${code}\nAfter you enter the code, resubmit your application.</div></div>`;
 const normalizeQuery=q=>q.replace(/\b(to|from):\(([^()\s]+)\)/g,'$1:$2').replace(/\s+/g,' ').trim();
 await context.route('https://mail.google.com/**',route=>{gmailReads++;return route.fulfill({contentType:'text/html',body:`<title>Søgning - ${recipient} - Gmail</title><input name=q><main role=main><table><tr role=row><td>Security code</td></tr></table></main><script>const q=(${normalizeQuery.toString()})(decodeURIComponent(location.hash.slice('#search/'.length)));document.querySelector('input').value=' '+q+' ';location.hash='#search/'+encodeURIComponent(q).replaceAll('%20','+');document.querySelector('tr').onclick=()=>document.querySelector('main').innerHTML=${JSON.stringify(message)}</script>`});});
 const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
 const extensionId=new URL(worker.url()).host;
 // A stale older tab with stalled startup must not win recovery merely because
 // it has the oldest tab ID. It cannot acquire the reader lock or answer probes.
 const stale=await context.newPage();await stale.addInitScript(()=>Object.defineProperty(navigator,'locks',{value:{request:()=>new Promise(()=>{})}}));
 await stale.goto(`chrome-extension://${extensionId}/connector.html`);
 const page=await context.newPage();await page.goto(`chrome-extension://${extensionId}/connector.html`);
 // Chrome-created tabs can navigate before Playwright installs interception.
 // Create the fixture tab through Playwright; all permissions, DOM scripts and
 // transport still run in the real extension. DNS is disabled for external hosts.
 await page.exposeFunction('fixtureCreateTab',async url=>{const tab=await context.newPage();await tab.goto(url);});
 await page.evaluate(()=>{chrome.tabs.create=async({url})=>{await window.fixtureCreateTab(url);return (await chrome.tabs.query({url:'https://mail.google.com/*'})).at(-1);};});
 app.service.store.set('profile',{email:recipient});const connection=app.service.mailbox.connect(app.origin).connection;
 await page.locator('#code').fill(JSON.stringify(connection));await page.getByRole('button',{name:'Connect',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('Connected'));
 assert.equal(app.service.store.settings().gmail.bridgeExtensionId,extensionId);
 const duplicate=await context.newPage(),closed=duplicate.waitForEvent('close',{timeout:5000});
 await duplicate.goto(`chrome-extension://${extensionId}/connector.html`).catch(error=>{if(!duplicate.isClosed())throw error;});await closed;
 assert.equal(context.pages().filter(p=>p.url()===`chrome-extension://${extensionId}/connector.html`).length,2);
 assert.equal(stale.isClosed(),false,'stale tabs are left alone and never selected as the active reader');
 assert.equal(page.isClosed(),false);assert.equal(app.service.store.settings().gmail.bridgeToken,connection.token);
 assert.equal(gmailReads,0,'idle extension does not read Gmail');
 const result=await app.service.mailbox.lookup({job:{company:'Fixture Research',url:'https://job-boards.greenhouse.io/fixture/jobs/1'},recipient,since:date,challengeBound:true});
 assert.equal(result?.code,code,JSON.stringify(app.service.mailbox.state)+' / '+await page.locator('#status').innerText());assert.equal(gmailReads,1);assert.equal(context.pages().some(p=>p.url().startsWith('https://mail.google.com')),false,'lookup tab closes, ordinary tabs remain');
 assert.equal(app.service.mailbox.bridge.pending,null);
 // Gmail's empty results view can omit role=main. A scoped, loaded empty
 // search must report no receipt, rather than a misleading sign-in error.
 await context.unroute('https://mail.google.com/**');
 await context.route('https://mail.google.com/**',route=>route.fulfill({contentType:'text/html',body:`<title>Search results - ${recipient} - Gmail</title><input name=q><p>No messages matched your search.</p><script>document.querySelector('input').value=decodeURIComponent(location.hash.slice('#search/'.length))+' ';location.hash=location.hash.replaceAll('%20','+');</script>`}));
 const receipt=await app.service.mailbox.receipt({job:{company:'Fixture Research',title:'Data Scientist',url:'https://job-boards.greenhouse.io/fixture/jobs/1'},recipient,since:date});
 assert.equal(receipt,null);assert.equal(app.service.mailbox.bridge.pending,null);
 // Direct Gmail search URLs can leave the existing search box blank. The
 // exact canonical route, account and loaded results must still all match.
 await context.unroute('https://mail.google.com/**');
 await context.route('https://mail.google.com/**',route=>route.fulfill({contentType:'text/html',body:`<title>Search results - ${recipient} - Gmail</title><input name=q value=" "><main role=main><table><tr role=row><td>Security code</td></tr></table></main><script>location.hash=location.hash.replaceAll('%20','+');document.querySelector('tr').onclick=()=>document.querySelector('main').innerHTML=${JSON.stringify(message)}</script>`}));
 const blankResult=await app.service.mailbox.lookup({job:{company:'Fixture Research',url:'https://job-boards.greenhouse.io/fixture/jobs/1'},recipient,since:date,challengeBound:true});
 assert.equal(blankResult.code,code,'a blank existing search box requires the matching route, account and loaded result before reading');
 // Keep the real extension scripts and transport, but shorten only this
 // fixture's search retries. Each guard fails independently and stays closed.
 await page.evaluate(()=>{const original=window.setTimeout.bind(window);window.setTimeout=(fn,ms,...args)=>original(fn,Math.min(ms,1),...args);});
 const allTrue={routeIsSearch:true,inputPresent:true,inputMatches:true,routeMatches:true,accountMatches:true};
 for(const [change,expected]of [
  [{route:'inbox'},{...allTrue,routeIsSearch:false,routeMatches:false}],
  [{missingInput:true},{...allTrue,inputPresent:false,inputMatches:false}],
  [{wrongInput:true},{...allTrue,inputMatches:false}],
  [{route:'other'},{...allTrue,routeMatches:false}],
  [{wrongAccount:true},{...allTrue,accountMatches:false}],
  [{blankInput:true,wrongAccount:true},{...allTrue,inputMatches:false,accountMatches:false}],
  [{blankInput:true,route:'other'},{...allTrue,inputMatches:false,routeMatches:false}]
 ]){
  await context.unroute('https://mail.google.com/**');
  await context.route('https://mail.google.com/**',route=>route.fulfill({contentType:'text/html',body:`<title>Search results - ${change.wrongAccount?'other@example.test':recipient} - Gmail</title><input name=q><main role=main><table><tr role=row><td>Fixture</td></tr></table></main><script>const c=${JSON.stringify(change)};document.querySelector('input').value=c.wrongInput?'unrelated search':c.blankInput?' ':decodeURIComponent(location.hash.slice('#search/'.length));if(c.missingInput)document.querySelector('input').remove();if(c.route)location.hash=c.route==='inbox'?'#inbox':'#search/other';</script>`}));
  await page.waitForFunction(()=>!busy);
  const pending=app.service.mailbox.lookup({job:{company:'Fixture Research',url:'https://job-boards.greenhouse.io/fixture/jobs/1'},recipient,since:date,challengeBound:true});
  await new Promise(resolve=>setImmediate(resolve));await page.evaluate(()=>poll());
  const result=await pending;assert.match(result.error,/requested search/);assert.deepEqual(result.diagnostic,{transport:true,search:expected});
  assert.equal(result.code,undefined);assert.equal(context.pages().some(p=>p.url().startsWith('https://mail.google.com')),false);
 }
 await context.unroute('https://mail.google.com/**');
 await context.route('https://mail.google.com/**',route=>route.fulfill({contentType:'text/html',body:`<title>Search results - ${recipient} - Gmail</title><input name=q><main role=main>Loading…</main>`}));
 await page.waitForFunction(()=>!busy);
 const unloaded=app.service.mailbox.lookup({job:{company:'Fixture Research',url:'https://job-boards.greenhouse.io/fixture/jobs/1'},recipient,since:date,challengeBound:true});
 await new Promise(resolve=>setImmediate(resolve));await page.evaluate(()=>poll());
 const unloadedResult=await unloaded;assert.match(unloadedResult.error,/did not finish loading/);assert.equal(unloadedResult.code,undefined);
});
