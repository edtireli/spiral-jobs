// A closed shadow root keeps control UI out of employer field/text extraction.
function paint({status,activity,cursor}){
 if(window!==window.top)return;
 let host=document.querySelector('[data-spiral-control]');
 if(!host){
  host=document.createElement('div');host.setAttribute('data-spiral-control','');
  host.style.cssText='all:initial;position:fixed;inset:0;pointer-events:none;z-index:2147483647';
  const root=host.attachShadow({mode:'closed'});
  root.innerHTML=`<style>
   :host{--red:#ed7c72}*{box-sizing:border-box}.frame{position:fixed;inset:5px;border:1.5px solid #e7696280;border-radius:12px;box-shadow:inset 0 0 28px #e7696212;pointer-events:none}
   .badge{position:fixed;top:12px;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:9px;border:1px solid #e7696266;border-radius:30px;padding:9px 13px;background:#160d0cf5;color:#e9948d;font:11px ui-monospace,monospace;white-space:nowrap;max-width:85vw}
   .dot{width:5px;height:5px;border-radius:50%;background:var(--red);flex-shrink:0}.activity{font-size:10px;color:#b1918e;max-width:40vw;overflow:hidden;text-overflow:ellipsis}.pointer{position:fixed;top:0;left:0;width:23px;height:29px;filter:drop-shadow(0 2px 2px #0008)}.pointer span{position:absolute;top:25px;left:18px;padding:3px 6px;border-radius:4px;background:#3b1c19;border:1px solid #e7696266;color:#ffb1a8;font:9px ui-monospace,monospace}.paused .frame{opacity:.4}[hidden]{display:none!important}
   </style><div class="frame"></div><div class="badge"><i class="dot"></i><strong></strong><span class="activity"></span></div><div class="pointer" hidden><svg width="23" height="29" viewBox="0 0 23 29"><path d="M2 1L2 23L8 17L13 27L17 25L12 15L21 15Z" fill="#ed7c72" stroke="#2c1110" stroke-width="1.5"/></svg><span>AI</span></div>`;
  host.applyControl=data=>{
   host.hidden=!['active','pausing','paused','stopping'].includes(data.status);host.style.display=host.hidden?'none':'block';host.dataset.controlStatus=data.status;
   root.querySelector('.badge strong').textContent={active:'AI in control',pausing:'Pausing…',paused:'AI paused',stopping:'Stopping…'}[data.status]||'';
   root.querySelector('.activity').textContent=data.status==='pausing'?'Finishing the current step':data.status==='paused'?'Resume in Spiral Jobs':data.activity||'';
   root.querySelector('.frame').style.opacity=data.status==='paused'?'.4':'1';
   const pointer=root.querySelector('.pointer');pointer.hidden=!data.cursor;
   if(data.cursor)pointer.style.transform=`translate(${data.cursor.x}px,${data.cursor.y}px)`;
  };
  document.documentElement.append(host);
 }
 host.applyControl?.({status,activity,cursor});
}
export async function paintBrowserControl(page,state){if(!page||page.isClosed())return;await page.evaluate(paint,state).catch(()=>{});}
