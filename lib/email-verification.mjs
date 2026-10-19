import {verificationText} from './mail.mjs';
export function emailChallenge(observation,recipient,{recipientBound=false}={}){
 const {snapshot,controls}=observation,text=snapshot.text;
 if(!verificationText.test(text)||!/(?:sent|send|email|e-mail|inbox)/i.test(text))return null;
 const emails=text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)||[];
 const matches=emails.some(e=>e.toLowerCase()===recipient?.toLowerCase());
 const fieldMatch=controls.some(c=>c.type==='email'&&String(c.value).toLowerCase()===recipient?.toLowerCase());
 if(!matches&&!fieldMatch&&(!recipientBound||emails.length))return {blocked:true,kind:'email',reason:'The verification recipient could not be matched to your application email.'};
 const fields=controls.filter(c=>c.isField&&(c.otpGroup!==undefined||c.autocomplete==='one-time-code'||/security.?code|verification.?code|confirmation.?code|one.?time|\botp\b/i.test(c.label+' '+c.name)));
 if(!fields.length){
  if(/(?:verification|security|confirmation|one.?time) code/i.test(text))return {blocked:true,kind:'email',reason:'The verification code controls need manual completion.'};
  return {blocked:true,kind:'email_link',reason:'The site asks for email verification. Open the matching verification link in Gmail; the application will stay open.'};
 }
 const single=fields.length===1&&fields[0].maxLength!==1&&fields[0].otpGroup===undefined;
 const split=fields.length>=4&&fields.length<=12&&fields.every(f=>f.maxLength===1&&f.otpGroup!==undefined&&f.otpGroup===fields[0].otpGroup);
 const valid=single||split;
 return {blocked:!valid,kind:'email',keys:fields.map(f=>f.key),url:snapshot.url,reason:valid?'Email verification required.':'The verification code controls need manual completion.'};
}
export async function enterVerification(n,challenge,result,observe){
 await n.checkpoint();
 if(!result||!/^[A-Z0-9]{4,12}$/i.test(result.code))return false;
 const fresh=await observe(n.page),current=emailChallenge(fresh,n.profile.email,{recipientBound:n.verificationRecipient===n.profile.email});
 if(!current||current.blocked||fresh.snapshot.url!==challenge.url||JSON.stringify(current.keys)!==JSON.stringify(challenge.keys))return false;
 if(challenge.keys.length!==1&&challenge.keys.length!==result.code.length)return false;
 const expected=challenge.keys.map((key,i)=>({key,value:challenge.keys.length===1?result.code:result.code[i]}));
 if(expected.some(({key,value})=>{const field=fresh.controls.find(c=>c.key===key);return field.maxLength>0&&field.maxLength<value.length;}))return false;
 for(const key of challenge.keys){const t=[...fresh.targets.values()].find(t=>t.control.key===key);await t.locator.evaluate(el=>{el.style.webkitTextSecurity='disc';el.setAttribute('autocomplete','one-time-code');});}
 for(const [i,key]of challenge.keys.entries()){const t=[...fresh.targets.values()].find(t=>t.control.key===key);await n.beforeAction(t.locator);await t.locator.fill(challenge.keys.length===1?result.code:result.code[i]);}
 const complete=o=>{
  const c=emailChallenge(o,n.profile.email,{recipientBound:n.verificationRecipient===n.profile.email});
  return c&&!c.blocked&&o.snapshot.url===challenge.url&&JSON.stringify(c.keys)===JSON.stringify(challenge.keys)&&expected.every(({key,value})=>{const f=o.controls.find(f=>f.key===key);return f&&f.value===value&&!f.invalid;});
 };
 const after=await observe(n.page);if(!complete(after))return false;
 // A pre-submit email challenge may only confirm the code, never send the application.
 const confirmationButtons=o=>o.controls.filter(c=>!c.isField&&/^(verify(?: (?:code|email))?|confirm(?: (?:code|email))?|continue|submit(?: application)?)$/i.test(c.label)&&(n.finalClicked||!/submit/i.test(c.label)));
 const safe=confirmationButtons(after);
 if(safe.length!==1)return false;
 await n.checkDocuments();const target=after.targets.get(safe[0].target).locator;await n.beforeAction(target);
 const checked=await observe(n.page);if(!complete(checked))return false;
 const latest=confirmationButtons(checked);if(latest.length!==1||latest[0].key!==safe[0].key)return false;
 const confirmed=[...checked.targets.values()].find(t=>t.control.key===safe[0].key);if(!confirmed)return false;
 await confirmed.locator.click();
 n.onEvent('email_verification_entered',{});return true;
}
