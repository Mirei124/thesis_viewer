# 当前实现任务与子 agent 初始上下文

[返回总体进度](../IMPLEMENTATION_PROGRESS.md)

维护者：主 agent。当前批次：B015；执行 agent：`/root/b015_persistent_highlights`。

## 第一部分：总体实现进度

- 项目目的：Chrome/Firefox 独立论文阅读扩展，本地解析、自配 API。
- 总体任务／阶段：Hypha `0001`；M3 高亮与 cite 浮窗。
- 已完成并验收：B001–B014 已完成，B014 当前会话手动高亮已在 Firefox 验证。
- 当前实现位置：高亮有页级 PDF 坐标和 quote，但仅存 React 内存，重导入同一 PDF 即消失。
- 当前批次：B015；用 IndexedDB 按文档内容 hash 与版本保存/恢复手动高亮，提供保存失败状态与清理入口。
- 与前后关系：为 M3 持久化高亮完成基础；不持久化原文件、全文、AI 结果，不做云同步或 cite 浮窗。
- 状态：实现中；执行 agent：`/root/b015_persistent_highlights`。

## 第二部分：当前细节目标清单

| ID | 小目标 | 完成条件／验证方式 | 状态／证据 |
|---|---|---|---|
| B015-01 | 高亮本地数据仓库 | IndexedDB schema 仅保存手动 Highlight、doc content hash/version、anchor、quote、color、createdAt；无网络/密钥/全文 | 未开始 |
| B015-02 | 恢复与写入 | 同一内容重新导入恢复高亮；颜色/删除原子写入；不同内容不串，旧异步加载不覆盖新文档 | 未开始 |
| B015-03 | 保存失败与清理 | IndexedDB 不可用/失败显示真实状态且会话高亮可继续；提供删除当前文档高亮入口 | 未开始 |

- 允许修改：高亮/存储相关 src、阅读页、样式、README、必要测试/配置；不得改总体追踪或 Hypha。
- 本批不包含：原文件/全文/生成结果持久化、云同步、AI evidence、跨文档匹配、cite 浮窗。
- 必需交付：IndexedDB 高亮仓库、恢复/删除/失败状态、typecheck/双端构建及真实 Firefox 验证。
- 验证要求：重新导入同一内容恢复；另一 PDF 无高亮；删除后重新导入不恢复。存储失败不能显示虚假“已保存”。
- 返回格式：逐项状态、修改文件、检查、未测项、风险、用户操作。

## 第三部分：相关背景知识

- 用户契约：手动高亮跨缩放、旋转、重开位置一致；高亮与 AI evidence 分开。
- 架构：全文、原文件、anchor、高亮、生成结果最终存在 IndexedDB；文档 contentHash/version 变化必须重新校验。B015 仅实现 Highlight 表。
- 现有入口：B014 session highlight 的 PDF 原坐标、quote、pageIndex、颜色、doc hash；B009 使用 extension storage 保存视图但不能替代 IndexedDB 高亮库。
- 已验证：B014 Firefox 高亮交互正常；B008 边界 PDF 样本未测。
- 必读：[架构第 4、6、10 节](../planning/02-architecture.md)、[实施第 2、3 节](../planning/05-implementation.md)、[B014](batches/B014.md)。
