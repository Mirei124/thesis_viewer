#!/usr/bin/env node
// Production detailed-overview evaluation. Never logs credentials or request headers.
import { registerHooks } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, basename } from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
registerHooks({ resolve(s,c,n) { try { return n(s,c); } catch(e) { if(e.code==='ERR_MODULE_NOT_FOUND'&&s.startsWith('.')) return n(`${s}.ts`,c); throw e; } } });
const { pageBlocksFromTextContent } = await import('../src/lib/pdfPageBlocks.ts');
const { pdfSectionCandidatesFromPages } = await import('../src/lib/pdfSectionCandidates.ts');
const { pdfEvidenceLedgerFromPages, locateEvidenceCandidate } = await import('../src/lib/evidenceLedger.ts');
const { createDetailedEvidenceLedger, createStructuredPaper } = await import('../src/lib/structuredPaper.ts');
const { selectDetailedContext, estimateTextTokens } = await import('../src/lib/detailedContext.ts');
const { DETAILED_SECTION_IDS } = await import('../src/lib/detailedOverview.ts');
const { generateDetailedOverview } = await import('../src/lib/detailedOverviewPipeline.ts');
const { requestCompatibleCompletion } = await import('../src/lib/compatibleProvider.ts');
const args=process.argv.slice(2), dryRun=args.includes('--dry-run'), methodOnly=args.includes('--method-only'), semanticReview=args.includes('--semantic-review');
const positional=args.filter(a=>!['--dry-run','--method-only','--semantic-review'].includes(a));
const [out,...paths]=positional;
if(!out||!paths.length) throw Error('Usage: node --experimental-strip-types scripts/evaluate-detailed-pipeline.mjs [--dry-run] [--method-only] [--semantic-review] OUT PDF...');
if(!dryRun&&!process.env.DS_API_KEY) throw Error('DS_API_KEY is required for live evaluation.');
const config={ baseUrl:'https://api.deepseek.com/v1',model:'deepseek-flash',structuredOutput:true,contextLimit:128000,outputLimit:32000,semanticReview };
await mkdir(out,{recursive:true});
const sourceHashes=Object.fromEntries(await Promise.all(['structuredPaper','detailedContext','detailedOverview','detailedOverviewPipeline','evidencePacket'].map(async name=>[name,createHash('sha256').update(await readFile(`src/lib/${name}.ts`)).digest('hex')])));
for(const path of paths) {
 const name=basename(path).replace(/\.pdf$/i,''), dir=resolve(out,name); await mkdir(dir,{recursive:true});
 const started=Date.now(); let task;
 try {
  const bytes=await readFile(path), documentVersion='sha256:'+createHash('sha256').update(bytes).digest('hex');
  task=getDocument({data:new Uint8Array(bytes),standardFontDataUrl:resolve('node_modules/pdfjs-dist/standard_fonts')+'/'});
  const pdf=await task.promise,pages=[];
  for(let i=0;i<pdf.numPages;i++) pages.push(pageBlocksFromTextContent(await(await pdf.getPage(i+1)).getTextContent(),i,documentVersion));
  const ledger=pdfEvidenceLedgerFromPages(pages,documentVersion,pdfSectionCandidatesFromPages(pages,documentVersion));
  const detailedLedger=createDetailedEvidenceLedger(ledger,pages),paper=createStructuredPaper(detailedLedger,pages);
  const selections=DETAILED_SECTION_IDS.map(id=>{const s=selectDetailedContext(paper,id);return {id,paragraphCount:s.paragraphs.length,chars:s.paragraphs.reduce((n,p)=>n+p.text.length,0),estimatedTextTokens:s.paragraphs.reduce((n,p)=>n+estimateTextTokens(p.text),0),sections:s.sections.map(s=>s.title),warnings:s.warnings};});
  await writeFile(`${dir}/input.json`,JSON.stringify({path,documentVersion,config,methodOnly,sourceHashes,pageCount:pages.length,paragraphCount:paper.paragraphs.length,selections},null,2));
  if(dryRun){console.log(JSON.stringify({name,dryRun,selections:selections.map(({id,chars,estimatedTextTokens})=>({id,chars,estimatedTextTokens}))}));continue;}
  let requestIndex=0;
  const requests=[];
  const result=await generateDetailedOverview({ledger,pages,config,request:async request=>{
   const payload=JSON.parse(request.messages.at(-1).content);
   if(methodOnly&&payload.section!=='method') return {content:JSON.stringify({status:'unavailable',text:'Evaluation skips this section.',sources:[]})};
   const index=++requestIndex,prefix=`${dir}/request-${String(index).padStart(2,'0')}`,sent=Date.now();
   await writeFile(`${prefix}.json`,JSON.stringify({config:request.config,messages:request.messages},null,2));
   console.log(JSON.stringify({name,request:index,event:'start',chars:request.messages.reduce((n,m)=>n+m.content.length,0)}));
   try {
    const response=await requestCompatibleCompletion({...request,apiKey:process.env.DS_API_KEY,fetchImpl:async(url,init)=>{
     const body={...JSON.parse(init.body),temperature:0};
     const raw=await fetch(url,{...init,body:JSON.stringify(body),signal:AbortSignal.any([...(init.signal?[init.signal]:[]),AbortSignal.timeout(600000)])});
     await writeFile(`${prefix}-raw.json`,await raw.clone().text()); return raw;
    }});
    const item={index,elapsedMs:Date.now()-sent,...response};requests.push(item);
    await writeFile(`${prefix}-response.json`,JSON.stringify(item,null,2));
    console.log(JSON.stringify({name,request:index,event:'done',elapsedMs:item.elapsedMs,usage:response.usage}));return response;
   }catch(e){await writeFile(`${prefix}-error.json`,JSON.stringify({name:e.name,message:e.message,status:e.status},null,2));throw e;}
  }});
  if(methodOnly) { result.result.sections=result.result.sections.filter(s=>s.id==='method');result.diagnostics=result.diagnostics.filter(s=>s.id==='method'); }
  const candidates=new Map(detailedLedger.candidates.map(c=>[c.evidenceId,c]));
  const refs=result.result.sections.flatMap(s=>s.blocks.flatMap(b=>b.evidenceRefs??[]));
  const ids=refs.flatMap(r=>r.evidenceIds),invalid=ids.filter(id=>{const c=candidates.get(id);if(!c)return true;const location=locateEvidenceCandidate(c,pages);return !location?.anchor||location.qualityWarnings.includes('quote-fallback-used');});
  const anchorValidation={refCount:refs.length,evidenceIdCount:ids.length,uniqueEvidenceIds:new Set(ids).size,invalidEvidenceIds:[...new Set(invalid)]};
  await writeFile(`${dir}/result.json`,JSON.stringify({...result,methodOnly,sourceHashes,pricing:'Provider cost not returned; token usage retained without assuming a pricing schedule.',usageTotals:requests.reduce((sum,r)=>{for(const [k,v] of Object.entries(r.usage??{}))sum[k]=(sum[k]??0)+v;return sum;},{}),anchorValidation,elapsedMs:Date.now()-started,requestCount:requestIndex},null,2));
  await writeFile(`${dir}/overview.md`,result.result.sections.map(s=>`## ${s.id}\n\n${s.blocks.map(b=>b.text).join('\n\n')}`).join('\n\n'));
  console.log(JSON.stringify({name,event:'complete',requests:requestIndex,elapsedMs:Date.now()-started,sectionStatuses:result.result.sections.map(s=>({id:s.id,status:s.status})),anchorValidation}));
 }catch(e){await writeFile(`${dir}/error.json`,JSON.stringify({name:e.name,message:e.message,elapsedMs:Date.now()-started},null,2));console.log(JSON.stringify({name,event:'error',message:e.message}));process.exitCode=1;}
 finally{if(task)await task.destroy();}
}
