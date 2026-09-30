# 当前实现任务

维护者：主 agent。更新时间：2026-09-30。状态：无执行中批次。

## 一、总体实现进度

B001–B074 已完成双浏览器 MV3 阅读扩展、Paper Insights、图标和可分发 ZIP 打包。最新批次见 [B074](batches/B074.md)。

## 二、当前细节目标清单

暂无新派发目标。`pnpm package` 可生成 Chrome/Firefox 扩展 ZIP 及 Firefox 源码 ZIP；安装到 Firefox release/beta 前仍需 Mozilla 签名。B073 设置页真实浏览器交互待 Playwright 会话恢复后复验。

## 三、相关背景知识与执行边界

打包复用 WXT 官方 zip 命令；ZIP 根目录包含 manifest、图标和 LICENSE。Firefox 源码 ZIP 按白名单收录生产源码及重建配置，排除测试、论文、调试文件和 Hypha；隔离重建与当前 Firefox 构建的 76 个文件字节一致。后续批次按 [协作流程](WORKFLOW.md)重新准备三部分任务包。
