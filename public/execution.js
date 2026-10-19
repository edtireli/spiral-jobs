export function executionView(control){
 if(!control||control.status==='finished')return {visible:false};
 const status=control.status;
 return {visible:true,status,title:{active:'AI in control',pausing:'Pausing…',paused:'AI paused',stopping:'Stopping…',disconnected:'Connection lost'}[status]||'AI in control',
  detail:{pausing:'Finishing the current step',paused:'Browser kept open',stopping:'Ending this run',disconnected:'Reconnect to control this run'}[status]||control.label||'Working',
  button:status==='paused'?'Resume AI':'Pause AI',disabled:status!=='active'&&status!=='paused',action:status==='paused'?'resume':'pause'};
}
let watchingDialogs=false;
function placeControls(){
 const bar=document.querySelector('#aiControlBar'),parent=[...document.querySelectorAll('dialog[open]')].at(-1)||document.body;
 if(bar.parentElement!==parent)parent.append(bar);
}
export function renderExecution(control){
 const view=executionView(control),$=s=>document.querySelector(s);
 if(!watchingDialogs){watchingDialogs=true;const observer=new MutationObserver(placeControls);for(const dialog of document.querySelectorAll('dialog'))observer.observe(dialog,{attributes:true,attributeFilter:['open']});}
 placeControls();
 document.body.dataset.aiControl=view.visible?view.status:'idle';
 $('#aiControlBar').hidden=!view.visible;
 if(!view.visible)return;
 $('#aiControlTitle').textContent=view.title;$('#aiControlActivity').textContent=view.detail;
 $('#aiControlActivity').title=view.detail;
 const button=$('#pauseAI');button.textContent=view.button;button.disabled=view.disabled;button.dataset.action=view.action;
}
