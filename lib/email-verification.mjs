import {verificationText} from './mail.mjs';
export function emailChallenge(observation,recipient,{recipientBound=false}={}){
 const {snapshot,controls}=observation,text=snapshot.text;
 if(!verificationText.test(text)||!/(?:sent|send|email|e-mail|inbox)/i.test(text))return null;
 const emails=text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)||[];
 const matches=emails.some(e=>e.toLowerCase()===recipient?.toLowerCase());
 const fieldMatch=controls.some(c=>c.type==='email'&&String(c.value).toLowerCase()===recipient?.toLowerCase());
 if(!matches&&!fieldMatch&&(!recipientBound||emails.length))return {blocked:true,kind:'email',reason:'The verification recipient could not be matched to your application email.'};
 const fields=controls.filter(c=>c.isField&&(c.autocomplete==='one-time-code'||/security.?code|verification.?code|confirmation.?code|one.?time|\botp\b/i.test(c.label+' '+c.name)));
 if(!fields.length)return {blocked:true,kind:'email_link',reason:'The site asks for email verification. Open the matching verification link in Gmail; the application will stay open.'};
 const valid=fields.length===1||([4,5,6,7,8,9,10,11,12].includes(fields.length)&&fields.every(f=>f.maxLength===1));
 return {blocked:!valid,kind:'email',keys:fields.map(f=>f.key),url:snapshot.url,reason:valid?'Email verification required.':'The verification code controls need manual completion.'};
}
export async function enterVerification(n,challenge,result,observe){
 await n.checkpoint();
 if(!result||!/^[A-Z0-9]{4,12}$/i.test(result.code)||!/[0-9]/.test(result.code))return false;
 const fresh=await observe(n.page),current=emailChallenge(fresh,n.profile.email,{recipientBound:n.verificationRecipient===n.profile.email});
 if(!current||current.blocked||fresh.snapshot.url!==challenge.url||JSON.stringify(current.keys)!==JSON.stringify(challenge.keys))return false;
 if(challenge.keys.length!==1&&challenge.keys.length!==result.code.length)return false;
 for(const key of challenge.keys){const t=[...fresh.targets.values()].find(t=>t.control.key===key);await t.locator.evaluate(el=>{el.style.webkitTextSecurity='disc';el.setAttribute('autocomplete','one-time-code');});}
 for(const [i,key]of challenge.keys.entries()){const t=[...fresh.targets.values()].find(t=>t.control.key===key);await n.beforeAction(t.locator);await t.locator.fill(challenge.keys.length===1?result.code:result.code[i]);}
 const after=await observe(n.page),buttons=after.controls.filter(c=>!c.isField&&/^(verify(?: (?:code|email))?|confirm(?: (?:code|email))?|continue|submit(?: application)?)$/i.test(c.label));
 // A pre-submit email challenge may only confirm the code, never send the application.
 const safe=buttons.filter(c=>n.finalClicked||!/submit/i.test(c.label));
 if(safe.length!==1)return false;
 await n.checkDocuments();const target=after.targets.get(safe[0].target).locator;await n.beforeAction(target);await target.click();
 n.onEvent('email_verification_entered',{});return true;
}
