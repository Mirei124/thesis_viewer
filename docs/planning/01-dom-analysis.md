# Moonlight DOM 与功能拆解

调研日期：2026-09-22。参考页：https://www.themoonlight.io/paper/ac15ef27-6fa5-4e6a-9baf-c734156b1064 。论文：SmartTrim: Adaptive Tokens and Attention Pruning for Efficient Vision-Language Models，arXiv:2305.15033v2，17 页。

## 实际结构

外层页面承载阅读器 iframe；Playwright 的 frame URL 为 `/extension/dist/web/pdf.html`，参数包括 `origin=https://arxiv.org/pdf/2305.15033` 和页面内 blob PDF 地址。普通 document 查询没有发现外层 iframe，Playwright frame 枚举可以访问；不要据普通查询空结果判断无阅读器，也不应假设外层 DOM 可直接抓取全文。

iframe 标题为 `PDF.js viewer`；运行时 `pdfjsLib.version = 4.4.168`、`PDFViewerApplication.pdfDocument.numPages = 17`。存在 `.page[data-page-number]`、`.textLayer`、canvas、PDF 内链接和目录。初次采样有 17 个 page 容器，但仅 2 个 textLayer；这证明文字 DOM 并不等于完整论文。此版本是参考站观察值，不是插件应锁定的版本。

```text
站点外壳
└─ PDF 阅读器 frame
   ├─ 左侧应用栏：文献库、收藏、导入、文件夹、主题
   ├─ 顶栏：目录、论文信息、搜索、缩放、页码、AI 操作、设置、导出
   ├─ 左侧文档目录／缩略图
   ├─ 中央 PDF：canvas + textLayer + annotationLayer + 附加交互
   ├─ 右侧内容面板：AI／高亮／解释／批注／笔记／引用卡片
   └─ 右侧功能切换栏：收起、切换面板、移动到底部
```

截图：[初始阅读界面](evidence/moonlight-overview.png)。快照：[初始](evidence/initial-page.yaml)、[高亮](evidence/highlights.yaml)、[设置](evidence/settings.yaml)、[提示词定制](evidence/prompt-personalization.yaml)。正文抽取：[PDF 第 1–9 页](evidence/smarttrim-selected-pages.json)，仅用于本次规划举例，不代表全部 17 页已审阅。

## 功能清单与复用边界

| 区域 | 实际观察 | 本插件设计映射 | 状态 |
|---|---|---|---|
| 阅读核心 | 目录/缩略图、搜索、缩放、页码、页内引用链接 | PDF.js viewer 能力 + 自有工具栏 | 首版核心 |
| 三行摘要 | 三条内容、折叠/View all、Copy、Regenerate | 用户选定三条 contributions，单独生成/重生成，证据跳转 | 首版核心 |
| 详细摘要 | Markdown 标题、列表、公式、Copy、Regenerate | 结构化科研摘要及可核查证据 | 首版核心 |
| 术语 | Keyword Dictionary 标签列表、展开 | 保留原文术语/缩写、解释文中含义 | 候选，首版不做 |
| 问答 | 建议问题、输入框、Add Reference、模型选择、Discussion | 单篇论文带出处问答 | 候选，首版不做 |
| 高亮 | 五色筛选、检索、复制、导出；Novelty/Methods/Results 自动类别 | 首版仅手动高亮/换色/删除/恢复 | 用户确认 |
| 解释 | Text/Image/URL/Table/Formula 类型筛选、空态提示选中后 Explain | 与翻译区分，首版不加解释模式 | 候选，首版不做 |
| 批注 | 选中文本后 Comment | 锚定原文的批注 | 候选，首版不做 |
| 笔记 | 块编辑提示、行内/块公式 | 全文笔记 | 候选，首版不做 |
| 引用卡片 | BibTeX、Kept(0)、References(44)、Citations(2) | 基础元数据/BibTeX 可做；被引网络需外部来源 | 后续候选 |
| 正文 cite | `.annotationLayer a[href="#cite.transformer"]`；点击触发额度限制 | 本地书目浮窗，区别于引用卡片管理 | 用户确认；参考浮窗内容未验证 |
| 翻译 | 页边 Translate Page、Auto 开关、顶栏 Auto Translate | 首版仅划词/句子翻译；不做自动全文翻译 | 用户确认 |
| 图解/测验 | Image Explanation、Quiz 入口 | 不因存在入口推断内部算法或质量 | 候选，首版不做 |
| 设置 | 语言、模型、外观、Prompt Personalization | 自配 API、语言、模板版本、阅读偏好 | 首版核心 |
| 个性化提示 | System / Explanation / Keywords / Three-Line / Summary 五类输入 | 首版固定模板版本与语言/关注点配置；完整模板编辑器可后续 | 技术方案 |
| 站点业务 | 推荐论文、邀请、额度、会员、收藏 | 只保留本地文献库；其余不纳入参考复刻 | 非核心 |

## DOM 操作经验

- iframe 中保留 PDF.js 原始 ID，例如 `viewFind`、`scaleSelect`、`pageNumber`、`viewOutline`；另有自定义 toolbar。隐藏模板与可见控件可能重复，不能简单计数按钮推导功能数量。
- 优先以 frame + 可访问名称定位实际控件；保存的 Playwright ref 仅用于本次快照，不是插件的选择器契约。
- 获取正文用 PDF.js 文档 API 的 `getPage/getTextContent`，不能滚动抓所有 `.textLayer` 作为正式解析方案。
- 目录来自 PDF outline，不必推断标题；无 outline 时才从文本推断，并标注为自动识别。
- 在当前参考页上 API 可以读取 PDF，是该站实现的事实；目标插件不能依赖第三方页面暴露 `PDFViewerApplication`。
- DOM 中混有推荐论文标题，因此不能取第一个 h1/h2 作为当前论文元数据。

## 影响提示词的真实例子

参考页三行总结使用 emoji、形容词和“1.5–4 倍加速、性能下降极小”。原文第 4 页明确采用 FLOPs 衡量效率；第 6 页另讨论同一 CPU 上单实例延迟。规划应区分计算预算比例、FLOPs 和实测延迟，不能把三者写成同一个速度结论。

原文第 5 页表 1 中，METER 与 SmartTrim 的 VQA test-dev 为 77.43 / 77.13、FLOPs 为 88.5G / 46.0G。这是可核验的具体比较；“下降 0.30 个百分点”是数值差值，不应写为“下降 0.30%”。第 4 页还说明自蒸馏两条路径共享参数，不应描述成另外训练一个独立教师。

参考站的 Prompt Personalization placeholder 建议三行分别写 problem/core method/key result。这是可见的定制建议，不是站点真实系统提示词；本规划不会声称已获取其内部 prompt。

正文 cite 补充证据：[点击引用后的状态](evidence/citation-popover.yaml)。链接有 `data-ref-type="cite"` 和 `data-inline-citation="Vaswani et al.2017"`，但这些是参考站添加的属性，不是标准 PDF.js 输出。点击后出现 Smart Citation 等功能额度限制，且页码发生跳转；未绕过限制，因此本项目浮窗的详细行为属于独立产品设计。
