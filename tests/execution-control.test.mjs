import test from 'node:test';
import assert from 'node:assert/strict';
import {ExecutionControl} from '../lib/execution-control.mjs';
import {executionView} from '../public/execution.js';

test('pause holds at a checkpoint and resume continues the same task once',async()=>{
 const c=new ExecutionControl('run'),events=[];c.pause();
 assert.equal(c.status,'pausing');
 const pending=(async()=>{await c.checkpoint();events.push('action');})();
 await new Promise(r=>setImmediate(r));assert.equal(c.status,'paused');assert.deepEqual(events,[]);
 c.resume();await pending;assert.deepEqual(events,['action']);assert.equal(c.id,'run');
 c.finish();await assert.rejects(c.checkpoint(),/stopped/);
});
test('stop releases suspended tasks without allowing their next action',async()=>{
 const c=new ExecutionControl('run');c.pause();const pending=c.checkpoint();c.cancel();
 await assert.rejects(pending,/stopped/);assert.throws(()=>c.resume(),/not paused/);
});
test('AI control indicator distinguishes working, pausing and safely paused',()=>{
 assert.equal(executionView(null).visible,false);
 assert.equal(executionView({status:'active',label:'Filling city'}).detail,'Filling city');
 assert.equal(executionView({status:'pausing'}).disabled,true);
 assert.equal(executionView({status:'paused'}).action,'resume');
 assert.equal(executionView({status:'disconnected'}).disabled,true);
 assert.equal(executionView({status:'finished'}).visible,false);
});
