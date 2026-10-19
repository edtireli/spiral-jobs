import {createHash, randomUUID} from 'node:crypto';
import dns from 'node:dns/promises';
import net from 'node:net';
export const id = () => randomUUID();
export const hash = x => createHash('sha256').update(typeof x === 'string' || Buffer.isBuffer(x) ? x : JSON.stringify(x)).digest('hex');
export const now = () => new Date().toISOString();
export function assert(ok, message, status=400) { if (!ok) throw Object.assign(new Error(message), {status}); }
export function normal(x='') { return x.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim(); }
export function companyKey(x) {
 const n=normal(x).replace(/\b(aps|a s|as|inc|ltd|limited|ab|gmbh)\b/g,'').replace(/\s+/g,' ').trim();
 if(/^(adc|adc consulting|amsterdam data collective(?: adc)?)$/.test(n))return 'adc';
 if(/^(if|if insurance|if p c insurance|if skadeforsikring|if forsikring)$/.test(n))return 'if';
 if(/^(h )?lundbeck$/.test(n))return 'lundbeck';
 if(/^alipes( capital)?$/.test(n))return 'alipes';
 return n;
}
export function canonical(x) {
 const u=new URL(x); assert(['https:','http:'].includes(u.protocol),'Only public HTTP(S) URLs are allowed.');u.hash='';
 for (const k of [...u.searchParams.keys()]) if (/^(utm_|source$|ref$|referrer$|gh_src$|lever-source$)/i.test(k)) u.searchParams.delete(k);
 u.searchParams.sort(); u.pathname=u.pathname.replace(/\/$/,'') || '/'; return u.href;
}
export function privateAddress(ip) {
 if (net.isIP(ip)===4) {const [a,b]=ip.split('.').map(Number); return a===0||a===10||a===127||a>=224||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&b===168)||(a===100&&b>=64&&b<=127);}
 const x=ip.toLowerCase(); return x==='::1'||x==='::'||/^f[cd]|^fe[89ab]/.test(x)||x.startsWith('::ffff:');
}
export async function publicURL(value,{allowTest=false}={}) {
 const u=new URL(value); assert(['https:','http:'].includes(u.protocol),'Only HTTP(S) job URLs are allowed.');
 assert(!u.username&&!u.password,'URLs containing credentials are not allowed.');
 if(allowTest && u.hostname==='127.0.0.1') return u;
 assert(u.port===''||['80','443'].includes(u.port),'Use a public web port.');
 assert(!/^(localhost|.*\.localhost)$/i.test(u.hostname),'Local network URLs are not job sites.');
 const addresses=await dns.lookup(u.hostname,{all:true}); assert(addresses.length && addresses.every(a=>!privateAddress(a.address)),'Private network addresses are not allowed.'); return u;
}
export function htmlText(s='') { return s.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,'').replace(/<[^>]+>/g,' ').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&nbsp;/g,' ').replace(/\s+/g,' ').trim(); }
export function rank(job) {
 const title=normal(job.title), text=normal(job.description), reasons=[]; let score=0;
 const add=(re,n,label)=>{if(re.test(title)){score+=n; reasons.push(label);}};
 add(/data scientist|machine learning|ai engineer|artificial intelligence|applied ai|research scientist/,45,'AI / data role');
 add(/data engineer|analytics engineer|scientific software|bioinformatic|computational biolog/,30,'Data / scientific engineering');
 add(/software engineer|python|data.*ai|ai.*engineering/,22,'Software / Python relevance');
 if(/life science|biomedical|clinical|neuroscience|healthcare|medical|pharma/.test(text)){score+=22;reasons.push('Life Sciences overlap');}
 if(/python/.test(text)){score+=10;reasons.push('Python');}
 if(/llm|generative|rag|neural network/.test(text)){score+=12;reasons.push('ML / GenAI');}
 if(/copenhagen|kobenhavn/.test(normal(job.location))){score+=5;}
 if(/director|head of|vice president|principal|staff |engineering manager/.test(title)){score-=25;reasons.push('Senior leadership requirements');}
 return {score:Math.min(99,Math.max(0,score)),reasons};
}
export function denmark(location='') {return /denmark|danmark|copenhagen|københavn|kobenhavn|aarhus|århus|odense|aalborg|lyngby|ballerup|hørsholm|horsholm|søborg|soborg|gladsaxe|roskilde|hillerød|hillerod/i.test(location);}
