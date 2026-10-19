import {existsSync,readFileSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
import {rename,rm} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);
function recordingRuntime(){
 const require=createRequire(import.meta.url),root=path.dirname(require.resolve('playwright-core/package.json'));
 const version=JSON.parse(readFileSync(path.join(root,'browsers.json'),'utf8')).browsers.find(b=>b.name==='ffmpeg').revision;
 const cache=process.env.PLAYWRIGHT_BROWSERS_PATH||(process.platform==='darwin'?path.join(os.homedir(),'Library/Caches/ms-playwright'):process.platform==='win32'?path.join(process.env.LOCALAPPDATA||path.join(os.homedir(),'AppData/Local'),'ms-playwright'):path.join(process.env.XDG_CACHE_HOME||path.join(os.homedir(),'.cache'),'ms-playwright'));
 return path.join(cache,'ffmpeg-'+version,process.platform==='darwin'?'ffmpeg-mac':process.platform==='win32'?'ffmpeg-win64.exe':'ffmpeg-linux');
}

export async function indexRecording(file){
 // Browser recording streams lack a duration/seek index. Remux without
 // re-encoding so long application sessions can be scrubbed in the Mac player.
 const binary=[recordingRuntime(),'/opt/homebrew/bin/ffmpeg','/usr/local/bin/ffmpeg','/usr/bin/ffmpeg'].find(existsSync);
 if(!binary)return {seekable:false,warning:'Install ffmpeg to enable indexed recording playback.'};
 const temporary=file+'.indexed.webm';
 try{
  await exec(binary,['-hide_banner','-loglevel','error','-i',file,'-map','0:v:0','-c','copy','-y',temporary],{timeout:60000});
  await rename(temporary,file);return {seekable:true};
 }catch(e){await rm(temporary,{force:true});return {seekable:false,warning:e.message};}
}
