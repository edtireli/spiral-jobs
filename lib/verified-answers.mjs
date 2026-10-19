import {hash} from './core.mjs';

const questionKey=field=>hash({label:String(field.label).replace(/[*✱]/g,'').replace(/\s+/g,' ').trim().toLowerCase(),type:field.type,options:(field.options||[]).map(({value,label})=>({value,label}))});

// Only independently checked answers may be remembered. Unrelated profile
// updates (such as language proficiency) do not invalidate their CV evidence.
export function rememberVerifiedAnswer(field,answer,profile){
 if(!answer?.value||!answer.evidence?.length||!answer.evidenceIds?.length)return null;
 const ids=[...new Set([...answer.evidenceIds,...answer.evidence.map(e=>e.factId)])];
 const facts=ids.map(id=>profile.facts.find(f=>f.id===id));
 if(facts.some(f=>!f)||answer.evidence.some(e=>typeof e.quote!=='string'||e.quote.trim().length<12||!facts.find(f=>f.id===e.factId)?.text.includes(e.quote)))return null;
 return {key:questionKey(field),question:field.label,answer:structuredClone(answer),facts:structuredClone(facts),verifiedAt:new Date().toISOString()};
}

export function findVerifiedAnswer(field,profile,records=[]){
 const key=questionKey(field);
 const record=records.find(r=>r.key===key&&r.facts?.length&&r.facts.every(f=>profile.facts.some(current=>current.id===f.id&&current.text===f.text)));
 if(!record||!rememberVerifiedAnswer(field,record.answer,profile))return null;
 return structuredClone(record.answer);
}
