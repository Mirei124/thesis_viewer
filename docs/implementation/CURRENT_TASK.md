# 当前实现任务与子 agent 初始上下文

[返回总体进度](../IMPLEMENTATION_PROGRESS.md)

维护者：主 agent。当前批次：B010；执行 agent：`/root/b010_page_blocks_coverage`。

## 第一部分：总体实现进度

- 项目目的：Chrome/Firefox 独立论文阅读扩展，本地解析、自配 API。
- 总体任务／阶段：Hypha `0001`；M2 文档解析与证据基础。
- 已完成并验收：M0/M1 B001–B009 已完成；PDF 可导入、阅读、搜索、导航并恢复视图。
- 当前实现位置：PDF.js 仅用于渲染/搜索，尚无面向后续引用、摘要和高亮的稳定文本块、页面锚点或覆盖数据。
- 当前批次：B010；从所有 PDF 页提取原始文本项，建立页级稳定块和 page anchor，报告可提取页/无文本页 coverage。
- 与前后关系：为后续章节、坐标映射、引用索引、证据和生成提供最小数据基础；不尝试双栏重排、章节分类、引用匹配或持久化。
- 状态：等待用户 GUI 验证；执行 agent：无（`/root/b010_page_blocks_coverage` 已返回）。

## 第二部分：当前细节目标清单

| ID | 小目标 | 完成条件／验证方式 | 状态／证据 |
|---|---|---|---|
| B010-01 | 页级文本块与稳定 ID | 从每页 PDF.js text content 生成有序 block，含 pageIndex、rawText、原始 transform/width/height 信息和内容版本相关 ID | 代码/构建通过：内容版本相关 ID、零基页、原始项几何、quote、矩形 anchor 和质量标记；待 Firefox 验证 |
| B010-02 | 页面 Anchor 与 coverage | block 含零基 pageIndex、原文 quote 和坐标/矩形可用性；显示 full/partial/unreadable 及无文本页警告 | 代码/构建通过：逐页 coverage、无文字/失败页计数和 `full/partial/unreadable`；待 Firefox 验证 |
| B010-03 | 最小可检查入口 | 阅读页或开发面板可展示提取进度/coverage，不能发送文本或声称完成章节/双栏语义解析 | 代码/构建通过：可展开页级诊断和原始项顺序 caution；搜索共用提取流程，待 Firefox 回归 |

- 允许修改：解析相关 `src/`、阅读页最小诊断 UI、样式、README、必要测试/配置；不得改总体追踪或 Hypha。
- 本批不包含：双栏顺序重建、章节分类、offset 映射、引用/cite、证据摘要、持久化、模型、翻译、高亮。
- 必需交付：明确类型/模块和可观察 extraction/coverage 结果，typecheck/双端构建，以多页 PDF 验证；不能把 PDF.js 原始项顺序称为可靠论文阅读顺序。
- 验证要求：UI 页码一基但数据 pageIndex 零基；无文本页必须显式计入 coverage；不将原文发送出扩展。
- 返回格式：逐项状态、修改文件、检查、未测项、风险、用户操作。

## 第三部分：相关背景知识

- 架构契约：Block 应有稳定 blockId、文档版本、pageIndex、rawText、readingOrder、anchor、quality flags；Anchor 的 PDF 基础是零基页 + 原坐标矩形组 + quote。完整细节在规划，但 B010 只建立最小页级骨架。
- 限制：PDF 原始文本项顺序不保证双栏阅读顺序；表格/公式不可可靠恢复时须标质量问题，不能送进摘要当证据。
- 现有入口：阅读页已有 PDFDocumentProxy；B007 的全页 getTextContent 仅会话索引，B010 可复用但不得破坏渲染、权限和竞态保护。
- 已验证：正常 PDF 渲染、搜索和视图恢复已在 Firefox 验证；B008 的无文本真实样本未测。
- 必读：[架构第 4、9 节](../planning/02-architecture.md)、[实施第 2、3 节](../planning/05-implementation.md)、[B009](batches/B009.md)。
