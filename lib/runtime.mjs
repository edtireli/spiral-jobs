import {assert} from './core.mjs';
export let ollamaURL=process.env.JOB_DESK_OLLAMA_URL||'http://127.0.0.1:11434';
export function setOllamaURL(value){const u=new URL(value);assert(u.protocol==='http:'&&u.hostname==='127.0.0.1'&&!u.username&&!u.password&&u.pathname==='/'&&!u.search&&!u.hash,'Only a local Ollama endpoint is allowed.');ollamaURL=u.origin;return ollamaURL;}
export class ModelRuntime {
 constructor({settings,endpoint=ollamaURL,request=fetch}){Object.assign(this,{settings,endpoint,request});this.state={status:'idle',message:'Models load automatically when needed.'};}
 download(model){
  assert(!this.pending,'Wait for the current model operation.',409);
  assert(typeof model==='string'&&/^(?:[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)*)(?::[a-zA-Z0-9_.-]+)?$/.test(model)&&model.length<200&&!/cloud/i.test(model),'Enter a local Ollama model tag or hf.co GGUF repository tag.');
  this.controller=new AbortController();this.state={status:'loading',model,message:'Downloading '+model};
  this.pending=(async()=>{try{
   const r=await this.request(this.endpoint+'/api/pull',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model,stream:true}),signal:this.controller.signal});assert(r.ok,'Model download could not start.');
   let buffer='';for await(const chunk of r.body){buffer+=new TextDecoder().decode(chunk);let end;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);if(!line.trim())continue;const p=JSON.parse(line);assert(!p.error,p.error);this.state={status:'loading',model,message:`${model} · ${p.status}${p.total?' · '+Math.round(p.completed/p.total*100)+'%':''}`};}}
   this.state={status:'downloaded',model,message:model+' downloaded. Select it below and save.'};
  }catch(e){this.state={status:'error',message:this.controller.signal.aborted?'Download stopped.':e.message};}finally{this.pending=null;}})();return {queued:true};
 }
 start(){
  if(this.pending)return {queued:true};
  const settings=this.settings(),names=[...new Set([settings.model,settings.navigationModel||settings.model])];
  if(names.some(n=>!n)){this.state={status:'setup',message:'Choose or download a planning and vision model in Settings.'};return {queued:false};}
  this.controller=new AbortController();const signal=AbortSignal.any([this.controller.signal,AbortSignal.timeout(900000)]);
  this.state={status:'loading',message:'Checking local models…',models:names};
  this.pending=(async()=>{try{
   const tags=await this.request(this.endpoint+'/api/tags',{signal});assert(tags.ok,'Ollama is unavailable.');const installed=(await tags.json()).models||[];
   for(const model of names){
    assert(installed.some(m=>m.name===model||m.model===model),`${model} is unavailable. Connect the model drive and retry.`);
    const show=await this.request(this.endpoint+'/api/show',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model}),signal});assert(show.ok,'Could not inspect '+model);const info=await show.json();
    assert(info.capabilities?.includes('vision')&&!info.remote_model&&!info.remote_host,'Choose an installed local vision model.');
    this.state={status:'loading',model,models:names,message:`Loading ${model}…`};
    const result=await this.request(this.endpoint+'/api/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model,stream:false,keep_alive:'10m',options:{num_ctx:8192}}),signal});
    assert(result.ok,`${model} could not load. Check available memory and the model drive.`);const loaded=await result.json();assert(!loaded.error,loaded.error||'Model load failed.');
   }
   this.state={status:'ready',models:names,message:names.join(' · ')+' ready. Inactive models may unload after 10 minutes.'};
  }catch(e){this.state=this.controller.signal.aborted?{status:'idle',message:'Model loading stopped.'}:{status:'error',message:e.message};}finally{this.pending=null;}})();
  return {queued:true};
 }
 cancel(){this.controller?.abort();this.state={status:'idle',message:'Model loading stopped. Already loaded models remain managed by Ollama.'};return {ok:true};}
}
