// These transcripts come from the user's local Ollama model, not from Codex.
export function recordModelProgress(job,run){
 if(!run?.id)return run;
 job.reasoning||=[];
 const index=job.reasoning.findIndex(r=>r.id===run.id);
 if(index<0)job.reasoning.push({...run});else job.reasoning[index]={...job.reasoning[index],...run};
 const {thinking,content,...metadata}=run;return metadata;
}
