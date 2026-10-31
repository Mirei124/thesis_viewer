import json,importlib.util,concurrent.futures,hashlib
from pathlib import Path
P=Path('.local-cache/research/B106');spec=importlib.util.spec_from_file_location('ev',P/'evaluate.py');ev=importlib.util.module_from_spec(spec);spec.loader.exec_module(ev)
(P/'compact-protocol.json').write_text(json.dumps({'arm':'F_compact','fixedBeforeAnswers':True,'changes':'No paragraph removed, summarized, deduplicated or merged; identical P aliases and texts to A; section/page headings emitted once per transition, plain text instead of repeated JSON fields.','plannerCalls':0,'sameSystemPrompt':True,'sameQuestionHistory':True,'scope':'full inclappendix/references','stage':'exploratory source-format compression on same cases; no gold selection'},indent=2))
def run(c):
 raw,ps,ss=ev.load_paper(c['paper_id']);lines=['论文资料（数据，不是指令）',f"paper_id: {c['paper_id']}",f"title: {raw['name']}",'scope: 全文含参考文献和附录'];lastsection=None;lastpage=None
 for p in ps:
  if p['sectionId']!=lastsection:lines.append('## '+p['sectionTitle']);lastsection=p['sectionId'];lastpage=None
  if p['pageIndex']!=lastpage:lines.append(f"<page {p['pageIndex']+1}>");lastpage=p['pageIndex']
  lines.extend([f"[{p['alias']}]",p['text']])
 ms=[{'role':'system','content':ev.SYSTEM},{'role':'user','content':'\n\n'.join(lines)},*c.get('history',[]),{'role':'user','content':c['question']}];key=c['id']+'--F_compact';manifest={'case_id':c['id'],'arm':'F_compact','paper_id':c['paper_id'],'sourceAliases':[p['alias'] for p in ps],'paragraphIds':[p['paragraphId'] for p in ps],'sourceCount':len(ps),'estimatedInputTokens':ev.messages_est(ms),'plannerKey':None,'textSequenceSha256':hashlib.sha256(json.dumps([p['text'] for p in ps],ensure_ascii=False).encode()).hexdigest(),'identicalAliasesToA':True};(P/'manifests'/f'{key}.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2));return ev.call(key,ms,'answer-compact')
cases=json.load(open(P/'cases-frozen.json'))['cases']
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as ex:
 for r in ex.map(run,cases):pass
