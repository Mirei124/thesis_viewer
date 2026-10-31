# B105：开源论文／PDF 问答的上下文构造源码调查

调查日期：2026-10-31。只读官方公开仓库源码，未运行模型、未测实际问答质量或费用。当前 `main` 的固定快照：

- FutureHouse PaperQA：`c692d0dfeac4a0296599f7fe21a253a58b7ac12a`。
- Cinnamon kotaemon：`9ad3e4e49aa35b8acddd235918a5d9753c1cfdf9`。

源码缓存：`.local-cache/research/B105/opensource/{paper-qa,kotaemon}/`。以下数值是这两个快照的默认／分支行为，不代表历史论文中的实验设置，也不能推断 alphaXiv 使用同一架构。

## 结论先行

两个项目都把“存储与召回单位”和“最终模型看到的上下文”分开。PaperQA 主要把召回块压缩为**与当前问题相关的证据摘要**后再生成；kotaemon 主要把召回的**原文、窗口、表格、图像**拼成上下文再生成。它们都不证明“固定取几个很短片段”适用于单篇论文的方法复述。

对本插件，适合复用的是检索／上下文构造／引用锚点的分层、文档作用域过滤、证据去重、未知时拒答，以及可选向量增强；不宜直接照搬服务器依赖、默认块数或逐块摘要调用。若问“完整解释这篇的方法”，应允许整个相关章节进入输入；局部问题才走较小原文证据窗口。这个路由建议是本报告的工程推断，不是两个项目已验证的最优结果。

## 1. PaperQA：召回 → 逐块问题相关摘要与评分 → 最终答案

### 可核实的源码链

1. **解析与分块**：PDF 解析器优先可用的 PyMuPDF 插件，回退 PyPDF；`reader_config` 默认 `chunk_chars=5000, overlap=250`，注意单位是**字符**。`chunk_pdf()` 顺序拼页并按字符长度切片，保留页范围；不是按完整语义段落／章节切分。分块可以跨页。[设置](https://github.com/Future-House/paper-qa/blob/c692d0dfeac4a0296599f7fe21a253a58b7ac12a/src/paperqa/settings.py#L170-L255)、[分块与页范围](https://github.com/Future-House/paper-qa/blob/c692d0dfeac4a0296599f7fe21a253a58b7ac12a/src/paperqa/readers.py#L90-L143)
2. **建索引与召回**：`Docs.retrieve_texts()` 构建／更新内部文本向量索引，按问题执行 MMR 接口，`k=evidence_k=10`，`fetch_k=2*k`，剔除已删除文档。`texts_index_mmr_lambda` 默认为 `1.0`，不应因调用名包含 MMR 就宣称默认做了强多样性去重。[检索](https://github.com/Future-House/paper-qa/blob/c692d0dfeac4a0296599f7fe21a253a58b7ac12a/src/paperqa/docs.py#L430-L490)、[索引设置](https://github.com/Future-House/paper-qa/blob/c692d0dfeac4a0296599f7fe21a253a58b7ac12a/src/paperqa/settings.py#L802-L824)
3. **证据模型输入**：每个召回 `Text` 分别调用 `map_fxn_summary()`，发送 system + user；user 内是 citation、该块原文、当前 question。要求保留数字／方程等相关细节，默认证据摘要约 100 词；输出摘要并给相关性分。表格会把 Markdown 表格并入块，关联图像可作为多模态输入。默认并发 4，而不是只发一次统一 rerank。[证据流程](https://github.com/Future-House/paper-qa/blob/c692d0dfeac4a0296599f7fe21a253a58b7ac12a/src/paperqa/docs.py#L492-L586)、[证据实际 messages](https://github.com/Future-House/paper-qa/blob/c692d0dfeac4a0296599f7fe21a253a58b7ac12a/src/paperqa/core.py#L178-L285)、[prompt](https://github.com/Future-House/paper-qa/blob/c692d0dfeac4a0296599f7fe21a253a58b7ac12a/src/paperqa/prompts.py#L1-L24)
4. **最终上下文**：摘要按相关分降序、名称排序，取 `answer_max_sources=5` 后再按阈值过滤。默认阈值 1。上下文序列化为 `证据key: 摘要 + 文献citation`，末尾附合法 keys；最终模型通常看的是摘要，不是所有原文块。[排序与序列化](https://github.com/Future-House/paper-qa/blob/c692d0dfeac4a0296599f7fe21a253a58b7ac12a/src/paperqa/settings.py#L1179-L1250)、[序列化模板](https://github.com/Future-House/paper-qa/blob/c692d0dfeac4a0296599f7fe21a253a58b7ac12a/src/paperqa/prompts.py#L164-L167)
5. **答案 messages**：最终 `Docs.aquery()` 使用 system + 单个 user；user 包括组装后的 context、question、篇幅与引用规则。证据不够则拒答。可选 prior answer 迭代会把先前答案放入 prompt，但这是围绕当前问题的会话状态，不能等同普通聊天 UI 最近 N 轮历史。[答案构造](https://github.com/Future-House/paper-qa/blob/c692d0dfeac4a0296599f7fe21a253a58b7ac12a/src/paperqa/docs.py#L588-L730)、[答案与迭代 prompt](https://github.com/Future-House/paper-qa/blob/c692d0dfeac4a0296599f7fe21a253a58b7ac12a/src/paperqa/prompts.py#L29-L75)

### 数值、成本与边界

| 项目 | 源码事实 | 对本插件的含义（推断） |
|---|---|---|
| 首轮块 | 5000 字符、250 重叠；默认取 10 块 | 不能当成 5000 token；不保证方法完整 |
| 证据压缩 | 每块约 100 词摘要＋相关分 | 先压缩可能丢公式条件、模块定义；适合多篇证据综合，未必适合完整方法教学 |
| 最终来源 | 最多 5 个 Context | “source”实际是证据 context，不一定是 5 篇不同论文 |
| LLM 次数 | 无重试且均摘要成功的简单路径，最多约 10 次证据调用＋1 次答案；可选 pre/post 与 agent 工具循环另加 | 不是低延迟单请求方案；并发 4 只能减少墙钟时间，不能消除费用 |
| embedding | 入库默认即时 embedding；也支持 defer；检索时补嵌入并维护索引 | 可复用已算向量；不等于所有部署跨会话都有自动持久答案缓存 |
| 全文开关 | `evidence_retrieval=False` 会处理所有 texts；最终仍默认最多 5 个摘要 | 不是“全文原文直接输入最终模型” |
| 禁用摘要 | `evidence_skip_summary=True` 时 Context 使用 cleaned 原文并默认分数 5 | 可绕过摘要损失，但最终 sources 数和 prompt budget 仍需单独设计 |

上述开关／默认值见[AnswerSettings](https://github.com/Future-House/paper-qa/blob/c692d0dfeac4a0296599f7fe21a253a58b7ac12a/src/paperqa/settings.py#L95-L165)、[无摘要分支](https://github.com/Future-House/paper-qa/blob/c692d0dfeac4a0296599f7fe21a253a58b7ac12a/src/paperqa/core.py#L330-L366)、[入库与 embedding](https://github.com/Future-House/paper-qa/blob/c692d0dfeac4a0296599f7fe21a253a58b7ac12a/src/paperqa/docs.py#L350-L400)。

**多模态**：该快照默认启用媒体解析并通过 enrichment LLM 生成描述；不 enrichment 的较省成本模式也存在。媒体描述帮助检索，证据摘要阶段可送原图。最终答案阶段主要送序列化 Context；不能宣称最终生成器始终看了全部原图。初次导入还可能发生文献元数据推断、图像 enrichment 调用，不能只按 11 次估算整条链成本。[媒体模式](https://github.com/Future-House/paper-qa/blob/c692d0dfeac4a0296599f7fe21a253a58b7ac12a/src/paperqa/settings.py#L196-L258)

**引用**：合法证据 key 与底层 `Text`／`Doc`、页范围关联，答案后处理生成参考文献；不是要求模型重建 PDF 坐标。适合借鉴“模型只引用短 key、本地映射原文”的分工。本插件已有更细的段落成员／锚点，可以保留，不必降级成页级引用。

**未知**：本次没有验证当前 agent 工具循环对聊天多轮指代的最佳策略、所有 parser 的版面质量、供应商级 prompt cache 命中率或生产成本；也未以静态默认值推断 PaperQA2 论文实验的 top-k。

## 2. kotaemon：混合召回／重排 → 原文证据拼接 → 带聊天历史的生成

它是自托管 Python/Web 应用，不是纯浏览器扩展；但文件范围筛选、原文证据窗口、PDF 高亮引用更接近阅读器。

### 可核实的源码链

1. **文件分块**：`FileIndexingPipeline` 默认创建 `TokenSplitter(1024, overlap=256)`，分隔优先 `\n\n`，回退换行／句号／零宽空格，允许开发设置覆盖。注意底层 `TokenSplitter` 类自身默认 overlap=20；应用文件流程显式传 256，应以调用点为准。[文件分块调用](https://github.com/Cinnamon/kotaemon/blob/9ad3e4e49aa35b8acddd235918a5d9753c1cfdf9/libs/ktem/ktem/index/file/pipelines.py#L760-L790)、[底层 splitter](https://github.com/Cinnamon/kotaemon/blob/9ad3e4e49aa35b8acddd235918a5d9753c1cfdf9/libs/kotaemon/kotaemon/indices/splitters/__init__.py#L10-L40)
2. **文件作用域**：检索前限定已选文档 ID，转成 chunk scope 与 file_id filter；未选文件直接返回空。不把用户其他论文静默混进答案。[文件检索](https://github.com/Cinnamon/kotaemon/blob/9ad3e4e49aa35b8acddd235918a5d9753c1cfdf9/libs/ktem/ktem/index/file/pipelines.py#L115-L178)
3. **召回与重排**：`VectorRetrieval` 支持 vector/text/hybrid；hybrid 并发全文检索和向量检索，合并后跑配置的 reranker，再裁到 top-k。`do_extend=True` 时首轮取 `10*top_k`；UI 默认取 10 块、hybrid、启用 reranking（类字段 top_k 自身是 5）。这里不是“默认 RRF”，源码链没有展示 RRF。[召回合并](https://github.com/Cinnamon/kotaemon/blob/9ad3e4e49aa35b8acddd235918a5d9753c1cfdf9/libs/kotaemon/kotaemon/indices/vectorindex.py#L116-L250)、[UI 默认](https://github.com/Cinnamon/kotaemon/blob/9ad3e4e49aa35b8acddd235918a5d9753c1cfdf9/libs/ktem/ktem/index/file/pipelines.py#L245-L312)
4. **原文上下文**：`PrepareEvidencePipeline` 对每块附文件名和页码，普通块优先使用 metadata.window，否则原文；表格优先 table_origin，去重，最多插入 5 个表格；图像附 caption 与 images。默认证据文本上限 32000 token，以 GPT-3.5 tokenizer 裁剪，保留第一个分块。这是证据上限，不是包括 system、历史、输出预留的总预算计算；可能在末尾截断，不能称为语义完整预算管理。[组装与裁剪](https://github.com/Cinnamon/kotaemon/blob/9ad3e4e49aa35b8acddd235918a5d9753c1cfdf9/libs/kotaemon/kotaemon/indices/qa/format_context.py#L15-L133)
5. **最终 messages**：可选 system，最近 N 轮 user/assistant，最后是 evidence + 当前 question 的 user prompt；N 默认 5。有图时最多附 10 张图。证据不足要求不编造；基本文本流程没有逐块证据摘要这一必经步骤。[实际 messages](https://github.com/Cinnamon/kotaemon/blob/9ad3e4e49aa35b8acddd235918a5d9753c1cfdf9/libs/kotaemon/kotaemon/indices/qa/citation_qa.py#L195-L271)、[默认 N 与配置](https://github.com/Cinnamon/kotaemon/blob/9ad3e4e49aa35b8acddd235918a5d9753c1cfdf9/libs/ktem/ktem/reasoning/simple.py#L348-L386)

### 聊天历史的一个重要反例

`AddQueryContextPipeline` 的确实现了“历史＋当前问题→独立搜索查询”，也有 query rewrite 类；但基础 `FullQAPipeline.retrieve()` 中调用它的代码被注释，实际 `query=message`。所以**默认最终生成器带历史，不等于默认检索器知道‘它／这个模块’指的是什么**。若本插件实现追问，必须单独定义 query rewrite 或显式选区／章节状态，而不能只把旧聊天塞到最终模型。[实现与被注释调用](https://github.com/Cinnamon/kotaemon/blob/9ad3e4e49aa35b8acddd235918a5d9753c1cfdf9/libs/ktem/ktem/reasoning/simple.py#L42-L140)

### 引用与调用成本

- 原来的 citation 模式会并行额外调用 citation pipeline，从证据提取相关引文，再用本地文本匹配找 span；这不是“答案有文件名就自动可靠定位”。[引用匹配](https://github.com/Cinnamon/kotaemon/blob/9ad3e4e49aa35b8acddd235918a5d9753c1cfdf9/libs/kotaemon/kotaemon/indices/qa/citation_qa.py#L296-L370)
- inline 模式要求模型同时输出编号、复制原文的起止短语及带编号答案，后处理解析和匹配。这可少一次独立 citation 请求，但 exact-copy／模糊定位会有模型格式与重排后的文本映射风险。[inline prompt 与解析](https://github.com/Cinnamon/kotaemon/blob/9ad3e4e49aa35b8acddd235918a5d9753c1cfdf9/libs/kotaemon/kotaemon/indices/qa/citation_qa_inline.py#L17-L150)
- 基础回答可为 1 次生成，embedding 查询另算；reranker 可能本地 cross-encoder 或 LLM／API。配置启用 LLM relevant scoring、citation、mindmap、rewrite 会增加调用，不能笼统宣传为“每问一次 API”。`generate_relevant_scores()` 在回答同时线程运行，主要供 UI 展示，不是所有情况都会先按该分数重排完再生成。[主流程](https://github.com/Cinnamon/kotaemon/blob/9ad3e4e49aa35b8acddd235918a5d9753c1cfdf9/libs/ktem/ktem/reasoning/simple.py#L280-L325)
- 文件复制到本地 hash 路径，索引建立在 VS／DS／关系数据库，可检测文件是否已索引、支持 reindex；比浏览器扩展重很多。[文件持久化](https://github.com/Cinnamon/kotaemon/blob/9ad3e4e49aa35b8acddd235918a5d9753c1cfdf9/libs/ktem/ktem/index/file/pipelines.py#L466-L540)

**整篇问题边界**：本次核实的基础 pipeline 不自动判断“解释完整方法”并扩展整章节，也没有证明 top10＋32000 token 能覆盖所有关键定义。可选 decomposition／ReAct 等另外存在，不能当成 basic 默认链。支持 tables/figures 依赖所选 loader 的媒体抽取质量，不保证普通 PDF text loader 自动恢复表格。

## 3. 给 Thesis Viewer 的具体取舍（建议，尚未实测）

| 可借鉴 | 建议落地形式 | 避免照搬 |
|---|---|---|
| PaperQA 的证据 key | 复用现有段落 alias→members→PDF anchor；每轮记合法来源集 | 让模型输出坐标、凭答案句子全文猜位置 |
| kotaemon 的作用域 | 单篇为默认边界；选区／用户指定章节优先 | 自动混入其他历史论文 |
| 问题相关原文 | 局部问题召回段落后有界补相邻段、合并完整窗口；方法／动机问题扩大到整章节 | 机械固定 5／10 块、全都摘要成 100 词 |
| 多轮 messages | 检索查询明确补全指代；最终保留近期对话；对话内容不是论文证据 | 把答案历史当作经过核实的论文事实；仅最终模型带历史 |
| 可选摘要 | 很长论文、多篇比较或超预算才压缩，保留原文回链与关键公式／条件 | 每问先对 10 个块调用摘要模型，增加延迟与信息损失 |
| 可选 embedding | 后续独立远程 embedding 配置，缓存按文档hash＋模型＋分块版本失效 | 首版硬依赖向量服务、把当前无向量用户配置弄坏 |
| 多模态 | 明确“问题引用图／表”时发送关联页裁图或可靠表格文本 | 默认全文所有页截图，放大 GPU／网络／token 占用 |
| 预算 | 每次统一计算 system＋证据＋历史＋问题＋输出预留，按完整段落删减并告知缺口 | 仅裁 evidence 字符串后假定不会超窗口 |

两项目均 Apache-2.0（分别见仓库 LICENSE／LICENSE.txt）；此处建议借鉴流程，不建议把 Python 服务栈迁入扩展。检索／prompt／引用模块需以独立问答验收集验证：局部事实、跨段指代、整节方法、公式符号、表格比较、缺证据拒答及多轮追问；本报告没有给出未经测试的准确率或性能百分比。
