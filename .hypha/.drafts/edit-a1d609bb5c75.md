---
id: 0001
kind: task-update
base_revision: f6d89f2713d17f3c3ec6dbb3c2a77ca891f9caa14905cd59a6d89d6ef237bd0f
target: intent/0001-实现跨浏览器论文阅读与快速概览插件
section: Next Step
---

## Next Step

B017 的模型配置与会话／本地密钥存储代码已验收并通过双端构建；先在真实 Chrome/Firefox 验证选项页保存、重载、会话 key、记住／清除和错误状态，再拆分 B018 实现兼容 API `/chat/completions` 请求与按需 API host permission。翻译、任务调度、缓存和摘要仍须保持在独立后续批次。
