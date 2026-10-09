#!/usr/bin/env node
// Research-only B090 harness. Does not modify the production reader.
import { registerHooks } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
registerHooks({resolve(s,c,n){try{return n(s,c)}catch(e){if(e.code==='ERR_MODULE_NOT_FOUND'&&s.startsWith('.'))return n(`${s}.ts`,c);throw e}}});
const {pageBlocksFromTextContent}=await import('../src/lib/pdfPageBlocks.ts');
const {pdfSectionCandidatesFromPages}=await import('../src/lib/pdfSectionCandidates.ts');
const {pdfEvidenceLedgerFromPages}=await import('../src/lib/evidenceLedger.ts');
const {createEvidencePassages}=await import('../src/lib/evidencePassages.ts');
const {createPassageRetrievalIndex,selectRankedPassagesForPurpose}=await import('../src/lib/retrievalIndex.ts');
const {createProgressiveEvidenceSession,appendProgressiveEvidenceStage,resolveProgressiveEvidenceAliases}=await import('../src/lib/evidencePacket.ts');
const {progressiveDetailedSectionMessages}=await import('../src/lib/detailedOverview.ts');
const [out,...paths]=process.argv.slice(2);
if(!out||!paths.length)throw Error('Usage: node --experimental-strip-types scripts/audit-overview-context.mjs OUTDIR PDF...');
await mkdir(out,{recursive:true});
for(const path of paths){
 const bytes=await readFile(path), version='sha256:'+createHash('sha256').update(bytes).digest('hex');
 const task=getDocument({data:new Uint8Array(bytes),standardFontDataUrl:resolve('node_modules/pdfjs-dist/standard_fonts')+'/'}), pdf=await task.promise;
 const pages=[];
 for(let i=0;i<pdf.numPages;i++)pages.push(pageBlocksFromTextContent(await (await pdf.getPage(i+1)).getTextContent(),i,version));
 const sections=pdfSectionCandidatesFromPages(pages,version), ledger=pdfEvidenceLedgerFromPages(pages,version,sections);
 const variants=[];
 for(const [targetChars,maxChars] of [[520,1500],[1200,3000]]){
  const collection=createEvidencePassages(ledger,{targetChars,maxChars,pages});
  const index=createPassageRetrievalIndex(collection), session=createProgressiveEvidenceSession(ledger,{maxExcerptChars:maxChars});
  const increments=[];
  for(const stage of ['problem_motivation','method']){
   const orderedPassages=selectRankedPassagesForPurpose(index,stage,{maxCandidates:24,maxCandidatesPerPage:2,includeAdjacent:true});
   const inc=appendProgressiveEvidenceStage(session,stage,{orderedPassages});
   const mapped=inc.sources.map(s=>({alias:s.alias,ids:resolveProgressiveEvidenceAliases(session,[s.alias],ledger,pages).map(x=>x.evidenceId)}));
   increments.push({increment:inc,mapped,messages:progressiveDetailedSectionMessages(stage,inc,[])});
  }
  const lengths=collection.passages.map(p=>p.text.length).sort((a,b)=>a-b);
  variants.push({targetChars,maxChars,passageCount:lengths.length,medianChars:lengths[Math.floor(lengths.length/2)],under200:lengths.filter(n=>n<200).length,allPassageChars:lengths.reduce((a,b)=>a+b,0),increments});
 }
 const result={path,version,pageCount:pages.length,sections:sections.map(s=>({title:s.title,page:s.pageIndex+1,quote:s.anchor.quote})),variants,pages:pages.map(p=>({page:p.pageIndex+1,blocks:p.blocks.map(b=>({id:b.blockId,text:b.normalizedText,x:b.rawTransform[4],y:b.rawTransform[5],width:b.rawWidth,height:b.rawHeight,eol:b.hasEol}))}))};
 const name=path.split('/').at(-1).replace(/\.pdf$/i,'');
 await writeFile(`${out}/${name}.json`,JSON.stringify(result));
 console.log(JSON.stringify({name,pageCount:pages.length,variants:variants.map(({increments,...v})=>({...v,sourceChars:increments.map(i=>i.increment.sources.reduce((s,x)=>s+x.excerpt.length,0)),sourceCounts:increments.map(i=>i.increment.sources.length)}))}));
 await task.destroy();
}
