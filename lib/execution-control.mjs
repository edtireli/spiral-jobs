import {assert} from './core.mjs';

// Cooperative suspension preserves the live application and never replays a step.
export class ExecutionControl {
 constructor(id,onChange=()=>{}){this.id=id;this.status='active';this.onChange=onChange;this.waiters=[];}
 state(){return {id:this.id,status:this.status};}
 set(status){this.status=status;this.onChange(this.state());}
 pause(){if(this.status==='active')this.set('pausing');return this.state();}
 resume(){assert(['pausing','paused'].includes(this.status),'This run is not paused.',409);this.set('active');this.release();return this.state();}
 cancel(){if(this.status==='finished')return;this.set('stopping');this.release();}
 finish(){this.set('finished');this.release();}
 release(){for(const resolve of this.waiters.splice(0))resolve();}
 async checkpoint(){
  let waited=false;
  while(['pausing','paused'].includes(this.status)){
   waited=true;
   const wait=new Promise(resolve=>this.waiters.push(resolve));
   if(this.status==='pausing')this.set('paused');
   await wait;
  }
  assert(!['stopping','finished'].includes(this.status),'Application run stopped.',409);
  return waited;
 }
}
