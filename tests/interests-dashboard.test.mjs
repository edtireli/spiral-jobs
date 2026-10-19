import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright';
import {start} from '../server.mjs';

test('the start-page interests persist and control Find jobs without applying',async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'spiral-interests-'));
 const app=await start({port:0,dataDir:dir});
 const browser=await chromium.launch({headless:true});
 t.after(async()=>{await browser.close();app.server.closeAllConnections();await new Promise(r=>app.server.close(r));await app.unlock();app.service.store.close();await rm(dir,{recursive:true,force:true});});
 app.service.store.set('sources',[{kind:'greenhouse',slug:'fixture',company:'Fixture'}]);
 t.mock.method(globalThis,'fetch',async()=>Response.json({jobs:[
  {id:'a',title:'Clinical Researcher',location:{name:'Aarhus'},absolute_url:'https://example.com/a'},
  {id:'b',title:'Machine Learning Engineer',location:{name:'Copenhagen'},absolute_url:'https://example.com/b'},
  {id:'c',title:'AI Director',location:{name:'Copenhagen'},absolute_url:'https://example.com/c'}
 ]}));
 const page=await browser.newPage();const errors=[],posts=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()==='POST')posts.push(new URL(r.url()).pathname);});
 await page.goto(app.origin);
 await page.locator('#emptyInterests').click();
 await page.getByLabel('Roles and topics').fill('AI');
 await page.getByLabel('Where in Denmark').fill('Copenhagen');
 await page.getByLabel('Skip titles containing').fill('director');
 await page.getByRole('button',{name:'Save interests',exact:true}).click();
 await page.locator('#interestsDialog').waitFor({state:'hidden'});
 assert.equal(await page.locator('#interestSummary').textContent(),'Copenhagen · AI');
 await page.reload();await page.locator('#interestsButton').click();
 assert.equal(await page.getByLabel('Roles and topics').inputValue(),'AI');
 assert.equal(await page.getByLabel('Where in Denmark').inputValue(),'Copenhagen');
 await page.locator('[data-close="interestsDialog"]').click();
 await page.locator('#emptyScan').click();
 await page.getByRole('heading',{name:'Machine Learning Engineer',exact:true}).waitFor();
 assert.deepEqual(app.service.store.jobs().map(j=>j.title),['Machine Learning Engineer']);
 assert.deepEqual(app.service.store.applications(),[]);
 assert.deepEqual(posts,['/api/settings','/api/scan']);assert.deepEqual(errors,[]);
});
