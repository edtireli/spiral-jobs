import test from 'node:test';
import assert from 'node:assert/strict';
import {localJSON} from '../lib/ollama-json.mjs';

const body={model:'fixture',think:true,format:'json',options:{num_predict:1200},messages:[{role:'user',content:'Use only the original facts.'}]};
test('reasoning that exhausts the output budget gets one non-thinking formatting pass',async()=>{
 const calls=[],progress=[];
 const value=await localJSON(body,{onProgress:p=>progress.push(p),chat:async(b,o)=>{calls.push(b);o.onProgress({id:String(calls.length),thinking:calls.length===1?'Local reasoning':'',done:true});return calls.length===1?{done_reason:'length',message:{content:'',thinking:'Local reasoning'}}:{message:{content:'{"answer":"supported"}'}};}});
 assert.equal(value.answer,'supported');assert.equal(calls.length,2);assert.equal(calls[1].think,false);assert.equal(calls[1].messages[0].content,body.messages[0].content);assert.match(calls[1].messages.at(-1).content,/Local reasoning/);assert.equal(progress.at(-1).formatting,true);
});
test('valid results need no formatting; invalid results are bounded and errors are not retried',async()=>{
 let calls=0;assert.deepEqual(await localJSON(body,{chat:async()=>{calls++;return {message:{content:'{"ok":true}'}};}}),{ok:true});assert.equal(calls,1);
 calls=0;await assert.rejects(localJSON(body,{validate:d=>d?.action==='ready',chat:async()=>{calls++;return {message:{content:'{"action":"unknown"}'}};}}),/could not produce/);assert.equal(calls,2);
 calls=0;await assert.rejects(localJSON(body,{chat:async()=>{calls++;throw new Error('connection lost');}}),/connection lost/);assert.equal(calls,1);
});
test('cancellation between reasoning and formatting does not start another model call',async()=>{
 const controller=new AbortController();let calls=0;
 await assert.rejects(localJSON(body,{signal:controller.signal,chat:async()=>{calls++;controller.abort();return {done_reason:'length',message:{content:'',thinking:'unfinished'}};}}),/abort/i);assert.equal(calls,1);
});
