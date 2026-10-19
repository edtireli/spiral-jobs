import {assert,normal,denmark} from './core.mjs';
export const defaultInterests={roles:['data','AI','software','life sciences'],locations:['Denmark'],exclude:[]};
export function validateInterests(value){
 assert(value&&typeof value==='object','Set your interests.');const out={};
 for(const key of ['roles','locations','exclude']){const a=value[key]||[];assert(Array.isArray(a)&&a.length<=15&&a.every(x=>typeof x==='string'&&x.trim().length>=2&&x.length<=70),'Use up to 15 short terms per field.');out[key]=[...new Set(a.map(x=>x.trim()))];}
 assert(out.roles.length&&out.locations.length,'Add at least one role and location.');return out;
}
const aliases={ai:['ai','artificial intelligence','machine learning','llm','generative'],ml:['machine learning','ml'],data:['data','analytics','analyst'],'data science':['data science','data scientist'],software:['software','developer','engineering','programmer'],'life sciences':['life science','life sciences','biomedical','clinical','bioinformatics','computational biology','pharma','medical','healthcare'],copenhagen:['copenhagen','kobenhavn','k benhavn'],aarhus:['aarhus','arhus']};
const contains=(text,term)=>(' '+normal(text)+' ').includes(' '+normal(term)+' ');
const matches=(text,term)=>(aliases[normal(term)]||[term]).some(t=>contains(text,t));
export function preferenceRank(job,value=defaultInterests){
 const p=value||defaultInterests,title=job.title||'',description=job.description||'',location=job.location||'';
 const locationMatch=denmark(location)&&p.locations.some(l=>/^(denmark|danmark)$/i.test(l)||matches(location,l));
 if(!locationMatch||p.exclude.some(term=>matches(title,term)))return {score:0,reasons:[]};
 const inTitle=p.roles.filter(term=>matches(title,term)),inBody=p.roles.filter(term=>matches(description,term));
 if(!inTitle.length&&!inBody.length)return {score:0,reasons:[]};
 return {score:Math.min(99,(inTitle.length?50:30)+inTitle.length*8+inBody.length*4),reasons:[...new Set([...inTitle,...inBody])].map(t=>'Interest: '+t)};
}
