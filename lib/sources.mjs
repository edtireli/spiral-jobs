import {htmlText,rank,denmark,assert} from './core.mjs';
export const defaultSources=[
 {kind:'greenhouse',slug:'intellishoredk',company:'Intellishore'},
 {kind:'greenhouse',slug:'trustpilot',company:'Trustpilot'},
 {kind:'greenhouse',slug:'wpp',company:'WPP'},
 {kind:'ashby',slug:'corti',company:'Corti'},
 {kind:'lever',slug:'veo',company:'Veo'}
];
export async function discover(sources,onSource=()=>{}){
 const results=[],errors=[];
 for(const s of sources){
  try{
   assert(/^[a-zA-Z0-9_-]{1,80}$/.test(s.slug),'Invalid board slug.');
   assert(['greenhouse','lever','ashby'].includes(s.kind),'Supported boards: greenhouse, lever, ashby.');
   const url=s.kind==='greenhouse'?`https://boards-api.greenhouse.io/v1/boards/${s.slug}/jobs?content=true`:s.kind==='ashby'?`https://api.ashbyhq.com/posting-api/job-board/${s.slug}`:`https://api.lever.co/v0/postings/${s.slug}?mode=json`;
   const res=await fetch(url,{signal:AbortSignal.timeout(20000)});assert(res.ok,`${s.company}: HTTP ${res.status}`);
   const data=await res.json(), rows=Array.isArray(data)?data:data.jobs||[];let count=0;
   for(const j of rows){
    const location=j.location?.name||(typeof j.location==='string'?j.location:null)||j.categories?.location||'';
    const title=j.title||j.text||'';if(!denmark(location))continue;
    const description=htmlText(j.content||j.descriptionPlain||[j.description,...(j.lists||[]).map(x=>x.text+' '+x.content),j.additional].filter(Boolean).join('\n'));
    const job={company:s.company,title,location,description,url:j.absolute_url||j.hostedUrl||j.jobUrl,applyUrl:j.applyUrl||j.applicationUrl||j.absolute_url,source:s.kind,sourceId:String(j.id),board:s.slug};
    Object.assign(job,rank(job));if(job.score<30)continue;results.push(job);count++;
   }onSource(`${s.company}: ${count} relevant Denmark roles`);
  }catch(e){errors.push({source:s.company,error:e.message});onSource(`${s.company}: ${e.message}`);}
 }return {jobs:results,errors};
}
