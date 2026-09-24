# 当前实现任务与子 agent 初始上下文

[返回总体进度](../IMPLEMENTATION_PROGRESS.md)

维护者：主 agent。当前批次：B014；执行 agent：`/root/b014_session_highlights`。

## 第一部分：总体实现进度

- 项目目的：Chrome/Firefox 独立论文阅读扩展，本地解析、自配 API。
- 总体任务／阶段：Hypha `0001`；M3 高亮与 cite 浮窗。
- 已完成并验收：B001–B013 已完成，含页级 block/anchor/offset 映射和本地引用索引。
- 当前实现位置：PDF.js 文字层可选择，但没有用户高亮；block anchor 尚未用于用户可见批注。
- 当前批次：B014；在当前渲染页支持选择 PDF text layer 文本后创建、显示、改色和删除手动高亮，保留 quote 和页级锚点。
- 与前后关系：本批仅当前会话，B015 单独做 IndexedDB 持久化；不开始 cite 浮窗、证据 chip、自动高亮或笔记。
- 状态：实现中；执行 agent：`/root/b014_session_highlights`。

## 第二部分：当前细节目标清单

| ID | 小目标 | 完成条件／验证方式 | 状态／证据 |
|---|---|---|---|
| B014-01 | 选区捕获与高亮数据 | 选择当前页文字层文本后生成 quote、页码和 PDF 原坐标/文本锚点；不劫持普通复制 | 未开始 |
| B014-02 | 高亮交互 | 浮动工具提供创建、高亮色、删除；点击高亮可操作，Esc/点击外部不会错误丢选区 | 未开始 |
| B014-03 | 变换与竞态 | 缩放/旋转/翻页后同页高亮仍对齐；新页面/文档不串高亮；README 如实说明仅会话内 | 未开始 |

- 允许修改：阅读页、高亮相关 src、样式、README、必要测试；不得改总体追踪或 Hypha。
- 本批不包含：持久化、跨页选区、自动高亮、笔记、cite 浮窗、模型、翻译、摘要。
- 必需交付：当前页高亮创建/色彩/删除/定位、typecheck/双端构建和可复现真实 PDF 验证。
- 验证要求：高亮坐标不可存屏幕像素；PDF 原坐标或可重建文本 anchor 必须随 scale/rotation 对齐。普通文字选择复制仍可用。
- 返回格式：逐项状态、修改文件、检查、未测项、风险、用户操作。

## 第三部分：相关背景知识

- 用户契约：选择文字后提供高亮/翻译/复制；高亮支持颜色、删除，缩放/旋转/重开后位置一致。B014 只实现手动高亮当前会话。
- 架构：Highlight 与 AI evidence 分开；坐标使用 PDF 原坐标，不能存屏幕像素。已有 block/anchor 是基础但不能误称跨页支持。
- 现有入口：reader 的 canvas/textLayer、page viewport、pageIndex、view transforms、request/render guards；不破坏 B004 permission 手势、B005 TextLayer 直接渲染。
- 已验证：Firefox 本地/URL阅读、offset 映射和引用索引正常；高亮未测。
- 必读：[架构第 4、6 节](../planning/02-architecture.md)、[实施第 1、3 节](../planning/05-implementation.md)、[B012](batches/B012.md)。
