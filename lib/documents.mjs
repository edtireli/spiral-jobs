import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {existsSync} from 'node:fs';
import {hash,assert} from './core.mjs';
const exec=promisify(execFile);
export function tex(s){return String(s??'').replace(/[\\{}$&#%_~^]/g,c=>({'\\':'\\textbackslash{}','{':'\\{','}':'\\}','$':'\\$','&':'\\&','#':'\\#','%':'\\%','_':'\\_','~':'\\textasciitilde{}','^':'\\textasciicircum{}'}[c])).replace(/[\u2011\u2013\u2014]/g,'-');}
function prose(s){return tex(s).replaceAll('/','/\\allowbreak{}');}
export const profiles={biomedical:'',ai:'',software:''};
function theme(profile,title){
 const dark=profile.documentTheme==='spiral';
 return `\\usepackage{fontspec}\\setsansfont{texgyreheros-regular.otf}[BoldFont=texgyreheros-bold.otf,ItalicFont=texgyreheros-italic.otf,BoldItalicFont=texgyreheros-bolditalic.otf]
\\usepackage{parskip}\\usepackage{xcolor}\\usepackage{tikz}\\usepackage{eso-pic}\\usepackage{hyperref}\\usepackage{fancyhdr}
\\renewcommand{\\familydefault}{\\sfdefault}
\\definecolor{paper}{HTML}{${dark?'000000':'FFFFFF'}}\\definecolor{ink}{HTML}{${dark?'EEEEEE':'111111'}}\\definecolor{muted}{HTML}{${dark?'ADADAD':'555555'}}
\\pagecolor{paper}\\color{ink}\\hypersetup{colorlinks=true,urlcolor=ink,linkcolor=ink,pdfauthor={${tex(profile.name)}},pdftitle={${tex(title)}}}
\\urlstyle{same}\\setlength{\\emergencystretch}{3em}\\setlength{\\parskip}{7pt}\\setlength{\\parindent}{0pt}
\\pagestyle{fancy}\\fancyhf{}\\renewcommand{\\headrulewidth}{0pt}\\renewcommand{\\footrulewidth}{0pt}
\\fancyfoot[L]{\\scriptsize\\color{muted}${tex(profile.name)}}\\fancyfoot[R]{\\scriptsize\\color{muted}\\thepage}
${dark?`\\AddToShipoutPictureBG{\\begin{tikzpicture}[remember picture,overlay]
\\foreach \\x in {0,...,52}{\\foreach \\y in {0,...,74}{
\\pgfmathsetmacro{\\shade}{4+4*(1+sin(\\x*13+\\y*9+18*sin(\\y*8)))}
\\fill[ink!\\shade!paper] ([xshift=\\x*4mm+1mm,yshift=-\\y*4mm-1mm]current page.north west) circle (.13mm);
}}\\end{tikzpicture}}`:''}
`;
}
function header(profile,title){return `{\\fontsize{34}{38}\\selectfont\\bfseries ${tex(profile.name)}}\\par\\vspace{1mm}
${profile.credentials?`{\\small\\color{muted}${tex(profile.credentials)}}\\par\n`:''}
\\vspace{1mm}{\\small\\color{muted}${tex([profile.location,profile.email,profile.phone].filter(Boolean).join(' · '))}}\\par
${profile.github?`{\\small\\color{muted}\\href{${tex(profile.github)}}{${tex(profile.github.replace(/^https?:\/\//,''))}}}\\par\n`:''}
\\vspace{4mm}{\\color{muted}\\hrule}\\vspace{6mm}
`;}
function base(profile,title){return `\\documentclass[11pt,a4paper]{article}
\\usepackage[a4paper,margin=24mm,footskip=12mm]{geometry}
${theme(profile,title)}\\begin{document}\n${header(profile,title)}`;}
function section(text){return `\\par\\vspace{3mm}{\\small\\ttfamily\\color{muted}${tex(text)}}\\par\\nopagebreak\n`;}
function factBlocks(profile){
 return (profile.facts||[]).filter(f=>f.id!=='home-address'&&!f.id.startsWith('extra-')&&!['employment-status','citizenship','eu-work-permission'].includes(f.id)).map(f=>{
  const lines=f.text.split('\n');
  if(lines.length>1&&/^[A-Z &/]+$/.test(lines[0]))return section(lines.shift())+prose(lines.join('\n')).replaceAll('\n','\\\\\n');
  return prose(f.text).replaceAll('\n','\\\\\n');
 }).join('\n\n');
}
function brandCustomCV(cv,profile){
 // Keep the factual body and its original row structure; change presentation only.
 const begin=cv.indexOf('\\begin{document}');
 let preamble=cv.slice(0,begin),body=cv.slice(begin+'\\begin{document}'.length);
 if(/\\begin\{center\}[\s\S]*?\\end\{center\}/.test(body))body=body.replace(/\\begin\{center\}[\s\S]*?\\end\{center\}/,header(profile,'Curriculum Vitae'));
 if(preamble.includes('\\newcommand{\\sectionheading}'))preamble+=`\n\\renewcommand{\\sectionheading}[1]{\\Needspace{5\\baselineskip}\\par\\vspace{3mm}{\\small\\ttfamily\\color{muted}#1}\\par\\vspace{1mm}}\n`;
 return preamble+'\n'+theme(profile,'Curriculum Vitae')+'\\begin{document}\n'+body;
}
function footer(profile,link){if(!link)return '';return `\n\\vfill\\vspace{8mm}\\noindent{\\small\\color{muted}\\href{${tex(link)}}{Local open-weights AI workflow · built by Edis Tireli · source \\& demo}${link.includes('/r/')?' (visit analytics)':''}.}\\par\n`;}
export function documentSources({profile,job,summary,coverLetter,projectLink,customCV}){
 let cv=customCV;
 if(cv&&profile.documentTheme==='spiral')cv=brandCustomCV(cv,profile);
 if(cv){
  cv=cv.replace(/(\\noindent\\textbf\{\\MakeUppercase\{Profile\}\}\\par\\vspace\{0.05cm\}\n)[\s\S]*?(\n\n\\sectionheading)/,(_,a,b)=>a+prose(summary||profile.profile)+b);
  if(projectLink){
   const packages=(/\\(?:usepackage|RequirePackage)(?:\[[^\]]*\])?\{[^}]*\bxcolor\b/.test(cv)?'':'\\usepackage{xcolor}\n')+(/\\(?:usepackage|RequirePackage)(?:\[[^\]]*\])?\{[^}]*\bhyperref\b/.test(cv)?'':'\\usepackage{hyperref}\n');
   cv=cv.replace('\\begin{document}',packages+'\\begin{document}');
   const note=`\n\\par\\vspace{5mm}\\noindent{\\small\\color{gray}\\href{${tex(projectLink)}}{Local open-weights AI workflow · built by Edis Tireli · source \\& demo}${projectLink.includes('/r/')?' (visit analytics)':''}.}\\par\n`;
   cv=cv.replace(/\\end\{document\}\s*$/,note+'\\end{document}');
  }
 }
 else cv=base(profile,'Curriculum Vitae')+prose(summary||profile.profile)+'\\par\n\\vspace{3mm}\n'+factBlocks(profile)+footer(profile,projectLink)+'\\end{document}';
 const letter=base(profile,'Application')+`{\\fontsize{18}{23}\\selectfont\\bfseries ${tex(job.title)}}\\par\\vspace{1mm}{\\small\\color{muted}${tex(job.company)}}\\par\\vspace{8mm}\n`+String(coverLetter||'').split(/\n\s*\n/).map(p=>prose(p.trim())).join('\n\n')+`\n\\par\\vspace{5mm}Kind regards,\\\\${tex(profile.name)}\n`+footer(profile,projectLink)+'\\end{document}';
 return {cv,letter};
}
export async function renderDocuments({root,dataDir,dir,job,profile,summary,coverLetter,includeLetter,projectLink}){
 await mkdir(dir,{recursive:true});
 const customCV=await readFile(path.join(dataDir||root,'cv-template.tex'),'utf8').catch(()=>null);
 const source=documentSources({profile,job,summary,coverLetter,projectLink,customCV});
 const files=[['CV',source.cv],...(includeLetter?[['Application',source.letter]]:[])];
 const bundled=path.resolve(root,'../bin/tectonic'),engine=process.env.SPIRAL_JOBS_TECTONIC||(existsSync(bundled)?bundled:'tectonic');
 for(const [name,content]of files){
  await writeFile(path.join(dir,name+'.tex'),content,{mode:0o600});
  try{await exec(engine,['--untrusted','--keep-logs','--outdir',dir,path.join(dir,name+'.tex')],{cwd:dir,timeout:180000,maxBuffer:3e6});}
  catch(e){throw new Error(e.code==='ENOENT'?'Install Tectonic to generate PDFs, or use the packaged Mac app.':`${name} could not compile. Review its LaTeX source and log.`);}
  const log=await readFile(path.join(dir,name+'.log'),'utf8');assert(!/Overfull \\[hv]box/.test(log),`${name} has overflowing text. Shorten the draft and render again.`);
 }
 const artifacts={cv:path.join(dir,'CV.pdf'),letter:includeLetter?path.join(dir,'Application.pdf'):null};
 return {...artifacts,hashes:{cv:hash(await readFile(artifacts.cv)),letter:artifacts.letter?hash(await readFile(artifacts.letter)):null}};
}
