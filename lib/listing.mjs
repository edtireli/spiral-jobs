import path from 'node:path';
import {mkdir,writeFile,rename} from 'node:fs/promises';
import {now} from './core.mjs';

// Read the rendered page by scrolling, including lazy content and large inner panes.
// Screenshots stay separate so a long listing is not shrunk into one unreadable image.
export async function readListing(page,{dir,onProgress=()=>{},signal,maxSections=36}={}){
 await mkdir(dir,{recursive:true});
 const sections=[],lines=new Set(),restores=[];let complete=true,textLength=0;
 const addText=text=>{for(const line of text.split('\n').map(s=>s.trim()).filter(Boolean))if(!lines.has(line)){if(textLength+line.length>180000){complete=false;break;}lines.add(line);textLength+=line.length+1;}};
 const url=page.url();
 try{
  for(const frame of page.frames()){
   if(signal?.aborted)throw new Error('Listing reading stopped.');
   if(/captcha|challenges\.cloudflare|doubleclick/i.test(frame.url()))continue;
   if(frame!==page.mainFrame()){
    const element=await frame.frameElement(),box=await element.boundingBox();
    if(!box||box.width<300||box.height<180)continue;
    await element.scrollIntoViewIfNeeded();
   }
   const root=await frame.evaluateHandle(()=>document.scrollingElement);
   const candidates=frame.locator('main,article,section,div');
   const indexes=await candidates.evaluateAll(elements=>elements.flatMap((e,i)=>{
    const r=e.getBoundingClientRect(),style=getComputedStyle(e);
    return r.width>=300&&r.height>=180&&e.scrollHeight>e.clientHeight+80&&/(auto|scroll)/.test(style.overflowY)?[i]:[];
   }));
   if(indexes.length>8)complete=false;
   const targets=[root.asElement(),...await Promise.all(indexes.slice(0,8).map(i=>candidates.nth(i).elementHandle()))].filter(Boolean);
   for(const target of targets){
    if(sections.length>=maxSections){complete=false;break;}
    const original=await target.evaluate(e=>e.scrollTop);restores.push({target,original});
    if(target!==targets[0])await target.scrollIntoViewIfNeeded();
    await target.evaluate(e=>e.scrollTo({top:0,behavior:'instant'}));
    let previous=-1,reachedBottom=false;
    while(sections.length<maxSections){
     if(signal?.aborted)throw new Error('Listing reading stopped.');
     await page.waitForTimeout(250);
     const position=await target.evaluate(e=>({top:Math.round(e.scrollTop),height:e.clientHeight,total:e.scrollHeight}));
     if(position.top===previous){complete=false;break;}
     previous=position.top;
     const content=await frame.evaluate(()=>{
      const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT),visible=[];
      while(walker.nextNode()){
       const node=walker.currentNode;if(!node.textContent.trim()||node.parentElement?.closest('script,style,noscript'))continue;
       const range=document.createRange();range.selectNodeContents(node);
       if([...range.getClientRects()].some(r=>r.width&&r.height&&r.top<innerHeight&&r.bottom>0&&r.left<innerWidth&&r.right>0))visible.push(node.textContent.trim());
      }
      return {full:document.body?.innerText||'',visible:visible.join('\n')};
     });
     addText(content.full);
     const image=`listing-${String(sections.length+1).padStart(2,'0')}.jpg`;
     const bytes=await page.screenshot({type:'jpeg',quality:70,timeout:10000});
     await writeFile(path.join(dir,image),bytes);
     await writeFile(path.join(dir,'live.listing.tmp.jpg'),bytes);await rename(path.join(dir,'live.listing.tmp.jpg'),path.join(dir,'live.jpg'));
     sections.push({image,text:content.visible,url:frame.url(),top:position.top});
     onProgress({message:`Reading listing · section ${sections.length}`,sections:[...sections],complete:false});
     // Re-measure after scroll handlers have loaded additional content.
     const size=await target.evaluate(e=>({top:e.scrollTop,height:e.clientHeight,total:e.scrollHeight}));
     if(size.top+size.height>=size.total-2){reachedBottom=true;break;}
     const next=Math.min(size.top+Math.max(160,Math.floor(size.height*.8)),size.total-size.height);
     await target.evaluate((e,top)=>e.scrollTo({top,behavior:'instant'}),next);
    }
    if(!reachedBottom)complete=false;
   }
  }
 }finally{
  for(const {target,original} of restores.reverse()){await target.evaluate((e,top)=>e.scrollTo({top,behavior:'instant'}),original).catch(()=>{});await target.dispose().catch(()=>{});}
 }
 return {url,sections,text:[...lines].join('\n'),complete,capturedAt:now()};
}
