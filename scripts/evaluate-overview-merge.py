#!/usr/bin/env python3
"""Research only: paired contribution organization experiment, same source and length budget."""
import concurrent.futures,importlib.util,json,sys
from pathlib import Path
spec=importlib.util.spec_from_file_location('runner',Path(__file__).with_name('evaluate-overview-context.py'));runner=importlib.util.module_from_spec(spec);spec.loader.exec_module(runner)
root,runner.output=map(Path,sys.argv[1:3]);runner.output.mkdir(parents=True,exist_ok=True)
common='请根据提供的论文原文概括2–4项实际贡献与相对文中既有研究的变化。区分作者主张、已验证结果与推断，不声称全领域首次；没有明确比较依据的贡献可保留但说明比较边界。共400–600中文字，不展开方法教程。中文叙述、英文专名、每项附支持alias。只输出既定JSON。'
formats={'split':'分别写“核心贡献”和“相对创新”两栏：前者写交付/发现，后者写比较维度及意义。','merged':'只写“核心贡献与相对创新”一栏：每条围绕同一项贡献连贯说明做出了什么、相对文中哪种既有做法改变了什么、这种改变的意义及证据边界。避免把同一贡献说两遍，不强求每项都有创新比较。'}
def run(name):
 task=json.loads((root/(name+'.json')).read_text())
 for arm,fmt in formats.items():
  messages=task['C'];p=json.loads(messages[-1]['content']);p['instruction']=common+fmt
  runner.call(name,arm,[messages[0],{'role':'user','content':json.dumps(p,ensure_ascii=False)}])
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
 for f in [pool.submit(run,n) for n in ['SAM','Video-MME','Chinchilla']]:f.result()
