import {open,readFile,rm,mkdir,chmod} from 'node:fs/promises';
import path from 'node:path';
export async function processLock(folder,name='server.lock'){
 await mkdir(folder,{recursive:true,mode:0o700});await chmod(folder,0o700);const file=path.join(folder,name);
 for(let attempt=0;attempt<2;attempt++){
  try{const f=await open(file,'wx',0o600);await f.writeFile(String(process.pid));await f.close();return async()=>{if(await readFile(file,'utf8').catch(()=>null)===String(process.pid))await rm(file,{force:true});};}
  catch(e){if(e.code!=='EEXIST')throw e;const pid=Number(await readFile(file,'utf8').catch(()=>''));
   let alive=true;try{if(!Number.isInteger(pid)||pid<1)throw new Error('stale');process.kill(pid,0);}catch(err){if(err.code==='EPERM')throw err;alive=false;}
   if(alive)throw new Error('Spiral Jobs is already running with this application history.');
   await rm(file,{force:true});
  }
 }
 throw new Error('Could not acquire the application lock.');
}
