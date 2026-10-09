#!/usr/bin/env node
// Offline production extraction/selection audit. Never invokes a model or network API.
import { registerHooks } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, basename } from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
registerHooks({ resolve(s,c,n) { try{return n(s,c);}catch(e){if(e.code==='ERR_MODULE_NOT_FOUND'&&s.startsWith('.'))return n(`${s}.ts`,c);throw e;} } });
const { pageBlocksFromTextContent }=await import('../src/lib/pdfPageBlocks.ts');
const { pdfSectionCandidatesFromPages }=await import('../src/lib/pdfSectionCandidates.ts');
const { pdfEvidenceLedgerFromPages,locateEvidenceCandidate }=await import('../src/lib/evidenceLedger.ts');
const { createDetailedEvidenceLedger,createStructuredPaper }=await import('../src/lib/structuredPaper.ts');
const { selectDetailedContext,estimateTextTokens,DETAILED_CONTEXT_SELECTION_VERSION }=await import('../src/lib/detailedContext.ts');
const [out,...paths]=process.argv.slice(2);
if(!out||!paths.length)throw Error('Usage: node --experimental-strip-types scripts/replay-detailed-selection.mjs OUTDIR PDF...');
await mkdir(out,{recursive:true});const summary=[];
for(const path of paths){
 const name=basename(path).replace(/\.pdf$/i,''),bytes=await readFile(path),documentVersion='sha256:'+createHash('sha256').update(bytes).digest('hex');
 const task=getDocument({data:new Uint8Array(bytes),standardFontDataUrl:resolve('node_modules/pdfjs-dist/standard_fonts')+'/'});
 try{
  const pdf=await task.promise,pages=[];
  for(let i=0;i<pdf.numPages;i++)pages.push(pageBlocksFromTextContent(await(await pdf.getPage(i+1)).getTextContent(),i,documentVersion));
  const body=pdfEvidenceLedgerFromPages(pages,documentVersion,pdfSectionCandidatesFromPages(pages,documentVersion));
  const ledger=createDetailedEvidenceLedger(body,pages),paper=createStructuredPaper(ledger,pages);
  let baseline;try{baseline=JSON.parse(await readFile(`docs/implementation/evaluations/B094/final-method-v17/${name}/input.json`,'utf8'));}catch{}
  const selections=['problem_motivation','method','contributions_novelty','experiments_ablations','limitations'].map(id=>{
   const selected=selectDetailedContext(paper,id),prior=baseline?.selections.find(s=>s.id===id);
   const chars=selected.paragraphs.reduce((n,p)=>n+p.text.length,0);
   const invalidMembers=selected.paragraphs.flatMap(p=>p.members).filter(m=>{const l=locateEvidenceCandidate(m.candidate,pages);return !l?.anchor||l.qualityWarnings.includes('quote-fallback-used');}).length;
   return{id,chars,estimatedTextTokens:selected.paragraphs.reduce((n,p)=>n+estimateTextTokens(p.text),0),paragraphCount:selected.paragraphs.length,invalidMembers,baselineChars:prior?.chars,reduction:prior?.chars?1-chars/prior.chars:undefined,sections:selected.sections.map(s=>({id:s.sectionId,title:s.title,role:s.role})),warnings:selected.warnings,paragraphs:selected.paragraphs};
  });
  await writeFile(`${out}/${name}-selection.json`,JSON.stringify({name,path,documentVersion,selectionVersion:DETAILED_CONTEXT_SELECTION_VERSION,selections},null,2));
  const row={name,selections:selections.map(({paragraphs,...s})=>s)};summary.push(row);console.log(JSON.stringify({name,selections:row.selections.map(({id,chars,baselineChars,invalidMembers})=>({id,chars,baselineChars,invalidMembers}))}));
 }finally{await task.destroy();}
}
await writeFile(`${out}/selection-summary.json`,JSON.stringify(summary,null,2));
