import json,random
from pathlib import Path
P=Path('.local-cache/research/B106');cases=json.loads((P/'cases-frozen.json').read_text())['cases'];mapping={};completed=[]
for c in cases:
 paths=[P/'responses'/f"{c['id']}--{a}.json" for a in ['A_full','B_body','C_sections','D_retrieval']]
 if not all(x.exists() for x in paths):continue
 raw=json.loads((P/'papers'/f"{c['paper_id']}.json").read_text());ps={f'P{i+1:04d}':p for i,p in enumerate(raw['paper']['paragraphs'])}
 arms=['A_full','B_body','C_sections','D_retrieval'];random.Random('blind106-'+c['id']).shuffle(arms);answers=[];source_map={}
 for i,a in enumerate(arms):
  r=json.loads((P/'responses'/f"{c['id']}--{a}.json").read_text());label=f'R{i+1}';mapping[c['id']+'--'+label]=a
  parsed=r.get('parsed') or {}; cited={s for b in parsed.get('answer',[]) if isinstance(b,dict) for s in b.get('sources',[])}
  manifest=json.loads((P/'manifests'/f"{c['id']}--{a}.json").read_text());sent=set(manifest['sourceAliases'])
  for s in cited:
   if s in ps:source_map[s]={'page':ps[s]['pageIndex']+1,'text':ps[s]['text'],'section':ps[s]['sectionId']}
  answers.append({'label':label,'parsed':parsed,'rawFallback':r.get('content') if not parsed else None,'unknownOrUnsentSources':sorted(cited-sent),'sent_source_ids':sorted(sent)})
 pack={'case':{k:v for k,v in c.items() if k not in ['gold_section_ids','diagnostic_search_query']},'answers':answers,'cited_original_sources':source_map,'fullpaper_local_path':str(P/'papers'/f"{c['paper_id']}.json")}
 (P/'blind').mkdir(exist_ok=True);(P/'blind'/f"{c['id']}.json").write_text(json.dumps(pack,ensure_ascii=False,indent=2));completed.append(c['id'])
(P/'blind-mapping.json').write_text(json.dumps(mapping,indent=2));print('Complete packs:',len(completed),completed)
