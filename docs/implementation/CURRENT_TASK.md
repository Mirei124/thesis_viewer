# 当前实现任务与子 agent 初始上下文

[返回总体进度](../IMPLEMENTATION_PROGRESS.md)

维护者：主 agent。当前批次：B013；执行 agent：`/root/b013_local_citation_index`。

## 第一部分：总体实现进度

- 项目目的：Chrome/Firefox 独立论文阅读扩展，本地解析、自配 API。
- 总体任务／阶段：Hypha `0001`；M2 文档解析与证据基础。
- 已完成并验收：B001–B012 已完成，含页级 block、coverage、自动章节及局部 offset 映射。
- 当前实现位置：每个 block 有页级锚点和规范化文本；尚无本地参考文献索引或正文引用 occurrence。
- 当前批次：B013；从本地 PDF block 构建保守参考文献候选和编号式正文引用候选，保留匹配依据和不确定性。
- 与前后关系：为 M3 cite 浮窗提供数据基础；本批不做浮窗、作者年份完整解析、外部检索或摘要关联。
- 状态：实现中；执行 agent：`/root/b013_local_citation_index`。

## 第二部分：当前细节目标清单

| ID | 小目标 | 完成条件／验证方式 | 状态／证据 |
|---|---|---|---|
| B013-01 | References 区候选 | 识别可能的 References 标题及后续条目 block，记录原始文本、anchor、置信和质量警告 | 未开始 |
| B013-02 | 编号引用 occurrence | 在正文 block 识别 `[1]`、`[1,2]`、`[1–3]` 等候选，关联到本地参考编号或标 ambiguous/unresolved | 未开始 |
| B013-03 | 可检查本地诊断 | 显示索引/匹配计数和状态，不联网、不猜 DOI/标题、不把不确定匹配伪称正确 | 未开始 |

- 允许修改：解析 src、阅读页最小诊断、样式、README、必要测试；不得修改总体追踪或 Hypha。
- 本批不包含：cite 浮窗、作者年份匹配、书目字段完善、外部联网、生成摘要、模型、持久化。
- 必需交付：Reference/Citation 数据类型与本地索引、明确状态、typecheck/双端构建和多页 PDF 验证。
- 验证要求：PDF.js 源项和章节候选不保证可靠阅读顺序；不能由页上一个 `[n]` 就确信是论文引用，必须保留依据和失败状态。
- 返回格式：逐项状态、修改文件、检查、未测项、风险、用户操作。

## 第三部分：相关背景知识

- 用户确认：cite 浮窗只用本地书目信息和已有本地摘要，不自动联网补全；不确定时显示未能可靠匹配。
- 架构：Reference 需保留原始书目、anchor、解析依据；CitationOccurrence 有显示标记、refIds、matched/ambiguous/unresolved。B013 只搭最小本地基础。
- 现有入口：`pdfPageBlocks` v2、自动章节/coverage、reader diagnostics；不可破坏现有权限、渲染与搜索。
- 已验证：B012 在 Firefox 正常；无复杂 citation PDF 真实样本保证。
- 必读：[架构第 4、7 节](../planning/02-architecture.md)、[实施第 2、3 节](../planning/05-implementation.md)、[B012](batches/B012.md)。
