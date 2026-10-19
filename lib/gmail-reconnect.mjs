import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {assert} from './core.mjs';

const exec=promisify(execFile);
export const validExtensionId=value=>typeof value==='string'&&/^[a-p]{32}$/.test(value);
export async function openGmailCompanion(extensionId,{platform=process.platform,run=exec}={}){
 assert(validExtensionId(extensionId),'The paired Gmail companion has no verified extension identity.');
 assert(platform==='darwin','Automatic Gmail companion reopening is available in the Mac app.');
 // No shell, user-supplied path, Chrome profile directory, or arbitrary URL.
 await run('/usr/bin/open',['-b','com.google.Chrome',`chrome-extension://${extensionId}/connector.html`],{timeout:8000,maxBuffer:65536});
}
