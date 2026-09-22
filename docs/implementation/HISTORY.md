# 批次与变更历史

[返回总体进度](../IMPLEMENTATION_PROGRESS.md)

| 日期 | 批次／事件 | 工作范围 | 结果与证据 | 下一步 |
|---|---|---|---|---|
| 2026-09-22 | 初始化追踪 | 建立主 agent 维护、三部分上下文委派、验收与回填流程 | 仅完成追踪基础；未派发实现任务 | 后续开始实现时由主 agent 拆解第一批 M0 小目标 |
| 2026-09-22 | 拆分追踪文档 | 分离总体进度、协作流程、当前任务、背景知识与批次历史 | 仅调整文档组织；实现仍未开始 | 经总体进度入口恢复后续工作 |
| 2026-09-22 | [B001](batches/B001.md) | WXT/TypeScript/React MV3 骨架、独立阅读页、选项页、构建说明 | 子 agent 完成；主 agent 复跑 typecheck、Chrome/Firefox 构建均通过；双端 manifest 无 permissions/host permissions | B002：接入并验证本地打包 PDF.js worker；真实浏览器加载仍未测试 |
| 2026-09-22 | [B002](batches/B002.md) | PDF.js 本地 worker、本地 PDF 首屏 canvas/文字层和错误状态 | 子 agent 完成，主 agent 验收代码/worker 产物并复跑 typecheck；双端构建通过，但真实扩展上下文渲染未验证 | B003：以实际 Chromium/Firefox 临时加载验证 B002 阅读页和本地文本 PDF |
| 2026-09-22 | [B003](batches/B003.md) | Chromium/Firefox 临时加载和本地 PDF 渲染验证 | Chromium 153 自动验证通过；Firefox 155 临时加载后由用户 GUI 验证 PDF、页码和文字层通过 | B004：用户触发 URL PDF 下载与按需 host permission 可行性 |
| 2026-09-22 | [B004](batches/B004.md) | URL PDF 下载、按需 HTTPS 来源权限与既有渲染复用 | 用户验证 Firefox 权限弹窗、W3 dummy PDF 下载、1 页显示与文字层通过；权限手势问题已返工修复 | B005：最小页码导航、缩放与旋转 |
| 2026-09-22 | [B005](batches/B005.md) | 页码导航、缩放、旋转与文字层同步 | 用户验证 Firefox 导航、缩放、旋转及文字层对齐均通过；已修复 detached TextLayer 导致的旋转布局失配 | B006：PDF outline 与缩略图导航 |
| 2026-09-22 | [B006](batches/B006.md) | 原生 outline 与按需缩略图导航 | 用户验证 Firefox 目录跳转、缩略图、变换后的跳页和无目录降级均通过 | B007：全文搜索与匹配导航 |
| 2026-09-22 | [B007](batches/B007.md) | 全页文本索引、搜索与匹配导航 | 用户验证 Firefox 跨页搜索、上下匹配跳转和无结果状态均通过 | B008：密码、损坏、扫描/无文本与超限输入降级 |
| 2026-09-22 | [B008](batches/B008.md) | 大小/页数、密码、损坏和无文本输入降级 | 用户确认正常 PDF 回归无异常；边界样本暂未测试并按用户意愿延后 | B009：阅读位置恢复 |
| 2026-09-22 | [B009](batches/B009.md) | 内容 hash 下的本地页码／缩放／旋转恢复 | 用户验证 Firefox 同一文档恢复及不同文档隔离正常 | M2：解析与证据基础 |

完整任务包与验收记录归档到 `batches/Bxxx.md`，本表链接相应文件。后续每批记录至少包含：批次 ID、目标、子 agent ID、涉及文件、目标完成情况、验证证据、主 agent 验收结论、遗留问题与下一步。涉及范围变更时注明用户依据和被移出的工作去向；不能直接删除未完成事项。
