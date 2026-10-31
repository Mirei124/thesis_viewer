import json,importlib.util,concurrent.futures,hashlib
from pathlib import Path
P=Path('.local-cache/research/B106');spec=importlib.util.spec_from_file_location('ev',P/'evaluate.py');ev=importlib.util.module_from_spec(spec);spec.loader.exec_module(ev)
(P/'nested-protocol.json').write_text(json.dumps({'arm':'G_nested','fixedBeforeAnswers':True,'change':'Same complete paragraph sequence and aliases asA; JSONsection+page containers sharemetadata; paragraphstill{id,text}. No text removed or summarized.','sameSystemPrompt':True,'plannerCalls':0,'stage':'exploratory formatting followup, same24cases notholdout'},indent=2))
def run(c):
 raw,ps,ss=ev.load_paper(c['paper_id']);sections=[];lasts=None;lastp=None
 for p in ps:
  if p['sectionId']!=lasts:sections.append({'section':p['sectionTitle'],'pages':[]});lasts=p['sectionId'];lastp=None
  if p['pageIndex']!=lastp:sections[-1]['pages'].append({'page':p['pageIndex']+1,'sources':[]});lastp=p['pageIndex']
  sections[-1]['pages'][-1]['sources'].append({'id':p['alias'],'text':p['text']})
 content=json.dumps({'paper_id':c['paper_id'],'title':raw['name'],'scope':'全文含参考文献和附录','sections':sections},ensure_ascii=False);ms=[{'role':'system','content':ev.SYSTEM},{'role':'user','content':content},*c.get('history',[]),{'role':'user','content':c['question']}];key=c['id']+'--G_nested';m={'case_id':c['id'],'arm':'G_nested','paper_id':c['paper_id'],'sourceAliases':[p['alias'] for p in ps],'paragraphIds':[p['paragraphId'] for p in ps],'sourceCount':len(ps),'plannerKey':None,'estimatedInputTokens':ev.messages_est(ms),'textSequenceSha256':hashlib.sha256(json.dumps([p['text'] for p in ps],ensure_ascii=False).encode()).hexdigest(),'identicalAliasesToA':True};(P/'manifests'/f'{key}.json').write_text(json.dumps(m,ensure_ascii=False,indent=2));return ev.call(key,ms,'answer-nested')
cases=json.load(open(P/'cases-frozen.json'))['cases']
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as ex:
 for r in ex.map(run,cases):pass
