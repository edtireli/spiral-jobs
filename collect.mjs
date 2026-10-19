import path from 'node:path';
import {collectJobs} from './lib/collector.mjs';
const dir=process.env.JOB_DESK_DATA_DIR||path.join(import.meta.dirname,'data');
try{console.log(JSON.stringify(await collectJobs(dir)));}catch(e){console.error(e.message);process.exitCode=1;}
