# 项目协作规则

- 任务治理优先使用 Hypha，不使用 task-forest。
- 开始实现前读取 `docs/planning/README.md`、`docs/IMPLEMENTATION_PROGRESS.md`，并恢复 Hypha 中的总体任务与适用知识。
- 协作流程见 `docs/implementation/WORKFLOW.md`，当前委派上下文见 `docs/implementation/CURRENT_TASK.md`；批次结束后归档并更新 `docs/implementation/HISTORY.md`。
- 主 agent 维护总体进度和 Hypha；每次选择一块任务，拆成小实现目标，并将“总体实现进度、当前细节目标清单、相关背景知识”三部分组成子 agent 初始上下文。
- 子 agent 按委派范围实现和验证，返回逐项目标状态与证据；主 agent 验收后更新追踪记录。子 agent 不直接修改总体进度或 Hypha。
- 功能范围和架构以定稿规划为准；可选功能默认不实现。仅要求维护规划／追踪时，不启动实现或派发子 agent。
- 测试用 PDF、提取的 Markdown／文字条目及可复用中间资料保存在项目 `.local-cache/`（已忽略 Git），优先复用现有文件，避免依赖 `/tmp` 导致跨会话重新下载或提取；不同论文版本分目录保存。
