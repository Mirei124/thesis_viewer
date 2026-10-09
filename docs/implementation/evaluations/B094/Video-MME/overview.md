## problem_motivation

MLLMs 的进展主要集中在静态图像理解，对时序视觉数据的处理能力仍未被充分探索（E002, E007）。既有 video-based benchmarks 存在视频类型多样性不足、时序动态覆盖不够、仅聚焦单一模态等问题，难以全面评估 MLLMs（E007, E037）。为此作者提出 Video-MME，覆盖 6 个视觉域与 30 个细分类别，时长自 11 秒至 1 小时，并纳入 subtitles 与 audio 以做全谱系评估（E002, E012）。实验中作者观察到 subtitles 与 audio 能显著提升视频理解，且模型性能随时长增加而下降（E005, E014）；长上下文架构与复杂时序推理训练数据只是作者展望的方向，并非本文实际采用的设计（E033）。

## method

Video-MME 的定位是填补 MLLMs 在顺序视觉数据上评测不足的空白：现有模型与评测主要聚焦静态视觉数据理解，难以刻画真实世界中物体随时间交互的动态性（E097）。它被设计为首个 full-spectrum、Multi-modal Evaluation benchmark，用于系统评估 MLLMs 在视频分析中的表现（E092）。

规模与输入形式：数据集包含 900 段视频与 2,700 个高质量 multiple-choice questions，平均每段视频 3 题（E102）。视频横跨 6 个视觉域、30 个细分领域，时长从 11 秒到 1 小时，并在 video frames 之外整合 subtitles 与 audios，以考察多模态输入（E102）。整个构建过程分为三步：video collection、question-answer annotation 与 quality review（E126）。

第一步 Video Collection。为覆盖多样视频类型，先从 YouTube 采集原始视频并为此建立 domain hierarchy，确定 Knowledge、Film & Television、Sports Competition、Life Record、Multilingual 等 6 个关键域，每域再细分为具体标签（如 Sports Competition 下的 football、basketball），共 30 个细粒度类别（E127）。每个类别都按 short（<2 分钟）、medium（4–15 分钟）、long（30–60 分钟）三种时长采集（E127）。除视频本身外，还获取 subtitles（若提供）与 audios 等 meta-information 供后续深入考察（E127）。最终数据集合计 900 段视频，其中 744 段带 subtitles、900 段全部带 audios（E135）。

第二步 Question-Answer Annotation。标注采用 multiple-choice QA 形式以便直接、灵活的评估，并招募英语能力强、在 vision-language learning 方面有丰富研究经验的标注者（E128）。每位标注者需完整观看整个视频，再迭代式地创建 3 个问题，每个问题配 4 个候选选项，合计 2,700 个 QA pairs（E128）。这些问题覆盖 12 种 task types，涵盖 perception、reasoning 与 information synthesis，且每对 QA 都与视频内容紧密绑定，使模型不直接参考视频便难以作答（E129, E130）。

第三步 Quality Review。复核先由另一位标注者逐条检查，确认语言表达清晰准确、问题可被回答且候选选项逻辑一致、指定正确答案恰当（E131）。随后把纯文本问题交给 Gemini 1.5 Pro，过滤掉仅凭文本即可答对的 QA pairs，例如可由常识推断为世界杯夺冠的 “What is the biggest achievement of Argentina’s number 10 in 2022?”，不合格者退回原标注者修改（E132）。统计显示 Gemini 1.5 Pro 在 text-only 设置下准确率低于 15%，说明题目确实依赖视频内容（E132）。

数据统计中还有两项用于刻画难度的设计。其一，questions、options 与 answers 的平均词数在不同视频长度间保持稳定，说明 QA 格式标准化，而 subtitle 词数随视频变长显著增长，short 视频平均 198.6 words、long 视频达 6.5K words（E136）；选项 A/B/C/D 的分布接近均匀（25.1/27.2/25.3/22.4%），以避免答案位置偏置（E149）。其二，借鉴 EgoSchema 引入 certificate length 度量 QA 的时间难度，其定义为让人类验证者确信标注正确所必需且充分的最小子片段集合，长度取这些 sub-clips 时长之和（E150）。从每个类别随机抽取 3 段视频计算该分布，short、medium、long 的中位数分别为 26s、164.7s 与 890.7s，medium 与 long 子集所需消化的视频内容明显长于 EgoSchema（E151）。

评测阶段按输入 modality 区分设置：每个模型分别在 frames only、frames with subtitles、frames with audio 三种条件下评测（E184）。参评对象包括 4 个 commercial MLLMs（GPT-4V、GPT-4o、Gemini 1.5 Flash、Gemini 1.5 Pro）与 9 个代表性 open-source video MLLMs（E190, E191, E192），并加入 3 个 advanced image MLLMs 以检验 benchmark 对 multi-image 场景的适配性（E193）。

帧采样遵循各模型官方配置：对支持极长多模态上下文的 Gemini 1.5 Pro，short 与 medium 视频按每秒 1 帧、long 视频每 2 秒 1 帧采样以保证 API 稳定性；其余模型按官方指南均匀采样固定帧数，例如 GPT-4V 为 10 帧、GPT-4o 为 384 帧、ST-LLM 与 Chat-UniVi-V1.5 各 64 帧等（E194）。在启用字幕的设置中，所有模型只使用与所采样视频帧时间戳对应的 subtitles，例如采样 10 帧就取这 10 个时间戳对应的 10 条字幕，以保证视觉与文本输入在时间上同步（E195）。评测输入按 “entire video frames + complete subtitles/audios (optional) + question with prompt” 组织，优先采用模型默认 prompt，缺失时使用标准化 prompt（E196）。最终准确率通过 regular expressions 抽取模型输出，并直接与 ground-truth answer 比较，不依赖 ChatGPT 等外部 judge（E198）。

## contributions_novelty

作者自述 Video-MME 是视频分析中首个 full-spectrum 的 MLLMs Multimodal Evaluation 基准，四项特征为视频类型覆盖 6 个 primary visual domains 与 30 个 subfields、时长跨度 11 秒至 1 小时、在 video frames 外整合 subtitles 与 audios、以及 expert annotators 严格人工标注。

文中指既有 video-based benchmarks 缺乏视频类型多样性、temporal dynamics 覆盖不足且偏重单一模态；对应交付 900 个视频、2,700 个 multiple-choice QA、744 份 subtitles 与 900 份 audios。

certificate length 分析显示 short/medium/long 中位数分别为 26s、164.7s、890.7s，中长视频所需内容明显长于 EgoSchema。

评测显示 Gemini 1.5 Pro 以 75% 平均准确率居商业模型首位（高于 GPT-4V 15.1%、GPT-4o 3.1%）；开源 VILA-1.5 为 59%，7B 中 VITA-1.5 达 56.1%；image MLLMs 约 50%，接近 LLaVA-NeXT-Video。

subtitles 与 audios 分别给 Gemini 1.5 Pro 带来 6.2% 与 4.3% 提升，长视频受益更大（subtitles：short +2.8%、long +10.1%），且所有模型性能随视频时长增加而下降。

## experiments_ablations

评测覆盖Video-MME全量900个视频、2,700个QA pairs，并分short/medium/long三个子集，各含300个视频、900个QA（E334、E332）。比较对象为4个commercial models、9个open-source video MLLMs，以及Qwen-VL-Chat/Max、InternVL-Chat-V1.5等image MLLMs（E435）。帧采样按官方配置：Gemini 1.5 Pro在short/medium取1 fps、long每2秒1帧，GPT-4o为384帧、VILA-1.5为8帧（E439）；subtitle设置取与采样帧时间戳对应的字幕（E440），准确率以正则抽取输出直接与ground truth比较，不用外部judge（E443）。仅输入frames时，Gemini 1.5 Pro平均准确率75%，高于GPT-4V 15.1个百分点、高于GPT-4o 3.1个百分点（E415）；open-source中34B VILA-1.5为59%，7B中最优的VITA-1.5为56.1%（E418），且多数open-source模型不支持audio，audio评测被省略（E419）。Table 5的模态对比中，Gemini 1.5 Pro整体加subtitles、audio分别提升6.2%、4.3%（E409、E330）；long的multilingual上subtitles、audio分别提升16.7%、12.5%，subtitles对short、long分别为2.8%、10.1%（E424）。性能随duration增加而下降，short到long为−14.3%（E415）。论文未报告移除或替换模块的消融，Table 5只是输入模态组合分析，不应视为模块消融（E423）。

## limitations

材料明确承认的覆盖范围限制有两处：多数 open-source 模型不支持音频输入，因此 audio 评估被省略，这些模型在音频模态下的表现无从比较（E546）；Video-MME 的 900 个视频中仅 744 个附带字幕，字幕模态覆盖并不完整（E488）。此外，certificate length 统计仅从每个类别随机抽取 3 个视频进行（E504）。上述覆盖边界制约了涉及 audio 与 subtitle 的结论以及时序难度结论的可外推范围。