# 批次与变更历史

[返回总体进度](../IMPLEMENTATION_PROGRESS.md)

| 日期 | 批次／事件 | 工作范围 | 结果与证据 | 下一步 |
|---|---|---|---|---|
| 2026-09-30 | [B077](batches/B077.md) | 扩展图标原生菜单增加阅读器与设置入口 | 用户在 `pw-main` 确认两项显示并打开正确；187 项测试、typecheck、双端构建与 manifest 检查通过 | 保留左键 PDF 判断，后续按用户反馈改进 |
| 2026-09-30 | [B076](batches/B076.md) | 工具栏 PDF 入口与三行概览质量回归 | 用户确认 PDF 打开／非 PDF 提示；[五篇回放与三篇真实模型对照](evaluations/B076.md)补齐 3DGS 密度控制和缩放论文定量预测；185 项测试、typecheck、双端构建通过 | 保持 PDF 直链范围，后续依新论文样本回归 |
| 2026-09-30 | [B075](batches/B075.md) | Chrome CRX/PEM 与 Firefox ZIP 汇集到 `dist/` | `pnpm package` 生成 CRX3 和私钥、复制 Firefox ZIP；私钥复用与 ID 稳定、`0600`、ZIP 一致性和 Git 排除均通过 | 备份 PEM 且不对外分发；Firefox 正式安装仍需 Mozilla 签名 |
| 2026-09-30 | [B074](batches/B074.md) | 双浏览器扩展 ZIP 与 Firefox 源码 ZIP 打包 | `pnpm package` 生成三包；ZIP 根目录 LICENSE/manifest/图标完备；源码白名单排除测试和临时数据，隔离重建 76 个产物字节一致 | Firefox 正式安装前需 Mozilla 签名；B073 设置页浏览器交互待会话恢复后复验 |
| 2026-09-30 | [B073](batches/B073.md) | 设置默认值、非流式兼容请求与扩展图标 | 移除模型 SSE 路径；官方 DeepSeek 新用户默认值、旧配置迁移；Chrome/Firefox 四尺寸图标产物；169 项测试、typecheck、双端构建通过 | `pw-main` 恢复后复验真实设置页交互；其他 PDF 质量和边界样本按需继续 |
| 2026-09-30 | [B072](batches/B072.md) | 详细概览关键公式证据与显示 | [五篇回放与真实模型评估](evaluations/B072.md)：2609.35457 的 `C=MD` 及计算最优分配律进入方法摘要并完成数学排版，35 个原始锚点复核；164 项测试、typecheck、双端构建通过 | 复杂多行／图像公式仅在可靠提取方案与样本出现时处理 |
| 2026-09-30 | [B071](batches/B071.md) | `[n]` 展开区原文合并展示 | [浏览器评估](evaluations/B071.md)：3DGS 连续九行及公式旁右栏续行合并、逐片段 PDF 跳转和键盘展开通过；160 项测试、typecheck、双端构建通过 | 其他 PDF 遇到几何歧义仍分段，不猜跨栏顺序 |
| 2026-09-30 | [B070](batches/B070.md) | Paper Insights 方法事实完整度与引用密度 | [五篇离线回放及真实模型评估](evaluations/B070.md)：3DGS prune 与 MiMo 5:1／128 token 已在方法输出；单 alias 折叠引用并可逐成员跳转；153 项测试、typecheck、双端构建通过 | 继续留意其他 PDF 的跨栏／数学残句和模型采样差异 |
| 2026-09-30 | [B069](batches/B069.md) | 详细摘要证据重排序与离线回放 | [五篇评估](evaluations/B069.md)的实际方法包和 `pw-main` 真模型输出覆盖主要步骤；2609.35457 的动机空包与实验数字缺失修复；150 项测试、typecheck、双端构建及五篇离线回放通过 | 残余：3DGS prune、MiMo 方法 5:1／128、跨栏残句与引用密度；后续按独立质量批次处理 |
| 2026-09-29 | [B068](batches/B068.md) | Paper Insights 三行与六栏目请求输入质量 | 四篇公开论文对照 [评估记录](evaluations/B068.md)：MiMo 三行覆盖混合注意力／MOPD／MTP，3DGS 方法与动机空包修复，SAM 全量与子集数字分离，Video-MME 四项创新进入摘要；25 files／138 tests、typecheck、双端构建及 diff 检查通过 | 后续质量工作聚焦引用密度、表格抽取与跨论文泛化；既有未测 PDF 边界不变 |
| 2026-09-29 | [B067](batches/B067.md) | README 与可分发 LICENSE 收尾 | README 与运行时架构同步；双端产物携带字节相同的 GPL LICENSE；24 files／121 tests、双端构建与产物核验通过 | M8 已完成；未测 PDF 边界仅在获得样本后验证，详细概览选材质量优化独立排期 |
| 2026-09-29 | [B066](batches/B066.md) | M8 双浏览器交付审计与人工回归 | 用户在正常 Chromium／Firefox 报告正常；24 files／121 tests 与双端产物审计通过，边界 PDF 样本仍未测 | B067：README／LICENSE 分发收尾 |
| 2026-09-29 | [B065](batches/B065.md) | Paper Insights 生成按钮图标化 | 用户继续下一步视为验收；24 files／121 tests、typecheck、双端构建与 diff 检查通过 | B066：最终双浏览器交付审计与人工回归 |
| 2026-09-29 | [B064](batches/B064.md) | 三行／详细概览的本地、版本隔离缓存 | 用户验证缓存命中与模型配置失效正常；24 files／121 tests、typecheck、双端构建与 diff 检查通过 | B065：Paper Insights 生成按钮图标化 |
| 2026-09-29 | [B062–B063](batches/B062-B063.md) | 缩放直接编辑与本地 PDF 内容键 fragment | B062 用户验证正常；本地 PDF 以 SHA-256 内容键写入 `#pdf`／`page`，23 files／117 tests、typecheck、双端构建与 diff 检查通过 | B064：两类概览的本地、版本隔离缓存；B063 实际浏览器 fragment 手测待用户反馈 |
| 2026-09-28 | [B056](batches/B056.md) | reader 遗留文案、安全错误映射与可访问名称 | 用户验证中英 reader 文案、错误提示和主题设置状态均正常；102 项测试与双端构建通过 | M8 双浏览器最终语言／主题回归；详细概览质量优化继续后置 |
| 2026-09-28 | [B055](batches/B055.md) | 连续滚动的远程 PDF 页码 fragment 同步 | 用户验证正常；滚轮页变化在滚动结束后以 `replaceState` 同步，首尾页与本地 PDF 边界保持 | 等待 B053／B054 用户验收及下一步指令 |
| 2026-09-28 | [B046–B052](batches/B046-B052.md) | 阅读器壳层与 Insights 体验重构 | 用户报告前端基本可用；连续 PDF、sticky 顶栏、贴边可调 rail、来源 fragment、位置历史、窄屏导入和内联证据均已实现。详细概览局部素材不足已明确移交后续质量优化，未通过放宽证据规则掩盖 | B053：统一迁移 reader 硬编码文案至现有消息目录，再做双浏览器语言／主题回归 |
| 2026-09-26 | M6 范围收窄 | 用户明确仅支持实际返回 PDF 的网页链接；不支持 HTML 论文页面或落地页（含 `arxiv.org/html`） | 既有 B004 URL PDF 链路保留；规划、验收和长期任务移除 HTML 采集／快照／锚点工作 | B036：回归直链 PDF 入口与 Chrome 关键链路；M7 交付收尾 |
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
| 2026-09-22 | [B010](batches/B010.md) | 页级文本块、anchor 与 coverage 诊断 | 用户验证 Firefox coverage、搜索与阅读回归；长文第 477 页有 15 个文本 block | M2：最小章节识别 |
| 2026-09-22 | [B011](batches/B011.md) | 自动章节候选与 Contents 抑制 | 用户验证自动目录正文跳转、Contents 抑制和原生 outline 优先正常 | M2：坐标／offset 映射 |
| 2026-09-23 | [B012](batches/B012.md) | 单项 raw／normalized offset 映射与搜索定位 | 用户验证 31 页 coverage、4,710 个 v2 block 和功能正常；转换路径尚未遇到样本 | M2：本地引用索引 |
| 2026-09-23 | [B013](batches/B013.md) | 本地参考文献与编号引用索引 | 用户验证 Video-MME 的 matched 标记及 Ghostscript 的 unresolved 降级均正常 | M3：高亮与 cite 浮窗 |
| 2026-09-24 | [B014](batches/B014.md) | 当前会话手动高亮 | 用户验证创建、改色、删除、复制、变换对齐、翻页返回与会话清除正常 | B015：持久化高亮 |
| 2026-09-24 | [B015](batches/B015.md) | IndexedDB 持久化手动高亮 | 用户验证高亮保存、隔离、恢复、变换对齐与清理正常 | M3：cite 浮窗 |
| 2026-09-24 | [B016](batches/B016.md) | 本地编号引用浮窗 | 核心功能验收通过；少数 marker 仍轻微左偏，用户要求记录并后续处理 | M4：模型配置与选区翻译 |
| 2026-09-24 | [B017](batches/B017.md) | 模型配置与安全存储 | 主 agent 审查 URL 校验、显式能力字段及 local/session 密钥边界；`pnpm typecheck`、Chrome/Firefox build、diff 检查通过。真实选项页交互尚未验证 | 在真实 Chrome/Firefox 中验证保存、会话 key、记住／清除及错误状态；随后 B018 API 请求与按需权限 |
| 2026-09-26 | [B018](batches/B018.md) | 兼容 API 请求与按需端点权限 | 主 agent 审查最小 host pattern、无 key Bearer、省略、SSE 完成标记与错误语义；9 个 mock 测试、typecheck、Chrome/Firefox build、diff 检查通过 | 在真实 Chrome/Firefox 中验证 B017 设置和 B018 权限提示／可控端点；再接入选区翻译任务 |
| 2026-09-26 | [B019](batches/B019.md) | PDF 选区翻译最小闭环 | 主 agent 审查同步权限调用、选区范围、JSON 解析、取消与旧响应失效；11 个 mock 测试、typecheck、Chrome/Firefox build、diff 检查通过 | 用户主动验证真实翻译、权限提示、取消与错误；随后补整句扩展、上下文、缓存／任务 |
| 2026-09-26 | [B020](batches/B020.md) | 翻译整句、上下文与缓存 | 主 agent 审查单文本项保守扩句、context 范围及无密钥缓存键；14 个测试、typecheck、Chrome/Firefox build、diff 检查通过 | 用户验证扩句／降级、context 与缓存命中；再决定翻译任务持久化 |
| 2026-09-26 | [B026](batches/B026.md) | 显式结构化输出映射与详细摘要诊断 | `structuredOutput` 仅在用户开启时映射为 JSON object；37 个测试、typecheck、Chrome/Firefox build、diff 检查通过 | B027：短别名、受预算证据包和本地映射基础设施 |
| 2026-09-26 | [B027](batches/B027.md) | 紧凑证据包与短别名映射 | 受预算、分用途的 packet 与 alias 本地还原均已验收；42 个测试、typecheck、Chrome/Firefox build、diff 检查通过 | B028：迁移三行概览的小输入／小输出契约 |
| 2026-09-26 | [B028](batches/B028.md) | 三行概览紧凑协议 | 真实请求改为短 packet 与三条 `{text,sources}`，本地锚点验证与证据跳转保留；42 个测试、typecheck、Chrome/Firefox build、diff 检查通过 | 用户 Firefox 实测三行请求；通过后 B029 拆分详细概览 |
| 2026-09-26 | B028 用户验证 | Firefox 真实模型的紧凑三行概览 | 用户报告正常；见 [验证记录](batches/B028-user-validation.md) | B029：详细概览六个轻量栏目请求 |
| 2026-09-26 | [B029](batches/B029.md) | 详细概览分栏目紧凑协议 | 一次点击内六个串行、各自受预算的请求；局部失败安全降级；42 个测试、typecheck、Chrome/Firefox build、diff 检查通过 | 用户 Firefox 实测六段生成、Evidence chip 与局部降级 |
| 2026-09-26 | B029 范围调整 | 用户授权递进式上下文与前缀缓存方案 | B029 未进入真实模型验证；其最小输出／局部降级保留，由 B030/B031 改为前序会话 + 逐步新增 PDF 块 | B030：稳定全局 alias 与递进会话原语 |
| 2026-09-26 | [B030](batches/B030.md) | 递进证据会话与素材质量过滤 | 全局 alias、阶段增量／可见性与本地重验已验收；并修复标题／作者等元数据 fallback；46 个测试、typecheck、Chrome/Firefox build、diff 检查通过 | B031：接入递进详细概览消息链 |
| 2026-09-26 | [B031-R](batches/B031-R.md) | 本地 RAG 选块调研 | 首版采用结构感知 lexical/BM25 风格检索 + 邻段 + 多样性；不引入远程 embedding 或重型本地模型 | B031-I1：实现本地检索索引与评分 |
| 2026-09-26 | [B031-I1](batches/B031-I1.md) | 本地 lexical 检索索引与栏目评分 | 可复现 BM25 风格排序、弱结构 boost 与正文 fallback 已验收；51 个测试、typecheck、Chrome/Firefox build、diff 检查通过 | B031-I2：将 ranked candidates 接入递进 session |
| 2026-09-26 | [B031-I2](batches/B031-I2.md) | 排序选材接入递进 session | 排序候选、预算、去重与保守邻接已接入 session 原语；53 个测试、typecheck、Chrome/Firefox build、diff 检查通过 | B031-I3：接入真实递进详细概览 |
| 2026-09-26 | [B031-I3](batches/B031-I3.md) | 递进 RAG 详细概览 | 本地检索选材、前序会话和逐步 sources 已接入真实详细请求；55 个测试、typecheck、Chrome/Firefox build、diff 检查通过 | 用户以 B029 问题 PDF 验证方法栏目与缓存前缀 |
| 2026-09-26 | B031-I3 用户观察 | 缓存命中但 PDF 文字项过碎 | 见 [观察记录](batches/B031-I3-user-observation.md)；不先增预算，改做连续 passage | B032：连续段落 passage 与多锚点映射 |
| 2026-09-26 | [B036](batches/B036.md) | 直链 PDF 内容边界与 M7 Chrome 验证准备 | `%PDF-` 识别、HTML／非 PDF 拒绝与 exact-host permission 单测已验收；72 项测试、typecheck、双端 build、diff 检查通过 | 用户在 Chrome 进行本地／URL PDF、HTML 拒绝、翻译／两类概览和权限拒绝回归 |
| 2026-09-26 | B036 用户验证 | Chrome 关键链路 | 用户报告全部正常：本地／URL PDF、HTML 拒绝、翻译、三行／详细概览、Evidence chip 与权限拒绝均通过 | B037：交付审计与安装／限制说明 |
| 2026-09-26 | [B037](batches/B037.md) | M7 交付审计与使用说明 | README、双端 MV3 构建／manifest、浏览器证据矩阵、限制和许可状态均已核对；72 项测试、typecheck、双端构建、diff 检查通过 | 当前本地交付完成；公开发布前由所有者补许可证 |

完整任务包与验收记录归档到 `batches/Bxxx.md`，本表链接相应文件。后续每批记录至少包含：批次 ID、目标、子 agent ID、涉及文件、目标完成情况、验证证据、主 agent 验收结论、遗留问题与下一步。涉及范围变更时注明用户依据和被移出的工作去向；不能直接删除未完成事项。
