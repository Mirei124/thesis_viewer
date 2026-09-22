# 当前实现任务与子 agent 初始上下文

[返回总体进度](../IMPLEMENTATION_PROGRESS.md)

维护者：主 agent。当前批次：无；下一批：B003（待派发）。

## 第一部分：总体实现进度

- 项目目的：面向相关领域学者，快速确定论文做了什么；Chrome/Firefox 独立论文阅读扩展，本地解析、自配兼容 API。
- 总体任务／阶段：Hypha `0001`；M0 双浏览器骨架与可行性。
- 已完成并验收：B001 的 WXT/TypeScript/React MV3 骨架、独立阅读页、选项页与两端构建；B002 的 PDF.js 本地 worker、选文件后首屏 canvas/文字层代码和错误状态。B002 尚无真实扩展上下文渲染证据；详见 `batches/B001.md`、`batches/B002.md`。
- 当前实现位置：已有 WXT 项目、`pdfjs-dist@6.3.289`、阅读页本地文件选择和页面一渲染代码；`.output/chrome-mv3/`、`.output/firefox-mv3/` 都含本地 worker。没有真实 Chromium/Firefox 临时加载的成功记录。
- 下一批：B003；对 B002 实际产物进行 Chromium/Firefox 临时加载，以本地文本 PDF 验证 canvas、文字层和错误状态。
- 与前后工作的关系：B003 为 M0 的运行时证据，不新增产品功能。通过后才继续 URL 下载、按需权限或 M1 完整阅读功能。
- 状态：待主 agent 选择可用验证路径后派发；执行 agent：无。

## 第二部分：当前细节目标清单

| ID | 小目标 | 完成条件／验证方式 | 状态／证据 |
|---|---|---|---|
| B003-01 | Chromium 加载实际 Chrome 产物并打开 `reader.html` | 记录加载命令、浏览器版本和扩展 URL；使用文本 PDF 显示“page 1 of N”、canvas 与文字层 | 未开始 |
| B003-02 | Firefox 临时加载实际 Firefox 产物并打开 `reader.html` | 通过 `web-ext` 或 `about:debugging` 的可复现步骤，使用同一 PDF 验证同等可见行为 | 未开始 |
| B003-03 | 验证 B002 失败状态并记录限制 | 非 PDF 或损坏输入显示明确错误；未能验证的浏览器/输入如实留档 | 未开始 |

- 允许修改：默认不修改产品代码；可新增最小、可复现的验证脚本或说明，并只在验证失败已定位到 B002 实现时进行必要修复。不得修改总体追踪或 Hypha。
- 本批不包含：新增 PDF 功能、URL/HTML 导入、存储、模型、翻译、摘要、高亮、cite、权限扩展或候选功能。
- 必需交付：真实浏览器版本、加载方式、使用的测试输入（不得提交用户论文）、观察结果、控制台/失败证据和未验证边界。
- 验证要求：普通网页 Playwright 通过不等于扩展验证；Firefox 临时加载也不等于签名安装。构建通过不等于 worker/文字层运行通过。
- 受阻处理：记录精确命令、输出和替代路径，保留可独立完成的验证；不将工具环境限制伪称为产品失败或通过。
- 返回格式：逐项目标状态、修改文件、实际检查及结果、未测试项、风险、主 agent 决策事项。

## 第三部分：相关背景知识

- 用户确认约束：Chrome/Firefox 独立扩展；本地解析；无 Moonlight 或必需服务器；候选功能默认不做。
- 架构／数据契约：PDF worker 与资源必须本地打包，独立阅读页持有 worker；CSP 下禁止远程脚本/worker。B002 不保存文件且不含网络请求。
- 现有实现入口：[reader 页面](../../src/pages/reader.tsx)、[WXT 配置](../../wxt.config.ts)、[B002 归档](batches/B002.md)。
- 相关知识结论：Hypha `0001` 仍进行中；B001/B002 只证明构建和代码，不证明真实扩展运行。
- 已验证事实／失败经验：主 agent 已复跑 B001 的 typecheck、双端构建以及 B002 的 typecheck；B002 子 agent 报告 Playwright Chromium 阻断 `file:`，系统 Chromium headless 无法保持 DevTools 连接，Chrome channel 缺失。
- 待核查假设：本机 Chromium/Firefox 的实际扩展加载能否用可控 profile/命令完成；是否须安装 `web-ext`。应先检查再决定实现或验证方式。
- 必读资料及用途：[架构第 2、5、10 节](../planning/02-architecture.md)的 worker/CSP/阅读页边界；[实施第 1、4 节](../planning/05-implementation.md)的 M0 和双浏览器证据标准；[B002](batches/B002.md)的已知验证限制。
