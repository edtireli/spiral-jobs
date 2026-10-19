const base={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'"};
const tokenOK=s=>/^[a-f0-9]{48}$/.test(s||'');
const reply=(body,status=200,extra={})=>new Response(body,{status,headers:{...base,...extra}});
const json=(body,status=200)=>reply(JSON.stringify(body),status,{'Content-Type':'application/json'});
async function authorized(request,secret){
 if(!secret||!/^[a-f0-9]{64}$/.test(secret))return false;
 const supplied=request.headers.get('Authorization')||'';if(supplied.length>200)return false;
 const hash=s=>crypto.subtle.digest('SHA-256',new TextEncoder().encode(s));
 const [a,b]=await Promise.all([hash(supplied),hash('Bearer '+secret)]);let different=0;const x=new Uint8Array(a),y=new Uint8Array(b);for(let i=0;i<x.length;i++)different|=x[i]^y[i];return different===0;
}
export default {
 async fetch(request,env,ctx){
  try{
   const url=new URL(request.url),p=url.pathname;
   if(url.search||p.length>150)return reply('Not found',404);
   if(p==='/privacy'&&request.method==='GET')return reply('Spiral Jobs link analytics: this link records its random application ID, visit time, IP address and browser user-agent for up to 30 days. It uses no cookies. Logs are visible only to the applicant. Automated email scanners may also open links. An IP address does not identify an individual recruiter.',200,{'Content-Type':'text/plain; charset=utf-8'});
   const match=p.match(/^\/r\/([a-f0-9]{48})$/);
   if(match&&['GET','HEAD'].includes(request.method)){
    if(!await env.LINKS.get('link:'+match[1]))return reply('Not found',404);
    const destination=env.DESTINATION||'https://github.com/edtireli/spiral-jobs';
    if(!/^https:\/\/(?:github\.com|[a-z0-9-]+\.github\.io)\/[\w./-]+$/.test(destination))return reply('Unavailable',503);
    if(request.method==='GET'){
     const ua=(request.headers.get('User-Agent')||'').slice(0,350),time=new Date().toISOString();
     const event={time,ip:(request.headers.get('CF-Connecting-IP')||'').slice(0,45),userAgent:ua,classification:/bot|crawler|spider|scanner|proofpoint|mimecast|barracuda|safelinks|headless/i.test(ua)?'likely automated':'unclassified'};
     ctx.waitUntil(env.LINKS.put('visit:'+match[1]+':'+time+':'+crypto.randomUUID(),JSON.stringify(event),{expirationTtl:2592000}).catch(()=>{}));
    }
    return reply(null,302,{Location:destination,Link:`<${url.origin}/privacy>; rel="privacy-policy"`});
   }
   if(!p.startsWith('/api/')||!await authorized(request,env.ADMIN_KEY))return reply('Not found',404);
   if(p==='/api/status'&&request.method==='GET')return json({service:'spiral-jobs-tracking'});
   if(p==='/api/links'&&request.method==='POST'){
    if(Number(request.headers.get('Content-Length')||0)>512)return reply('Too large',413);
    const reader=request.body?.getReader();let raw='',length=0;while(reader){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>512){await reader.cancel();return reply('Too large',413);}raw+=new TextDecoder().decode(value);}
    const data=JSON.parse(raw);if(!tokenOK(data.token)||Object.keys(data).length!==1)return reply('Invalid link',400);
    await env.LINKS.put('link:'+data.token,'1');return json({ok:true});
   }
   const visits=p.match(/^\/api\/visits\/([a-f0-9]{48})$/);
   if(visits&&request.method==='GET'){
    const keys=await env.LINKS.list({prefix:'visit:'+visits[1]+':',limit:200});
    const values=await Promise.all(keys.keys.map(k=>env.LINKS.get(k.name,'json')));
    return json({visits:values.filter(Boolean).reverse(),truncated:!keys.list_complete});
   }
   return reply('Not found',404);
  }catch{return reply('Unavailable',503);}
 }
};
