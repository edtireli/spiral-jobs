import http from 'node:http';
import {randomUUID} from 'node:crypto';
import {ollamaURL} from './runtime.mjs';

// Stream local responses: Node fetch's default header timeout can expire while
// a non-streaming 27B request is still reasoning. No implicit retry of actions.
export function localChat(body,{signal,onProgress=()=>{},timeoutMs=900000,endpoint=ollamaURL}={}){
 return new Promise((resolve,reject)=>{
  const started=Date.now(),id=randomUUID();let response,buffer='',content='',thinking='',reasoningCharacters=0,phase='Waiting for model',last,finished=false;
  const snapshot=()=>({id,model:body.model,startedAt:new Date(started).toISOString(),phase,elapsed:Math.round((Date.now()-started)/1000),thinking,content,characters:content.length,reasoningCharacters});
  const progress=()=>onProgress(snapshot());
  const clean=()=>{clearInterval(ticker);clearTimeout(deadline);signal?.removeEventListener('abort',abort);};
  const fail=error=>{if(finished)return;finished=true;clean();request.destroy();onProgress({...snapshot(),done:true,error:error.message});reject(error);};
  const abort=()=>fail(new Error('Local model request stopped. No automatic retry was made.'));
  const request=http.request(endpoint+'/api/chat',{method:'POST',headers:{'Content-Type':'application/json'}},res=>{
   response=res;
   if(res.statusCode!==200){let detail='';res.setEncoding('utf8');res.on('data',s=>detail+=s);res.on('end',()=>fail(new Error(`Ollama returned HTTP ${res.statusCode}: ${detail.slice(0,500)}`)));return;}
   res.setEncoding('utf8');
   const consume=line=>{
    if(!line.trim())return;let item;try{item=JSON.parse(line);}catch{throw new Error('Ollama sent an unreadable response. Nothing was retried.');}
    if(item.error)throw new Error('Ollama: '+item.error);
    if(item.message?.thinking){thinking+=item.message.thinking;reasoningCharacters=thinking.length;phase='Thinking';}
    if(item.message?.content){content+=item.message.content;phase='Writing response';}
    last=item;
   };
   res.on('data',chunk=>{try{buffer+=chunk;let end;while((end=buffer.indexOf('\n'))>=0){consume(buffer.slice(0,end));buffer=buffer.slice(end+1);}}catch(e){fail(e);}});
   res.on('end',()=>{if(finished)return;try{consume(buffer);if(!last?.done)throw new Error('Ollama disconnected before completing its response. Your application was not retried.');finished=true;clean();onProgress({...snapshot(),phase:'Response ready',done:true,doneReason:last.done_reason});resolve({...last,message:{role:'assistant',content,thinking},reasoningCharacters});}catch(e){fail(e);}});
   res.on('error',e=>fail(new Error(`Ollama connection interrupted (${e.code||e.message}). No automatic retry was made.`)));
  });
  request.on('error',e=>fail(new Error(`Cannot reach local Ollama at ${endpoint} (${e.code||e.message}). Check model status, then retry.`)));
  const ticker=setInterval(progress,2000);ticker.unref();
  const deadline=setTimeout(()=>fail(new Error(`The local model exceeded ${Math.round(timeoutMs/60000)} minutes. The application is paused; no automatic retry was made.`)),timeoutMs);deadline.unref();
  signal?.addEventListener('abort',abort,{once:true});
  if(signal?.aborted)return abort();
  progress();request.end(JSON.stringify({...body,stream:true}));
 });
}
