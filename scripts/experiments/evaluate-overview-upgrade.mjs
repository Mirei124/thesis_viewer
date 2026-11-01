// B112 paired production-baseline/candidate evaluation; never records request headers or credentials.
import {registerHooks} from 'node:module';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
registerHooks({resolve(s,c,n){try{return n(s,c)}catch(e){if(e.code==='ERR_MODULE_NOT_FOUND'&&s.startsWith('.'))return n(s+'.ts',c);throw e}}});
const {pageBlocksFromTextContent}=await import('../../src/lib/pdfPageBlocks.ts');
const {pdfSectionCandidatesFromPages}=await import('../../src/lib/pdfSectionCandidates.ts');
const {pdfEvidenceLedgerFromPages,locateEvidenceCandidate}=await import('../../src/lib/evidenceLedger.ts');
const {createDetailedEvidenceLedger,createStructuredPaper}=await import('../../src/lib/structuredPaper.ts');
// Preserve the actual pre-upgrade baseline after production adopts the winning implementation.
const baselineRoot=resolve('.local-cache/batches/B112/baseline-44d60de');
await mkdir(baselineRoot,{recursive:true});
try{await readFile(resolve(baselineRoot,'src/lib/threeLineOverview.ts'))}catch{const archive=execFileSync('git',['archive','44d60de','src/lib']);execFileSync('tar',['-x','--exclude=*.test.ts','--exclude=*.spec.ts','-C',baselineRoot],{input:archive})}
const {threeLineEvidencePacket,threeLineOverviewMessages,parseThreeLineOverview,validateThreeLineOverview}=await import(resolve(baselineRoot,'src/lib/threeLineOverview.ts'));
const {generateDetailedOverview}=await import(resolve(baselineRoot,'src/lib/detailedOverviewPipeline.ts'));
const {requestCompatibleCompletion}=await import('../../src/lib/compatibleProvider.ts');
const {estimateMessagesTokens}=await import('../../src/lib/detailedContext.ts');
const args=process.argv.slice(2), variant=args.find(a=>a.startsWith('--variant='))?.split('=')[1]??'both',prepare=args.includes('--prepare');
const outputTag=args.find(a=>a.startsWith('--out-tag='))?.split('=')[1];
const wanted=args.find(a=>a.startsWith('--papers='))?.split('=')[1].split(',');
const root=resolve('.local-cache/batches/B112');await mkdir(root,{recursive:true});
const specs=[['SAM','2304.02643','sam.pdf'],['Attention','1706.03762','attention.pdf'],['VideoMME','2405.21075','video-mme.pdf'],['Chinchilla','2203.15556','chinchilla.pdf']].filter(p=>!wanted||wanted.includes(p[0]));
const config={baseUrl:'https://api.deepseek.com/v1',model:'deepseek-flash',structuredOutput:true,semanticReview:false,contextLimit:128000,outputLimit:32000};
let active=0;const queue=[];async function limited(fn){if(active>=3)await new Promise(r=>queue.push(r));active++;try{return await fn()}finally{active--;queue.shift()?.()}}
const hash=x=>createHash('sha256').update(x).digest('hex');
async function load(spec){const [name,id,file]=spec;const dir=resolve(root,name);await mkdir(dir,{recursive:true});const data=await readFile(resolve('.local-cache/papers',id,file)),documentVersion='sha256:'+hash(data);let pages;
 try{const cached=JSON.parse(await readFile(resolve(dir,'paper.json'),'utf8'));if(cached.documentVersion===documentVersion)pages=cached.pages;}catch{}
 if(!pages){const task=getDocument({data:new Uint8Array(data),standardFontDataUrl:resolve('node_modules/pdfjs-dist/standard_fonts')+'/'});try{const pdf=await task.promise;pages=[];for(let i=0;i<pdf.numPages;i++)pages.push(pageBlocksFromTextContent(await(await pdf.getPage(i+1)).getTextContent(),i,documentVersion));}finally{await task.destroy()}}
 const ledger=pdfEvidenceLedgerFromPages(pages,documentVersion,pdfSectionCandidatesFromPages(pages,documentVersion));const detailedLedger=createDetailedEvidenceLedger(ledger,pages),paper=createStructuredPaper(detailedLedger,pages);await writeFile(resolve(dir,'paper.json'),JSON.stringify({name,id,documentVersion,pages,paper}));return {name,dir,pages,ledger,detailedLedger,paper};}
async function run(p,mode){const dir=resolve(p.dir,outputTag??mode);await mkdir(dir,{recursive:true});let totalCalls=0;
 async function call(kind,request){
 if(outputTag){const evaluationRun=hash(p.name+':'+outputTag).slice(0,16);request={...request,messages:request.messages.map((m,i)=>i===1&&m.role==='user'?{...m,content:JSON.stringify({evaluationRun,...JSON.parse(m.content)})}:m)}}
 const n=++totalCalls;const sha=hash(JSON.stringify({config:request.config,messages:request.messages,temperature:0}));const dest=resolve(dir,`${kind}-${sha.slice(0,14)}`);try{const cached=JSON.parse(await readFile(dest+'-response.json','utf8'));if(cached.requestSha256===sha&&cached.content)return cached;}catch{}
  await writeFile(dest+'-request.json',JSON.stringify({requestSha256:sha,config:request.config,messages:request.messages,temperature:0,thinking:'provider default (omitted)',estimatedInputTokens:estimateMessagesTokens(request.messages)},null,2));
  if(prepare)return {content:kind==='three'?JSON.stringify({items:[]}):JSON.stringify({status:'unavailable',text:'Offline preparation only',sources:[]})};
  return limited(async()=>{const started=Date.now();console.log(JSON.stringify({paper:p.name,mode,kind,event:'request',estimatedInputTokens:estimateMessagesTokens(request.messages)}));try{const result=await requestCompatibleCompletion({...request,apiKey:process.env.DS_API_KEY,fetchImpl:async(url,init)=>{const body=JSON.parse(init.body);body.temperature=0;const raw=await fetch(url,{...init,body:JSON.stringify(body),signal:AbortSignal.timeout(360000)});return raw}});const row={...result,requestSha256:sha,elapsedMs:Date.now()-started};await writeFile(dest+'-response.json',JSON.stringify(row,null,2));console.log(JSON.stringify({paper:p.name,mode,kind,event:'response',ms:row.elapsedMs,usage:result.usage}));return row;}catch(e){await writeFile(dest+'-error.json',JSON.stringify({name:e.name,code:e.code,status:e.status,elapsedMs:Date.now()-started}));throw e}});
 }
 let three;
 try{let messages,packet,candidate;if(mode==='baseline'){packet=threeLineEvidencePacket(p.ledger,p.pages);messages=threeLineOverviewMessages(packet)}else{const {prepareThreeLineCandidate}=await import('./overview-three-line.ts');candidate=prepareThreeLineCandidate(p.ledger,p.pages);messages=candidate.messages;await writeFile(resolve(dir,'three-selection.json'),JSON.stringify({sources:candidate.sources,paragraphs:candidate.paragraphs.map(x=>({paragraphId:x.paragraphId,role:x.role,kind:x.kind,text:x.text}))},null,2));}
 const response=await call('three',{config,messages});if(!prepare){const parsed=parseThreeLineOverview(response.content);if(packet)validateThreeLineOverview(parsed,packet,p.ledger,p.pages);else{const map=new Map(candidate.sources.map((s,i)=>[s.alias,candidate.paragraphs[i]]));for(const item of parsed.items)for(const alias of item.sources){const paragraph=map.get(alias);if(!paragraph||paragraph.members.some(m=>!locateEvidenceCandidate(m.candidate,p.pages)))throw Error('Candidate source binding failed')}}three={parsed,usage:response.usage,elapsedMs:response.elapsedMs};await writeFile(resolve(dir,'three-result.json'),JSON.stringify(three,null,2));}}
 catch(e){await writeFile(resolve(dir,'three-error.json'),JSON.stringify({name:e.name,message:e.message}));console.log(JSON.stringify({paper:p.name,mode,event:'three-error',message:e.message}));}
 try{const runner=mode==='baseline'?generateDetailedOverview:(await import('./overview-detailed.ts')).generateDetailedCandidate;const detailed=await runner({ledger:p.ledger,pages:p.pages,config,request:r=>call('detailed',r)});if(!prepare)await writeFile(resolve(dir,'detailed-result.json'),JSON.stringify(detailed,null,2));console.log(JSON.stringify({paper:p.name,mode,event:prepare?'prepared':'done',statuses:detailed.result.sections.map(s=>s.status)}));}
 catch(e){await writeFile(resolve(dir,'detailed-error.json'),JSON.stringify({name:e.name,message:e.message}));console.log(JSON.stringify({paper:p.name,mode,event:'detailed-error',message:e.message}));}
}
if(!prepare&&!process.env.DS_API_KEY)throw Error('DS_API_KEY must be configured; its value will not be logged.');
const modes=variant==='both'?['baseline','candidate']:[variant];
if(outputTag&&modes.length!==1)throw Error('--out-tag requires a single --variant to keep paired results separate.');
await writeFile(resolve(root,'protocol.json'),JSON.stringify({baselineCommit:'44d60de',papers:specs,config,temperature:0,thinking:'provider default (omitted)',maxConcurrentRequests:3,qualityGate:'No new major factual errors; improved source-grounded method coverage/clarity or three-line complementarity without uncontrolled token growth; cache savings distinct from actual tokens.',variants:modes,outputTag:outputTag??null,cacheIsolation:outputTag?'Stable per-paper per-round nonce before the first source group prevents earlier experimental source-prefix warmup':'No added nonce in initial baseline/candidate round'},null,2));
const loaded=await Promise.all(specs.map(load));await Promise.all(loaded.map(async p=>{for(const mode of modes)await run(p,mode)}));
