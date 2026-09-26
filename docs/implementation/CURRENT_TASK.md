# 当前实现任务与子 agent 初始上下文

维护者：主 agent。当前批次：B042；执行 agent：待派发。

## 第一部分：总体实现进度

- B038–B041 已完成：arXiv `/pdf/` 自动接管、主题、语言、设置权限开关和 Moonlight 风格的信息层级已具备；Choose PDF 在正常 Chromium 与 Firefox 会话均正常。
- HTML 论文页（含 `arxiv.org/html`）仍不支持。

## 第二部分：当前细节目标清单

| ID | 目标 | 完成条件 |
|---|---|---|
| B042-01 | 自动回归 | 检查 theme/i18n/arXiv/布局新增状态与既有 reader 测试、双端构建和权限边界 |
| B042-02 | 手动清单 | 形成 Chrome/Firefox 的最小真实回归步骤：两语言、三主题、本地/URL/arXiv PDF、HTML 拒绝、阅读/证据/翻译 |
| B042-03 | 验收 | 汇总可验证证据、Playwright file chooser 限制和明确需用户确认项；不把自动化限制表述为产品缺陷 |

- 可改 reader JSX/CSS 与布局相关测试；不得修改 provider、证据、PDF 渲染、arXiv 接管、主题／语言状态语义或实现 HTML 采集。
- 验证边界：Playwright 控制的 Chromium 不能可靠打开系统文件选择器；正常 Chromium 与 Firefox 会话中的 Choose PDF 均正常，前者不得判为功能回归。

## 第三部分：相关背景知识

- 在线链接的“支持”以 HTTP 响应实际为 PDF 为准，不按 URL 后缀或 arXiv 域名猜测。HTML 登录页、论文 HTML、落地页均显示非 PDF 输入错误并提示本地文件或 PDF 直链。
- B004 Firefox 与 B036 Chrome 均已获用户真实验证；构建证据不能替代尚未验证的边界样本。
- 未测边界：无文字、密码、损坏和超限样本；已知非阻塞构建警告：reader chunk 大于 500 kB。公开发布／再分发前仍需项目所有者选择并加入许可证。
