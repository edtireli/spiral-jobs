import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import {mkdtemp,rm} from 'node:fs/promises';
import {start} from '../server.mjs';

test('Chrome companion can reconcile one receipt but cannot change dashboard settings or submit',async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'spiral-mail-'));
 const app=await start({port:0,dataDir:dir}),service=app.service;
 t.after(async()=>{await service.mailbox.close();await service.running;await new Promise(r=>app.server.close(r));service.store.close();await rm(dir,{recursive:true,force:true});});
 const recipient='fixture@example.test';service.store.set('profile',{email:recipient});
 const dashboard=(route,body={})=>fetch(app.origin+route,{method:'POST',headers:{Origin:app.origin,'Content-Type':'application/json','X-Job-Desk-Token':app.csrf},body:JSON.stringify(body)});
 const {connection}=await (await dashboard('/api/gmail/connect',{confirm:true})).json();
 const extensionOrigin='chrome-extension://'+'a'.repeat(32);
 const bridge=(route,body={},token=connection.token,origin=extensionOrigin)=>fetch(app.origin+route,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(body)});
 assert.equal((await bridge('/api/gmail/bridge/poll',{},'wrong')).status,403);
 assert.equal((await bridge('/api/gmail/bridge/poll',{},connection.token,'https://evil.example')).status,403);
 assert.equal((await bridge('/api/autonomy',{enabled:true})).status,403);
 assert.equal((await bridge('/api/gmail/bridge/auto-apply')).status,404);
 assert.equal(JSON.stringify(service.state()).includes(connection.token),false);
 const j=service.store.add({company:'Fixture Research',title:'Data Scientist',location:'Copenhagen',url:'https://job-boards.greenhouse.io/fixture/jobs/1'}).job;
 const history=service.store.record({job:j,status:'uncertain'});j.stage='uncertain';j.navigation={status:'uncertain'};service.store.save(j);
 async function reconcile(message){
  assert.equal((await dashboard(`/api/jobs/${j.id}/check-application-email`)).status,200);
  const {request}=await (await bridge('/api/gmail/bridge/poll')).json();assert.ok(request);
  assert.equal((await bridge('/api/gmail/bridge/result',{id:request.id,account:'wrong@example.test',messages:[message]})).status,409);
  assert.equal((await bridge('/api/gmail/bridge/result',{id:request.id,account:recipient,messages:[message]})).status,200);
  await service.running;
 }
 const message={id:'m1',sender:'no-reply@greenhouse.io',date:new Date().toISOString(),subject:'Fixture Research',body:'Please verify your email for Fixture Research. Security code: 12345678'};
 await reconcile(message);assert.equal(service.store.get(j.id).stage,'uncertain');assert.equal(service.store.get(j.id).emailCheck.kind,'verification');
 await reconcile({...message,id:'receipt',subject:'Fixture Research — Data Scientist',body:'We have received your application for Data Scientist at Fixture Research.'});
 assert.equal(service.store.get(j.id).stage,'submitted');assert.equal(service.store.applications().length,1);assert.equal(service.store.blocked(j).id,history.id);assert.equal(service.store.blocked(j).emailReceipt.messageId,'receipt');assert.equal(JSON.stringify(service.store.events(j.id)).includes('12345678'),false);
 await dashboard('/api/gmail/disconnect');assert.equal((await bridge('/api/gmail/bridge/poll')).status,403);
});
