# 当前实现任务

维护者：主 agent。更新时间：2026-09-30。状态：无执行中批次。

## 一、总体实现进度

B001–B075 已完成双浏览器 MV3 阅读扩展、Paper Insights、图标、分发 ZIP 以及 Chrome CRX/PEM 打包；最新批次见 [B075](batches/B075.md)。

## 二、当前细节目标清单

暂无新派发目标。`pnpm package` 将 Chrome CRX/PEM 与 Firefox 扩展 ZIP 放入忽略的 `dist/`；Firefox sources ZIP 留在 `.output/`。Firefox 正式安装仍需 Mozilla 签名，B073 设置页真实浏览器交互待 Playwright 会话恢复后复验。

## 三、相关背景知识与执行边界

Chrome 私钥 `dist/thesis-viewer-chrome.pem` 由脚本在后续打包中复用，以维持扩展 ID；丢失该密钥可能导致 ID 变化。PEM 不能纳入版本库或对外分发。`dist/` 受 Git 排除。后续批次按 [协作流程](WORKFLOW.md)重新准备三部分任务包。
