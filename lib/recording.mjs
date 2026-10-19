import {existsSync} from 'node:fs';
import {rename,rm} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);

export async function indexRecording(file){
 // Browser recording streams lack a duration/seek index. Remux without
 // re-encoding so long application sessions can be scrubbed in the Mac player.
 const binary=['/opt/homebrew/bin/ffmpeg','/usr/local/bin/ffmpeg'].find(existsSync);
 if(!binary)return {seekable:false,warning:'Install ffmpeg to enable indexed recording playback.'};
 const temporary=file+'.indexed.webm';
 try{
  await exec(binary,['-hide_banner','-loglevel','error','-i',file,'-map','0:v:0','-c','copy','-y',temporary],{timeout:60000});
  await rename(temporary,file);return {seekable:true};
 }catch(e){await rm(temporary,{force:true});return {seekable:false,warning:e.message};}
}
