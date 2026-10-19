import http from 'node:http';
import path from 'node:path';
import {readFile} from 'node:fs/promises';
const root=path.resolve(import.meta.dirname,'../docs');
http.createServer(async(req,res)=>{const name=new URL(req.url,'http://localhost').pathname;const allowed=['/','/index.html','/demo.css','/desk.css','/demo.js','/background.js','/demo.mp4','/poster.png'];if(!allowed.includes(name)){res.writeHead(404);return res.end();}try{const file=name==='/'?'/index.html':name;res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.mp4')?'video/mp4':file.endsWith('.png')?'image/png':'text/html');res.end(await readFile(path.join(root,file)));}catch{res.writeHead(404);res.end();}}).listen(Number(process.env.PORT||4329),'127.0.0.1',()=>console.log('Fictional demo: http://127.0.0.1:'+(process.env.PORT||4329)));
