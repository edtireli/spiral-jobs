import test from 'node:test';
import assert from 'node:assert/strict';
import {Navigator} from '../lib/navigator.mjs';

function fixture(){
 const moves=[],painted=[],n=new Navigator({});
 n.page={url:()=> 'https://example.test/apply',isClosed:()=>false,mouse:{move:async(x,y)=>moves.push({x,y})}};
 n.syncControl=async()=>painted.push({...n.cursor});
 n.cursor={x:100,y:100,url:n.page.url()};
 return {n,moves,painted};
}

test('active pointer moves smoothly to the exact target with a matching visible overlay',async()=>{
 const {n,moves,painted}=fixture();await n.movePointer({x:350,y:225});
 assert.ok(moves.length>3);assert.equal(moves.length,painted.length);
 assert.deepEqual(moves.at(-1),{x:350,y:225});
 for(let i=0;i<moves.length;i++){
  assert.equal(moves[i].x,painted[i].x);assert.equal(moves[i].y,painted[i].y);
  assert.ok(moves[i].x>=100&&moves[i].x<=350&&moves[i].y>=100&&moves[i].y<=225);
  if(i){assert.ok(moves[i].x>=moves[i-1].x);assert.ok(moves[i].y>=moves[i-1].y);}
 }
});

test('Stop interrupts pointer travel before it reaches the target',async()=>{
 const {n,moves}=fixture();let checkpoints=0;
 n.checkpoint=async()=>{if(++checkpoints===3)n.abort.abort();};
 await assert.rejects(n.movePointer({x:1000,y:800}),/stopped or its page changed/);
 assert.equal(moves.length,2);assert.notDeepEqual(moves.at(-1),{x:1000,y:800});
});

test('Pause time does not advance the pointer, and Resume continues instead of snapping',async()=>{
 const {n,moves}=fixture();let checkpoints=0,resumeIndex;
 n.checkpoint=async()=>{if(++checkpoints===3){resumeIndex=moves.length;await new Promise(r=>setTimeout(r,180));assert.equal(moves.length,resumeIndex);return true;}return false;};
 await n.movePointer({x:350,y:225});
 assert.notDeepEqual(moves[resumeIndex],{x:350,y:225});assert.ok(moves.length-resumeIndex>2);
 assert.deepEqual(moves.at(-1),{x:350,y:225});
});

test('a changed application page interrupts pointer travel without moving the replacement',async()=>{
 const {n,moves}=fixture();let checkpoints=0;
 n.checkpoint=async()=>{if(++checkpoints===2)n.page={};};
 await assert.rejects(n.movePointer({x:500,y:300}),/stopped or its page changed/);assert.equal(moves.length,1);
});

test('beforeAction uses the target center after scrolling and retains action checkpoints',async()=>{
 const {n,moves}=fixture();let scrolled=false,checks=0;n.checkpoint=async()=>{checks++;};
 const target={isVisible:async()=>true,scrollIntoViewIfNeeded:async()=>{scrolled=true;},boundingBox:async()=>{assert.equal(scrolled,true);return{x:200,y:300,width:500,height:40};}};
 await n.beforeAction(target);assert.deepEqual(moves.at(-1),{x:450,y:320});assert.ok(checks>moves.length);
});
