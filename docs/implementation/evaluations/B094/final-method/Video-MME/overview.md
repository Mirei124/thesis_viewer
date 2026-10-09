## method

本文的核心贡献类型是 benchmark（评测基准）而非新模型，因此其“方法”对应的是 Video-MME 的构建流程与评测协议本身：任务是系统评估 MLLM 在视频分析上的能力，输入是采自 YouTube 的原始视频及其附属信息，最终输出是一套带高质量人工标注的 video QA 数据与可复现的评测流程 (E092, E098)。

构建分三步：video collection、question-answer annotation 与 quality review (E126)。

Video Collection。先建立 domain hierarchy 作为采集骨架，再从 YouTube 获取原始视频。共设 6 个主域，即 Knowledge、Film & Television、Sports Competition、Life Record、Multilingual，每个域再细分为具体 tag（如 Sports Competition 下的 football、basketball），合计 30 个细粒度类别；每个类别都收集短（<2 分钟）、中（4–15 分钟）、长（30–60 分钟）三档时长的视频，并同时抓取字幕（若有）与音频等 meta-information，以便后续考察外部模态信息的作用。最终得到 900 个视频，其中 744 个带字幕、900 个带音频 (E127, E135)。

Question-Answer Annotation。在原始视频之上标注 QA，用以严格考察 MLLM 对视频内容的理解。形式上采用 multiple-choice QA，以便直接、灵活的评测；标注者需具备较强的英语能力与 vision-language learning 研究经验。具体做法是每位标注者完整观看视频后迭代撰写 3 道相关问题，每题配 4 个候选选项，最终形成 2,700 个 QA pair。这些问题覆盖 12 种 task type，横跨 perception、reasoning 与 information synthesis，并且被设计为必须紧扣视频内容，使模型无法在不参考视频的情况下答对 (E128, E129, E130)。

Quality Review。为保证质量，每道 QA 先交由另一位标注者复核，检查语言表达是否清晰准确、问题是否可答、候选选项是否逻辑自洽、指定正确答案是否恰当。此外，为剔除仅凭语言先验即可解出的样本，把纯文本形式的问题单独交给 Gemini 1.5 Pro，过滤掉不看视频也能答对的 QA，并将不合格题退回原作者修改；例如可由常识直接推出答案的题目会在这一阶段被排除。统计显示 Gemini 1.5 Pro 在纯文本设定下准确率不足 15%，说明该步骤确实筛掉了不需要视频线索的题目 (E131, E132)。

与难度刻画相关的统计（属于数据构建的一部分）。数据集包含 900 个视频、744 份字幕与 900 个音频文件 (E135)。QA 各文本字段的字数在不同时长下保持稳定（问题约 11.5–14.5 词），而字幕词数随时长明显增长，短、中、长视频平均分别约 198.6、1425.6、6515.6 词，说明长视频承载的信息量更大 (E136, E142)。正确选项 A/B/C/D 的分布接近均匀（25.1/27.2/25.3/22.4%），以避免位置偏置 (E149)。论文借鉴 EgoSchema 的 certificate length 度量 QA 的时间难度：certificate 指足以让人类验证者确信该标注正确的最小 sub-clip 集合，certificate length 即这些子片段时长之和；每类随机抽 3 个视频统计，短、中、长视频的中位 certificate length 分别为 26s、164.7s 与 890.7s (E150, E151)。基准还按时长切分为 Video-MME-S/M/L 三个子集，各含 300 个视频与 900 个 QA (E106, E108)。

评测协议（4.1 Settings 与第 7 节）。受评模型共 16 个：4 个 commercial models 与 9 个代表性 open-source video MLLM，另加 3 个 advanced image MLLM 以检验基准对 multi-image 场景的适配性 (E173, E190)。其中 commercial models 为 GPT-4V、GPT-4o、Gemini 1.5 Flash 与 Gemini 1.5 Pro (E191)；open-source video MLLM 包括 Video-LLaVA、ST-LLM、ShareGPT4Video、VideoChat2-Mistral、VILA-1.5、Chat-UniVi-V1.5、VITA-1.0、VITA-1.5 与 LLaVA-NeXT-Video (E192)；advanced image MLLM 为 Qwen-VL-Chat/Max 与 InternVL-Chat-V1.5 (E193)。

视频统一转为多帧图像输入。对支持极长多模态上下文的 Gemini 1.5 Pro，短、中视频按 1 frame per second 采样，长视频按每 2 秒 1 帧采样以保证 API 稳定；其余模型遵循各自官方配置均匀采样固定帧数，例如 GPT-4V 取 10 帧、GPT-4o 取 384 帧，并尽量多取帧以充分释放其能力 (E194, E176)。启用字幕时，只取与所采帧时间戳对应的字幕——若采样 10 帧，就取这 10 个时间点各自的字幕，从而保证视觉与文本输入在时间上对齐、语义连贯 (E195, E170)。

推理与打分的输入组织为“complete video frames + complete subtitles/audios（可选）+ question with prompt”：模型若有默认的 multiple-choice prompt 则沿用默认，否则使用统一 prompt，并要求只输出选项字母 (E196, E197)。准确率由正则表达式抽取模型输出后直接与 ground-truth 答案比对，不借助 ChatGPT 等外部评判模型 (E198, E185)。评测在三种输入模态条件下展开，即 frames only、frames with subtitles 与 frames with audio，以便分离不同模态信息对视频理解的作用 (E182, E184)。