# B094 独立方法语义审阅（阶段记录）

审阅对象：当前可用的 SAM、3DGS、Video-MME、LoopVL、Chinchilla、ResNet 的 request-02-response.json，并对照同目录 request-02.json 的 newSources。仅作定向人工审查，非逐句穷尽事实认证。v16 final-method 与 Transformer、LoRA 尚待文件落地后补审。

## 是否阻断验收

旧 request-02 不能作为“重大事实错误为0、核心方法完整”的质量通过证据。至少 Video-MME 存在明确范围泛化错误，ResNet 存在核心结构证据未选入。若最终 v16 输出仍有这些问题，应阻断质量验收；这不等同于阻断所有代码集成。

## 具体发现

- **Video-MME，明确适用范围错误（高）**：输出“每个模型分别在 frames only、frames with subtitles、frames with audio 三种条件下评测”。输入 E093 明确说明这里是 Gemini 1.5 Pro 在六类视频上的分析；E094 是该句后续并列三种设置，不能推出每个参评模型都有音频条件。需要保留 Gemini 范围。字幕与抽样帧时间戳对应（E105）确有原文支持，不应误报；与 E106 的“complete subtitles/audios”须分清概括格式与具体实现。
- **ResNet，核心机制缺失（高）**：已解释 residual mapping、identity/projection shortcut、stride/channel matching 与训练，但完全没有深层网络的 bottleneck（1×1降低维度→3×3→1×1恢复维度）。当前 request-02 的 newSources 中也没有 bottleneck，只有 E067 的 projection shortcut 1×1 convolution。相关结构解释藏在实验4.1；仅按方法标题选章会漏掉。应补入该段再生成，不能靠模型常识自行补写。
- **3DGS，模块定义缺失（中）**：篇幅很长但没有解释 SH 是 spherical harmonics、用于表达视角相关颜色；只在末尾提 SH coefficients/bands 的训练安排。E013 明确含 directional appearance component/color 与 spherical harmonics 定义。应补这项核心表示机制，删除大部分阈值、CUDA线程、步数等旁枝。
- **SAM，范围与详略（中）**：编码机制已正确区分：points/boxes=positional+type embeddings、text=CLIP、mask=conv+image embedding；decoder双向attention/MLP动态分类器已解释，较旧调查改善。data engine三阶段也完整。但方法输出加入长串数据规模、标注时间、评测指标/网格阈值，明显超出理解主机制所需；应保留结构、prompt训练、歧义处理和数据引擎，再缩短旁枝。text-to-mask独立训练/推理条件已在末段区分，不能简单判为混用。
- **LoopVL，核心流程基本覆盖（中/低）**：H/L分别是什么、共享方式、循环顺序、视觉anchor、PrefixLM、预训练/对齐/mid-training/SFT/GRPO均解释。大量学习率、batch size、token总量、种子和评测预算可压缩。E049本身对“最后五次调用”的列举不是前向次序；输出复述了原文列举，不据此认定模型编造。该原文歧义宜避免机械复述为严格执行顺序。
- **Chinchilla，核心流程基本覆盖（中/低）**：三条估计路径、loss decomposition及预算约束下求最优已解释。E045 的 horizons “ranges by a factor of 16”是范围跨度；输出“不同horizon之间相差16倍”容易误读为任意/相邻都16倍，宜改“跨度16倍”。模型配置、数据采样比例、评测清单过多。

总体：alias合法与锚点有效没有解决这些语义问题。应以最终输入/输出逐项复核，不能把本审阅旧稿问题直接归到尚未完成的v16上。

## 后续文件补审（原始 response/request 成对）

**审计纠正**：overview/result 的 alias 会由 runner 全局重编号；其编号不同于单次 request 并非覆盖错配。本报告以 request-N-response.json 对应 request-N.json 为证据，不用 overview 的偏移编号定位。

- **Transformer request-02**：Q/K/V、scaled attention、multi-head、causal mask、cross-attention、FFN、position encoding、训练步骤均有机制说明，未发现本次定向检查中的明确重大事实错误。仍加入训练硬件/时长/BLEU等旁枝，末尾“beam具体配置不在摘录”暴露推理源覆盖不足，不符合完整复述目标的理想状态。
- **LoRA request-02**：冻结W0、A/B低秩分支、零初始化、alpha/r缩放、应用attention权重、merge后推理与多任务限制均有解释，未发现明确重大事实错误。后半段奇异子空间实证与精确性能数字明显挤占方法；可保留低秩假设与验证思路，移出大部分结果。

### v16 final-method/SAM

依据 `final-method/SAM/request-01-response.json` 与同名request。

- 主机制完整度比旧稿提高：高分辨率image encoder、稀疏/稠密prompt编码、decoder双向attention、输出token/MLP、歧义多mask、交互模拟训练和data engine三阶段均有解释。
- **限定范围问题（中）**：输出“SA-1B ... 其中99.1%来自上述全自动阶段，因此数据集只纳入自动生成的mask”。E056中的99.1%是data engine总产物比例，随后才说明发布的SA-1B只含自动mask；当前把两者合成同一总体，并把因果压缩成“因此”，容易产生99.1%与100%的自相矛盾。应区分生成总量与发布子集，或删这条非核心统计。
- **机制详略（低/中）**：E126写上采样后token还会再对image embedding做一次attention，再过MLP；输出没有提这一额外attention，但主decoder解释已足够理解。输出“逐点相乘”直接跟随E126的spatially point-wise product措辞，不能仅凭此判为模型数学编造；更清晰的动态分类器/按位置对通道向量作内积解释更适合读者。
- **训练/推理边界（中）**：末段“训练时用CLIP计算文本与图像embedding”可以使人误以为训练有文本监督。E213实际是image crop经CLIP image encoder生成训练prompt，E216明确无需explicit text supervision，推理才用text encoder。输出随后写出了crop流程，但仍建议明确补一句“该扩展训练使用图像prompt而不需要文本监督”。
- **详略仍未达成理想状态**：batch/learning rate、标注时长与mask统计、图像发布尺寸、质量IoU仍占大量篇幅。不是因篇幅长而不合格，而是非核心统计未被简化。

### v16 final-method/Video-MME

依据 `final-method/Video-MME/request-01-response.json` 与同名request。

- 采集→完整观看与多选标注→双人/文本模型质检→采帧/字幕→选项抽取accuracy的完整流程已给出。
- 删除了旧稿“每个模型”全称，属于改善，但最后“评测在三种输入模态条件下展开”仍未交代E093所在的Gemini 1.5 Pro类别分析范围。其前文列出全部16个参评模型，读者仍可能理解为通用协议。建议明确“另外，对Gemini 1.5 Pro比较三种模态条件”，而不是只删量词。
- **明确内部不一致（中）**：输出“共设6个主域，即Knowledge、Film & Television、Sports Competition、Life Record、Multilingual”只列5项；E037原文也漏一项，但同请求E012明确第六项Artistic Performance。这是忠实复述局部缺陷而没有跨证据核对的实例，应补齐第六项或不枚举。
- 字幕时间戳规则有E105直接支持，不认定错误。模式支持条件需要限定，不应把字幕同步与音频支持混为同一问题。

## 更新后的验收判断

8篇旧稿已作定向审阅；最终v16仅SAM与Video-MME在本次窗口内可补审。不能签署“v16八篇重大事实错误为0”。SAM与Video-MME核心机制已明显改善，但上述数据总体/模态适用范围/主域枚举问题仍需修订或如实记录；ResNet bottleneck是否补入与3DGS SH定义仍等待最终稿。若对外声称已达到方案的零重大事实错误及完整机制门槛，应暂缓该质量结论。

## v17 双请求最终方法审阅

- **Video-MME request-02：此前实质问题已修复。** 输出补齐Artistic Performance，六域枚举一致；明确Table 4主体without/with subtitles与Gemini 1.5 Pro单独三模态分析，并指出多数开源模型不支持audio。原文E012支持六域，E099支持Gemini范围，E103明确开源audio省略，E118/E119支持采帧/字幕时间戳。针对此前问题的定向复核通过，本轮未发现新的实质错误。
- **SAM当前这次v17不是可用最终方法。** 目录仅request-01，response.content不是合法JSON，result.method.status=unavailable，并未进入request-02语义复核。不能将此次计为已完成双请求或语义通过；等待自动/人工重试后再审。此项是生成可用性失败，不是已显示回答中的事实错误。

- **3DGS v17 request-02：主要缺口已修，仍有一处数学解释错误。** SH已明确解释为spherical harmonics系数表达随视角变化的颜色；Algorithm 1的采样视图→渲染→loss→Adam更新、附录A梯度参数化与clone/split均已补入。输出首个Gaussian公式正确，但文字“指数中的二次型随位置x偏离中心μ而衰减”反了：二次型增大，衰减的是取负指数后的Gaussian权重。应写“Gaussian权重随离中心距离增大而衰减”。该句是实质数学表述错误，但未改变后续正确的优化/渲染流程；应定向修订，不再沿用‘完全没解释SH’的旧稿问题。

- **ResNet v17 request-02：此前核心机制缺口已修复。** 输出完整解释bottleneck的1×1降维→3×3→1×1升维，为什么节省计算，以及50/101/152层的构造；原文E159、E160、E165、E166支持。residual与identity/projection shortcut、逐元素相加、尺寸匹配、训练与推理均有解释。该定向复核未发现新的实质机制错误。复核稿对未提供的损失函数/无法确认的迭代数上标明确不自行补造；这不是新的事实错误。

四篇关键审阅当前状态：Video-MME与ResNet此前阻断机制/范围问题已修；3DGS主要覆盖问题已修但存在一句二次型衰减解释错误；SAM本次v17输出不可用，尚待重试。该结论只针对已读取的版本，不替代后续重试审查。

### SAM v17 补跑（已完成request-02）

此前不可用状态已被新的两请求补跑替代。复核稿正确区分points/boxes的位置+类型嵌入、CLIP text encoder、dense mask卷积与逐元素相加；decoder两层双向attention、上采样后的额外attention、MLP输出已完整描述；训练的交互prompt/误差区域/11轮、歧义多mask与data engine三阶段均有机制。最后明确文本变体训练用CLIP图像嵌入，推理用CLIP文本嵌入，修复此前训练/推理边界含混。本次未发现新的核心模块或训练阶段错误。

仍有一处非核心数量范围表达不够准确：第三个完全自动阶段之后接“该流程...1.1B掩码，其中99.1%完全自动生成”，把data engine整体99.1%比例紧接在fully automatic阶段流程后；源E056的99.1%属于整个data engine总产物，发布SA-1B又只含自动mask。后句已明确发布集只含自动mask，比v16有所改善，但最好直接省略99.1%以免将自动阶段误解为有0.9%人工mask。此项不影响主方法机制可复述性。
