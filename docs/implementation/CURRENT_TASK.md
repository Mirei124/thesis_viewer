# 当前实现任务与子 agent 初始上下文

[返回总体进度](../IMPLEMENTATION_PROGRESS.md)

维护者：主 agent。当前批次：B016；执行 agent：`/root/b016_local_cite_popover`。

## 第一部分：总体实现进度

- 项目目的：Chrome/Firefox 独立论文阅读扩展，本地解析、自配 API。
- 总体任务／阶段：Hypha `0001`；M3 高亮与 cite 浮窗。
- 已完成并验收：B001–B015 已完成，含本地 Reference/CitationOccurrence 索引和持久化手动高亮。
- 当前实现位置：B013 可显示引用诊断，但正文文本层没有可点击 cite 交互，也没有 reference card。
- 当前批次：B016；在当前页编号引用 marker 上提供本地 cite 浮窗，显示原始条目、状态、依据和安全的新标签链接（若本地已有），并支持关闭与参考页跳转。
- 与前后关系：不解析作者年份、不联网、不启动模型；已有本地摘要关联和复杂歧义候选留后续。
- 状态：实现中；执行 agent：`/root/b016_local_cite_popover`。

## 第二部分：当前细节目标清单

| ID | 小目标 | 完成条件／验证方式 | 状态／证据 |
|---|---|---|---|
| B016-01 | marker hit region 与浮窗 | 仅在本地识别的编号式 marker 上添加不破坏选择的可点击区域；点击不先跳文末 | 未开始 |
| B016-02 | 本地 reference card | 显示原始条目、编号、matched/ambiguous/unresolved 与依据；多引用显示列表，未匹配保持真实状态 | 未开始 |
| B016-03 | 键盘/链接/降级 | Esc/外部关闭并返回焦点；跳参考页；仅允许本地 http/https 来源链接新标签，不能模型猜测/联网 | 未开始 |

- 允许修改：cite/阅读页相关 src、样式、README、必要测试；不得改总体追踪或 Hypha。
- 本批不包含：作者年份 marker、联网补全、被引论文摘要、AI 请求、reference 持久化扩展、跨页自动 hit region。
- 必需交付：可访问的本地 cite 浮窗、状态/依据、typecheck/双端构建和真实 PDF 验证。
- 验证要求：匹配状态不等于语义正确；无/歧义引用不能显示伪造书目。普通文本选择必须继续可用。
- 返回格式：逐项状态、修改文件、检查、未测项、风险、用户操作。

## 第三部分：相关背景知识

- 用户契约：cite 浮窗仅用本地对应参考文献条目、标题/作者/年份、DOI/原文链接和已有本地摘要；不自动联网补全。无明确匹配必须说明并可跳文末。
- 架构：CitationOccurrence 含 marker、refIds、matched/ambiguous/unresolved；Reference 原始书目与 anchor、解析依据。B013 只实现编号式单项索引。
- 现有入口：`pdfCitationIndex` 与 reader diagnostics、B014 highlight selection。cite hit region 不得拦截普通选择或破坏 TextLayer。
- 已验证：Video-MME matched 和 Ghostscript unresolved 都经 Firefox 测试；高亮持久化正常。
- 必读：[架构第 7、10 节](../planning/02-architecture.md)、[实施第 1、3 节](../planning/05-implementation.md)、[B013](batches/B013.md)、[B015](batches/B015.md)。
