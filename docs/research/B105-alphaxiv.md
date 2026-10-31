# B105 alphaXiv 论文问答调研

调查日期：2026-10-31。仅调研，没有登录、创建会话或调用付费模型。原始网页、官方实验代码与公开 Markdown 缓存在 `.local-cache/research/B105/alphaxiv/`；子 agent 未修改产品代码或总体进度。

## 结论与证据边界

能查到 alphaXiv **官方公开工具契约、研究博客及实验源码**，不必全靠相似产品推断。公开资料体现至少三种读论文路径：结构化报告、问题相关页、单篇全文问答。**不能由此断言线上 PDF 侧栏聊天每轮固定采用其中哪一种**，也未找到线上完整 system prompt、检索阈值、切段参数、history 压缩及 prompt/KV cache 实现。

证据等级：A＝官方文档／可检查源码对相应公开组件的直接说明；B＝官方产品说明，可证明能力不能证明后台算法；C＝基于证据给插件的设计建议，不是 alphaXiv 实现事实。研究仓库的 A 级证据只覆盖该版本实验，不可扩张为生产部署事实。

## 1. 当前官方 MCP：报告、全文与可引用页内容

[A，官方 MCP 文档](https://www.alphaxiv.org/docs/mcp)：`get_paper_content` 默认给 AI 生成的结构化中间报告；报告缺失回退提取全文，`fullText=true` 可直接读全文。`answer_pdf_queries` 按一篇论文的一组问题筛选相关页，返回带 paper ID 和页码的 XML，便于由原文构造引用；官方建议同论文问题批量提交。`discover_papers` 是跨论文发现：结合关键词、embedding 与可选多轮搜索。

这些契约说明“文献发现”和“论文内部取证”可以拆开，但**没有公开单篇页筛选内部是 embedding、词法、LLM、重排还是组合**。MCP 是外部 agent 接口，不自动等同网站侧栏的实现。

## 2. 2026-03 官方研究：检索与回答分工

[A，2026-03-10 官方 ArxivQA 博客](https://www.alphaxiv.org/blog/training-retrieval-agents-for-arxiv-search)：研究聚焦从 arXiv 库寻找可回答问题的论文；提出让小型训练检索器负责多跳检索，用户选择的较强模型负责综合回答。环境有关键词／语义检索以及按页读取，作者强调漏掉关键论文比多取少数论文更伤召回。博客把训练环境链接到下述官方仓库。

该结论主要面向**跨论文研究问题**，不是“单篇 PDF 每个问题都要跑多 agent”。博客也明确其检索模型未针对低延迟优化，所以不能将其复杂多跳轨迹当作阅读器首版的成本标准。

## 3. 官方实验源码：单篇工具确实直接输入全文

仓库：[alphaXiv/retriever-sandbox](https://github.com/alphaXiv/retriever-sandbox)，本地核对 commit `ff396661bd7f7891a86725001f9276d47887258e`（提交时间 2026-03-05）。只克隆读取，没有执行依赖或远程 API。

[A，askPaper.ts](https://github.com/alphaXiv/retriever-sandbox/blob/ff396661bd7f7891a86725001f9276d47887258e/src/tools/askPaper.ts)：收到论文 ID 和一个问题后加载该论文，清理每页文本并拼成全文；新建 Gemini 3 Flash agent，输入论文标题、ID、全文和问题。要求准确、简洁，论文没提供答案则说明，并限制输出最多 400 个空白分隔词；超长还会硬截输出。

可复核行号：全文拼接 L42–44、agent 指令 L45–58、输入组装 L60–65、调用 L67、输出截断 L69–72。其输入模板形状如下（占位符为本报告简写）：

```text
**Paper Title**: {论文标题}
**Universal ID**: {论文ID}
**Full Text**:
{各页清洗文本，空行拼接}
**Question**: {本次问题}
```

在这个函数里**没有**显式选择 top-k、embedding／reranker、历史消息、全文 token 预算或溢出回退，也没有强制每项回答带页引用。不能把这些未实现的细节误说成“由底层自动处理”。这恰好是可用于对照的全文基线，不是可直接照抄的完整可靠问答产品。

[A，db/services/papers.ts](https://github.com/alphaXiv/retriever-sandbox/blob/ff396661bd7f7891a86725001f9276d47887258e/db/services/papers.ts)：全文查询按页码排序，页面文本和论文摘要分开存储；页面另有英文全文检索向量。摘要 embedding 不等于全文每个段落都有 embedding。

[A，readPage.ts](https://github.com/alphaXiv/retriever-sandbox/blob/ff396661bd7f7891a86725001f9276d47887258e/src/tools/readPage.ts)：按论文 ID／页码取页，但实际只返回该页前 2000 字符，超过则带截断提示。它虽叫“读页”，实现并不保证完整一页；不应继承这种会遗漏页尾公式／表格解释的硬截断。

[A，research.agent.ts](https://github.com/alphaXiv/retriever-sandbox/blob/ff396661bd7f7891a86725001f9276d47887258e/src/agents/research.agent.ts)：顶层研究 agent 使用 Claude Sonnet 4.5，先并行多角度检索，再读摘要／页；片段不够时调用 Ask Paper，再依据读到的内容迭代查询。它证明的是实验中的**检索→必要时全文子问答→继续搜索**，不是所有回答一次性把全库内容塞入窗口。

## 4. 可公开读取的 Markdown 接口实测

[A，官方公开 lookup skill](https://www.alphaxiv.org/skills/alphaxiv-paper-lookup/SKILL.md)：指向 `overview/{id}.md` 结构化报告，不足时再取 `abs/{id}.md` 全文；404 分别表示报告／全文尚不可得。

仅对 Attention Is All You Need 作无鉴权 GET 验证：

| 接口 | 实测结果 | 可得出的结论 |
|---|---|---|
| [overview/1706.03762.md](https://www.alphaxiv.org/overview/1706.03762.md) | 24,910 bytes；作者／背景／动机／方法／结果／意义六个主要标题 | 中间报告比普通短摘要详细，但含生成性解释 |
| [abs/1706.03762.md](https://www.alphaxiv.org/abs/1706.03762.md) | 40,056 bytes；可读提取文本 | 另有完整原文读取路径 |

bytes 不是 token；仅一篇且没有评测报告事实准确率，不声称其更正确或普遍压缩到某比例。所读纯文本中的公式、表格布局也未做完整性验收。尤其不要把生成报告当成原文证据；它可导读／路由，回答细节应回查原文。

## 5. 选区、图片、历史、引用与缓存能确认多少

[B，官方扩展商店说明](https://chromewebstore.google.com/detail/alphaxiv-understand-resea/liihfcjialakefgidmaadhajjikbjjab)：支持对 PDF 直接聊天、选中论文片段、以 `@` 加入其他论文上下文。该说明未揭示选区周边扩展规则和整篇实际输入量。

[B，官方隐私政策](https://www.alphaxiv.org/privacy)，页面修订日期 2026-09-24：处理助手消息、历史、选中文字、引用和附件，可由第三方供应商执行上下文检索／生成等任务。这能证明多种输入存在，不能证明 PDF 总是作为视觉 token 输入，也不能证明聊天历史全量重发。供应商列表不等于当前某次请求模型，更不能据此承诺所有模型能力。

| 问题 | 截至调查可证实的范围 | 仍未知 |
|---|---|---|
| 全文还是 RAG | 公开实验 Ask Paper 为全文；当前 MCP 同时有报告／全文／相关页接口 | 生产网页单篇聊天的默认路由 |
| 图像／表格／公式 | 公开服务支持文件和图像附件 | 图片选择、解析器、视觉输入与文本对齐策略 |
| 多轮历史 | 产品存储助手历史；实验 Ask Paper 每次新建 agent | 线上历史裁剪、摘要、query rewrite／compaction |
| 引用 | MCP 页码 XML 支持可追溯引用 | 生产 claim-level 引用校验与坐标映射细节 |
| 缓存 | 公开 .md 存在可复用内容服务 | 解析缓存失效、页筛选缓存、prompt/KV cache、命中率 |
| 预算与重排 | 文档和实验能看见工具边界 | 线上分块长度、top-k、reranker、上下文余量 |

## 6. 对当前插件的建议（C，供主 agent 综合，并非本轮实现）

1. **保留全文基线**。单篇正常长度论文可先测“带页／段 alias 的完整正文＋当前问题”，与现有章节扩展检索对照；不要预设 RAG 必然优于可容纳的全文。
2. **分别实现取证和生成接口**。已有段落、章节及 PDF 锚点可组成统一 evidence API：按问题找段→扩展同节／相邻段→不足时读整节。未来换 embedding 时生成协议和引用定位不需要重写。
3. **选区优先但不限制为选区**。选中文字仅作为指代目标；用户问模块意义／公式推导时，需要周围定义和所在章节。单纯复述选区会重演此前方法概览证据不完整的问题。
4. **报告是索引，不是事实替身**。已有详细概览可辅助定位主题，但证据必须落到原文 alias；跨轮助手自己的回答也不能作为新的论文事实来源。
5. **明确预算与历史策略**。按可用窗口减去系统提示、问题、history 和输出保留计算证据容量；对溢出按章节优先级缩减，不静默硬截文本。多轮追问要将指代补齐用于检索，答案仍只引实际选入原文。
6. **先做有限补检索，再考虑多 agent**。alphaXiv 的跨库 RL 训练与多 agent 并非本地单篇首版必需；对当前插件可先评估一轮检索＋一次缺证据补读，比直接移植复杂研究 agent 更易验收。

建议评测问题包含：直接事实、公式／符号定义、完整方法、跨章节设计动机、实验表格、选区指代、多轮追问、论文没说的内容。记录答案正确性、证据召回、引用支持度、输入 token、首字延迟／总延迟；对“材料不足”区分源文无答案和检索漏召回。
