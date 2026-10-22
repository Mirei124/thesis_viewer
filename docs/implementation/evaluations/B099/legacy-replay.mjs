import {registerHooks} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
registerHooks({resolve(s,c,n){try{return n(s,c)}catch(e){if(e.code==='ERR_MODULE_NOT_FOUND'&&s.startsWith('.'))return n(`${s}.ts`,c);throw e}}});
const {pageBlocksFromTextContent}=await import('./src/lib/pdfPageBlocks.ts');
const {pdfSectionCandidatesFromPages}=await import('./src/lib/pdfSectionCandidates.ts');
const {pdfEvidenceLedgerFromPages}=await import('./src/lib/evidenceLedger.ts');
const {createEvidencePassages}=await import('./src/lib/evidencePassages.ts');
const {createPassageRetrievalIndex,selectRankedPassagesForPurpose}=await import('./src/lib/retrievalIndex.ts');
const {createProgressiveEvidenceSession,appendProgressiveEvidenceStage}=await import('./src/lib/evidencePacket.ts');
const {DETAILED_SECTION_IDS,progressiveDetailedSectionMessages}=await import('./src/lib/detailedOverview.ts');
const task=getDocument({data:new Uint8Array(await readFile(process.argv[2]))});
const pdf=await task.promise,pages=[];for(let i=0;i<pdf.numPages;i++)pages.push(pageBlocksFromTextContent(await(await pdf.getPage(i+1)).getTextContent(),i,'b099'));
const ledger=pdfEvidenceLedgerFromPages(pages,'b099',pdfSectionCandidatesFromPages(pages,'b099'));
const passages=createEvidencePassages(ledger,{targetChars:520,maxChars:1500,pages});const index=createPassageRetrievalIndex(passages);const session=createProgressiveEvidenceSession(ledger,{maxExcerptChars:1500});const outputs=[];
for(const id of DETAILED_SECTION_IDS){const selected=selectRankedPassagesForPurpose(index,id,{maxCandidates:24,maxCandidatesPerPage:2,includeAdjacent:true});const inc=appendProgressiveEvidenceStage(session,id,{orderedPassages:selected});outputs.push({id,selectedPassages:selected.length,increment:inc,messages:progressiveDetailedSectionMessages(id,inc,[])});}
await writeFile(process.argv[3],JSON.stringify({candidateCount:ledger.candidates.length,passageCount:passages.length,outputs},null,2));console.log(JSON.stringify(outputs.map(x=>({id:x.id,selectedPassages:x.selectedPassages,sources:x.increment.sources.length,aliases:x.increment.sentAliases.length}))));await task.destroy();
