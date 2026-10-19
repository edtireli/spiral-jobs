import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,chmodSync} from 'node:fs';
import path from 'node:path';
import {id,now,companyKey,canonical,normal,assert} from './core.mjs';
export class Store {
 constructor(dir){mkdirSync(dir,{recursive:true,mode:0o700});chmodSync(dir,0o700); this.db=new DatabaseSync(path.join(dir,'jobs.sqlite'));
  this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
   CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,url TEXT UNIQUE NOT NULL,company_key TEXT NOT NULL,role_key TEXT NOT NULL,data TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS applications(id TEXT PRIMARY KEY,job_id TEXT,company_key TEXT NOT NULL,role_key TEXT NOT NULL,status TEXT NOT NULL,data TEXT NOT NULL,created_at TEXT NOT NULL);
   CREATE UNIQUE INDEX IF NOT EXISTS one_employer ON applications(company_key);
   CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY,time TEXT,job_id TEXT,action TEXT,detail TEXT);`);
  // A crashed submission is never automatically retried.
  for(const a of this.applications().filter(a=>a.status==='submitting')) this.application(a.id,{status:'uncertain',note:'The app stopped during submission. Check the employer site before doing anything else.'});
 }
 settings(){return Object.fromEntries(this.db.prepare('SELECT key,value FROM settings').all().map(r=>[r.key,JSON.parse(r.value)]));}
 set(key,value){this.db.prepare('INSERT OR REPLACE INTO settings VALUES(?,?)').run(key,JSON.stringify(value));}
 jobs(){return this.db.prepare('SELECT data FROM jobs').all().map(r=>JSON.parse(r.data)).sort((a,b)=>(b.score||0)-(a.score||0));}
 get(jobId){const row=this.db.prepare('SELECT data FROM jobs WHERE id=?').get(jobId);assert(row,'Job not found.',404);return JSON.parse(row.data);}
 save(job){job.updatedAt=now();this.db.prepare('INSERT OR REPLACE INTO jobs VALUES(?,?,?,?,?)').run(job.id,canonical(job.url),companyKey(job.company),normal(job.title+' '+job.location),JSON.stringify(job));return job;}
 add(data){const url=canonical(data.url), ck=companyKey(data.company), rk=normal(data.title+' '+data.location);
  assert(ck&&rk,'Company and title are required.');
  const found=this.db.prepare('SELECT data FROM jobs WHERE url=? OR (company_key=? AND role_key=?)').get(url,ck,rk);
  if(found){const j=JSON.parse(found.data);j.lastSeen=now();
   if(canonical(j.url)===url&&data.description&&data.description!==j.description){j.description=data.description;if(j.draft&&!this.blocked(j)){delete j.draft;j.revision++;j.stage='needs_review';}}
   this.save(j);return {job:j,added:false};}
  return {job:this.save({...data,url,id:id(),stage:'new',createdAt:now(),lastSeen:now(),revision:0}),added:true};
 }
 blocked(job){return this.db.prepare('SELECT data FROM applications WHERE company_key=? OR role_key=?').all(companyKey(job.company),normal(job.company+' '+job.title+' '+job.location)).map(r=>JSON.parse(r.data))[0]||null;}
 applications(){return this.db.prepare('SELECT data FROM applications ORDER BY created_at DESC').all().map(r=>JSON.parse(r.data));}
 record({job,company,title='',url='',status='applied',note='',date=now()}){
  const name=job?.company||company, ck=companyKey(name);assert(ck,'Company is required.');
  const a={id:id(),jobId:job?.id||null,company:name,title:job?.title||title,position:job?.title||title,url:job?.url||url,status,note,createdAt:date,location:job?.jobDetails?.location||job?.location||null,postcode:job?.jobDetails?.postcode||null,address:job?.jobDetails?.address||null,deadline:job?.jobDetails?.deadline||null,sourceUrl:job?.jobDetails?.sourceUrl||job?.url||url};
  try{this.db.prepare('INSERT INTO applications VALUES(?,?,?,?,?,?,?)').run(a.id,a.jobId,ck,normal(name+' '+a.title+' '+(job?.location||'')),status,JSON.stringify(a),date);}
  catch(e){if(/UNIQUE constraint failed/.test(e.message))throw Object.assign(new Error('This employer is already in your application history. Repeat application blocked.'),{status:409});throw e;}
  this.event(a.jobId,'history_recorded',{company:name,status});return a;
 }
 application(aid,patch){const r=this.db.prepare('SELECT data FROM applications WHERE id=?').get(aid);assert(r,'History record not found.',404);const a={...JSON.parse(r.data),...patch};this.db.prepare('UPDATE applications SET status=?,data=? WHERE id=?').run(a.status,JSON.stringify(a),aid);return a;}
 release(aid){ // Only a proven pre-dispatch failure may release a reservation.
  this.db.prepare("DELETE FROM applications WHERE id=? AND status='submitting'").run(aid);
 }
 event(jobId,action,detail={}){this.db.prepare('INSERT INTO events(time,job_id,action,detail) VALUES(?,?,?,?)').run(now(),jobId,action,JSON.stringify(detail));}
 events(jobId){return this.db.prepare('SELECT time,action,detail FROM events WHERE job_id=? ORDER BY id DESC LIMIT 25').all(jobId);}
 close(){this.db.close();}
}
