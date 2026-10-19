// The next application action stays visible above every preview.
export function applicationAction(job,busy=false,automatic=false){
 const n=job.navigation,d=job.draft;
 automatic=automatic&&!['review','final'].includes(n?.approvalMode);
 if(busy)return {action:'wait',label:'Working…',disabled:true,hint:'Watch progress in live.'};
 if(['submitted','uncertain'].includes(n?.status))return {action:'live',label:n.status==='submitted'?'View confirmation':'Check submission',hint:'Saved in application history. Repeat applications are blocked.'};
 if(n?.status==='verification')return {action:'live',label:'Complete email verification',hint:'Continue in the original browser. A second application will not be sent.'};
 if(job.blocked&&(!n?.exposed||n.status==='stopped'))return {action:'blocked',label:'Already applied',disabled:true,hint:'This employer is in your application history.'};
 if(n?.status==='skipped')return {action:automatic?'auto-apply':'prepare',label:automatic?'Retry automatically':'Prepare application',disabled:!!job.blocked,hint:n.message};
 if(n?.status==='final_review')return {action:'live',label:'Review & submit application',hint:'The form is filled. Your final approval sends it.'};
 if(['needs_answer','human','needs_document','document_review'].includes(n?.status))return {action:'live',label:{needs_answer:'Answer & continue',human:'Continue application',needs_document:'Prepare required letter',document_review:'Review required letter'}[n.status],hint:n.message};
 if(automatic&&!job.blocked)return {action:'auto-apply',label:'Auto apply to this job',hint:'Choose review, final approval or full auto.'};
 if(n?.status==='paused')return {action:'resume-navigation',label:'Resume application',hint:n.message};
 if(n?.status==='review'&&n.phase==='inspect'){
  if(d?.snapshot.navigation)return {action:'approve',label:'Approve & fill application',hint:'Review your CV and answers. Approval starts filling and uploads.'};
  return {action:'draft',label:'Prepare application',hint:'The form is open. Prepare your documents for review.'};
 }
 if(n&&['opening','running','submitting'].includes(n.status))return {action:'wait',label:'Working…',disabled:true,hint:n.message};
 return {action:'prepare',label:'Prepare application',hint:'Opens the form and prepares your CV. Nothing is sent before approval.'};
}
