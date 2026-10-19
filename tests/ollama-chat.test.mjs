import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {localChat} from '../lib/ollama-chat.mjs';
async function fixture(t,handle){const server=http.createServer(handle);await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));return `http://127.0.0.1:${server.address().port}`;}
test('streaming joins partial JSON, reports progress and retains the local Qwen thinking for the requested transcript',async t=>{
 let body;const endpoint=await fixture(t,async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;body=JSON.parse(raw);res.writeHead(200,{'Content-Type':'application/x-ndjson'});
 res.write(JSON.stringify({message:{thinking:'private model scratchwork'},done:false})+'\n');
 res.write('{"message":{"content":"{\\"ok\\":');setTimeout(()=>{res.end('true}"},"done":true}\n');},30);
 });
 const progress=[];const result=await localChat({model:'fixture'},{endpoint,onProgress:p=>progress.push(p)});
 assert.equal(body.stream,true);assert.equal(result.message.content,'{"ok":true}');assert.equal(result.message.thinking,'private model scratchwork');assert.ok(result.reasoningCharacters>0);assert.equal(progress.at(-1).done,true);
});
test('an interrupted stream and local model errors are actionable and never retried',async t=>{
 let calls=0;const endpoint=await fixture(t,(req,res)=>{calls++;req.resume();res.writeHead(200);res.end('{"error":"runner ran out of memory"}\n');});
 await assert.rejects(localChat({model:'fixture'},{endpoint}),/out of memory/);assert.equal(calls,1);
});
test('explicit deadline aborts a silent model with a clear error',async t=>{
 const endpoint=await fixture(t,(req,res)=>{req.resume();});
 await assert.rejects(localChat({model:'fixture'},{endpoint,timeoutMs:50}),/exceeded/);
});

test('cancel aborts a streaming request without retrying',async t=>{
 let calls=0;const endpoint=await fixture(t,(req,res)=>{calls++;req.resume();res.writeHead(200);res.write('{"message":{"thinking":"in progress"},"done":false}\n');});
 const controller=new AbortController();const pending=localChat({model:'fixture'},{endpoint,signal:controller.signal});setTimeout(()=>controller.abort(),30);
 await assert.rejects(pending,/stopped/);assert.equal(calls,1);
});
