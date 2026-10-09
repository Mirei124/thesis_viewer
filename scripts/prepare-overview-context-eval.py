import json,re,hashlib,sys
from pathlib import Path
# Input: PDFs extracted via pdftotext and audit-overview-context.mjs results.
root=Path(sys.argv[1]); out=root/'requests';out.mkdir(exist_ok=True)
spec={
'SAM':('SAM',[(r'1\. Introduction',r'2\. Segment Anything Task'),(r'2\. Segment Anything Task',r'6\. Segment Anything RAI Analysis')]),
'3DGS':('3DGS',[(r'\nINTRODUCTION\n',r'\nRELATED WORK\n'),(r'\nOVERVIEW\n',r'\nIMPLEMENTATION, RESULTS AND EVALUATION\n')]),
'Transformer':('Transformer',[(r'\nIntroduction\n',r'\nResults\n')]),
'Chinchilla':('Chinchilla',[(r'1\. Introduction',r'2\. Related Work'),(r'3\. Estimating the optimal parameter/training tokens allocation',r'4\.2\. Results')]),
'Video-MME':('Video-MME',[(r'1\. Introduction',r'2\. Related Work'),(r'3\. Video-MME',r'4\.2\. Quantitative Results')]),
'LoopVL':('2609.38426',[(r'\nIntroduction\n',r'\n5\n\nEvaluation\n')])}
new='''请为尚未读过这篇论文、但有领域基础的读者完整复述本文的方法，使其能理解方法如何实际工作。先说明任务、输入与输出，再按实际依赖关系讲清完整流程。每个核心模块首次出现必须解释它是什么（具体操作/表示/学习目标），接收什么、做什么、输出什么以及如何交给下一模块，不能只罗列名称。区分训练阶段和使用/推理阶段。仅简化不影响机制的工程枝节；保留决定机制的约束、关键配置以及有可靠来源的必要公式，并解释变量和用途。数据集/基准讲清采集、标注、质检、任务及评测协议；实证/缩放规律论文讲清控制变量、实验设计、拟合/估计过程与验证，不套架构模板。若一个核心定义未在材料中提供，明确缺的是哪一处；不得用常识补造或整栏宣布资料不足。不得照着摘录顺序逐段改写，不用“给出的上下文”叙事。中文叙述，专业术语保留英文。方法篇幅按完整性需要，通常800–1600中文字，可为复杂方法适当增加，不以固定3–6步压缩。每个可核实段落附直接支持的alias，输出既定JSON。'''
manifest=[]
for name,(txtname,ranges) in spec.items():
 audit=json.loads((root/'audit'/('b084-2609.38426.json' if name=='LoopVL' else name+'.json')).read_text())
 text=(root/(txtname+'.txt')).read_text(); slices=[]; spans=[]
 for start,end in ranges:
  matches=list(re.finditer(start,text)); s=matches[-1].start() if name=='LoopVL' else matches[0].start(); e=re.search(end,text[s+len(matches[0].group(0)):]); assert e,(name,end)
  stop=s+len(matches[0].group(0))+e.start(); slices.append(text[s:stop]);spans.append([s,stop])
 sources=[]
 for part in slices:
  # pdftotext paragraph separators are a research proxy, not a production paragraph detector.
  for para in re.split(r'\n\s*\n',part):
   p=re.sub(r'\s+',' ',para).strip()
   if not p:continue
   sources.append({'alias':f'P{len(sources)+1:03d}','excerpt':p})
 v=audit['variants'][0]; problem=v['increments'][0]['messages']; method=v['increments'][1]['messages']
 b=json.loads(method[-1]['content']);b['instruction']=new
 improved=[method[0],{'role':'user','content':json.dumps(b,ensure_ascii=False)}]
 full=[method[0],{'role':'user','content':json.dumps({'instruction':new,'newSources':sources,'legalSourceAliases':[s['alias'] for s in sources]},ensure_ascii=False)}]
 task={'name':name,'problem':problem,'A':method,'B':improved,'C':full,'sourceSpans':spans,'textFileSha256':hashlib.sha256(text.encode()).hexdigest()}
 (out/(name+'.json')).write_text(json.dumps(task,ensure_ascii=False))
 manifest.append({'name':name,'pdfSha256':audit['version'],'pages':audit['pageCount'],'sourceSpans':spans,'pdftotextSha256':task['textFileSha256'],'A_sourceChars':sum(len(s['excerpt']) for i in v['increments'] for s in i['increment']['sources']),'C_sourceChars':sum(len(s['excerpt']) for s in sources),'C_sources':len(sources),'variants':[{k:z for k,z in a.items() if k!='increments'} for a in audit['variants']]})
Path('docs/implementation/evaluations/B090/manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2))
(root/'method-prompt.txt').write_text(new)
print(json.dumps(manifest,ensure_ascii=False,indent=2))
