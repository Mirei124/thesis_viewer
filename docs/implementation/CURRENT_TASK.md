# 当前实现任务与子 agent 初始上下文

[返回总体进度](../IMPLEMENTATION_PROGRESS.md)

维护者：主 agent。当前批次：B012；执行 agent：`/root/b012_offset_mapping`。

## 第一部分：总体实现进度

- 项目目的：Chrome/Firefox 独立论文阅读扩展，本地解析、自配 API。
- 总体任务／阶段：Hypha `0001`；M2 文档解析与证据基础。
- 已完成并验收：B001–B011 已完成；B010 页级 block/anchor/coverage 与 B011 自动章节候选均在 Firefox 验证。
- 当前实现位置：页级 block 保留 `rawText` 和原始几何；尚无 raw↔normalized offset 映射，搜索和后续证据不能可靠回跳到块内文本位置。
- 当前批次：B012；为单个 block 创建可审计的规范化文本、双向 offset 映射与质量标记，供搜索命中和未来 evidence anchor 使用。
- 与前后关系：不重建双栏段落顺序或语义章节；只保证单一 PDF.js 文本项的局部可追溯规范化。
- 状态：实现中；执行 agent：`/root/b012_offset_mapping`。

## 第二部分：当前细节目标清单

| ID | 小目标 | 完成条件／验证方式 | 状态／证据 |
|---|---|---|---|
| B012-01 | 规范化与映射类型 | 为 block 增加 normalizedText、raw↔normalized offset 映射与质量 flags；空白/连字符/Unicode 变化可追溯 | 未开始 |
| B012-02 | 搜索命中定位集成 | 搜索使用或展示映射后的命中边界，能回到具体 page/block；无法精确映射时诚实降级 | 未开始 |
| B012-03 | 单项边界与诊断 | 诊断显示映射版本/不确定项；不声称跨 item、跨列或跨页 offset 精确 | 未开始 |

- 允许修改：解析 src、阅读页最小诊断/搜索整合、样式、README、必要测试；不得改总体追踪或 Hypha。
- 本批不包含：跨文本项合并、双栏重排、章节语义、引用匹配、持久化、模型、翻译、摘要、高亮。
- 必需交付：可测试映射算法、block 数据更新、真实 PDF 多页检查、typecheck/双端构建。
- 验证要求：保留 rawText；规范化不得无记录删除内容；无法定位时必须标 quality flag 及 page 级回退。
- 返回格式：逐项状态、修改文件、检查、未测项、风险、用户操作。

## 第三部分：相关背景知识

- 架构契约：Block 需要 rawText、normalizedText、raw↔normalized offset 映射、anchor、quality flags；Evidence 必须明确 exact/paragraph/page 精度。
- 限制：PDF.js 源项顺序不可靠，B012 不可把单项映射扩展为跨列阅读顺序。
- 现有入口：`src/lib/pdfPageBlocks.ts`、B007 搜索索引、B010 extraction diagnostics；必须保留 B004 权限手势与异步竞态保护。
- 已验证：B010/B011 在 Firefox 正常，且 Contents 误报已修复。
- 必读：[架构第 4、5 节](../planning/02-architecture.md)、[实施第 2 节](../planning/05-implementation.md)、[B010](batches/B010.md)、[B011](batches/B011.md)。
