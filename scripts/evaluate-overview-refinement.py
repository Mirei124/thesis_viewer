#!/usr/bin/env python3
"""Second iteration: full context, task-specific method brief, production output allowance."""
import concurrent.futures,importlib.util,json,sys
from pathlib import Path
spec=importlib.util.spec_from_file_location('runner',Path(__file__).with_name('evaluate-overview-context.py'));runner=importlib.util.module_from_spec(spec);spec.loader.exec_module(runner)
root,runner.output=map(Path,sys.argv[1:3]);runner.output.mkdir(parents=True,exist_ok=True)
brief='''为尚未读过原文的领域研究者写“方法详解”。目标是读者看完能沿着流程复述方法如何工作。只解释下面给定的方法范围，不写泛泛背景、贡献宣传、性能结果、数据集统计或逐项罗列所有超参数。先用两句定义任务、输入和输出，再按依赖关系组织4–8个有实质内容的自然段，可用简短小标题。每个核心模块必须在首次出现时解释其具体对象/操作、输入、变换和输出；说清模块如何连接，训练如何使它工作、使用时如何产生结果。关键定义和因果连接优先于参数清单；所有影响核心机制的设计保留，仅省略读者不需要即可理解流程的工程配置。依论文类型选取合适叙述，不为模型论文强加数据采集模板、不为实证研究强加编码器模板。
关键模块与关键训练阶段不可遗漏，也不可用未提供的知识补全。仅当某缺口确实阻断核心方法理解时，用一句指出具体缺口；不要附一长串未提供的次要细节。公式只在能准确解释且确有必要时使用，符号断裂则用文字讲清含义，不复原猜测。原文对方法的动机可以就地解释，但不展开Related Work。中文叙述并保留英文术语。建议900–1600中文字，不把英文单词计为中文字；复杂方法可稍长，但删除任何不帮助复述方法的句子。段落末引用直接支持的alias，禁止一段挂大量无关来源。只输出既定JSON。'''
scopes={
'SAM':'promptable segmentation；image encoder/prompt encoder/mask decoder的实际操作与信息流；歧义mask与quality score；训练prompt模拟及loss；三阶段data engine的具体操作；最终如何zero-shot使用。',
'3DGS':'从SfM和图像到3D Gaussian参数表示；可微投影/颜色合成；图像监督与优化；clone/split/prune如何自适应增密；tile与深度排序渲染；反向更新和推理输出。',
'Transformer':'从输入/目标token、position表示到encoder、causal decoder与cross-attention；scaled dot-product及multi-head是什么；FFN/residual/normalization作用与连接；训练目标、并行teacher-forced训练与autoregressive推理。',
'Chinchilla':'固定FLOPs下参数量与token分配问题；控制训练设置及模型/token网格；逐一解释训练曲线包络、IsoFLOP极小值、参数化loss拟合三条估计路径；如何从预算求最优；如何用Chinchilla做大规模验证；外推边界。',
'Video-MME':'任务和视频/字幕/音频输入、选择题输出；分层采集与时长、人工QA标注、独立复核和text-only过滤；如何输入不同被评模型、控制字幕/音频条件和以accuracy评分。不介绍模型排名或逐项列举被评模型。',
'LoopVL':'视觉编码/projector及token拼接；两层共享参数recurrent state与H/L更新调度；PrefixLM和2D位置机制；alignment→mid-training→SFT→visual RL的目标和冻结/训练边界；推理循环如何更新视觉语言状态并输出文本。'}
def run(name):
 t=json.loads((root/(name+'.json')).read_text());p=json.loads(t['C'][-1]['content']);p['instruction']=brief+'\n本篇方法范围：'+scopes[name]
 runner.call(name,'D',[t['C'][0],{'role':'user','content':json.dumps(p,ensure_ascii=False)}],32000)
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
 for f in [pool.submit(run,n) for n in scopes]:f.result()
