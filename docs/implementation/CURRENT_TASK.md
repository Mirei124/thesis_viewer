# 当前实现任务与子 agent 初始上下文

维护者：主 agent。当前批次：无；M8 已完成。B058 与 B063 的补充真实样本验证保留为后续可选验证。

## 第一部分：总体实现进度

- B038–B056 已完成：GPL-3.0-only、arXiv `/pdf/` 自动接管、主题／语言、连续多页阅读、边缘 rail、sticky 顶栏、来源 fragment、位置历史、可拖宽侧栏、紧凑 Insights 与 reader 安全本地化均已实现。
- 用户已验证 B056 的中英文案、错误提示与设置主题状态正常；B055 的连续滚动页码地址同步亦已验收。
- HTML 论文页（含 `arxiv.org/html`）不支持；在线链接只支持实际响应为 PDF 的 HTTPS URL。

## 第二部分：当前细节目标清单

| ID | 目标 | 完成条件 |
|---|---|---|
| B057-01 | 双端产物与权限审计 | 重新执行 Chrome／Firefox 构建，核对 manifest、静态资源和 arXiv 自动接管所需的最小权限；不修改功能代码，除非发现可复现的构建／manifest 问题 |
| B057-02 | 真实浏览器回归矩阵 | 为正常 Chromium 与 Firefox 各给出最短的语言／主题／阅读状态／arXiv PDF 直链接管／非 PDF 边界回归步骤；用户报告逐端结果前不得将双浏览器验收写成通过 |
| B057-03 | 未测边界盘点 | 区分本批已测界面回归与尚无样本的无文字、密码、损坏、超限 PDF，保留其为明确未测限制，不把“未遇到”写成通过 |
| B057-04 | 约束 | 不改 reader、provider、证据、主题／语言实现、权限或布局；不重载扩展、不新建 profile、不将 Playwright Chromium 文件选择器限制认定为回归 |
| B057-05 | 设置页独立标签修复 | 以 WXT options HTML entrypoint 的 `manifest.open_in_tab` 元数据生成双端 `options_ui.open_in_tab: true`；移除或避免无效的 manifest 覆盖配置，并以构建产物断言验证 |

- B057 待委派：最终回归准备与双端产物审计。详细概览方法／实验栏目偶发“材料不足”仍是整体功能完成后的独立质量优化，不能通过放宽 evidence 校验处理。

- B057 静态反馈：主 agent 复跑 `npm test`（20 files／102 tests）、Chrome／Firefox build 和 `git diff --check` 均通过。双端 MV3 manifest 仅含 `storage`／`webNavigation` 与按需 HTTPS／loopback host 权限，reader、options 与 PDF worker 资源均存在；reader bundle 仍有大于 500 kB 的已知警告。发现待人工确认项：`wxt.config.ts` 声明 `options_ui.open_in_tab: true`，但两端构建 manifest 均为 `false`；本批不改动，需确认浏览器管理页打开设置的实际表现。正常 Chromium 与 Firefox 的真实回归均待用户报告。

- B057-05 诊断：用户已确认从扩展管理页打开设置未使用独立标签页。WXT 源码与官方 entrypoint 文档均表明 options 页的 `open_in_tab` 只能从 `entrypoints/options.html` 的 `<meta name="manifest.open_in_tab" content="true">` 读取；`wxt.config.ts` 的 `manifest.options_ui` 会被 entrypoint 产物覆盖。待委派做最小元数据修复与双端产物验证。

- B057-05 验收：已在 options entrypoint 写入正确元数据并移除被覆盖的重复 manifest 配置。主 agent 复跑 typecheck、102 项测试、Chrome／Firefox build、`git diff --check`；逐端断言 `options_ui.page === "options.html"`、`open_in_tab === true` 及原有权限不变，均通过。用户重载后确认从扩展管理页打开设置会在独立标签页显示。

| B058-01 | 连续本地书目条目 | 在已识别 References 标题后的 PDF.js 本地文本块中，以 `[n]` 起始块为条目边界，将其后、下一个 `[n]` 前的连续块拼接为同一条目的完整可见文本；保留第一块 page anchor 作为跳转目标，不猜测 DOI／URL／作者／标题，不联网 |
| B058-02 | 引用浮窗重排 | 去掉面向读者的内部 caution、basis 与每条质量警告／空 URL 提示；浮窗以完整书目文本、页码跳转和仅当原文逐字存在的 URL 外链为主。未解析引用仍显示可恢复的“跳到参考文献”入口 |
| B058-03 | 可靠性与验证 | 仅在已定位的参考文献尾段内、按连续 PDF.js source order 合并，遇到下一编号严格断开；新增跨项不串接、同条多块拼接、URL 仅来自完整原文的单测。运行 typecheck、完整测试、Chrome／Firefox build 与 diff check |
| B058-04 | 约束 | 不修改正文 citation marker 命中／点击、PDF 渲染、模型、证据、远程权限或布局外的其他功能；不把 PDF.js source order 伪称为排版阅读顺序；不重载扩展 |

- B058 待委派：用户要求移除本地引用卡片的内部匹配说明，并完整显示每个本地书目条目。

- B058 实现反馈：References 标题后 `[n]` 条目现在合并到下一个编号前的本地 PDF.js 连续文本块（可跨页），首块仍是跳转 anchor，明确 URL 从合并原文提取。引用浮窗仅显示完整条目、页码跳转和原文 URL，已移除 caution／basis／质量警告／空 URL 行；未解析 marker 仍可跳到 References。typecheck、21 files／106 tests、Chrome／Firefox build 与全局 `git diff --check` 通过；等待用户重载后的真实论文验证。

| B059-01 | 缩放下拉设计 | 将顶栏中间的百分比按钮改为可访问的缩放选择器，保留左右的缩小／放大；选项按截图提供自动缩放、实际大小、适合页面、适合页宽及 50／75／100／125／150／200／300／400% |
| B059-02 | 缩放语义与状态 | 自动缩放须继续随阅读区宽度变化更新；实际大小和固定百分比写入当前 view；适合页面与适合页宽分别计算可视阅读区尺寸。手动加减应切到自定义百分比，切换或恢复位置不得丢页码、旋转、连续滚动位置或持久化 view |
| B059-03 | 双端可访问外观 | 使用原生 select 语义与本地化 label。支持 `appearance: base-select` 的浏览器可获得接近截图的品牌下拉外观；Firefox 必须优雅回退到可用的原生选择器，不能依赖不支持的 custom select API |
| B059-04 | 验证与约束 | 为缩放模式／范围补最小测试，运行 typecheck、完整测试、Chrome／Firefox build、diff check；不改 PDF 渲染精度、模型、证据、权限、side rail 或其他顶栏功能，不重载扩展 |

- B059 待委派：用户要求将页面缩放重设计为截图所示的紧凑下拉选择器。

- B059 实现反馈：顶栏已改为原生、带可访问 label 的缩放选择器，保留加减并提供自动／实际／适合页面／适合页宽及 50–400%。新增 auto、fit-page、fit-width、manual 状态，rail 拖宽、旋转和位置历史均保留模式与相对滚动位置；旧保存 view 按手动缩放恢复。仅支持 `appearance: base-select` 的浏览器增强 picker 外观，Firefox 回退原生 select。typecheck、22 files／109 tests、Chrome／Firefox build、`git diff --check` 通过；等待用户重载验证。

| B060-01 | 自定义缩放输入 | 在缩放选择器末尾增加“自定义缩放”选项；选中后显示带 `%` 单位的数字输入，允许输入 25–400 的整数百分比，Enter 或失焦时应用，并保持 manual zoom mode |
| B060-02 | 表单与错误行为 | 输入有本地化 label、`name`、numeric input mode、min/max/step；输入期间不抢占式报错，失焦或提交时若无效则恢复当前实际百分比并给出简短、可访问的范围提示；IME composition 时 Enter 不提交 |
| B060-03 | 保持阅读状态 | 合法输入应用后保持页码、相对滚动位置、旋转、连续阅读与位置历史；下拉切回预设后隐藏或重置自定义输入；不改变旧保存 view 兼容性 |
| B060-04 | 验证与约束 | 为解析／范围／提交时机补测试，运行 typecheck、完整测试、Chrome／Firefox build、diff check；不改 PDF 渲染、模型、证据、权限或侧栏功能，不重载扩展 |

- B060 待委派：用户要求支持手动输入任意缩放值。

- B060 实现反馈：缩放选择器末尾新增“自定义缩放”，选中后显示关联 label 的原生百分比输入和应用按钮。输入仅接受 25–400 整数；Enter（非 IME）或失焦提交，输入时清除提示，失焦／提交时无效则恢复当前实际百分比并以本地化 `role=status` 提示。合法输入复用现有 manual zoom 与定位保持流程。typecheck、22 files／111 tests、Chrome／Firefox build 与 `git diff --check` 通过；等待用户重载验证。

| B061-01 | 合并自定义缩放外观 | custom 状态下将预设选择器和百分比输入做成同一个连续组合控件：共享外轮廓、相邻边界无双线或空隙、两端圆角只在外侧，视觉上为一格 |
| B061-02 | 可访问与窄屏 | 不改变两个原生控件的 DOM 语义、label、焦点环、验证提示或 Firefox 回退；任一子控件获得焦点时组合外观清晰，窄屏不压坏顶栏或状态提示 |
| B061-03 | 验证与约束 | 运行 typecheck、测试、Chrome／Firefox build、diff check；仅改相关 CSS（若确需 class 只做最小改动），不改缩放状态、PDF、模型、证据、权限或布局语义 |

- B061 待委派：用户要求将 custom 状态的两个缩放框合为一个视觉控件。

- B061 实现反馈：custom 状态的 select 与数值 form 现包在一个组合容器内，共享外框且仅保留内侧分隔线；`focus-within` 提供基础焦点边框，支持 `:has()` 的浏览器提供组合 outline，单控件 focus-visible 仍是回退。dark／forced-colors 与 360px 窄屏均有针对性规则。typecheck、111 tests、Chrome／Firefox build 与 `git diff --check` 通过；等待用户重载视觉验收。

- B061 返工原因：用户明确指出所需不是两个控件的视觉合并，而是正在显示的缩放值（如 `400%`）本身可直接编辑；原 B060／B061 的额外“自定义缩放”输入不符合该交互。

| B062-01 | 单一可编辑缩放值 | 用一个始终展示当前缩放状态的原生文本输入替代 select + custom form：手动状态显示如 `400%`，点击／聚焦后可直接编辑数字；输入 25–400 的整数后，失焦或非 IME 的 Enter 自动应用并显示带 `%` 的结果。无效输入恢复当前实际百分比并给出简短状态提示 |
| B062-02 | 预设菜单 | 在同一缩放控件右侧保留仅用于展开预设项的箭头；菜单提供自动、实际大小、适合页面、适合页宽及既有固定百分比。选择预设后更新输入显示和既有 zoom mode；不再出现“自定义缩放”选项或第二个数值框 |
| B062-03 | 可访问与阅读状态 | 使用关联 label、原生 input／button／disclosure 语义、可见焦点与正确 tab 顺序；不伪造 ARIA combobox。保留加减、旋转、连续阅读、页码、相对滚动位置、历史与旧保存 view 的行为 |
| B062-04 | 验证与约束 | 更新缩放解析／编辑提交的单测，运行 typecheck、完整测试、Chrome／Firefox build、diff check；仅改 reader 缩放控件、样式、必要 i18n／测试，不改 PDF 渲染、模型、证据、权限或侧栏，不重载扩展 |

- B062 实现反馈：已以单一原生文本输入替换 select + custom form；空闲时显示当前实际比例（如 `400%`），聚焦后显示并全选纯数字，只有编辑过的合法 25–400 整数在失焦或非 IME Enter 时提交为 manual。未编辑的聚焦／失焦不会改变 auto／fit mode，无效输入恢复当前比例并显示本地化范围提示。右侧原生 `details` 箭头菜单保留 auto／actual／fit-page／fit-width 与 50–400 预设，选择后关闭；已删除 custom 选项、第二数值框和提交按钮。typecheck、22 files／112 tests、Chrome／Firefox build 与 `git diff --check` 通过；等待用户重载后的实际交互验收。

| B063-01 | 稳定本地 PDF 键 | 对实际导入并通过现有大小检查的本地 PDF bytes 使用浏览器 Web Crypto SHA-256 生成仅含安全字符的本地来源键（含明确的 local/hash 版本前缀）；相同字节内容必须得到相同键，文件名、路径、mtime 不参与。不得把本地路径、文件名或内容直接写入地址 |
| B063-02 | 本地 fragment 与页码同步 | 本地 PDF ready 后写入与远程一致的 `#pdf=<local-key>`，第 2 页起带 `&page=N`；连续滚动、缩放／旋转后的现有激活页同步继续更新 `page`。远程 HTTPS URL fragment 格式、自动加载、权限和分享语义必须不变 |
| B063-03 | 本地 fragment 边界 | 本地 key 仅是当前浏览器中已导入内容的匿名标识，不能使新标签页／另一设备读取用户磁盘或绕过文件选择与权限；在没有本地文件 payload 的启动场景要保持安全、可恢复的 idle／说明状态，不能当作 HTTPS URL fetch 或误报可直开 |
| B063-04 | 测试与约束 | 为 stable key、fragment 格式／解析和 local/remote 不串用补单测，运行 typecheck、完整测试、Chrome／Firefox build、diff check；仅改 reader source/address/fragment 及必要测试／文案，不改 PDF 渲染、模型、证据、权限或缩放，不重载扩展 |

- B063 实现反馈：新增 `local-sha256-<64 位小写 hex>` 本地来源键，Web Crypto 仅以已读取且通过大小检查的 PDF bytes 计算；不含文件名、路径或内容，改名／异目录的相同 bytes 得到相同键。本地 ready 后写 `#pdf=<key>`，连续滚动和显式跳页同步 `&page=N`（第一页省略）；远程 HTTPS format／fetch／权限不变。只含本地 key 的新 reader 地址保持可重新选择文件的 idle，不 fetch、不读取或持久化文件。typecheck、23 files／117 tests、Chrome／Firefox build 与 `git diff --check` 通过；等待用户真实浏览器验收。

| B064-01 | 缓存契约与存储 | 新建受白名单约束的本地 IndexedDB 概览仓库；只存已完成、已本地验证的 three-line／detailed 结构化结果和必要版本元数据，绝不存 API key、headers、原始模型文本或逐步请求历史。读写错误可忽略且不阻断概览 |
| B064-02 | 精确缓存隔离 | 缓存键必须包含 `sha256:<documentContentKey>`、PDF 页面提取／evidence ledger 版本、对应 three-line 或 progressive detailed prompt／协议版本，以及影响结果的非机密模型配置（base URL、model、structured output、context／output limit）；不允许同名文件、同 URL 或仅同模型误命中 |
| B064-03 | 恢复与再校验 | 当前 PDF 的 extraction 与 ledger ready 后异步读取；恢复前按当前 ledger 重新确认每个缓存 evidence ID 仍存在且可定位。缓存命中恢复两类结果（detailed 仍须依赖已恢复或新生成的 three-line），不请求 host permission、不发送模型请求；损坏／过期／无效项不展示为事实，安全降级到未生成 |
| B064-04 | 写入与状态 | 每个概览只在成功完成验证后写入；取消、权限拒绝、网络失败、格式失败及 detailed 的局部不可用中间态均不写。导入切换／旧异步读写不得覆盖新 PDF state；可在既有 debug／状态区域以本地化、非侵入方式说明已从本地恢复 |
| B064-05 | 验证与约束 | 增加 key、结构校验、证据重验及不含 secret 的单测；运行 typecheck、完整测试、Chrome／Firefox build、diff check。不修改模型请求、prompt 内容、evidence 判定、PDF／fragment／权限语义或详细概览的材料不足策略，不重载扩展 |

- B064 实现反馈：新增独立 `thesis-viewer-overviews` IndexedDB，白名单重建并只持久化完整、已本地验证的结构化结果；未保存 API key、headers、原始 provider 文本、诊断或递进会话。cache key 覆盖 document SHA-256、页面提取／ledger 版本、概览协议版本及 base URL、model、streaming、structured output、context／output limit。当前 extraction／ledger ready 后异步读取，逐条 evidence ID 需仍存在并可定位；detailed 仅在 three-line 成功后恢复，局部不可用的 detailed 不写入。读写和旧文档竞态均安全降级，命中无权限或模型请求。typecheck、24 files／121 tests、Chrome／Firefox build 与 `git diff --check` 通过；等待用户真实浏览器缓存命中／配置失效验证。

| B065-01 | Insights 图标生成按钮 | 将 Paper Insights 中 three-line 与 detailed 的可见“生成”文字按钮替换为现有图标体系的紧凑 icon button；不改变生成、取消、禁用或缓存恢复逻辑 |
| B065-02 | 无障碍与外观 | 两个 icon button 保留各自本地化的 `aria-label` 与 `title`，SVG 仅装饰，保留原生 button、焦点环、禁用态和窄屏布局；不得仅凭图标或 title 提供名称 |
| B065-03 | 验证与约束 | 运行 typecheck、完整测试、Chrome／Firefox build、diff check；仅改 reader Insights JSX／相关 CSS，必要时新增现有图标路径，不改模型、证据、缓存、PDF、权限或文案契约，不重载扩展 |

- B065 实现反馈：Paper Insights 的两个文字生成按钮已替换为同一紧凑 sparkle icon button；生成、取消、禁用和缓存逻辑未变。各自保留本地化 `aria-label` 与 `title`，SVG 为装饰，沿用现有 button 的可见焦点；窄屏为 2rem 方形控件。仅改 reader JSX／CSS。typecheck、24 files／121 tests、Chrome／Firefox build 与 `git diff --check` 通过；等待用户重载视觉验收。

| B066-01 | 静态交付审计 | 运行 typecheck、完整测试、Chrome／Firefox build、Firefox lint（如项目脚本可用）与 diff check；检查双端 manifest 的 options 独立标签、最小权限、reader/options/worker 资源，以及 GPL 文件／声明的一致性 |
| B066-02 | 最短双端回归矩阵 | 基于当前实现给出 Chromium 与 Firefox 分别可执行的最小验证：主题／语言保持、URL PDF 和 arXiv `/pdf/`、HTML 拒绝、本地 PDF fragment、连续滚动页码、概览 cache hit、图标生成按钮和设置页独立标签。不得将用户未报告的结果写成通过 |
| B066-03 | 未测边界诚实盘点 | 保留无文字、密码、损坏、超限 PDF 及 B058 引用完整条目的真实样本为未测；标明 Playwright Chromium 的文件选择器限制不是产品回归 |
| B066-04 | 约束 | 只审计、构建与编写验证步骤；不改 reader／provider／evidence／缓存／权限／布局，不重载扩展、不新建 profile、不生成模型请求 |

- B066 静态反馈：typecheck、24 files／121 tests、Chrome／Firefox build 与 `git diff --check` 通过；项目无 Firefox lint script。双端 MV3 均为 `options_ui.open_in_tab: true`，常规权限仅 `storage`／`webNavigation`，HTTPS／loopback 为按需权限，reader/options/PDF worker 存在；Chrome service worker 与 Firefox `background.scripts` 均正确。仍待用户在正常 Chromium／Firefox 执行合并回归；未测边界为无文字、密码、损坏、超限 PDF 和 B058 完整参考条目。另发现发布层待办：独立 `.output` 不含 LICENSE，README 留有“无后台脚本”旧描述；本批未修改，需独立收尾。

| B067-01 | README 架构与安装说明 | 删除／改正“无后台脚本”等已失真的描述，使 README 与当前 Chrome service worker、Firefox MV3 background scripts、arXiv 接管、options 独立标签、仅直链 PDF 范围和已知限制一致；不声称未测边界已经通过 |
| B067-02 | 可分发许可证 | 调整构建／打包流程或发行说明，使独立分发的 Chrome／Firefox 构建目录包含根目录 GPL-3.0-only LICENSE，且不改变 manifest、bundle、权限或运行时资源 |
| B067-03 | 发布核验 | 重新构建两端，断言 LICENSE、manifest、reader/options/worker 存在；运行 typecheck、测试、diff check。只改 docs／构建复制步骤，不能修改功能或重载扩展 |

- B067 实现反馈：README 已同步连续阅读、概览缓存、双端后台、独立 settings tab、arXiv `/pdf/` 接管条件和 HTML 拒绝边界；双端 build 后执行 `scripts/copy-license.mjs`，根与两个产物 LICENSE SHA-256 相同。typecheck、24 files／121 tests、双端 build、manifest／reader／options／worker 存在性及 `git diff --check` 均通过。M8 主流程已由用户在正常 Chromium／Firefox 验收；已归档至 B067。

## 第三部分：相关背景知识

- 当前 `#pdf=` 仅为可分享的 HTTPS 远程 PDF 来源；B063 拟增加不可反序列化为文件的本地内容键，仍不得绕过文件选择或可选来源权限。
- 现有翻译已经以 IndexedDB 保存完成任务和确定性请求缓存；概览没有持久化。B064 应复用其“缓存不可用也不阻断”的模式，但不能复用翻译的弱键：概览必须带 evidence／extraction／prompt 版本并在恢复时重验当前本地 evidence。
- 主题／语言切换不能丢失阅读位置、选区、已生成结果或任务状态；应用自有文案使用消息键，论文原文、模型输出与 URL 保持原样。
- Playwright 控制 Chromium 的文件选择器限制不应判为扩展回归；正常 Chromium 与 Firefox 会话是功能验证依据。
- 详细概览质量优化须保持 alias→本地锚点复核、未知 alias 拒绝和局部安全降级。
- B066 是交付审计而不是功能实现；只有用户在正常 Chromium／Firefox 会话报告的现象才可作为真实浏览器通过证据。
