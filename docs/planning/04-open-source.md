# 开源复用与技术选型

2026-09-22 通过项目官方仓库/文档核查。以下是组件能力与选型建议，尚未做组合安装或集成验证。实施时锁定当时验证通过的版本与 lockfile，不照搬 Moonlight 所用旧版本。许可证以采用版本的 LICENSE/NOTICE 为准。

## 推荐基线

| 组件 | 用途 | 许可证 | 采用方式与边界 |
|---|---|---|---|
| [WXT](https://github.com/wxt-dev/wxt) | 扩展入口、构建、浏览器差异 | MIT | 一套源码分别输出 Chrome/Firefox；两端明确选择 MV3 |
| [PDF.js](https://github.com/mozilla/pdf.js) | PDF 渲染、文字提取、目录、搜索、页内定位 | Apache-2.0 | 直接使用 pdfjs-dist 与 viewer 组件，自有 UI；worker/字体/cmaps 本地打包；不提供可靠科研语义解析/OCR |
| [Dexie](https://github.com/Dexie/Dexie.js) | IndexedDB 对象、事务、迁移 | Apache-2.0 | 保存 PDF Blob、文档、文本块、注释、生成版本；仅用本地核心，不启用云服务 |
| [react-markdown](https://github.com/remarkjs/react-markdown) | AI 输出及笔记预览 | MIT | 不启用原始 HTML；引用 chip 由应用解析，模型不能生成可执行链接 |
| [KaTeX](https://github.com/KaTeX/KaTeX) | 公式排版 | MIT | 配合 remark-math/rehype-katex，本地字体，关闭信任模式；乱码公式降级为原文引用 |
| [Zod](https://github.com/colinhacks/zod) | 数据、消息、生成 JSON 校验 | MIT | 结构校验不等于事实校验，另外检验证据 ID、原文引句与指标 |
| [MiniSearch](https://github.com/lucaong/minisearch) | 可选本地关键词检索 | MIT | 不属首版必需依赖；PDF 全文查找用 PDF.js。后续问答再评估中文分词；全局总结不依赖 top-k 替代通读 |

UI 建议 React + TypeScript；样式、状态管理和具体组件拆分由实施 agent 决定。无需为了使用 React 额外引入 PDF 渲染封装。

`Readability` 与 `DOMPurify` 曾为 HTML 论文导入候选；用户已将网页入口收窄为实际返回 PDF 的 URL，二者不纳入本项目依赖或后续默认工作。

PDF.js 接口依据：[PDFDocumentProxy](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib-PDFDocumentProxy.html) 提供页、目录和 destination 等访问；[PDFPageProxy](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib-PDFPageProxy.html) 提供文本与 annotations。它们不直接返回已消歧的科研参考文献条目，cite 匹配层需要本项目定义。

## 比较后不作为基线的组件

| 候选 | 可用部分 | 未选择为基线的原因 |
|---|---|---|
| [wojtekmaj/react-pdf](https://github.com/wojtekmaj/react-pdf) | MIT，React 中显示 PDF | 它不是完整阅读器；本项目需要搜索、目录、细粒度定位，直接 PDF.js 更统一；可替换适配层但不能双重维护 PDF 状态 |
| [react-pdf-highlighter](https://github.com/agentcooper/react-pdf-highlighter) | MIT，文本/区域高亮与坐标参考 | 需验证其 PDF.js 版本和缩放/旋转兼容；作为实现参考或经 spike 通过后采用，不承诺开箱即用 |
| [diegomura/react-pdf](https://github.com/diegomura/react-pdf) | 用 React 生成 PDF | 与阅读现有 PDF 的 react-pdf 名称相似，但用途不同，本项目不需要 |
| [GROBID](https://github.com/grobidOrg/grobid) | Apache-2.0，学术文档结构/参考文献抽取 | 需要独立处理环境，不能直接打包进浏览器；与用户已选无必需服务器不符，保留可选远期 adapter |
| [pdffigures2](https://github.com/allenai/pdffigures2) | Apache-2.0，科研 PDF 图表/标题抽取 | JVM 工具，不是浏览器内可直接导入的 JS 库；可借鉴流程，不能写成首版浏览器依赖 |

本次没有验证到可以直接拿来替换 Moonlight、同时满足本地解析、自配 API、双浏览器和证据定位的完整开源产品。因此复用成熟基础组件，自己定义科研文档和生成契约；不复制参考站私有资源或以 DOM 外观推断其代码开源。

## 跨浏览器依据

- [WXT 多浏览器/manifest 文档](https://wxt.dev/guide/essentials/target-different-browsers.html)：可生成不同浏览器版本；Firefox 默认 MV2，因此项目必须明确配置 MV3，检查产物。
- [MDN background](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/background)：Chrome MV3 使用 service worker，Firefox 使用 background scripts/event page；由构建适配，不把 Chrome 生命周期假设带到公共业务层。
- [Chrome service worker 生命周期](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)：worker 可被终止，长时间模型调用和 PDF 解析放在独立阅读器页面，任务状态持久化。
- [MDN content scripts](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Content_scripts)：受限页面及内建阅读器不可当成普通可注入网页；通过独立扩展阅读页导入 PDF。

许可证与依赖核查是实施的发布检查，不需要为上述普通本地规划增加额外审批。
