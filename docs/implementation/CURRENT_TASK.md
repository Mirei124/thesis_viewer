# 当前实现任务与子 agent 初始上下文

[返回总体进度](../IMPLEMENTATION_PROGRESS.md)

维护者：主 agent。当前批次：B006；执行 agent：待派发。

## 第一部分：总体实现进度

- 项目目的：面向相关领域学者，快速确定论文做了什么；Chrome/Firefox 独立论文阅读扩展，本地解析、自配兼容 API。
- 总体任务／阶段：Hypha `0001`；M1 阅读核心与导入。
- 已完成并验收：B001–B004 双浏览器 MV3、本地/URL PDF、按需权限；B005 页码导航、缩放、旋转及文字层在 Firefox 用户实测通过。归档在 `batches/B001.md` 至 `batches/B005.md`，关键用户验证保存于 Hypha。
- 当前实现位置：阅读页已能加载本地/URL PDF，逐页渲染 canvas/文字层，支持页码、缩放和旋转；尚无 outline、缩略图、搜索或位置恢复。
- 当前批次：B006；显示 PDF 原生 outline（有则显示，无则诚实说明）和按需渲染的缩略图页码导航，确保跳转复用 B005 渲染状态。
- 与前后工作的关系：B006 完善 M1 导航；后续独立实现全文搜索、位置恢复、导入错误边界和存储，不提前解析自动章节或做结构化文献能力。
- 状态：待派发；执行 agent：待派发。

## 第二部分：当前细节目标清单

| ID | 小目标 | 完成条件／验证方式 | 状态／证据 |
|---|---|---|---|
| B006-01 | 原生 PDF outline 导航 | 使用 `PDFDocumentProxy.getOutline()` 显示层级条目；点击可解析 destination 时跳转；无 outline 显示明确状态，不伪造自动目录 | 未开始 |
| B006-02 | 缩略图列表与页码跳转 | 为当前/邻近页按需生成低成本 thumbnail，点击跳转；缩放/旋转及文档切换后缩略图不会覆盖主阅读页状态 | 未开始 |
| B006-03 | 导航失败与可访问性 | 未解析 destination、无 outline、缩略图渲染失败均有准确降级；按钮/列表可用键盘操作 | 未开始 |

- 允许修改：阅读页相关 `src/`、样式、README 与本批必要测试/配置；不得修改总体进度、历史、当前任务或 Hypha。
- 本批不包含：自动章节识别、全文搜索、位置恢复、持久化、复杂多栏解析、网页采集、模型、翻译、摘要、高亮、cite 或候选功能。
- 必需交付：outline/缩略图导航代码、错误降级、typecheck/双端构建及尽可能的真实 PDF 验证；不将无 outline PDF 说成已验证 outline 成功。
- 验证要求：outline destination 可为显式数组或 named destination，必须经 PDF.js API 解析，不能猜页码；缩略图渲染不得改变当前主 canvas/文字层和用户视图。避免为所有页一次性生成大图。
- 受阻处理：报告 PDF 输入是否含 outline、目的地解析/失败证据、缩略图数量与浏览器观察；不静默丢弃导航失败。
- 返回格式：逐项状态、修改文件、实际检查、未测试项、风险和主 agent/用户操作。

## 第三部分：相关背景知识

- 用户确认约束：基础 PDF 阅读要求目录和缩略图；目录优先读取 PDF outline，没有则使用后续识别章节并标明自动识别，无法识别时保留缩略图与页码。本批只读取原生 outline。
- 架构／数据契约：PDF `pageIndex` 零基、显示页码一基；outline target 可能没有有效页，必须显示解析失败而非错误跳转。缩略图为导航辅助，不应牵涉原文持久化或结构化 Block。
- 现有实现入口：`src/pages/reader.tsx` 持有 `PDFDocumentProxy`，已有 `changeView`/`renderPage` 与 B005 的 requestId/renderId/TextLayer 取消保护；新代码不可破坏 B004 permission 手势。
- 相关知识结论：B005 用户验证范围仅为多页导航、缩放、旋转和文字层；不包含目录、缩略图或 destination 解析。
- 已验证事实／失败经验：直接渲染可见 TextLayer 才能保留 PDF.js 的旋转/缩放布局变量；异步竞争必须使用 render/request ID 和任务取消保护。
- 待核查假设：测试 PDF 是否含原生 outline；PDF.js destination 解析在当前版本对 named/explicit destination 的 API 行为需实测。
- 必读资料及用途：[架构第 4、5 节](../planning/02-architecture.md)的 Anchor/pageIndex、目录和缩略图契约；[开源选型 PDF.js 条目](../planning/04-open-source.md)的 outline/destination API；[实施第 1、3 节](../planning/05-implementation.md)的 M1 验收与性能限制；[B005](batches/B005.md)的现有渲染竞态保护。
