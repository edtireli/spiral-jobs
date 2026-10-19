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
 let gmailReads=0;const recipient='fixture@example.test',code='12345678',date=new Date().toISOString();
 const message=`<h2 class=hP>Greenhouse security code</h2><div data-message-id=fixture><span class=gD email=no-reply@greenhouse.io></span><span class=g3 title="${date}"></span><div class=a3s>Your security code is: ${code}</div></div>`;
 await context.route('https://mail.google.com/**',route=>{gmailReads++;return route.fulfill({contentType:'text/html',body:`<title>Search results - ${recipient} - Gmail</title><input name=q><main role=main><table><tr role=row><td>Security code</td></tr></table></main><script>document.querySelector('input').value=decodeURIComponent(location.hash.slice('#search/'.length));document.querySelector('tr').onclick=()=>document.querySelector('main').innerHTML=${JSON.stringify(message)}</script>`});});
 const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
 const extensionId=new URL(worker.url()).host;const page=await context.newPage();await page.goto(`chrome-extension://${extensionId}/connector.html`);
 // Chrome-created tabs can navigate before Playwright installs interception.
 // Create the fixture tab through Playwright; all permissions, DOM scripts and
 // transport still run in the real extension. DNS is disabled for external hosts.
 await page.exposeFunction('fixtureCreateTab',async url=>{const tab=await context.newPage();await tab.goto(url);});
 await page.evaluate(()=>{chrome.tabs.create=async({url})=>{await window.fixtureCreateTab(url);return (await chrome.tabs.query({url:'https://mail.google.com/*'})).at(-1);};});
 app.service.store.set('profile',{email:recipient});const connection=app.service.mailbox.connect(app.origin).connection;
 await page.locator('#code').fill(JSON.stringify(connection));await page.getByRole('button',{name:'Connect',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('Connected'));
 assert.equal(gmailReads,0,'idle extension does not read Gmail');
 const result=await app.service.mailbox.lookup({job:{company:'Fixture Research',url:'https://job-boards.greenhouse.io/fixture/jobs/1'},recipient,since:date,challengeBound:true});
 assert.equal(result?.code,code,JSON.stringify(app.service.mailbox.state)+' / '+await page.locator('#status').innerText());assert.equal(gmailReads,1);assert.equal(context.pages().some(p=>p.url().startsWith('https://mail.google.com')),false,'lookup tab closes, ordinary tabs remain');
 assert.equal(app.service.mailbox.bridge.pending,null);
});
