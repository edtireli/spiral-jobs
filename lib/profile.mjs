import {writeFile} from 'node:fs/promises';
import path from 'node:path';
import {assert,hash} from './core.mjs';
export async function saveProfile(service,body){
 assert(!service.busy&&![...(service.navigators?.values()||[])].some(n=>n.exposed&&!n.closed),'Finish the active application before editing your profile.',409);
 const previous=service.store.settings().profile,p={...previous};
 for(const key of ['name','firstName','lastName','email','phone','location','country','city','github','linkedin','availability','salary','profile','currentCompany','englishProficiency','projectFooterText','credentials'])if(body[key]!==undefined){assert(typeof body[key]==='string'&&body[key].length<=4000,'Invalid profile field.');p[key]=body[key].trim();}
 assert(p.name&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email),'Enter your name and email.');
 if(p.name!==previous.name||!p.firstName||!p.lastName){p.firstName=body.firstName?.trim()||p.name.split(/\s+/)[0];p.lastName=body.lastName?.trim()||p.name.split(/\s+/).slice(1).join(' ');}
 if(body.cvText!==undefined){assert(typeof body.cvText==='string'&&body.cvText.length>=30&&body.cvText.length<60000,'Paste your CV text (30–60,000 characters).');p.cvText=body.cvText;p.facts=body.cvText.split(/\n\s*\n/).filter(s=>s.trim()).map((text,i)=>({id:'cv-'+i,text:text.trim()}));}
 if(body.extraFacts!==undefined){assert(typeof body.extraFacts==='string'&&body.extraFacts.length<=20000,'Keep additional facts under 20,000 characters.');p.extraFacts=body.extraFacts.trim();}
 if(body.cvText!==undefined||body.extraFacts!==undefined)p.facts=[...p.facts.filter(f=>!f.id.startsWith('extra-')),...(p.extraFacts||'').split(/\n+/).map(s=>s.trim()).filter(Boolean).map((text,i)=>({id:'extra-'+i,text}))];
 for(const key of ['salaryAnnual','salaryMonthly','consultingYears'])if(body[key]!==undefined&&body[key]!==''){assert(Number.isFinite(Number(body[key]))&&Number(body[key])>=0,'Invalid numeric fact.');p[key]=Number(body[key]);}
 if(body.documentTheme)p.documentTheme=['classic','spiral'].includes(body.documentTheme)?body.documentTheme:'classic';
 if(typeof body.projectFooter==='boolean')p.projectFooter=body.projectFooter;
 if(body.cvTemplate){assert(typeof body.cvTemplate==='string'&&body.cvTemplate.length<100000&&body.cvTemplate.includes('\\documentclass'),'Choose a standalone LaTeX source.');await writeFile(path.join(service.dataDir,'cv-template.tex'),body.cvTemplate,{mode:0o600});}
 assert(p.facts.length,'Add your CV before saving.');
 for(const [jid,n]of service.navigators||[])if(!n.exposed){await n.close();service.navigators.delete(jid);}
 service.store.set('profile',p);
 for(const j of service.store.jobs())if(j.draft&&!service.store.blocked(j)){delete j.draft;j.revision++;j.stage='needs_review';service.store.save(j);}
 service.store.event(null,'profile_updated',{hash:hash(p)});return {ok:true};
}
