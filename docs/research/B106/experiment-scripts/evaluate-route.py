import importlib.util,json,concurrent.futures,time
from pathlib import Path
P=Path('.local-cache/research/B106');spec=importlib.util.spec_from_file_location('ev',P/'evaluate.py');ev=importlib.util.module_from_spec(spec);spec.loader.exec_module(ev)
protocol={'arm':'E_route','frozenBeforeEAnswers':True,'rules':['Useexistingquestion+outlineplanner;scopeglobal->Afull','scopelocal->Dretrieval','IfDanswerstatusnotansweredORmissingnonempty->Afullonce'],'prompt':'identical tofourbaselines; no gold used','planner':'prioractualplanner reused; fullplannerusagechargedpercase','intermediateAnswer':'chargedtoE evenwhenfallback','maxExpansion':1,'tuningNote':'ruleproposed afterbaselineanalysis; exploratory same24questions, not independentholdout'};(P/'route-protocol.json').write_text(json.dumps(protocol,indent=2))
def run(c):
 raw,ps,ss=ev.load_paper(c['paper_id']);plan=json.load(open(P/'responses'/f"{c['id']}--plan.json"));scope=(plan.get('parsed')or{}).get('scope');first='A_full' if scope=='global' else 'D_retrieval';selected=ev.select(c,ps,ss,plan,first);ms=ev.make_messages(c,selected,first,raw);r=ev.call(c['id']+'--E_initial',ms,'route-initial');steps=[r['key']];used=first
 answer=r.get('parsed')or{}
 if first!='A_full' and (answer.get('status')!='answered' or bool(answer.get('missing'))):
  selected=ps;used='A_full';r=ev.call(c['id']+'--E_fallback',ev.make_messages(c,selected,'A_full',raw),'route-fallback');steps.append(r['key'])
 final={**r,'key':c['id']+'--E_route','kind':'route-final','routeSteps':steps,'selectedArm':used,'initialArm':first,'plannerKey':plan['key']};(P/'responses'/f"{c['id']}--E_route.json").write_text(json.dumps(final,ensure_ascii=False,indent=2));manifest={'case_id':c['id'],'arm':'E_route','paper_id':c['paper_id'],'sourceAliases':[p['alias'] for p in selected],'paragraphIds':[p['paragraphId'] for p in selected],'sourceCount':len(selected),'plannerKey':plan['key'],'routeSteps':steps,'initialArm':first,'selectedArm':used};(P/'manifests'/f"{c['id']}--E_route.json").write_text(json.dumps(manifest,ensure_ascii=False,indent=2));return final
cases=json.load(open(P/'cases-frozen.json'))['cases']
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as ex:
 for r in ex.map(run,cases):pass
