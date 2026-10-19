export function emailChallenge(observation,recipient){
 const {snapshot,controls}=observation,text=snapshot.text;
 if(!/(?:verification|security|one.time) code/i.test(text)||!/(?:sent|send|email|e-mail|inbox)/i.test(text))return null;
 const emails=text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)||[];
 if(!emails.some(e=>e.toLowerCase()===recipient?.toLowerCase()))return {blocked:true,reason:'The verification recipient could not be matched to your application email.'};
 const fields=controls.filter(c=>c.isField&&(c.autocomplete==='one-time-code'||/security.?code|verification.?code|one.?time|\botp\b/i.test(c.label+' '+c.name)));
 if(!fields.length)return {blocked:true,reason:'Email verification detected. Complete the code in the open browser.'};
 const valid=fields.length===1||([6,8].includes(fields.length)&&fields.every(f=>f.maxLength===1));
 return {blocked:!valid,keys:fields.map(f=>f.key),url:snapshot.url,reason:valid?'Email verification required.':'The verification code controls need manual completion.'};
}
export async function enterVerification(n,challenge,result,observe){
 await n.checkpoint();
 if(!result||!/^[A-Z0-9]{6,8}$/.test(result.code))return false;
 const fresh=await observe(n.page),current=emailChallenge(fresh,n.profile.email);
 if(!current||current.blocked||fresh.snapshot.url!==challenge.url||JSON.stringify(current.keys)!==JSON.stringify(challenge.keys))return false;
 if(challenge.keys.length!==1&&challenge.keys.length!==result.code.length)return false;
 // Codes stay out of model prompts, state, logs and screenshots. Recording is
 // protected by masking the inputs before browser typing (CSS remains on the fields).
 for(const key of challenge.keys){const t=[...fresh.targets.values()].find(t=>t.control.key===key);await t.locator.evaluate(el=>{el.style.webkitTextSecurity='disc';el.setAttribute('autocomplete','one-time-code');});}
 for(const [i,key]of challenge.keys.entries()){const t=[...fresh.targets.values()].find(t=>t.control.key===key);await n.beforeAction(t.locator);await t.locator.fill(challenge.keys.length===1?result.code:result.code[i]);}
 const after=await observe(n.page),buttons=after.controls.filter(c=>!c.isField&&/^(verify(?: (?:code|email))?|confirm(?: (?:code|email))?|continue|submit(?: application)?)$/i.test(c.label));
 if(buttons.length===1){const target=after.targets.get(buttons[0].target).locator;await n.beforeAction(target);await target.click();}
 n.onEvent('email_verification_entered',{});return true;
}
