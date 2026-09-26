# B031-R：本地 PDF 证据块检索／重排序调研

日期：2026-09-26。范围：为详细概览的“本轮应新增哪些可信正文块”作出首版实现选择；不改变模型输出、alias 校验或远端 API。

## 结论

仍然需要解决“选哪些文字块”。B030 的递进会话只改变了**何时**追加证据，并没有让 `slot + 章节 + PDF 顺序` 成为语义检索；B029 的“方法栏只拿到标题／作者／编号／标点”正是这个缺口的实测证据。应把问题拆成：先从本地全文找足够可读的候选，再按栏目和论文结构重排序；不能让 LLM 从全文自行挑选，也不能因检索而取消本地 anchor 核验。

**首版建议：本地、无模型的 section-aware lexical retrieval（字段化 BM25 风格评分）+ 邻接段落扩展 + 多样性选择。** 它不新增下载模型、第三方服务或扩展包大体积依赖；对论文栏目中常见的专名、缩写、数据集、`ablation` 等关键词尤为稳妥。它直接针对现在的“噪声 fallback”失败，并可在导入后离线建立索引。这个选择是工程推断，不声称在所有论文上优于 dense retrieval。

**后续增强：本地可选 hybrid retrieval（lexical 候选 + 用户显式下载的多语 embedding 双塔 + RRF）**；只在首版离线评测显示 lexical 对同义表述召回不足时加入。不要把 cross-encoder/ColBERT 作为首版，也不要把远程 embedding API 当作前提。

## 研究事实与约束

### 已验证事实

- BM25 源自概率相关性框架，是成熟的词项匹配／排序方法；Robertson 与 Zaragoza 的综述覆盖 BM25 及其带字段的 BM25F 形式。[论文与 DOI](https://doi.org/10.1561/1500000019)
- 双编码 dense passage retrieval 可为 query 和 passage 各自编码并以向量相似度检索；DPR 在其开放域 QA 评测中相对 BM25 有较高 top-20 召回，但这不等于未经训练的浏览器内 embedding 对论文摘要必然更好。[DPR 原论文](https://arxiv.org/abs/2004.04906)
- ColBERT 的 late interaction 保留 token 级相似度并预先计算 passage 表示；原作者报告其目标是大规模检索，需 BERT 编码及向量索引。[原论文](https://arxiv.org/abs/2004.12832) [作者实现](https://github.com/stanford-futuredata/ColBERT)
- 当前 Chrome MV3 的后台是按需运行的 service worker，不能作为长驻的索引／模型计算宿主；本项目的 Reader 页面或 worker 才是合适的运行处。[Chrome MV3 文档](https://developer.chrome.com/docs/extensions/develop/migrate/what-is-mv3)
- IndexedDB 能保存大量结构化数据、支持索引且可在 Web Worker 使用；扩展同样受浏览器存储配额和可能的淘汰约束，必须处理写入失败／重建。[MDN](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API) [Chrome 扩展存储说明](https://developer.chrome.com/docs/extensions/develop/concepts/storage-and-cookies)
- 一个 query 与 passage 联合前向计算的 cross-encoder 通常有很强的重排序效果，但每个候选都要运行模型；即使低延迟研究也把其成本作为核心限制。[Shallow Cross-Encoders](https://arxiv.org/abs/2403.20222)

### 合理推断（需本项目实验验证）

- 单篇论文通常只有数十到数百个可用正文块，字段化 lexical 打分和轻量 token 倒排索引的运行时间应远小于一次远端摘要调用；其瓶颈更可能是 PDF 解析质量，而非检索算法。
- 文献结构是强先验：方法、实验、局限不能只靠全局 `top-k`，应作为 filter/boost 字段而非绝对硬过滤；标题识别错时仍要能从全局正文找到候选。
- 随会话递进的栏目 query 可加入已发送证据的关键词，但不得把 assistant 草稿作为事实或把其文字直接当 query 的唯一来源；固定栏目 query 与结构字段应始终保底。

### 待实验假设

- 首版 lexical 是否能将“方法”前 5 候选中可读正文的比例显著提升，且不降低实验／局限栏的 evidence 覆盖。
- 为方法和实验加入前后相邻段（parent/neighbor expansion）是否比单块截断更容易让模型形成连贯描述。
- 中英混合、数学符号密集、双栏乱序 PDF 是否需要针对 CJK 的 unigram/bigram 或字母数字 token 规则；不可先假定英文 BM25 参数通用。

## 方案比较

| 方案 | 本地可行性／隐私 | 延迟与包体 | 对当前失败的预期 | 风险与结论 |
|---|---|---|---|---|
| 固定 slot + 文本顺序（当前） | 完全本地 | 最低 | 无法区分方法正文和首页元数据 | 已被 B029 反例否定，不应继续作为主要选择器 |
| 关键词／字段化 BM25 风格 + 结构 boost | 纯 TypeScript，索引只存本地；不发送全文或密钥 | 导入时一次建 token/df；栏目检索毫秒级量级（待测） | 可用栏目 query 命中 `we propose`、`architecture`、`trained`、`ablation`、`limitation` 等正文信号，并保留章节先验 | **首版推荐**；同义改写／弱标题时会漏召回，保留全局回退 |
| 本地 dense embedding 双塔 | 可行，但模型文件、WASM/WebGPU/CPU 兼容、首次下载和存储均需设计；全文仍只在设备内 | 首次下载与编码慢，向量占用可观；后续 query 快 | 有望改善同义匹配和弱标题 | 作为可选增强；需模型许可、离线包体、Firefox/无 WebGPU 降级和语种评测 |
| hybrid lexical + dense，RRF 融合 | 同上，且不需远程服务 | 多一套向量与索引 | 通常比单一路径更稳，BM25 可补专名／数字 | 后续增强；不能未评测即把复杂度带入首版 |
| cross-encoder reranker | 需本地模型与每 query×候选推理 | k 候选逐一推理；MV3/低端设备风险高 | 排序质量潜力大 | 不作为首版；若未来引入，仅 rerank lexical/dense top-12，并可取消 |
| ColBERT/late interaction | 本地可做但专为大量语料设计，token 向量索引和模型复杂 | 包体、向量量、WASM/WebGPU 风险最大 | 对单 PDF 小集合属于过度设计 | 不采用；其预计算优势不抵实现成本 |
| 远程 embedding 或让 LLM 先选块 | 全文将额外发送给新服务，或增加主模型调用 | 网络、费用、隐私、失败面增加 | 可能看似相关但难控、慢 | 不采用为首版；违反“无必需后端／不泄露全文给新增第三方”的约束 |

## 推荐的 B031-I 设计

### 1. 索引时机与数据模型

在 `EvidenceLedger` 已形成、且 B030 噪声过滤完成后，于 Reader/解析 worker 为每个 `documentVersion + extractionVersion` 建本地 `RetrievalIndex`。不在 service worker 存可变内存状态。

每个可检索单元仍指向**原始 evidence candidate**，只新增可再生成的检索字段：

```text
RetrievalRecord {
  evidenceId, blockId, pageIndex, sourceOrder, section, slot,
  normalizedText, tokenFrequency, length,
  sectionPathTokens, qualityTier, neighborIds
}
```

- 仅合格的可读正文进入主索引；References、Appendix（除非栏目明确需要）、标题/作者/机构/DOI/URL/email、纯数字或标点、过短片段不进入。
- 保留一个“全局可读正文”回退池，而不是将低质量元数据塞回结果。若没有合格正文，返回明确的 coverage 缺失，模型请求应少发或不发。
- `evidenceId`、`blockId`、全文和 token 索引只留本地 IndexedDB/内存；发给模型前仍由 `EvidencePacket` 映射到稳定 `E001` alias 和短 quote。
- `neighborIds` 只能连接同一 sectionPath、同页或相邻 sourceOrder 的合格正文；扩展时重新做长度与重复控制，防止双栏错序污染。

### 2. 栏目 query 和初选

每一栏构造**确定性、可审计** query，而不是向 LLM 问“选什么”：

| 栏目 | 固定 query 词／字段 boost（示例，需中英 token 化） | 目标候选 |
|---|---|---|
| 问题／动机 | `problem, challenge, limitation, motivate, however, aim, address`；Abstract/Introduction boost | top 4 + 1 邻接 |
| 方法 | `we propose, framework, method, architecture, approach, model, consists, training, inference`；Methods 强 boost、Introduction 次 boost | top 5 + 每个命中 0–1 邻接 |
| 核心贡献 | `contribution, propose, introduce, novel, demonstrate, we make`；Introduction/Conclusion boost | top 4 + 1 邻接 |
| 相对创新 | `unlike, compared, prior, previous, existing, different, related work`；Introduction/Related Work/Methods boost | top 4 + 1 邻接 |
| 实验／消融 | `experiment, evaluate, dataset, baseline, result, table, ablation, performance`；Experiments/Results 强 boost | top 6 + 必要邻接 |
| 局限 | `limitation, limitation(s), future work, fail, failure, cannot, only, restricted`；Discussion/Conclusion boost | top 4；无命中可用实验范围块，不能捏造作者局限 |

具体实现使用 Unicode 规范化、字母数字 token、CJK unigram/bigram 的小型可测 tokenizer；可维护的双语栏目词表是产品规则，版本化进 `retrievalVersion`。先按正文长度归一的 lexical score 排序，再加如下透明 bonus/penalty：section 精确命中 > 相邻相关 section > global；slot 仅是弱 boost；质量 tier、过短、重复和近页页眉均降权。不要将自动 section 名称当硬门槛。

### 3. 重排序、多样性与递进会话

1. 对全部主索引求 lexical score，取每栏 top 12。
2. 去掉 near-duplicate；同一 block/同页连续块最多保留两个，使用 MMR 风格“相关性 − 与已选文本相似性惩罚”选出预算内的 `4/5/4/4/6/4` 个新块。这里的相似度可先以 token Jaccard 实现，不必 embedding。
3. 若第一名是段中短句，则追加一个合格前/后邻居，且替换掉最低分重复项；输出仍受 B030 的每栏容量／字符预算约束。
4. session 已有 alias 的块不重复追加；新的候选按第一次发送的顺序获得全局 `E001…`。模型只能引用“至本轮已发送”的 alias。
5. score 低于门槛或没有合格块：不发送伪证据。栏目直接本地标记材料不足／覆盖不足，UI 说明“未检索到可读正文”，并记录可诊断原因（无正文、无 query 命中、仅低质量块）。

### 4. 与现有可验证性契约的边界

检索只返回 `EvidenceCandidate[]`，绝不生成模型可见事实。`EvidencePacket` 继续负责短 alias、quote 截断和别名映射；响应仍须经 `resolveEvidencePacketAliases` 与当前 PDF 的 quote/block/precision/anchor 校验。检索得分、section 推断和邻接关系不应发送给模型，也不能代替证据。这样无论 BM25 选错还是 embedding 选错，错误最多导致“材料不足／低质量摘要”，不会让无锚点的内容通过。

### 5. 失败降级和可观察指标

- **无文本／扫描件／partial coverage：** 不建完整索引；显示解析覆盖不足，不把页面坐标、标题或 OCR 缺失伪装成方法证据。
- **索引存储失败：** 在当前 Reader 内临时建索引；失败时采用“合格正文 + section/长度/去重”的确定性 scan，仍禁止元数据 fallback。下次可重建。
- **未知章节：** 使用全局 lexical top-k + 质量过滤；在结果 coverage 标识 `section-unknown`。
- **请求取消／恢复：** index 可由文档重新生成；渐进 session 的 alias 映射只在当前任务保留，不能跨文档版本复用。

验收时须保存匿名化、无正文的诊断数值而不是请求内容：候选总数、质量过滤数、每栏目 `top-k` 的 section/页分布、是否 query 命中、追加 alias 数、材料不足原因、索引耗时/大小。建立至少 10 篇不同版式论文的小型本地 gold set：人工对每栏目标 1–3 个可用 blockId；比较当前 selector 与新 selector 的 Recall@k、MRR、可读正文率、重复率、首次详细概览耗时和发送字符数。用户可点击确认的 evidence chip 只验证锚点正确，不能单独证明检索召回正确。

## 不应做的事

1. 不把完整 PDF、原始 evidence ID 或 offset 传给一个“选块 LLM”；这会增加隐私／成本且绕开现有本地校验设计。
2. 不因 prefix cache 把无关全文持续塞入对话；缓存命中不等于证据相关，且长上下文仍会让生成变慢、发生注意力稀释。
3. 不把 BM25 分数或自动 slot 当作事实真值，也不以其为理由放宽 alias/quote/anchor 核验。
4. 不在首版引入 WebGPU、远程模型下载、ColBERT 或 cross-encoder；先用测量证明 lexical 首版不够，再把 dense 做成可选、可禁用的本地能力。

## B031-I 切分建议

- **I1：** `retrievalIndex`（tokenizer、质量准入、字段化 lexical score、可复现排序）及单元测试；不接模型。
- **I2：** 分栏目 selector（diversity/neighbor expansion/coverage 原因）接入 B030 的“新增证据”决定处，保留 session alias 与旧 fallback 的安全规则。
- **I3：** 诊断和 gold-set 评测工具；由人工样本结果决定是否进入 optional dense/hybrid 调研与原型。

这能让小问题先以少量高分正文回答；方法／实验等需要更多上下文的后续栏目再递进增加经检索的相邻正文，而不是仅因栏目靠后就追加更多随机块。
