# 第二阶段：界面、多语言、主题与 arXiv PDF 自动阅读

状态：阅读器壳层、主题、arXiv 直链接管及基础语言状态已实现；B046–B052 的前端布局与交互已获用户验收。下一项为将 reader 中遗留硬编码文案迁移到现有消息目录；HTML 论文页仍不支持。

## 目标与边界

- 重做阅读器信息层级：顶栏（文档、阅读控制、主题／语言）、左栏（目录／缩略图）、中央 PDF、右栏（概览、翻译、证据）。窄屏改为可切换的阅读／侧栏，不隐藏关键状态。
- 所有自有 UI 文案使用消息键；首批 `zh-CN` 与 `en`，默认跟随浏览器语言，设置页可覆盖并持久化。论文原文、模型生成内容和 API 请求不翻译或重发。
- 主题支持 light、dark、system；以 CSS 变量提供色板，保存用户显式选择，system 随 `prefers-color-scheme` 变化。Canvas PDF 保持原始页面；只改变阅读器外壳、文字层辅助元素和可访问焦点样式。
- 仅自动接管 arXiv 的直接 PDF 路由（`https://arxiv.org/pdf/<id>` 及其版本／`.pdf` 变体）。`/abs`、`/html`、导出页、其它站点和任何返回 HTML 的响应均不接管。

## 本地概览结果缓存（B064，2026-09-29）

- 三行概览与详细概览都应缓存到扩展私有的 IndexedDB；只写入已经通过本地 schema、alias 与 PDF 证据锚点校验的最终结构化结果，绝不保存 API key、请求头、原始 provider 响应或递进会话历史。
- 缓存键至少隔离 PDF bytes 的 SHA-256 文档版本、证据 ledger／页面提取版本、各概览提示词／协议版本，以及所有会影响生成结果的非机密模型配置（端点身份、模型、结构化输出与上下文／输出限制）。不得因同名文件、同一 URL 或仅相同页数命中。
- 打开已有缓存的同一 PDF 时，先以当前本地 ledger 重新核验每个 evidence ID／引用；核验成功才恢复。缓存命中不申请 host permission、不发送模型请求；读写失败、损坏或过时项只安全降级为未生成状态，不能阻断重新生成。
- 本地缓存仅属于当前浏览器扩展资料；不加入 `#pdf` fragment，不导出、不跨设备同步，不持久化 PDF 文件 bytes。清除浏览器扩展数据会清除缓存。

## arXiv 接管方案

先做 B038 可行性批次，不预先承诺具体 API。候选方案是受限 `webNavigation` 监听顶层 arXiv PDF 导航，经用户在设置中明确开启后将同一 tab 导向扩展阅读页，并以编码的原 URL 作为一次性输入；阅读页仍通过现有来源权限和 PDF 字节签名校验下载。监听只匹配 arXiv PDF 路径，忽略 extension URL、iframe、同一导航重复事件和用户关闭的开关，避免循环。

该方案须确认 Chrome/Firefox MV3 对 `webNavigation`、后台生命周期和 `tabs.update` 的兼容性及所需权限；不得用 MV3 不支持的阻塞 `webRequest`。若任一端无法低权限一致实现，降级为 arXiv 页面按钮／右键“在 Thesis Viewer 打开”，不扩大为全站劫持。

## 交付顺序

1. B038：双浏览器 arXiv PDF 接管权限／循环／失败回退 spike。
2. B039：设计 token、主题状态和无闪烁初始化。
3. B040：消息目录、语言选择和关键 reader/options 文案迁移（设置页已完成；reader 遗留硬编码文案待后续统一迁移）。
4. B041：桌面与窄屏阅读器布局实现、键盘与对比度回归。
5. B042：整体验收：双浏览器、两种语言、三种主题、开关／拒绝／非 PDF／网络失败路径。

## 验收

- 切换语言或主题不丢失阅读位置、选择、生成结果或任务状态；每个交互控件有可本地化名称和可见焦点。
- 自动接管仅在开关开启且顶层 arXiv PDF 路由命中时发生；下载失败、权限拒绝、HTML 响应、非 arXiv 和 `/html` 均不劫持且给出可恢复反馈。
- 文档、主题与语言偏好不含密钥，不发送给模型或网页。

## 技术依据

Chrome `webNavigation` 要求显式 `webNavigation` 权限，且导航可能产生重复的 `onBeforeNavigate`／错误事件；MV3 不支持普通扩展使用阻塞 `webRequest`。因此先以小范围 spike 验证，不能将“自动劫持”做成未受限的网络拦截。[Chrome webNavigation](https://developer.chrome.com/docs/extensions/reference/api/webNavigation)；[Chrome MV3 网络限制](https://developer.chrome.com/docs/extensions/reference/api/webRequest)。Firefox 的同名导航 API 提供 URL filter 和顶层 frame 信息。[MDN webNavigation](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/webNavigation)。

## B101：连续PDF渲染资源上限（2026-10-22）

用户提供Firefox多PDF纹理/扩展高内存证据，要求优先位图生命周期优化并保留清晰度与阅读交互。连续页面保留CSS占位，主位图只保留可见页与相邻页；每阅读器64MiB基础RGBA预取预算，可见页为清晰度例外。取消后等待结束再归零，过期结果不得复活；后台暂停绘制、连续隐藏15秒后释放主位图，前台恢复位置/标注。Pages缩略图按面板/前台生成，后台移除IMG，保留低成本数据；文档替换/关闭由loadingTask.destroy负责worker销毁，不并发cleanup。实现及Firefox复测边界见[B101](../implementation/evaluations/B101.md)。

## 2026-11-01 B113：选区与标注样式

用户要求初选操作统一，翻译置提问之前，隐藏颜色/字符数；颜色仅在已有标注编辑中显示，并提供背景高亮/下划线。翻译主标题右侧复制/关闭为有可访问标签的SVG图标，去扩展提示。标注可选style持久化及备份兼容，旧记录默认背景；不改锚点或PDF原文，不增加默认样式设置。参见[B113验收](../implementation/evaluations/B113.md)。
