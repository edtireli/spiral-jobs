import {readdir,readFile} from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const root=path.resolve(import.meta.dirname,'..');
const excluded=new Set(['.git','node_modules','data','dist','.cache','.private','verification','.wrangler','__pycache__']);
const problems=[];
const publishable=new Set(execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean));
for(const name of publishable)if(/^(?:data|verification|dist|\.private|\.cache|node_modules)\//.test(name))problems.push(name+': private/generated directory is tracked');
async function walk(dir){for(const item of await readdir(dir,{withFileTypes:true})){
 if(excluded.has(item.name))continue;
 const file=path.join(dir,item.name),relative=path.relative(root,file);
 if(item.isDirectory()){await walk(file);continue;}
 if(!publishable.has(relative))continue;
 if(item.isSymbolicLink()){problems.push(relative+': unexpected symlink');continue;}
 if(/(?:^|\/)(?:config\.json|\.env|wrangler\.local\.json|runtime\.json)|\.sqlite|\.webm$/.test(relative)){problems.push(relative+': private/generated file');continue;}
 if(!/\.(?:mjs|js|json|md|html|css|yml|py|m|tex|txt)$/.test(file)||relative==='scripts/privacy-audit.mjs'||relative.startsWith('desktop/licenses/'))continue;
 const source=await readFile(file,'utf8');
 if(/\/Users\/[a-zA-Z0-9_-]+\//.test(source))problems.push(relative+': personal absolute path');
 if(/[\w.+-]+@(?:gmail|hotmail|outlook|protonmail|yahoo)\.[a-z]+/i.test(source))problems.push(relative+': personal email');
 if(/(?:ghp_|github_pat_|sk-proj-)[A-Za-z0-9_]{20,}/.test(source)||/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(source))problems.push(relative+': secret-like content');
}}
await walk(root);
const profile=JSON.parse(await readFile(path.join(root,'resources/profile.json'),'utf8'));
if(profile.name||profile.email||profile.phone||profile.location||profile.facts?.length)problems.push('Default profile must be empty.');
if(problems.length){console.error(problems.join('\n'));process.exit(1);}
console.log('Public source scan passed: empty profile; no private runtime files, personal paths, email accounts or secret patterns. Manual media review is still required.');
