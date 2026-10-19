import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {existsSync} from 'node:fs';
import {hash,assert} from './core.mjs';
const exec=promisify(execFile);
export function tex(s){return String(s??'').replace(/[\\{}$&#%_~^]/g,c=>({'\\':'\\textbackslash{}','{':'\\{','}':'\\}','$':'\\$','&':'\\&','#':'\\#','%':'\\%','_':'\\_','~':'\\textasciitilde{}','^':'\\textasciicircum{}'}[c])).replace(/[\u2011\u2013\u2014]/g,'-');}
export const profiles={biomedical:'',ai:'',software:''};
function base(profile,title){
 const dark=profile.documentTheme==='spiral';
 return `\\documentclass[11pt,a4paper]{article}
\\usepackage[a4paper,margin=24mm]{geometry}
\\usepackage{fontspec}\\setsansfont{lmsans10-regular.otf}[BoldFont=lmsans10-bold.otf,ItalicFont=lmsans10-oblique.otf,BoldItalicFont=lmsans10-boldoblique.otf]\\usepackage{parskip}\\usepackage{xcolor}\\usepackage{tikz}\\usepackage{eso-pic}\\usepackage{hyperref}
\\renewcommand{\\familydefault}{\\sfdefault}
\\definecolor{paper}{HTML}{${dark?'080808':'FFFFFF'}}\\definecolor{ink}{HTML}{${dark?'F2F2F2':'111111'}}\\definecolor{muted}{HTML}{${dark?'AAAAAA':'555555'}}
\\pagecolor{paper}\\color{ink}\\hypersetup{colorlinks=true,urlcolor=ink,pdfauthor={${tex(profile.name)}},pdftitle={${tex(title)}}}
\\setlength{\\emergencystretch}{3em}\\setlength{\\parskip}{8pt}\\pagestyle{empty}
\\AddToShipoutPictureBG{\\begin{tikzpicture}[remember picture,overlay]\\foreach \\r in {1,...,12}{\\draw[ink!4!paper,line width=.3pt] ([xshift=-10mm,yshift=-10mm]current page.north east) circle (\\r*8mm);}\\end{tikzpicture}}
\\begin{document}
{\\fontsize{29}{32}\\selectfont ${tex(profile.name)}}\\par
{\\small\\color{muted}${tex([profile.email,profile.phone,profile.location].filter(Boolean).join(' | '))}}\\par
\\vspace{2mm}\\hrule\\vspace{6mm}
`;
}
function footer(profile,link){if(!link)return '';return `\n\\vfill\\vspace{8mm}\\noindent\\colorbox{paper!88!ink}{\\parbox{\\dimexpr\\linewidth-2\\fboxsep\\relax}{\\small\\color{muted}${tex(profile.projectFooterText||'Prepared using Spiral Jobs, a local AI application pipeline.')} \\href{${tex(link)}}{Source \\& demo}${link.includes('/r/')?' · visit analytics':''}.}}\n`;}
export function documentSources({profile,job,summary,coverLetter,projectLink,customCV}){
 let cv=customCV;
 if(cv){
  cv=cv.replace(/(\\noindent\\textbf\{\\MakeUppercase\{Profile\}\}\\par\\vspace\{0.05cm\}\n)[\s\S]*?(\n\n\\sectionheading)/,(_,a,b)=>a+tex(summary||profile.profile)+b);
  if(projectLink){
   const packages=(/\\(?:usepackage|RequirePackage)(?:\[[^\]]*\])?\{[^}]*\bxcolor\b/.test(cv)?'':'\\usepackage{xcolor}\n')+(/\\(?:usepackage|RequirePackage)(?:\[[^\]]*\])?\{[^}]*\bhyperref\b/.test(cv)?'':'\\usepackage{hyperref}\n');
   cv=cv.replace('\\begin{document}',packages+'\\begin{document}');
   const note=`\n\\par\\vspace{5mm}\\noindent{\\small\\color{gray}${tex(profile.projectFooterText||'Prepared using Spiral Jobs, a local AI application pipeline.')} \\href{${tex(projectLink)}}{Source \\& demo}${projectLink.includes('/r/')?' (visit analytics)':''}.}\\par\n`;
   cv=cv.replace(/\\end\{document\}\s*$/,note+'\\end{document}');
  }
 }
 else cv=base(profile,'Curriculum Vitae')+`{\\small\\color{muted}CURRICULUM VITAE}\\par\n${tex(summary||profile.profile)}\\par\n\\vspace{3mm}\n`+(profile.facts||[]).filter(f=>f.id!=='home-address').map(f=>tex(f.text).replaceAll('\n','\\\\\n')).join('\n\n\\vspace{2mm}\n')+footer(profile,projectLink)+'\\end{document}';
 const letter=base(profile,'Application')+`{\\small\\color{muted}APPLICATION}\\par\n{\\Large ${tex(job.title)}}\\par ${tex(job.company)}\\par\\vspace{7mm}\n`+String(coverLetter||'').split(/\n\s*\n/).map(p=>tex(p.trim())).join('\n\n')+`\n\\par\\vspace{5mm}Kind regards,\\\\${tex(profile.name)}\n`+footer(profile,projectLink)+'\\end{document}';
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
