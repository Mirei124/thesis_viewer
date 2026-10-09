## problem_motivation

真实世界具时序动态，MLLMs 评测却多聚焦静态视觉，既有 video benchmarks 在视频类型多样性、时序动态与模态覆盖上不足 (E002)。故 Video-MME 施加高难度挑战 (E003)。

## method

Video-MME 的核心贡献类型是数据集与评测基准，而非新模型或算法，因此方法主线应落在它的构建流程与评测协议上。其输入是从 YouTube 采集的原始视频及配套字幕、音频等元信息，最终输出是一套可直接用于评测 MLLMs 视频理解能力的 multiple-choice QA 数据集与统一评测协议 (E006, E007)。整个构建由三个衔接步骤组成：video collection、question-answer annotation 与 quality review (E011)。

Video collection 首先建立 domain hierarchy，据此在 YouTube 上按领域检索原始视频：覆盖 Knowledge、Film & Television、Sports Competition、Life Record、Multilingual 等 6 个关键领域，每个领域再细分出 football、basketball 等具体标签，共得到 30 个细粒度视频类别 (E012)。每个类别都采集不同时长的视频，划分为 short（< 2 分钟）、medium（4–15 分钟）、long（30–60 分钟），并同步获取字幕与音频等元信息；最终数据集含 900 个视频，其中 744 个带字幕、900 个带音频，时长分布相对均衡 (E012)。由于字幕与音频作为独立元信息被保留，同一批视频可切换不同输入模态，把“模型能看到什么”变成受控变量，而不是把评测锁死在单一输入条件上 (E012, E028, E030)。三个步骤的职责依次收紧：collection 决定领域、时长覆盖与可支持的模态，annotation 决定任务类型与题面，quality review 决定最终哪些样本可用 (E012, E013, E016)。

Question-answer annotation 阶段，标注者需完整观看视频，再迭代式地为每个视频编写 3 个问题并各配 4 个候选选项，共得到 2,700 个 QA 对 (E013)。题目统一采用 multiple-choice QA 格式，涵盖 12 种任务类型，横跨 perception、reasoning 与 information synthesis (E014, E015)。每个 QA 对都被要求与视频内容紧密绑定，使模型无法在不引用视频的情况下答对 (E015)。该基准不涉及模型训练，标注与人工审核流程本身就是数据质量的把关环节，模型侧只有推理与评分 (E013, E016)。

Quality review 是最后一道筛子：每个 QA 对由另一位标注者复核，检查语言表达是否清晰准确、问题是否可答、候选选项逻辑是否一致、指定正确答案是否恰当 (E016)。为确认问题确实需要视频内容作为关键线索，论文将纯文本问题交给 Gemini 1.5 Pro 做 text-only 测试，剔除仅凭问题文本即可回答的 QA 对，不合格者退回原标注者修改；该设置下 Gemini 1.5 Pro 的准确率低于 15%，说明过滤后的问题确实依赖视频内容 (E017)。

评测协议方面，评测包含三种输入模态设置：frames only、frames with subtitles、frames with audio (E028, E030)；被评测模型按各自官方配置运行，准确率由模型输出直接与 ground-truth answer 比对得到，不借助 ChatGPT 等外部模型评分 (E022, E031)。

## contributions_novelty

作者提出 Video-MME，定位首个 MLLMs 视频分析综合多模态评测基准（E033）。

含 900 视频、2,700 选择题，跨 6 域 30 细类，时长 11 秒–1 小时，带字幕与音轨（E035）。

评测 GPT-4V、GPT-4o、Gemini 1.5 Pro 及开源模型（E036）。

Gemini 1.5 Pro 均准 75%，VILA-1.5 59%，字幕/音频提升 6.2%/4.3%，长视频增益更大，性能随视频变长下降（E037, E039）。

比较仅限多项选择子集（E038）。

相对既有 image MLLM 与视频时序基准（E044），其加入字幕/音轨与跨时长评测；属解读（E033, E035）。

并指出长上下文架构与复杂时序推理数据方向（E040）。

## experiments_ablations

在Video-MME上评测4个商用模型、开源视频MLLM与Qwen-VL-Max等图像MLLM，精度由输出与ground-truth直接比对（E048、E051、E060）。仅帧输入时Gemini 1.5 Pro达75%，超GPT-4V 15.1%、GPT-4o 3.1%（E062）。模态对比中，其长视频多语言任务加字幕提升16.7%、加音频12.5%（E071）。原文未提供模块移除或替换的消融，该部分证据不足。

## limitations

评估显示，视频时长增加时 MLLMs 性能下降，open-source models 受限的输入帧数成为长视频理解的信息瓶颈（E076）；复杂时序推理数据集仍较有限（E077）。