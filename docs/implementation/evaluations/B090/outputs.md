# B090 deepseek-flash 原始输出对照

2026-10-09。生成内容原样保留，**不是校正后的论文解读**。已发现的事实/范围问题见主报告。A：现状；B：同输入加强解释；C：人工选整章；D：整章+人工方法范围。分栏/合并为另一次同素材对照。

## SAM

### A

输入 1761 tokens；输出 1160 tokens（含 reasoning）；耗时 7.65s。

模型侧：image encoder 采用经 MAE pre-training 的 Vision Transformer (ViT)，为处理高分辨率输入做最小改动，每张图像只运行一次，可在对模型进行 prompting 之前预先计算（E002）。prompt 侧：points 与 boxes 以 positional encodings 加上各 prompt type 的 learned embeddings 表示，free-form text 由 CLIP 的 off-the-shelf text encoder 编码，dense prompts（即 masks）经 convolutions 嵌入并与 image embedding 逐元素相加（E003）。随后 lightweight mask decoder 把 image embedding、prompt embeddings 与一个 output token 映射为 mask，该设计即 Segment Anything Model（SAM），并具备 ambiguity-aware 特性（E003、E006）。
数据侧：data engine 分三阶段，依次为模型辅助的人工标注、自动预测 mask 与人工标注混合的半自动阶段、无需标注者输入的全自动阶段（E004）。半自动阶段先用 bounding box detector 检出 confident masks，该 detector 在第一阶段全部 mask 上以通用 “object” 类别训练，随后把 mask 预填进图像，请标注者补充未标注物体；此阶段在 180k 图像中新增 5.9M masks，累计 10.2M，并周期性地在新数据上重训模型 5 次，单 mask 平均标注时间回升至 34 秒，每图平均 mask 数由 44 增至 72（E005）。

### B

输入 1817 tokens；输出 1796 tokens（含 reasoning）；耗时 8.95s。

本文处理的是 promptable segmentation：模型接收一张 image 与一个 prompt，输出对应的 segmentation mask（E006）。prompt 的类型包括 points、boxes、free-form text 和 mask（E003）。E001 说明该任务与 ambiguity 有关，并称要把这一任务做好需要专门的 modeling 与 training loss 选择，但材料中并未给出 loss 的具体形式，mask decoder 的内部结构、output token 如何参与计算同样未在片段中交代（E001）。

模型结构由三部分组成，作者称之为 Segment Anything Model（SAM）：powerful image encoder 计算 image embedding，prompt encoder 把 prompt 编码，两者再由 lightweight mask decoder 融合并预测 segmentation mask（E006）。image encoder 使用 MAE 预训练的 Vision Transformer（ViT），为处理 high resolution 输入做了 minimal adaptation；它每张图只运行一次，因此可以在 prompting 之前预先算好（E002）。prompt encoder 一侧，points 与 boxes 用 positional encodings 与每种 prompt type 各自的 learned embeddings 相加来表示，free-form text 交给 CLIP 的 off-the-shelf text encoder，dense prompts（即 masks）则用 convolutions 嵌入后与 image embedding 逐元素相加（E003）。mask decoder 接收 image embedding、prompt embeddings 和一个 output token，输出 mask（E003）。就推理流程而言，image encoder 只需一次前向，后续的 prompt 编码与解码在已算好的 image embedding 上进行（E002）。

数据侧对应 Segment Anything Data Engine，分三阶段：（1）model-assisted manual annotation；（2）半自动阶段，自动预测的 masks 与 model-assisted annotation 混合；（3）完全自动阶段，模型在无标注者输入的情况下生成 masks（E004）。E001 提到该任务的自动标注能力正是 data engine 所需要的。片段只展开了第二阶段的做法：先自动检测 confident masks——为此用 generic “object” 这一类目在全部第一阶段 masks 上训练一个 bounding box detector——再把预填这些 masks 的 image 呈现给标注者，要求其标注其余尚未标注的对象；该阶段在 180k 张 image 上新增 5.9M masks，累计 10.2M masks，期间周期性重训模型 5 次。由于这些对象更难标注，每个 mask 的平均标注时间回升到 34 秒（不含自动 masks），每张 image 的平均 mask 数从 44 增至 72（含自动 masks）（E005）。第一、第三阶段的具体操作，以及 E006 中另外两项约束的名称，均未在所给材料中给出（E004）。

### C

输入 7813 tokens；输出 6487 tokens（含 reasoning）；耗时 27.61s。

任务与输入输出。这套方法的核心任务叫 promptable segmentation：输入是一张图像加上一个 segmentation prompt，prompt 可以是前景/背景点集合、粗略的 box 或 mask、free-form text，或一般来说任何指示“要分割什么”的信息，输出是对应的 segmentation mask (P014)。任务对输出只要求“valid”，即当 prompt 本身有歧义、可能指向多个物体（例如衬衫上的一点既可指衬衫也可指穿衣的人）时，给出其中至少一个物体的合理 mask 即可 (P014)。这一任务设定受 NLP 中“先预训练、再用 prompt engineering 迁移到多样下游任务”的基础模型范式启发，并被同时用作预训练目标与下游迁移手段 (P001, P004)。由此得到的模型在推理时可以充当更大系统的组件——例如把已有 object detector 的 box 输出当作 prompt 就得到实例分割——因此它与在固定任务集合上训练的多任务分割系统不同，属于一种任务泛化 (P017)。这种可组合性是设计出发点，论文将其类比为 CLIP 作为 DALL·E 的文本-图像对齐组件 (P019)。

模型结构。promptable segmentation 与真实使用场景共同施加了三条约束：必须支持灵活 prompt、mask 计算要达到 amortized 实时以便交互使用、并且必须对歧义有感知 (P006)。实现是 SAM（Segment Anything Model），由三部分组成：heavyweight 的 image encoder、可接受多种 prompt 的 prompt encoder、以及快速的 mask decoder (P030, P006)。image encoder 每张图像只运行一次，产出 image embedding；同一个 image embedding 随后可被不同 prompt 反复复用，从而把编码成本摊销 (P006)。在已有 image embedding 的前提下，prompt encoder 与 mask decoder 在 web browser 的 CPU 上约 50ms 就能从 prompt 得到 mask，这是实时交互的基础 (P006)。

image encoder 采用经 MAE 预训练的 Vision Transformer (ViT)，并针对高分辨率输入做了最小适配 (P035)。prompt encoder 按 prompt 稠密程度分路：sparse 的 point、box 用 positional encoding 叠加该 prompt 类型的学习 embedding 表示，free-form text 用 CLIP 的 off-the-shelf text encoder 编码，dense 的 mask 则用卷积嵌入并与 image embedding 逐元素相加 (P035)。

mask decoder 把 image embedding、prompt embedding 和一个 output token 映射成 mask：它改造了 Transformer decoder block，在 prompt 与 image embedding 之间做双向 cross-attention（prompt-to-image 与 image-to-prompt），同时用 prompt self-attention 更新全部 embedding；跑两个 block 后对 image embedding 上采样，再由 MLP 把 output token 变为 dynamic linear classifier，逐图像位置计算 mask 的前景概率 (P037)。为处理歧义，模型对单个 prompt 预测多个 mask 输出（实测 3 个足以覆盖常见情形，因为嵌套 mask 通常至多三层：whole、part、subpart），训练时只对该 prompt 下 loss 最小的那个输出反传 (P039)。每个 mask 还配一个预测的 confidence score，即估计的 IoU，用于对多个输出排序 (P030, P032)。论文强调，要在这项任务上真正做得好，需要专门的建模与损失设计 (P016)。

训练阶段。预训练算法对每个训练样本模拟一串 prompt（点、box、mask），并把模型预测的 mask 与 ground truth 比较；做法借自 interactive segmentation，但目标不同：后者追求在足够多用户输入后得到有效 mask，而这里要求对任何 prompt（包括歧义 prompt）都直接给出有效 mask，正因如此预训练模型才能直接用于 data engine 的自动标注 (P016)。监督信号是 focal loss 与 dice loss 的线性组合 (P034)。训练按 11 轮随机采样 prompt 来模拟交互过程，使 SAM 能无缝嵌入 data engine (P034)。材料中未给出 text prompt 的训练配置（原文指向 §7.5）与组件层级的架构细节（原文指向 §A），这两处不补造 (P034, P033)。

数据引擎。由于分割 mask 在互联网上并不天然充裕，本文不采用在线爬取，而是构建 data engine，即模型与标注互相迭代的 model-in-the-loop 标注流程，分三阶段 (P003, P036)。第一阶段是 assisted-manual：专业标注员在由 SAM 驱动的浏览器交互式分割工具中点击前景/背景点来标注 mask，并可用像素级 brush 与 eraser 修正；该阶段不设语义约束，标注员自由标注 stuff 与 things，按显著度顺序标注，单个 mask 若超过 30 秒则鼓励跳到下一张图 (P038)。阶段开始时 SAM 用公开分割数据集训练，随后改用新标注的 mask 重训，image encoder 从 ViT-B 扩到 ViT-H，共重训 6 次；每个 mask 的平均标注时间从 34 秒降到 14 秒，每图平均 mask 数从 20 升到 44，最终从 120k 张图得到 4.3M mask (P040)。

第二阶段是 semi-automatic：先用第一阶段 mask 训练一个 generic “object” 类别的 bounding box detector 来检出 confident mask，将其预填到图像上，让标注员专注补标那些未标注物体，以提高 mask 多样性；该阶段新增 5.9M mask、涉及 180k 图像（累计 10.2M），期间周期性重训模型 5 次，每个 mask 的平均标注时间回升到 34 秒（不计自动 mask），每图平均 mask 数从 44 增到 72（含自动 mask）(P043)。

第三阶段是 fully automatic：此时已积累足够 mask 提升模型，且模型已具备 ambiguity-aware 能力，因此可以完全不做人工标注 (P045)。具体做法是用 32×32 的规则点网格作为 prompt，对每个点预测一组可能对应有效物体的 mask——若点落在 part 或 subpart 上，就同时返回 subpart、part 与 whole；再用模型的 IoU 预测模块挑选高置信 mask，并只保留“稳定”的 mask（在 0.5−δ 与 0.5+δ 两个阈值下二值化概率图结果相近者视为稳定），随后用 non-maximal suppression (NMS) 去重，并额外处理多个重叠的 zoomed-in image crop 以改善小物体 mask 质量 (P045)。该阶段对全部 11M 图像运行，共产出 1.1B mask (P045)。

数据集与质检。SA-1B 由 11M 张 licensed、privacy-preserving 的高分辨率图像与 1.1B mask 构成，平均每图约 100 个 mask，其中 99.1% 的 mask 出自全自动阶段，因此最终数据集只包含自动生成的 mask (P012, P044)。图像平均分辨率 3300×4950，因数据体量问题发布时把最短边降采样到 1500 像素，人脸与车牌已做模糊处理 (P044)。质检方式是把自动 mask 与专业修正 mask 配对比较：随机抽 500 张图（约 50k mask），由专业标注员用模型与像素级 brush/eraser 改进全部 mask，计算两两 IoU，结果 94% 的配对 IoU 高于 90%、97% 高于 75%；作为参照，既有工作估计的 annotator 间一致性为 85–91% IoU (P046)。SA-1B 的 mask 总量比此前任何分割数据集多 400 倍 (P005)。属性分析显示，其图像数与 mask 数分别是第二大分割数据集 Open Images 的 11 倍与 400 倍，每图平均 mask 数比 Open Images 多 36 倍、比最接近的 ADE20K 多 3.5 倍；相对 mask 尺寸分布更偏向小与中等物体；在按 mask 尺寸分箱做分层抽样以控制尺寸分布后，mask concavity 与其他数据集大体相似 (P077, P074)。在地理与收入代表性上，SA-1B 在欧洲、Asia & Oceania 及 middle income countries 的占比明显更高，Africa、Latin America & Caribbean 与 low income countries 在所有数据集中都被低估，但 SA-1B 中每个区域仍有至少 28M mask；各区域与收入分组的每图平均 mask 数（94–108）相对一致 (P080, P079, P076)。

使用/推理阶段与评测。推理时不需要重新训练，下游任务通过 prompt engineering 完成，即 zero-shot transfer (P018)。评测由两部分构成：其一是用新构建的 23 个分割数据集套件检验单前景点 prompt 下 mask 的质量，发现往往只略低于人工标注的 ground truth；其二是在 zero-shot transfer 协议下考察多类下游任务，包括 edge detection、object proposal generation、instance segmentation，以及对 text-to-mask 预测的初步探索，其中实例分割等任务是把 promptable segmentation 模型作为组件嵌入更大的系统 (P007, P017)。

### D

输入 7928 tokens；输出 7033 tokens（含 reasoning）；耗时 28.92s。

任务与输入输出。promptable segmentation 的目标是在给定任意 segmentation prompt 时返回一个 valid segmentation mask；prompt 可以是前景/背景点、rough box、mask、free-form text，或一般地任何指示图像中要分割什么的信息。输入是图像加 prompt，输出是 mask；当 prompt 有歧义、可指多个对象时，输出仍应是其中至少一个对象的合理 mask（P004, P014）。

模型总览。SAM 由三个组件组成：image encoder、prompt encoder、mask decoder（P033）。image encoder 为每张图像计算一次 image embedding；prompt encoder 把 prompt 编码成 prompt embedding；mask decoder 将两者结合并输出 mask（P006）。将 image encoder 与轻量 prompt encoder / mask decoder 分离，使同一 image embedding 可被不同 prompt 重用，从而摊销图像编码成本（P030）。

image encoder 与 prompt encoder。image encoder 使用 MAE 预训练的 ViT，并针对高分辨率输入做最小适配，每张图像只运行一次，可在 prompt 之前预先计算。prompt encoder 分 sparse 与 dense：points、boxes、text 属于 sparse，用 positional encoding 与每种 prompt type 的 learned embedding 相加；free-form text 用 CLIP 的 off-the-shelf text encoder；dense prompts（mask）用 convolutions 嵌入，并与 image embedding 逐元素相加（P035）。

mask decoder。mask decoder 将 image embedding、prompt embeddings 与一个 output token 映射为 mask。其结构是修改的 Transformer decoder block 加 dynamic mask prediction head：先做 prompt self-attention 与双向 cross-attention（prompt-to-image embedding 和 image-to-prompt），更新所有 embeddings；运行两个 block 后，上采样 image embedding，并用 MLP 将 output token 映射为 dynamic linear classifier，在图像每个位置计算 mask foreground probability（P037）。

歧义 mask 与 quality score。为处理歧义，SAM 对同一 prompt 预测多个 mask，而不是把多个有效对象平均成一个 mask；通常 3 个输出足以覆盖 whole、part、subpart 等嵌套情形（P039）。模型还为每个 mask 预测 confidence score，即 estimated IoU，用于排序和选择（P032）。

训练。预训练时，promptable segmentation 任务通过模拟 prompt 序列实现：对每个训练样本模拟 points、boxes、masks 等 prompt，并比较模型 mask 预测与 ground truth（P016）。训练随机采样 prompt 并在每个 mask 上做 11 轮模拟，使模型适应交互式使用，并能接入 data engine；mask 预测用 focal loss 与 dice loss 的线性组合监督（P034）。

data engine 第一阶段。data engine 有三个阶段：assisted-manual、semi-automatic、fully automatic（P003）。第一阶段 assisted-manual 中，专业 annotators 在浏览器交互式分割工具中点击前景/背景点，工具由 SAM 驱动，并可借助 pixel-precise brush 和 eraser 修正 mask；由于使用预计算 image embeddings，标注可实时进行。该阶段不设 semantic constraints，annotators 自由标注 stuff 与 things，按显著性排序，并可在单 mask 超过 30 秒时进入下一图（P038）。随着标注数据积累，SAM 被重新训练，image encoder 从 ViT-B 扩展到 ViT-H，共重训 6 次（P040）。

data engine 第二阶段。第二阶段 semi-automatic 先自动检测 confident masks：用第一阶段 mask 训练一个 bounding box detector，类别为 generic “object”。把图像预填这些 mask 后，annotators 只标注剩余未标注对象，以增加 mask diversity。该阶段也周期性在新数据上重训模型（5 次）（P043）。

data engine 第三阶段与 zero-shot 使用。第三阶段 fully automatic 不再需要 annotators。模型用 32×32 regular grid of points 作为 prompt；因为已具备 ambiguity-aware，若点落在 part/subpart，会返回 subpart、part、whole object 等一组 mask。随后用 IoU prediction module 选择 confident masks，并只保留 stable masks（对 probability map 在 0.5−δ 与 0.5+δ 阈值化得到相似 mask），再用 NMS 过滤重复；为改善小 mask 质量，还处理多个重叠的 zoomed-in image crops（P045）。该阶段对数据集全部图像生成 mask，形成 SA-1B 的自动标注（P003）。训练完成后，模型通过 prompt engineering 做 zero-shot transfer：预训练使模型能对任意 prompt 作出合适响应，因此下游任务可被改写成给模型合适 prompt（P018）。例如已有猫的 bounding box detector 时，把 detector 输出的 box 作为 prompt 输入 SAM，即可得到猫的 instance segmentation；也可把 promptable segmentation model 作为更大系统的一个组件，组合出 edge detection、object proposal generation、instance segmentation、text-to-mask 等任务（P017, P007）。

### split

输入 7667 tokens；输出 8298 tokens（含 reasoning）；耗时 33.08s。

以下区分作者主张、已验证结果与推断。
核心贡献
1. 作者提出 promptable segmentation task：给定 point、box、mask 或 text 等 prompt，返回 valid mask；即使 prompt 有歧义，也须至少给出一个合理对象的结果；作者称该任务既提供预训练目标，也可通过 prompt engineering 解决下游分割任务，并类比 NLP 的 prompt。P014 P004
2. 作者交付 SAM：image encoder、prompt encoder、mask decoder 三组件。P006
3. 作者称该分离是为了复用同一 image embedding 并摊销计算，给定 embedding 后 prompt encoder 与 mask decoder 在浏览器 CPU 约 50ms；对歧义 prompt 输出多张 valid masks 与 confidence score。P034 P030
4. 作者以 data engine 三阶段（assisted-manual、semi-automatic、fully automatic）构建 SA-1B：11M images、1.1B masks，99.1% 自动生成。P044 P045
5. 作者把数据引擎描述为模型与数据迭代：模型辅助标注，新数据再改进模型。P003
6. 作者报告 500 images 抽样中 94% 自动-修正 mask 对 IoU>90%；在 23 segmentation datasets 上由 single foreground point 产生高质量 mask，并零样本迁移到 edge detection、object proposal generation、instance segmentation 与初步 text-to-mask。P046 P007
相对创新
1. 相对 multi-task segmentation systems：后者训练与测试任务固定，而作者主张 promptable segmentation 模型可在推理时作为更大系统组件执行新任务，属 task generalization；比较边界是文中定义的多任务系统。P017 P018
2. 相对 interactive segmentation：作者称其目标不是等足够用户输入后得到有效 mask，而是对任意 prompt 始终预测 valid mask，并可通过 composition 嵌入算法流程；比较边界是文中 interactive segmentation 的设定。P016 P019
3. 数据维度：作者称 masks 非网络自然充沛，故采用 model-in-the-loop data engine。P003
4. SA-1B 较 Open Images 多 11× images、400× masks，每图平均 masks 多 36×，该比较限于文中列出的数据集。P074 P077
5. Responsible AI：作者报告 SA-1B 在 Europe、Asia & Oceania 与 middle income countries 的代表性高于 COCO 与 Open Images，但所有比较数据集都 underrepresent Africa 与 low income countries。P079 P080
6. 作者认为这有助于更 equitable 的真实使用。P005
7. 区分与边界：任务定义、架构、数据引擎与发布属作者交付；零样本迁移与 mask 质量由实验和抽样验证。P007 P046
8. 作者希望 SA-1B 成为构建新 foundation models 的资源，但文中未把结论扩展为全领域首次或未比较任务上的优势。P005

### merged

输入 7693 tokens；输出 2570 tokens（含 reasoning）；耗时 11.52s。

核心贡献与相对创新

一、promptable segmentation task：作者把 NLP 的 prompt 迁移到分割，定义“给定任意 prompt 返回 valid mask”，并将其同时用作预训练目标与下游 zero-shot 的手段（P014、P004）。相对文中 interactive segmentation 以足够用户输入后得到有效掩码为目标，该任务要求对任意 prompt 始终给出合理掩码，以支持含歧义的自动标注（P016）；作者并强调它不同于训练与测试任务相同的 multi-task segmentation system，模型可在推理时作为更大系统的组件完成新任务（P017）。此处的区分属作者的定位性主张，非实验比较。

二、SAM 架构：由 heavyweight image encoder、prompt encoder 与轻量 mask decoder 组成，image embedding 只计算一次即可被不同 prompt 复用，实现 amortized real-time 交互（P033、P006）。作者报告在浏览器 CPU 上约 50ms（P034）。针对单一输出会平均多个有效掩码的问题，改为对单 prompt 预测多个 mask 并给出 confidence score，训练时只回传最小 loss（P039、P030）；“3 个输出足以覆盖多数情形”是作者的经验判断（P039）。

三、data engine 与 SA-1B：因 mask 在网络上并不天然丰富，作者未沿用典型 foundation model 的在线取数，而是 model-in-the-loop 的三阶段标注（P003、P036）。最终 SA-1B 含 11M 图像与 1.1B masks，99.1% 由全自动阶段生成（P042、P044）；作者称其 mask 数比既有最大分割数据集 Open Images 多 400×（P074）。质量方面有验证：抽取约 500 图、50k mask 经专业标注者修正，94% 配对 IoU 大于 90%，作者据此与先前工作估计的 85–91% 标注者间一致性对比（P046）。

四、zero-shot 泛化：在 23 个分割数据集及 edge detection、object proposal generation、instance segmentation 与初步 text-to-mask 上以 prompt engineering 做 zero-shot transfer，作者报告结果强（P007）。但文中亦承认 room for improvement remains（P007），因此不宜视为已全面解决。

## 3DGS

### A

输入 2360 tokens；输出 983 tokens（含 reasoning）；耗时 5.0s。

输入是静态场景的一组图像及经 SfM 标定的对应相机，SfM 作为副产物给出稀疏点云；由这些点初始化一组 3D Gaussians，每个由位置（mean）、covariance matrix 与 opacity 定义 (E009)。随后进行交错的 optimization 与 density control，重点优化 anisotropic covariance 以获得精确的场景表示 (E008)。密度控制的具体规则为：optimization warm-up 之后每 100 iterations 执行一次 densify，并移除基本透明的 Gaussians (E006)；对欠重建区域中的小 Gaussians，克隆一个同尺寸副本并沿 positional gradient 方向移动，对高方差区域中的大 Gaussians 则替换为两个并缩小其 scale (E005)。优化后得到紧凑、非结构化且精确的表示，所有测试场景为 1–5 million Gaussians (E007)。最后是 real-time 渲染：基于快速 GPU sorting 与受 tile-based rasterization 启发的可见性感知算法，支持遵循 visibility ordering 的 anisotropic splatting，既加速训练也支撑实时显示 (E007, E008)。

### B

输入 2421 tokens；输出 2459 tokens（含 reasoning）；耗时 11.58s。

**任务、输入与输出**
本文方法是面向静态场景的 novel-view synthesis：输入为一组静态场景图像，以及由 SfM 标定出的对应相机，标定过程还会以副产物形式给出一个 sparse point cloud；输出则是用一组 3D Gaussians 表示该场景，并能在 1080p 分辨率下以约 30 fps 实时渲染新视角 (E009, E008)。这里的 3D Gaussian 不是神经网络，而是显式图元，每个由位置（mean）、covariance matrix 和 opacity 定义 (E009)。作者的总体目标是让该表示在保持 SOTA 视觉质量与有竞争力训练时间的同时，借 tile-based splatting 实现 1080p 实时渲染 (E004)。

**初始化**
表示直接从相机标定阶段产生的 sparse points 建立 3D Gaussians，从而使稀疏的离散点既继承 continuous volumetric radiance field 有利于场景优化的性质，又避免在空区域做无谓计算 (E008)。

**训练阶段：交错优化与密度控制**
训练的核心是 interleaved optimization 与 density control，其中特别优化 anisotropic covariance，以便准确贴合场景几何 (E008)。本文与 NeRF 类方法的 image formation model 相同，区别在渲染算法本身：NeRFs 是连续表示，需要昂贵的 random sampling 才能找到成像模型所需的样本，因而带来噪声与算力开销；而 points 是无结构、离散的表示，可通过优化 opacity 与 positions 实现几何的创建、销毁与位移，这正是密度控制得以生效的前提 (E002)。

密度控制的具体流程是：在 optimization warm-up 之后，每 100 iterations 执行一次 densify，并移除基本透明的 Gaussians (E006)。几何调整按局部重建状态分两路：位于 under-reconstructed 区域的小 Gaussians 需要覆盖新生成的几何，此时选择 clone，即复制一个同样大小的副本并沿 positional gradient 方向移动它；而处于高方差区域的大 Gaussians 则需要 split 成更小的图元，做法是用两个新 Gaussians 取代原图元，并把它们的 scale 除以一个因子 (E005)。

**渲染阶段（训练与推理共用）**
渲染是方法的第三个要素，使用快速 GPU sorting 算法，思路借鉴 tile-based rasterization (E007)。得益于 3D Gaussian 表示，方法可以做 anisotropic splatting 并尊重 visibility ordering，而排序正是其前提 (E007)。作者说明该 visibility-aware rendering 算法既加速训练，又允许实时渲染，因此它同时服务于训练与推理 (E008)。优化结束后得到的是紧凑、无结构且精确的场景表示，所测场景规模为 1–5 million Gaussians (E007)。

**材料中缺失的关键定义**
若干决定机制的具体定义在提供的材料中没有出现，无法据此推断：covariance matrix 的参数化方式（如何由旋转与缩放构造）、image formation model 的公式（Eq. 2 与 Eq. 3 被援引但其形式未给出）、split 时 scale 所除因子的取值、判定“基本透明”的 opacity 阈值、触发 densify 的 positional gradient 判据、warm-up 的迭代长度、损失函数与优化器配置，以及 tile-based rasterization 的分块、排序与前后合成细节 (E002, E005, E006, E007)。

### C

输入 6336 tokens；输出 6232 tokens（含 reasoning）；耗时 27.64s。

本文解决的任务是从一组静态场景的多视角照片出发完成 novel view synthesis，并让训练时间与最快的 radiance field 方法竞争、同时在 1080p 分辨率下实现实时渲染。方法的输入是一组图像以及由 Structure-from-Motion (SfM) 标定得到的对应相机，SfM 在标定过程中顺带产生一个稀疏点云，该点云被直接用于初始化（P009, P002）。与多数依赖 Multi-View Stereo (MVS) 数据的 point-based 方法不同，本方法只以 SfM 点为输入；在 NeRF-synthetic dataset 上即使随机初始化也能达到高质量（P006）。输出是一个显式、非结构化的 radiance field 表示：一组 3D Gaussians，可以直接栅格化渲染。整条 pipeline 由三部分构成——3D Gaussians 场景表示、与 adaptive density control 交错的参数优化、以及基于 tile 的可微实时渲染（P006）。

表示的基元与参数。每个 3D Gaussian 由世界坐标系下的中心（mean）μ、一个完整 3D 协方差矩阵 Σ 和不透明度 α 定义，其空间衰减为以 μ 为中心的高斯函数 G(x) = exp(−½ (x)ᵀ Σ⁻¹ (x))，渲染混合时该高斯值再乘上 α（P013, P015）。选择 3D Gaussians 的原因是它既可微、又可以被投影成 2D splats 从而支持快速的 α-blending，并且不需要法向量——SfM 点极其稀疏，估计法向量并对其进行优化非常困难（P012）。除位置、协方差与 α 外，每个 Gaussian 还用 spherical harmonics (SH) 系数表示与视角相关的颜色 c，这与既有 radiance field 做法一致（P022, P009）。这种各向异性协方差可以让 3D Gaussians 适配不同形状的几何，形成相当紧凑的表示（P019）。

从 3D 到 2D 的可微投影。渲染前需要把 3D Gaussian 投影到图像空间：给定 viewing transformation W，相机坐标系下的协方差为 Σ′ = J W Σ Wᵀ Jᵀ，其中 J 是投影变换的仿射近似的 Jacobian（P015, P017）。去掉 Σ′ 的第三行与第三列后得到 2×2 的 variance matrix，其结构与性质等同于从带法向量的 planar point 出发的情形（P017）。

协方差的参数化。直接对 Σ 做梯度下降不可行，因为协方差矩阵只有在 positive semi-definite 时才有物理意义，而更新步与梯度很容易产生非法矩阵（P017）。因此改为优化等价但更直观的分解 Σ = R S Sᵀ Rᵀ，其中 S 为 scaling matrix、R 为 rotation matrix（P017）；实现上分别存储 3D 向量 s（scaling）与四元数 q（rotation），并保证把 q 归一化成合法的单位四元数（P019）。为避免训练时 automatic differentiation 的开销，所有参数的梯度都被显式推导（P019）。协方差的初值设为各向同性 Gaussian，其轴长等于该点到最近三个点的平均距离（P040）。

训练循环与损失。优化基于反复迭代的“渲染—与训练视图比较”，因为 3D 到 2D 投影存在歧义，几何可能被放错位置，所以优化过程必须既能创建几何、也能销毁或移动放错的几何（P040）。优化使用 Stochastic Gradient Descent，借助 GPU 加速框架并可为部分算子编写自定义 CUDA kernel；其中栅格化是优化的主要计算瓶颈（P040）。α 用 sigmoid 激活限制在 [0−1) 区间并获得平滑梯度，协方差的 scale 用指数激活，位置使用类似 Plenoxels 的标准指数衰减调度（P040）。损失为 L1 与 D-SSIM 的组合 L = (1−λ)L1 + λL_D-SSIM，所有测试取 λ = 0.2（P043, P033）。

与优化交错进行的 adaptive density control 负责从稀疏初始集合生成更密、参数更正确的 Gaussian 集合（P042）。在 optimization warm-up 之后，每 100 次迭代做一次 densification，并剔除基本透明（α 小于阈值 ε_α）的 Gaussian（P042）。是否加密由 view-space positional gradient 的平均幅值决定：无论“欠重建”（under-reconstruction）还是“过重建”（over-reconstruction）区域，这类梯度都较大，因此平均幅值超过 τ_pos = 0.0002 的 Gaussian 会被加密（P042）。欠重建区域需要新增几何，做法是 clone：复制一个同样大小的副本并沿位置梯度方向移动（P042, P056）。过重建区域中覆盖面积过大的 Gaussian 则被 split 成两个，其 scale 除以实验确定的因子 φ = 1.6，新位置以原 3D Gaussian 作为 PDF 采样得到（P042, P056）。为抑制相机附近 floaters 造成的密度不合理增长，每 N = 3000 次迭代把 α 设为接近零，让优化只在需要处重新抬高 α，同时由 α < ε_α 的剔除机制清理多余 Gaussian（P042）。此外还会周期性移除在世界空间中过大、以及在 view space 中 footprint 过大的 Gaussian（P057）。所有 Gaussian 始终是欧氏空间中的 primitive，不需要针对远处或大型 Gaussian 做空间压缩、warping 或投影（P057）。

渲染器的前向。tile-based rasterizer 把屏幕划分为 16×16 的 tile，再把 3D Gaussians 对 view frustum 和每个 tile 做 culling：只保留 99% 置信区间与 frustum 相交的 Gaussian，并用 guard band 直接剔除位置极端（均值靠近近平面且远在 frustum 之外）的 Gaussian，因为这类点投影后的 2D 协方差计算不稳定（P058）。随后按 Gaussian 覆盖的 tile 数生成实例，每个实例带一个由 view space depth 与 tile ID 组合的 key，所有 Gaussian 用一次 GPU Radix sort 排序（P058）。该流程不做额外的逐像素排序，blending 依据这一次初始排序完成，因此 α-blending 在某些配置下是近似的；当 splat 接近单像素大小时近似可忽略，且这种取舍显著提升了训练与渲染性能（P058）。排序后为每个 tile 找出落在其上、按深度排序的首尾条目形成 tile 列表；栅格化时每个 tile 启动一个 thread block，协作把成包的 Gaussian 载入 shared memory，再对每个像素从前到后累加颜色与 α（P058）。当某像素的 α 达到饱和时对应线程停止，整个 tile 在所有像素都饱和后终止——α 饱和是唯一停止条件，方法不限制能够接收梯度更新的混合 primitive 数量，从而适应深度复杂度差异很大的场景而无需逐场景调参（P058, P002）。

渲染器的反向。反向传播复用前向的已排序 Gaussian 数组与 tile 范围，改为从后到前遍历 per-tile 列表，以避免在 global memory 中保存任意长的逐像素混合点列表所带来的动态内存管理开销（P058）。遍历从影响该 tile 中任一像素的最后一个点开始，点仍以协作方式载入 shared memory；每个像素只在点的深度小于等于其在前向中最后贡献颜色的点的深度时，才进行开销较大的 overlap testing 与处理（P058）。梯度计算需要混合过程中每一步的累计不透明度，实现上只在前向结束时保存每个点的最终累计 α，反向时用它除以该点自身的 α 来恢复所需系数（P058）。

训练阶段与推理阶段的区别。训练阶段用同一套 tile-based renderer 做前向渲染并回传梯度，从而把训练时间压到与最快的 radiance field 方法相当；一旦训练完成，同一渲染器可以支持对多种场景的实时导航（P032）。训练后的表示规模在测试场景中为 1–5 million 个 Gaussian（P006）。

评测所用数据与参照。实验在若干已发表数据集上进行（Barron et al. 2022; Hedman et al. 2018; Knapitsch et al. 2017）（P002）；其中 Mip-NeRF360 被作为 SOTA NeRF 质量参照，其训练时间可达 48 小时，而快速的 radiance field 方法只能做到随场景约 10–15 fps 的交互级渲染，达不到高分辨率实时（P006）。NeRF-synthetic dataset 也被用于说明初始化下的鲁棒性（P006）。

材料中未提供的关键细节包括：Sec. 7.1 所述的 learning schedule 及其余训练设置（P040, P033）、appendix A 中显式梯度求导的具体过程（P019）、Appendix C 中排序与栅格化流程的细节（P058）、以及对透明 Gaussian 做剔除所用的阈值 ε_α 的数值（P042）。这些数据集的具体采集方式、标注、质检流程与评测协议，也不在所提供的材料中（P002）。

### D

输入 6453 tokens；输出 13438 tokens（含 reasoning）；耗时 54.94s。

任务可表述为：给定静态场景的一组图像及由 SfM [Schönberger and Frahm 2016] 标定的相机，方法输出一组显式 3D Gaussians 参数，并在训练后从新视角渲染图像。P009 P006
输入中的 SfM 过程会附带产生稀疏点云，方法用这些点初始化 3D Gaussians；输出表示由位置（mean）、协方差矩阵、不透明度 α 与 spherical harmonics (SH) 颜色系数构成，最终用于 novel-view synthesis。P009 P006

初始化与各向异性协方差参数化
方法从 SfM 稀疏点云创建 3D Gaussians，每个 Gaussian 的几何由世界坐标中的完整 3D 协方差矩阵 Σ 和中心 μ 定义，且不依赖法线，以避免从极稀疏点估计噪声法线。P013 P012
但直接优化 Σ 很难保持半正定，因此把 Σ 重写为 Σ=RSS^T R^T，其中 S 为 scaling matrix、R 为 rotation matrix，并分别存储 3D 向量 s 和 quaternion q，训练时归一化 q；初始协方差取各向同性 Gaussian，轴长等于到最近三个点的平均距离。P017 P019 P040
位置、α、协方差和 SH 系数一起优化，颜色由 SH 表示视角相关 appearance。P022 P006

可微投影与颜色合成
渲染时先把 3D Gaussian 投影到 2D：给定 viewing transformation W，相机坐标中的协方差为 Σ'=J W Σ W^T J^T，J 是 projective transformation 仿射近似的 Jacobian；去掉 Σ' 的第三行和第三列后得到 2×2 variance matrix，使其像 planar point 一样参与后续 α-blending。P015 P017
这里采用的 primitive 是 3D Gaussians，它们既可微又可投影成 2D splats，使图像形成既保留 volumetric representation 的可微性，又能用标准 α-blending 高效合成像素。P012 P006
每个投影后的 Gaussian 在 blending 中乘以 α，颜色来自 SH 系数。P013 P022

图像监督与优化
优化按迭代进行：每次渲染当前 3D Gaussians 并与 captured dataset 的训练视图比较，用 L1 与 D-SSIM 组合损失 L=(1−λ)L1+λLD-SSIM，其中 λ=0.2，并以 Stochastic Gradient Descent 在 GPU 框架中更新参数。P040 P043 P033
由于 3D 到 2D 投影存在歧义，优化必须能创建、销毁或移动几何。P040
α 经 sigmoid 激活限制在 [0−1) 以得到平滑梯度，covariance 的 scale 经 exponential 激活，位置使用指数衰减调度；对所有参数的梯度被显式推导，以减少自动微分开销。P040 P019
该循环同时依赖快速 rasterization，因为它是优化主要计算瓶颈。P040

自适应密度控制：clone、split 与移除
在 optimization warm-up 后，每 100 iterations 执行 densify，并移除 α 小于阈值 εα 的透明 Gaussians。P042
增密关注两类区域：欠重建（underreconstruction）的小 Gaussian 与过重建（over-reconstruction）的大 Gaussian，二者都有较大的 view-space positional gradients；平均幅度超过 τpos=0.0002 时触发处理。P042 P056
对欠重建的小 Gaussian 采用 clone：创建同尺寸副本并沿 positional gradient 方向移动，以覆盖新几何；对过重建的大 Gaussian 采用 split：用两个新 Gaussian 替换，scale 除以 φ=1.6，并以原 3D Gaussian 作为 PDF 采样初始化位置。P042 P056
为抑制靠近输入相机的 floaters 造成密度不合理增长，每 N=3000 iterations 把 α 设到接近零，再让优化恢复需要的 α；同时周期性移除 worldspace 很大或在 viewspace footprint 很大的 Gaussians，以控制总数。P042 P057

Tile-based 深度排序渲染
实时渲染器把屏幕划分成 16×16 tiles，先对 3D Gaussians 做 view frustum 与 tile 级 culling，只保留 99% confidence interval 与 view frustum 相交的 Gaussian，并用 guard band 拒绝均值靠近近平面且远在 frustum 外的极端位置。P058
每个 Gaussian 按其覆盖的 tile 数实例化，实例 key 由 view space depth 与 tile ID 组合；所有实例用一次快速 GPU Radix sort 排序，从而按深度顺序组织 splats，而不做逐像素排序。P058
这种全局排序使 α-blending 在 splats 远大于像素时可以是近似，但当 splats 接近像素大小时近似误差可忽略。P058

前向光栅化与反向传播
排序后为每个 tile 生成列表，记录覆盖该 tile 的第一个和最后一个深度排序条目；每个 tile 启动一个 thread block，先将 Gaussians 分批加载到 shared memory，再对每个像素 front-to-back 遍历列表累加 color 与 α。P058
当像素达到 α 饱和时对应线程停止，整个 tile 在所有像素饱和（α 趋于 1）后终止；rasterization 不限制接收梯度的 blended primitives 数量，因此能处理任意变化的 depth complexity。P058
反向传播复用前向的排序数组与 tile ranges，按 back-to-front 重新遍历 per-tile lists；遍历从影响该 tile 任一像素的最后一个点开始，像素只在其深度小于等于前向中最后贡献颜色的点深度时才处理。P059
梯度计算需要每步 accumulated opacity，但只存储前向结束时总 accumulated α，然后在 back-to-front 中除以每个点自身的 α 来恢复系数，从而避免动态内存管理；该 rasterizer 完全可微。P059 P058

推理输出
训练完成后，同一套 tile-based renderer 直接用于新相机位姿，经投影、深度排序、α-blending 输出 novel-view 图像，并允许对捕获场景进行实时导航。P032 P006

## Transformer

### A

输入 1981 tokens；输出 1748 tokens（含 reasoning）；耗时 7.48s。

本文方法为 Transformer，是首个完全基于 attention 的 sequence transduction 模型，将 encoder-decoder 架构中常用的 recurrent layers 替换为 multi-headed self-attention（E003）。输入沿用 encoder-decoder 结构，encoder 把输入 symbol representations 的序列映射为表示（E006）；由于模型既无 recurrence 也无 convolution，需在 encoder 与 decoder 堆栈底部的 input embeddings 上加入 positional encodings，以注入 token 的相对或绝对位置信息（E007）。

关键处理步骤：1）embeddings 与 positional encodings 相加；2）encoder 各层以 multi-headed self-attention 取代 recurrent layers（E003）；3）encoder 与 decoder 的每层除 attention sub-layers 外，还含 fully connected feed-forward network，该网络对每个位置独立且以相同方式施加，由两次 linear transformation 与中间的 ReLU 组成（E004）；4）dropout 施于每个 sub-layer 的输出，且发生在该输出与 sub-layer 输入相加并归一化之前，同时也施于 encoder 和 decoder 堆栈中 embeddings 与 positional encodings 之和（E005）。Multi-Head Attention 的作用在于抵消 attention-weighted positions 平均所带来的有效分辨率下降（E002）。

### B

输入 2039 tokens；输出 1881 tokens（含 reasoning）；耗时 8.92s。

本文处理的任务是 sequence transduction，实验中具体化为机器翻译：模型接收输入序列的 symbol representations，由 encoder 将其映射为表示，再由 decoder 生成输出序列（E006）。作者提出的 Transformer 是第一个完全基于 attention 的 sequence transduction model，它把 encoder-decoder 架构中最常用的 recurrent layers 替换为 multi-headed self-attention（E003）。

整体上模型仍沿用 encoder-decoder 结构（E006）。由于 Transformer 既不含 recurrence 也不含 convolution，计算过程本身不携带顺序信息，因此作者在 encoder 与 decoder 两个 stack 的底部把 positional encodings 加到 input embeddings 上，以注入 token 的相对或绝对位置信息；positional encodings 与 embeddings 维度相同，因而可以直接相加（E007）。

encoder 与 decoder 的每一层由 attention sub-layers 与一个 fully connected feed-forward network 组成。该 feed-forward network 对每个位置单独且相同地作用，内部是两次 linear transformations，中间夹一个 ReLU activation（E004）。也就是说位置之间不通过它交换信息，跨位置的信息传递完全由 attention sub-layer 承担。

在残差与归一化上，每个 sub-layer 的输出先施加 dropout，然后加回该 sub-layer 的输入再做 normalization；此外 encoder 与 decoder 两个 stack 中 embeddings 与 positional encodings 之和也施加 dropout（E005）。材料中 base model 的 dropout rate 数值被截断，具体取值无法确认（E005）。

采用 attention 路线的动机在于降低 sequential computation：以 convolutional neural networks 为基本构建块的 ConvS2S 与 ByteNet 虽可对全部位置并行计算 hidden representations，但关联任意两个位置所需操作数随距离增长，分别为线性与对数，远距离依赖因此更难学习；Transformer 把这一代价降为常数级操作，代价是 attention-weighted positions 平均导致 effective resolution 下降，作者以 Multi-Head Attention 抵消（E002）。

训练阶段，作者报告在 translation tasks 上 Transformer 的训练速度明显快于基于 recurrent 或 convolutional layers 的架构（E003）。推理阶段的具体做法，以及 multi-head attention 的计算公式、head 数量、层数与隐藏维度等关键配置，所给材料均未提供，此处无法复述，这是本方法说明中缺失的核心定义部分。

效果方面，模型在 WMT 2014 English-to-German 上取得 28.4 BLEU，比包括 ensembles 在内的既有最佳结果高出 2 BLEU 以上；在 WMT 2014 English-to-French 上以八块 GPU 训练 3.5 天，取得 41.8 的单模型 state-of-the-art BLEU（E001）。

### C

输入 6157 tokens；输出 6893 tokens（含 reasoning）；耗时 27.99s。

本文处理的是 sequence transduction 问题，落点是机器翻译：encoder 接收长度为 n 的输入符号表示序列 (x1, ..., xn)，把它映射为一串连续表示 z = (z1, ..., zn)；decoder 以 z 为条件生成输出符号序列 (y1, ..., ym)，并且是逐元素生成，每一步都按 auto-regressive 方式把此前已生成的符号当作额外输入来产生下一个符号 (P008)。作者提出的 Transformer 放弃 recurrence，完全依赖 attention 机制在输入与输出之间建立全局依赖，因此可以获得大得多的并行度，并在很短训练时间下取得当时最好的翻译质量 (P002)。

整体结构沿用 encoder-decoder，encoder 与 decoder 都由堆叠的 self-attention 与 point-wise 全连接层组成 (P009)。encoder 是 N = 6 个相同层的堆叠，每层含两个 sub-layer：第一个是 multi-head self-attention，第二个是 position-wise fully connected feed-forward network；每个 sub-layer 外面包一个 residual connection 再跟 layer normalization，即该 sub-layer 的输出为 LayerNorm(x + Sublayer(x))，其中 x 是 sub-layer 的输入、Sublayer(x) 是它自身实现的函数 (P011)。为了能这样相加，模型中所有 sub-layer 以及 embedding 层的输出维度统一取 dmodel = 512，这也是贯穿全模型的维度 (P011)。

decoder 同样是 N = 6 层堆叠，但在 encoder 的两个 sub-layer 之外插入第三个 sub-layer，对 encoder stack 的输出做 multi-head attention；同时 decoder 的 self-attention sub-layer 被做上 masking，再配合输出 embedding 相对输入偏移一位，保证位置 i 的预测只能依赖位置小于 i 的已知输出 (P011)。attention 在模型中有三种用法：encoder-decoder attention 里 query 来自上一层 decoder，key 与 value 来自 encoder 输出，使 decoder 的每个位置都能关注输入序列的所有位置；encoder 内的 self-attention 里 query、key、value 全部来自上一层 encoder 的输出，每个位置可关注上一层所有位置；decoder 内的 self-attention 让每个位置只能关注到当前及之前的位置，这是通过在 scaled dot-product attention 内把 softmax 输入中对应非法连接的数值置为 −∞ 实现的 (P029)。

attention 函数本身可描述为一个映射：给定一个 query 和一组 key-value 对（都是向量），输出是 value 的加权和，每个 value 的权重由 query 与对应 key 的兼容性函数算出 (P013, P016)。本文用的是 Scaled Dot-Product Attention：输入是维度 dk 的 query 与 key、维度 dv 的 value，先算 query 与所有 key 的点积，把每个点积除以 sqrt(dk)，再经 softmax 得到 value 上的权重；实现上把一组 query 打包成矩阵 Q、key 与 value 打包成 K 和 V，一次算出 Attention(Q, K, V ) = softmax(QK^T / sqrt(dk))V (P018)。缩放这一步是必要的，因为 dk 较大时点积数值会变大，把 softmax 推到梯度极小的区域；若 q 与 k 的各分量是均值 0、方差 1 的独立随机变量，其点积的方差恰为 dk，这正是要除以 sqrt(dk) 的原因 (P020, P024)。

单个 attention 会对被加权的位置取平均，削弱有效分辨率，因此用 Multi-Head Attention 来对抗：把 query、key、value 分别用 h 组不同的可学习线性投影投到 dk、dk、dv 维，在每一组投影上并行执行 attention，得到 dv 维输出，把这些输出拼接后再投影一次得到最终结果，即 MultiHead(Q, K, V ) = Concat(head1, ..., headh)W^O，其中 headi = Attention(Q Wi^Q, K Wi^K, V Wi^V ) (P023, P026)。本文取 h = 8 个并行 head，每个 head 的 dk = dv = dmodel/h = 64，投影矩阵 Wi^Q ∈ R^{dmodel×dk}、Wi^K ∈ R^{dmodel×dk}、Wi^V ∈ R^{dmodel×dv}、W^O ∈ R^{hdv×dmodel}；由于每个 head 的维度被压低，总计算量与全维度的单 head attention 相当 (P027)。

每个 encoder 与 decoder 层还含一个 position-wise feed-forward network，对每个位置分别且同样地作用，由两个线性变换中间夹一个 ReLU 组成：FFN(x) = max(0, xW1 + b1)W2 + b2 (P031)。它的输入输出维度是 dmodel = 512，内层维度是 dff = 2048，不同层使用各自不同的参数，也可以理解为两次 kernel size 为 1 的卷积 (P033)。

输入的 token 与输出的 token 都先经可学习 embedding 变成 dmodel 维向量，decoder 输出再经一个可学习的线性变换加 softmax，得到下一个 token 的概率；两个 embedding 层与 pre-softmax 线性变换共享同一个权重矩阵，而 embedding 层中的这些权重还要乘以 sqrt(dmodel) (P035)。由于模型既无 recurrence 也无 convolution，序列顺序信息靠加在 encoder 与 decoder 底部输入 embedding 上的 positional encoding 注入，两者维度同为 dmodel 所以可以直接相加；本文用不同频率的正弦与余弦函数，PE(pos, 2i) = sin(pos/10000^{2i/dmodel})、PE(pos, 2i+1) = cos(pos/10000^{2i/dmodel})，其中 pos 是位置、i 是维度，各维波长构成从 2π 到 10000·2π 的等比数列，这样对任意固定偏移 k，PEpos+k 都能写成 PEpos 的线性函数，便于模型学出按相对位置去关注的行为 (P044)。

作者用三项标准把 self-attention 与 recurrent、convolutional 层做对照：每层总计算复杂度、可并行程度（用最少顺序操作数衡量）、以及网络中任意输入输出位置之间的最大路径长度，路径越短越容易学到长程依赖 (P046, P047)。self-attention 用常数个顺序执行的操作连接所有位置，而 recurrent 层需要 O(n) 个顺序操作；当序列长度 n 小于表示维度 d 时 self-attention 快于 recurrent 层，而在当时最好的翻译模型所用的 word-piece、byte-pair 表示下这一条件通常成立 (P047, P048)。按 Table 1 的统计，self-attention 每层复杂度为 O(n²·d)，recurrent 为 O(n·d²)，convolutional 为 O(k·n·d²)，restricted self-attention 为 O(r·n·d) (P040)。顺序操作数上 self-attention、convolutional 与 restricted self-attention 均为 O(1)，recurrent 为 O(n) (P041)。最大路径长度上 self-attention、recurrent、convolutional、restricted self-attention 分别为 O(1)、O(n)、O(logk(n))、O(n/r)，其中 n 是序列长度、d 是表示维度、k 是卷积核大小、r 是受限 self-attention 的邻域大小 (P036, P042)。更早的卷积式模型里，把任意两个位置联系起来所需操作数随距离增长，ConvS2S 是线性、ByteNet 是对数，Transformer 把它降到常数，代价是 attention 加权平均带来的有效分辨率下降，这一副作用由 Multi-Head Attention 抵消 (P005)。作者也指出，若要处理很长的序列，可以把 self-attention 限制在以输出位置为中心、大小为 r 的邻域内，此时最大路径长度变为 O(n/r)；作为附带好处，检查模型的 attention 分布还显示不同 head 确实学到不同任务，且许多 head 的行为与句子的句法和语义结构相关 (P048)。

训练数据与批处理：English-German 用标准 WMT 2014 English-German 数据集，约 450 万句对，用 byte-pair encoding 编码，源与目标共享约 37000 个 token 的词表；English-French 用大得多的 WMT 2014 English-French，共 36M 句，切成 32000 的 word-piece 词表；句对按近似长度组 batch，每个 batch 约含 25000 个源 token 和 25000 个目标 token (P053)。硬件与训练计划：单机 8 块 NVIDIA P100，base 模型每个训练 step 约 0.4 秒，共训练 100,000 步、约 12 小时；big 模型 step 时间 1.0 秒，训练 300,000 步、约 3.5 天 (P055)。优化器用 Adam，β1 = 0.9、β2 = 0.98、ϵ = 10⁻⁹，学习率按 lrate = dmodel^{-0.5} · min(step_num^{-0.5}, step_num · warmup_steps^{-1.5}) 变化，即前 warmup_steps 步线性升高、之后按步数平方根的倒数下降，warmup_steps = 4000 (P057, P059)。

训练中采用三类正则化 (P061)，材料中详述了其中两类：residual dropout 施加在每个 sub-layer 的输出上（在加回 sub-layer 输入并做归一化之前），也施加在 encoder 与 decoder 中 embedding 与 positional encoding 之和上，base 模型取 Pdrop = 0.1；label smoothing 取 ϵls = 0.1，它会让 perplexity 变差，因为模型学会更不确定，但能提升准确率与 BLEU (P068)。评测在 English-to-German 与 English-to-French 的 newstest2014 测试集上进行，指标是 BLEU，同时报告训练成本 FLOPs (P062, P063)。材料列出的结果包含 Transformer (base model) 与 Transformer (big) 两行，以及 ByteNet、Deep-Att + PosUnk、GNMT + RL、ConvS2S、MoE 等对照模型在 EN-DE、EN-FR 上的 BLEU 与 FLOPs 数值 (P062, P064, P067)。作者还把可学习 positional embedding 与正弦版本做了对照，发现两者结果几乎一致（见 Table 3 行 (E)），最终选正弦版本，因为它可能外推到训练时未遇到的更长序列 (P044)。

有几处本文材料没有覆盖，需要按缺口标注而非补造：一是使用/推理阶段的具体解码流程（例如每步如何选取下一个符号、是否使用某种搜索策略）没有给出，材料只说明了 decoder 的 auto-regressive 性质以及 masking 加偏移一位保证位置 i 只依赖更早输出这一约束 (P008, P011)；二是超参数只完整给出 base 模型一侧（N = 6、dmodel = 512、dff = 2048、h = 8），Table 3 底部那行 big 模型的具体配置未在材料中出现 (P011, P027, P055)；三是 P061 声称的三类正则化中，除 residual dropout 与 label smoothing 之外的第三类内容未在材料中展开 (P061, P068)。

### D

输入 6279 tokens；输出 11936 tokens（含 reasoning）；耗时 49.36s。

**方法详解：从输入到 encoder/decoder 的流程**

**任务与总览**：模型把输入符号表示序列 (x1,...,xn) 映射为连续表示 z=(z1,...,zn)，decoder 再以 z 为条件，一次一个元素地生成输出符号序列 (y1,...,ym)；每一步模型是 auto-regressive，会把此前生成的符号作为额外输入（P008）。整体 encoder 与 decoder 都用堆叠的 self-attention 和 point-wise fully connected layers 构成（P009）。

**输入、位置表示到 encoder**：输入 token 与输出 token 先经 learned embeddings 变成 dmodel 维向量；decoder 输出用 learned linear transformation 与 softmax 得到下一 token 概率（P035）。两个 embedding 层与 pre-softmax 线性变换共享同一权重矩阵，embedding 权重再乘以 sqrt(dmodel)（P035）。由于模型没有 recurrence 和 convolution，为利用序列顺序，在 encoder 与 decoder 堆叠底部把 positional encodings 加到 input embeddings 上；两者同维可直接相加（P044）。文中用不同频率的 sine 与 cosine 函数，使 PE_pos+k 可表示为 PE_pos 的线性函数，便于模型学习按相对位置 attention，并可能外推到更长序列（P044）。

**Encoder stack**：encoder 由 N=6 个相同 layer 堆叠；每层有两个 sub-layer，第一是多头 self-attention，第二是 position-wise fully connected feed-forward network（P011）。每个 sub-layer 外包 residual connection，再接 layer normalization，即输出为 LayerNorm(x + Sublayer(x))；为使 residual 可加，所有 sub-layer 与 embedding 输出维度均为 dmodel=512（P011）。self-attention 中 keys、values、queries 都来自上一层 encoder 输出，每个 encoder 位置可 attend 上一层所有位置（P029）。这样 self-attention layer 用常数个顺序操作连接所有位置，而不是 recurrent layer 的 O(n) 顺序操作（P047）。

**Scaled Dot-Product Attention**：attention 函数把 query 与一组 key-value pairs 映射到输出；输出是 values 的加权和，权重由 query 与对应 key 的兼容性函数算出（P013）。Scaled Dot-Product Attention 的 query 与 key 维度为 dk，value 维度为 dv；对 query 与所有 key 做点积，除以 sqrt(dk)，经 softmax 得到 weights，再对 values 加权（P018）。批量计算时把 queries、keys、values 分别打包成 Q、K、V 矩阵，输出为 Attention(Q,K,V)=softmax(QK^T/sqrt(dk))V（P018）。除以 sqrt(dk) 是因为 dk 大时点积会变大，把 softmax 推入梯度极小区域；缩放可抵消这一效应（P020）。点积的方差随 dk 增长，这解释了为何需要缩放（P024）。

**Multi-Head Attention**：不直接用 dmodel 维键值查询做单一 attention，而是把 Q、K、V 分别用 h 组不同的 learned linear projections 投影到 dk、dk、dv 维；在每组投影上并行执行 attention，得到 dv 维输出；这些输出拼接后再投影一次 W^O 得到最终值（P023）。公式为 MultiHead(Q,K,V)=Concat(head1,...,headh)W^O，其中 headi=Attention(QWi^Q, KWi^K, VWi^V)（P026）。这使模型能在不同 representation subspaces、不同位置联合关注信息；单头 averaging 会抑制这种能力（P026）。文中 h=8，dk=dv=dmodel/h=64，总计算量与全维单头 attention 相近（P027）。

**Decoder、encoder-decoder attention 与 masking**：decoder 同样由 N=6 个相同 layer 堆叠；除 encoder 的两个 sub-layer 外，再插入第三 sub-layer，对 encoder stack 输出做 multi-head attention，即 encoder-decoder attention（P011）。其 queries 来自前一个 decoder layer，memory keys 与 values 来自 encoder 输出，使每个 decoder 位置都能 attend 输入序列所有位置（P029）。decoder 的 self-attention 被修改为不能 attend 后续位置；为保持 auto-regressive 性质、阻止向左信息流，在 scaled dot-product attention 内把 softmax 输入中非法连接置为 −∞（P029）。该 masking 与 output embeddings 偏移一位结合，保证位置 i 的预测只依赖位置小于 i 的已知输出（P011）。

**FFN、residual 与 normalization**：每个 encoder/decoder layer 还含一个 position-wise FFN，对每个位置单独且相同地应用；它由两个线性变换与中间的 ReLU 组成：FFN(x)=max(0,xW1+b1)W2+b2（P031）。线性变换跨位置相同，但层与层参数不同；也可看作 kernel size 1 的两层 convolution（P031）。输入输出维度 dmodel=512，inner-layer 维度 df f=2048（P033）。residual connection 绕每个 sub-layer 后接 layer normalization，使各 sub-layer 的输出以 LayerNorm(x + Sublayer(x)) 形式连接，便于信息与梯度穿过深层（P011）。训练时对每个 sub-layer 输出在加到 sub-layer 输入并归一化前施加 dropout，也对 embedding 与 positional encoding 之和施加 dropout；base 模型 Pdrop=0.1（P068）。

**训练目标、并行训练与自回归推理**：decoder 输出经 learned linear transformation 与 softmax 得到下一 token 概率，训练在这些下一 token 概率上进行（P035）。文中还使用 εls=0.1 的 label smoothing，使模型学得更不确定但改善 accuracy 与 BLEU（P068）。训练时目标输出整体偏移一位作为 decoder 输入，配合前述 masking，位置 i 只看已知的较早输出（P011）；该架构因此允许显著更多并行化（P002）。推理时模型按 auto-regressive 方式逐步工作：每一步消费已生成符号作为额外输入，生成下一个符号，再把它反馈给下一步（P008）。优化使用 Adam，β1=0.9、β2=0.98、ε=10−9，学习率先线性 warmup 4000 步，之后按步数 inverse square root 衰减（P057, P059）。

## Chinchilla

### A

输入 2132 tokens；输出 1089 tokens（含 reasoning）；耗时 6.1s。

方法的输入是一个事先给定的固定计算预算：作者关注在固定 FLOPs 预算下，model size 与 training tokens 数量应如何权衡 (E002)，而在实践中可用的 accelerator 数量与使用时长通常事先已知 (E005)。作者为此提出三种不同途径来回答该问题 (E002)。Approach 1 固定一族模型规模，范围从 70M 到超过 10B 参数，对每个模型用 4 种不同的 training sequences 数量（即不同训练步数）进行训练，再从这些运行中直接提取给定 training FLOPs 下达到的 minimum loss (E003)，该步得到的 loss 估计是后续拟合的前提。Approach 2 与 Approach 3 使用不同的 fitting methodologies 和不同的 trained models (E004)。三条路径的输出汇合为对 parameter 与 tokens 最优 scaling 的预测：三者一致表明，随着 compute budget 增加，model size 与训练数据量应大致按相等比例增加；其中前两种途径对最优 model size 的预测非常接近，第三种在更大 compute budget 下预测出的最优模型更小 (E004)。

### B

输入 2189 tokens；输出 3467 tokens（含 reasoning）；耗时 16.84s。

本文的任务是：在给定固定 FLOPs 预算的前提下，回答应如何在 model size 与 training tokens 数量之间做权衡，其输出形式是关于最优参数规模与训练 token 数如何随 FLOPs 变化的预测 (E002)。这一设定的现实约束来自既有大模型的处境：训练大语言模型的算力与能耗成本很高，且随模型规模上升，而实践中可用的训练算力预算往往事先已知（有多少 accelerators、打算使用多久）；由于这类模型通常只训练一次，为给定算力预算准确估计最佳 model hyperparameters 就十分关键 (E005)。作者同时指出，大规模模型的能耗成本会通过 inference 与 fine-tuning 的使用被摊薄，因此一个被更优训练出来的较小模型，其收益不止于性能改善本身，还显著降低 inference 成本、便于在较小硬件上开展下游使用 (E006)。

对既有做法的观察是：当前最大的 dense transformer 规模已超过 5000 亿参数，且除 LaMDA 外多数模型大约只训练了 3000 亿 token (E007)；同时这类模型面临算力需求庞大、需要获取更多高质量训练数据的挑战，作者发现更大、更高质量的数据集将对语言模型的进一步 scaling 起关键作用 (E001)。

方法由三条估计路径构成。第一条路径固定一组模型家族，参数规模从 70M 到超过 10B，对每个模型用 4 个不同的 training sequence 数量（即不同的 training steps）训练，再从这些 runs 中直接提取在给定 training FLOPs 下所达到的 minimum loss 估计；该路径的训练细节列于 Appendix D (E003)。也就是说，其输入是模型规模与训练步数/序列数的组合，中间产物是各算力预算下的最小损失，输出则是据此读出的最优 model size 与 training tokens 配置。此处材料以 training sequences 与 training steps 描述训练量，如何换算为 training tokens 数量并未给出。

第二、第三条路径采用另外的 fitting methodologies，并训练了与第一条路径不同的模型 (E004)。不过这两条路径的具体拟合流程——所拟合的函数形式、拟合目标，以及如何由拟合结果反解最优参数与 token 配比——在可见材料中没有出现，是需要核对原文的缺失。同样，决定机制的训练配置（数据集构成、优化器与 learning rate schedule、序列长度等）仅以 Appendix D 的形式被引用，其内容未出现在可见材料中 (E003)。

在验证层面，作者将三条路径相互对照：尽管拟合方法与所用模型不同，三条路径对参数与 token 随 FLOPs 的最优缩放给出了可比的预测（Table 2），共同指向随着 compute budget 增加，model size 与训练数据量应以大致相等的比例增长；第一与第二条路径对最优 model size 的预测非常接近（Figure 1、Figure A3），而第三条路径在更大算力预算下预测的最优模型更小 (E004)。整个估计过程属于训练与拟合阶段，得出的结论则服务于 inference 与下游 fine-tuning 阶段的成本与部署考量 (E006)。

### C

输入 9641 tokens；输出 11951 tokens（含 reasoning）；耗时 48.38s。

任务与目标：本文研究固定 FLOPs budget C 下 model size N 与 training tokens D 的取舍；它把 final pre-training loss L(N,D) 作为目标函数，在 FLOPs(N,D)=C 约束下求 N_opt(C), D_opt(C)=argmin L(N,D)。P013
模型是 autoregressive transformer，输入是不同 N 与 D 的训练配置，输出是 loss，最终输出是 compute-optimal frontier 及对更大 compute 的外推。P001 P013
分析使用 smoothed training loss 作为 test loss 的无偏估计，因为训练 token 数小于整个 corpus 的 token 数，处于 infinite data regime。P015 P016
实验输入是 over 400 models，参数从 under 70M 到 over 16B，token 从 5B 到 over 400B，每个配置训练若干不同 training horizons。P014
FLOPs 在 Appendix F 中计算，材料没有给出具体公式，所以只能保留 FLOPs(N,D) 是 N 与 D 的确定性函数这一约束。P028 P013

总览：三种 approach 都先训练覆盖不同 model size 与 training tokens 的模型，再用 training curves 拟合 scaling 经验估计量，假设 compute 与 model size 之间为 power-law。P027
三个方法均预测 parameter count 与 training tokens 应随 compute 近似等比例增加。P027

Approach 1：固定 model sizes（70M 到 over 10B），每个参数配置训练 4 个不同 training sequences/horizon；学习率在 horizon 上 decay 10×，horizon 的 token 跨度差 16×。P065
对每次 run 先 smooth 再 interpolate training loss curve，得到从 FLOP count 到 training loss 的连续映射；对每个 FLOP count 选出 loss 最低的 run，于是在 1500 个 logarithmically spaced FLOP 值上得到该 compute 下最优的 N 与所需 D。P065
此时所有被选点位于训练最后 15% 内，因此 cosine cycle length 应在约 D 个 token 上 decay 10×。P065
最后对 N_opt 与 D_opt 拟合 power law，得到 N_opt ∝ C^a、D_opt ∝ C^b，Approach 1 给出 a=0.50、b=0.50。P065

Approach 2：IsoFLOP profiles 固定 9 个 training FLOP counts（6×10^18 到 3×10^21），变化 model size 至多 16B；每个点的 cosine schedule length 设成与 token 数匹配，读取 final training loss。P065
对每条 IsoFLOP curve 把 final smoothed loss 对 parameter count 作抛物线拟合，用谷底位置直接估计该 FLOP budget 下最优 model size，再对 FLOPs 与 loss-optimal model size/token 数拟合 power law。P099
Approach 2 得到 a=0.49、b=0.51。P099

Approach 3：把 Approach 1 与 2 的所有 final losses 汇总，建模为参数 N 与 token 数 D 的参数函数：L_hat(N,D)=E + A/N^α + B/D^β。P099 P100 P101
其中 E 对应数据分布上 ideal generative process 的 loss，A/N^α 表示 N 参数的 Transformer 即使完美训练也达不到 ideal process，B/D^β 表示只因有限优化步数与数据采样而未收敛到收敛点。P102
拟合目标是最小化预测 log loss 与观测 log loss 之间的 Huber loss，使用 L-BFGS；为避免 local minima 从一组初始化的 grid 中取最佳拟合，δ=10^-3 以增强对 outliers 的稳健性。P102 P104
拟合后，在 FLOPs(N,D)≈6ND 约束下最小化 L_hat 得到 efficient frontier 的闭式形式：N_opt(C)=G(C/6)^a、D_opt(C)=G^{-1}(C/6)^b，其中 G=(αA/(βB))^{1/(α+β)}，a=β/(α+β)、b=α/(α+β)。P127 P131 P138 P141
Approach 3 得到 a=0.46、b=0.54；它预测在更大 compute 下最优模型更小，原因是 frontier C→N_opt 出现 negative curvature，且 Huber loss 对高 FLOPs 点权重更高、把低 compute 点当 outliers。P143

Table 2 汇总三种 approach 的 a、b，并用 bootstrapping 估计 10th/90th percentiles：每次采样 80% 数据、重复 100 次。P144 P147 P148
用这些外推，材料给出示例：175B 模型应在 4.41×10^24 FLOPs 和 over 4.2 trillion tokens 下训练；280B Gopher-like 模型对应约 10^25 FLOPs 与 6.8 trillion tokens；1 trillion 参数模型除非有 10^26 FLOPs（over 250× Gopher 的 compute）否则不太可能最优。P160

验证阶段：按估计 frontier，对 Gopher 的 compute budget 最优模型应小 4×、token 多 4×；为此训练 70B、1.4T tokens 的 Chinchilla。P014 P162
Chinchilla 与 Gopher 训练 FLOPs 相同，但 model size 与 training tokens 不同；Chinchilla 比 Gopher 小 4×，因此 memory footprint 与 inference cost 更低，也便于在较小硬件上做 downstream use；energy cost 会通过 inference 与 fine-tuning 摊销。P014 P162
Chinchilla 沿用 Gopher 的 architecture 与 training setup，差别包括：在 MassiveText 上使用略不同的 subset distribution；用 AdamW 替代 Adam；用不施加 NFKC normalisation 的 SentencePiece tokenizer，94.15% token 与 Gopher 相同；forward/backward 用 bfloat16，而在 distributed optimiser state 中存 float32 权重副本。P162
Table 4 给出具体 architecture：Gopher 280B 与 Chinchilla 70B 都是 80 layers；number heads 分别为 128 与 64，key/value size 都是 128，d_model 分别为 16,384 与 8,192，max LR 分别为 4×10^-5 与 1×10^-4，batch size 分别为 3M→6M 与 1.5M→3M；feed-forward size 始终为 4×d_model，两者都在训练中途把 batch size 加倍。P169 P170 P171 P172 P173 P174 P175 P176
所有模型在 TPUv3/TPUv4 上用 JAX 与 Haiku 训练。P162
使用/推理阶段：在 language modelling、reading comprehension、question answering、common sense、MMLU、BIG-bench 等任务上评测，例子包括 WikiText-103、The Pile: PG-19、arXiv、FreeLaw、RACE-m、RACE-h、LAMBADA、Natural Questions、TriviaQA、TruthfulQA、HellaSwag、Winogrande、PIQA、SIQA、BoolQ 等。P180 P182
评测任务 largely 与 Rae et al. (2021) 相同，以便直接比较。P183
材料未给出 MassiveText 的采集、标注与质检细节（仅说明与 Gopher 同数据、subset distribution 见 Table A1），未给出 Appendix F 的 FLOPs 具体公式、Appendix D.4 的 head-to-head 比较细节，也未给出每个评测任务的具体 metric 定义。P162 P028 P065 P183

### D

输入 9772 tokens；输出 10902 tokens（含 reasoning）；耗时 44.77s。

任务定义与输出。给定固定 FLOPs 预算 C，问题是在 model size（参数量 N）与 training tokens 数 D 之间分配计算。作者把 final pre-training loss 写成 L(N,D)，因为计算预算 C 是 FLOPs(N,D) 的确定函数，所以求 N_opt(C),D_opt(C)=argmin L(N,D) s.t. FLOPs(N,D)=C（P013）。分析针对 smoothed training loss，它在 infinite data regime 下是 test loss 的无偏估计；所谓 infinite data regime 指 training tokens 数少于整个 corpus 的 token 数（P015）（P016）。经验拟合基于 400 多个模型，参数从不到 70M 到超过 16B，训练 token 从 5B 到超过 400B，每个配置有多个 training horizon（P014）。

统一控制与网格。三条估计路径都先训练一组同时改变 model size 与 training tokens 的模型，再用 resulting training curves 拟合 empirical estimator；并假设 compute 与 model size 之间存在 power-law 关系（P027）。FLOPs 的具体计数按 Appendix F（P028）。Approach 1 使用 70M 到 10B 的模型家族，每个模型 4 个训练序列数/训练步数；Approach 2 把 model size 扩到 16B，并固定 9 个 training FLOPs 档位（6×10^18 到 3×10^21）（P065）。

Approach 1：训练曲线包络。输入是固定参数量 N 的模型家族，变化训练步数或训练序列数；对每个 N 训练 4 个模型，并在 horizon（以 training tokens 度量）上把 learning rate 衰减 10×，horizon 跨度 16×（P065）。对每条 run 先平滑再插值 training loss curve，得到从 FLOP count 到 training loss 的连续映射；对每个 FLOP count 选 loss 最低的 run，于是对任意 C 得到满足 FLOPs(N,D)=C 的最有效 N,D。在 1500 个对数间隔 FLOP 值上比较所有模型，最后拟合 N_opt ∝ C^a 与 D_opt ∝ C^b，得到 a=0.50,b=0.50（P065）。被选中的点都落在训练最后 15% 内，这反过来提示 cosine cycle 长度应设在约 D 个 token 上衰减 10×（P065）。

Approach 2：IsoFLOP profiles。与沿整条训练曲线取点的 Approach 1 不同，这里固定 9 个 training FLOPs 值，改变 model size，并只看每个点的 final training loss（P065）。对每个 FLOP budget，训练足够多不同 model size 以看到 loss 的明显最小值，然后对每条 IsoFLOP 曲线拟合 parabola 来直接估计 loss 最低处的 model size；cosine schedule 长度设为匹配目标 token 数（P099）。再用这些极小值拟合 power law，得到 N_opt ∝ C^a、D_opt ∝ C^b，其中 a=0.49,b=0.51（P099）。

Approach 3：参数化 loss 拟合。把 Approach 1 和 2 的所有 final loss 合并，建模为 N 与 D 的参数函数 L_hat(N,D)=E+A/N^α+B/D^β（P100）（P102）。三项分别表示数据分布上理想生成过程的 loss（对应自然文本熵）、完美训练的 transformer 在 N 个 parameter 下仍低于理想过程、以及因为只在数据集分布的一个样本上做有限步优化、未训练到收敛造成的差距（P102）。拟合时最小化 predicted log loss 与 observed log loss 之间的 Huber loss（δ=10^-3），用 L-BFGS，并从一组初始化的 grid 中选最佳拟合以处理 local minima（P102）（P104）。然后在此参数化 loss 上做约束优化：在 FLOPs(N,D)≈6ND 下最小化 L_hat，得到 efficient frontier，并解析地写成 N_opt(C)=G(C/6)^a、D_opt(C)=G^{-1}(C/6)^b，其中 G=(αA/βB)^{1/(α+β)}, a=β/(α+β), b=α/(α+β)（P127）（P138）（P141）。由此得到 a=0.46,b=0.54；低 FLOPs（C≤10^21）的点残差较大，Huber loss 使拟合更重高 FLOPs 点，加上 frontier C→N_opt 的负曲率，使该路径在更大预算下预测更小的 N_opt（P143）。

从预算求最优与三条路径的一致性。三条路径用不同拟合方法和不同训练模型，却给出可比的 N_opt(C),D_opt(C)：参数量与 token 数随 compute 近似等比例增长，Table 2 汇总这些指数（P143）（P144）。具体地，Approach 1 给出 0.50/0.50，Approach 2 给出 0.49/0.51，Approach 3 给出 0.46/0.54（P147）（P148）。因此给定一个 C，只需把 C 代入相应拟合的 power law 得到 N_opt 与 D_opt；Table 3 则反查给定 model size 落在 compute-optimal frontier 上所需的 FLOPs 与 tokens（P152）。该外推预测当前 large language models 相对其 compute budget 偏大：例如 175B parameter 模型对应约 4.41×10^24 FLOPs 和超过 4.2 trillion tokens，280B 的 Gopher-like 模型约需 10^25 FLOPs 和 6.8 trillion tokens；除非有 10^26 FLOPs（超过 Gopher 用量的 250×），1 trillion parameter 模型不太可能最优（P160）。

Chinchilla 大规模验证。基于上述 frontier，Gopher 的 compute budget 下最优 model size 估计在 40B 到 70B parameter 之间；作者取区间上端训练 70B 模型、1.4T tokens，称为 Chinchilla（P162）（P014）。验证设计是让 Chinchilla 与 Gopher 使用相同 FLOPs，但改变 N 与 D 的分配（P162）。Chinchilla 沿用 Gopher 的 model architecture 和 training setup，只改若干项：在 MassiveText 的稍不同子集分布上训练以容纳更多 tokens，用 AdamW 替代 Adam，使用不做 NFKC normalisation 的 SentencePiece tokenizer，并在 forward/backward 用 bfloat16 而 distributed optimiser state 保留 float32 权重副本；训练基础设施为 TPUv3/TPUv4、JAX 与 Haiku（P162）。Gopher 预算本身约为 5.76×10^23 FLOPs（P065）。

外推边界。作者明确指出跨多个数量级外推有显著不确定性，但分析仍表明当前许多 LLM 的 compute budget 下应使用更小模型并训练更多 tokens（P160）。拟合假设 compute 与 model size 的 power-law，未来工作可考虑 large model size 下的 curvature（P027）。在方法内部，低 FLOPs 点被 Huber loss 当作 outlier、Approach 3 的负曲率导致其预测更小 N_opt，这些都是 frontier 外推时的不确定来源（P143）。另外，IsoFLOP 分析在 C4 与 GitHub code 两个额外数据集上复现，均得到 model size 与 training tokens 近似等比例缩放的结论（P160）。

### split

输入 9495 tokens；输出 2666 tokens（含 reasoning）；耗时 11.11s。

核心贡献
1. 在固定 FLOPs budget 下估计 N_opt(C) 与 D_opt(C)，用三种方法：Approach 1 固定模型规模、变化训练 token 数；Approach 2 IsoFLOP profiles；Approach 3 参数化损失拟合并以 Huber loss 与 L-BFGS 求解（P065、P099、P102）。估计基于超过 400 个模型，参数不到 70M 至超过 16B，训练 5B 至超过 400B tokens（P014）。
2. 三种方法给出接近的指数：a、b 分别为 0.50/0.50、0.49/0.51、0.46/0.54（P147、P148）。作者据此主张模型规模与训练 token 数应随 compute 近似等比例增加（P027、P144）。
3. 交付 Chinchilla：70B 参数、1.4T tokens（P024、P025、P026），在与 Gopher 相同的 FLOPs 下模型小 4×、token 多 4×（P013、P162）；作者报告其优于 Gopher 及其他 large models（P013）。
4. 推断性预测：现有大模型相对其 compute budget 明显过大，如 175B 模型应训练超过 4.2T tokens（P160）。

相对创新
1. 比较维度是 Kaplan et al. (2020) 的 scaling 建议：后者认为 compute 增加 10× 时模型规模增 5.5×、token 仅增 1.8×（P001），对应指数 a=0.73、b=0.27（P149、P150、P151）；本文的等比例结论与之直接不同（P027、P144）。
2. 意义在于给出可检验的预算分配预测，并用同 FLOPs 的 Chinchilla 加以检验，同时指出更小模型可降低 inference 成本（P014、P162）。
3. 比较边界：作者自述跨多个数量级外推存在显著不确定性（P160）；评估沿用 Rae et al. (2021) 的任务集以便直接比较（P183）；在 C4 与 GitHub code 上复现 IsoFLOP 分析得到相似结论（P160）。文中未主张全领域首次。

### merged

输入 9521 tokens；输出 6904 tokens（含 reasoning）；耗时 28.91s。

核心贡献与相对创新：
1. 重新估计 compute-optimal 分配。作者主张固定 FLOPs budget 时 model size 与 training tokens 应近似等比例增加，而非 Kaplan et al. (2020) 所述主要扩大 model size；三种估计分别给出 𝑁𝑜𝑝𝑡∝𝐶^0.50/0.49/0.46、𝐷𝑜𝑝𝑡∝𝐶^0.50/0.51/0.54，并推断当前 LLMs 相对各自 compute budget 偏大、tokens 不足（P013；P144）。该判断来自经验拟合：基于 over 400 models（70M 至 16B parameters、5B 至 400B+ tokens），作者承认外推多个数量级存在不确定性（P014；P160）。
2. 以三种互补方法并跨数据集检验 scaling 结论。Approach 1 固定 model size 变 training tokens，Approach 2 使用 IsoFLOP profiles，Approach 3 拟合 parametric loss function（P027；P099）。三者在文中给出相近预测，并在 C4 与 GitHub code 上复现类似结论（P143；P160）。相对 Kaplan et al. (2020) 的 scaling 建议，这是文中明确对比的变化，但比较边界限于作者设定的模型规模与数据范围（P143）。
3. 训练 Chinchilla 进行验证。作者据 Gopher 的 compute budget 预测 optimal model 应小 4 倍、多训 4 倍 tokens，并训练 70B Chinchilla、使用 1.4T tokens（P014；P162）。文中报告其在同 FLOPs 下优于更大的 Gopher，且因小 4 倍而降低 inference cost 与 memory footprint（P014；P162）。这相对文中 GPT-3、Gopher、MT-NLG 等约 300B tokens 的配置改变了参数与数据权衡（P018；P021）。

## Video-MME

### A

输入 2328 tokens；输出 1180 tokens（含 reasoning）；耗时 5.63s。

Video-MME 的构建从原始视频采集开始：作者先建立 domain hierarchy，从 YouTube 获取原始视频，划分 6 个 key domains（原文列举 Knowledge、Film & Television、Sports Competition、Life Record 与 Multilingual），每个 domain 再细分为具体 tags，共得到 30 个 finely-grained video categories，并按类别采集不同 duration 的视频（含 short 等）(E005)。采集完成后进入标注：招募具备较强英语能力与 vision-language learning 研究经验的标注者，要求其完整观看视频，再为每个视频迭代创建 3 个问题，每题配 4 个候选选项，最终形成 2,700 组 QA pairs，对应 900 个视频 (E006, E008)。随后进行人工复核：由另一名标注者逐项检查语言表达是否清晰准确、问题是否可回答、候选选项是否逻辑一致以及指定正确答案是否恰当 (E007)。通过复核的 QA 还需经筛查，将 text-only 问题输入 Gemini 1.5 Pro，过滤仅凭文本问题即可作答的 QA pair，以保证视频内容成为关键线索 (E007)。输出即用于评测的 multiple-choice QA 集合，其样例要求模型整合 video frames 的视觉信息与 auditory/subtitle 内容 (E002)，以考察 long-term contextual understanding 与复杂 spatial、temporal reasoning (E004)。

### B

输入 2375 tokens；输出 1629 tokens（含 reasoning）；耗时 8.3s。

本文提出的是评测基准 Video-MME 的构建方法，而不是训练一个新的 MLLMs，因此不存在模型参数意义上的训练阶段；MLLMs 在这里是被评测对象，方法核心是构造视频与配套问答，并用其考察模型能力 (E008, E006)。

任务、输入与输出：每个样本给出一段视频，模型需基于视频内容回答四选一的 multiple-choice QA，评测目标是考察 MLLMs 的 compositional video understanding，尤其是 long-term contextual understanding 与复杂的 spatial、temporal reasoning (E004, E006)。问题被刻意设置为不能仅凭文本推断，视频内容必须作为作答的关键线索 (E007)。

数据构造流程如下。先从 YouTube 采集原始视频，为此建立 domain hierarchy，划分 6 个 key domains，包括 Knowledge、Film & Television、Sports Competition、Life Record 与 Multilingual；每个 domain 再细分为具体 tags，例如 Sports Competition 下的 football 与 basketball，共得到 30 个 fine-grained video categories，并在每个类别下采集不同 duration 的视频 (E005)。需要说明的是，该摘录在声明 6 个 domain 后只列出五个名称，第六个 domain 的名称在材料中缺失 (E005)。

随后是 QA 标注：采用 multiple-choice QA 形式，标注者需完整观看视频，再迭代创建 3 个相关问题，每题附四个候选选项，最终形成 2,700 个 QA pairs，对应 900 段视频 (E006, E008)。质检分两步：先由另一位标注者审查语言表达是否清晰精确、选项逻辑是否一致、指定正确答案是否合理；再用纯文本问题询问 Gemini 1.5 Pro，过滤掉仅凭问题文本即可回答的样本，从而保证问题确实依赖视频内容 (E007)。数据集在示例中要求模型整合视频画面与 auditory/subtitle 等不同来源的信息 (E002)，整体设计也以难度和多样性为目标 (E004)。

评测协议方面，材料只说明采用四选一形式以便直接而灵活地评估，未给出具体 prompt 模板、打分或指标定义，也未说明 MLLMs 推理时的帧采样与输入配置，这些属于材料中缺失的关键定义 (E006)。Gemini 1.5 Pro 在材料中仅用于问题过滤，并未说明它是被评测模型 (E007)。

### C

输入 9027 tokens；输出 5255 tokens（含 reasoning）；耗时 22.97s。

本文的核心贡献不是新的 MLLM 架构或训练算法，而是一个面向 MLLMs 视频分析能力的综合评测基准 Video-MME：其全部视频与标注均由人工收集与整理，用来考察模型的长时上下文理解以及复杂空间与时间推理这类组合式视频理解能力（P002）；它针对既有视频基准在视频类型多样性、时间动态覆盖不足和单一模态取向上所做的补足（P001）。

任务与输入输出。给定一段视频及其可选的字幕与音轨，被评模型要回答与该视频内容绑定的 multiple-choice 问题，输出选项（A/B/C/D）；计分方式是直接把模型输出与 ground-truth 答案比对得到 accuracy，不使用 ChatGPT 等外部模型参与判分（P132）（P178）。题干被刻意设计成必须依赖视频内容才能回答，这是评测有效性的前提（P051）。

数据构建按三步展开：video collection、question-answer annotation、quality review（P051）。在 video collection 阶段，先从 YouTube 建立领域层级，确定 Knowledge、Film & Television、Sports Competition、Artistic Performance、Life Record、Multilingual 六个视觉领域，再细分为 30 个 fine-grained categories（如 football、basketball、technology、esports、magic show、fashion 等），每个类别都收集 short（< 2 分钟）、medium（4–15 分钟）、long（30–60 分钟）三档时长的视频，并同时获取字幕（若提供）与音轨等 meta-information（P051）（P003）。最终得到 900 个视频，视频长度跨度从 11 秒到 1 小时，其中 744 个带字幕、900 个带音轨（P051）。

question-answer annotation 阶段招募英语能力强、具备 vision-language 研究经验的标注者：每人完整观看整段视频后迭代撰写 3 个问题，每题配 4 个候选选项，全库共 2,700 个 QA pairs，问题覆盖 perception、reasoning、information synthesis 等 12 种 task types（P051）。数据统计显示，短/中/长三档的 question、option、answer 平均词数基本一致，说明 QA 格式标准化；而字幕词数随视频变长显著上升，短字幕平均 198.6 词、长视频字幕可达约 6.5K 词，意味着长视频承载的信息量更大（P053）。选项 A/B/C/D 的答案分布接近均匀（25.1/27.2/25.3/22.4%），以避免评测偏置（P083）；视频时长与题型分布也做了统计，短时长以 action、object recognition 等 perception 任务为主，长时长以 reasoning 任务为主（P054）（P053）。

quality review 阶段有两道机制。第一道由另一名标注者复核每个 QA pair：语言表达是否清晰、问题是否可答且选项逻辑一致、指定正确项是否合理（P051）。第二道把纯文本题干（不给视频）交给 Gemini 1.5 Pro，过滤掉仅凭题干就能答对的样本——例如可由常识推出的“2022 年阿根廷 10 号的最大成就是什么”会被剔除，未通过的题目退回原标注者修改；在该 text-only 设定下 Gemini 1.5 Pro 的准确率低于 15%，说明问题确实依赖视频内容（P052）。

时间难度用 certificate length 度量：某条 QA pair 的 certificate 被定义为“足以让人类验证者确信标注正确”的最小子片段集合，certificate length 即这些子片段的时间长度之和（P084）。每类随机抽取 3 个视频统计后，short、medium、long 三档的中位 certificate length 分别为 26s、164.7s 和 890.7s，长视频子集需要消化的视频内容明显多于 EgoSchema（P084）。此外，与既有基准的横向对比表格逐项列出 #Videos、#Clips、Len.、#QA Pairs、Anno.、QA Tokens、Sub. Tokens、Multi-level、Open-domain、Sub.&Aud. 等维度，其中 Video-MME-S/M/L 分别指短、中、长部分，且比较只针对各数据集的 multiple-choice 子集（P049）。

评测协议。被评对象包括 4 个商业模型 GPT-4V、GPT-4o、Gemini 1.5 Flash、Gemini 1.5 Pro，开源视频 MLLMs 如 Video-LLaVA、VideoChat2-Mistral、ST-LLM、ShareGPT4Video、Chat-UniVi-V1.5、LLaVA-NeXT-Video、VITA-1.0、VITA-1.5、VILA-1.5，以及通过扩展到 multi-frame 输入参与评测的图像 MLLMs 如 Qwen-VL-Chat/Max、InternVL-Chat-V1.5（P130）（P004）。各模型遵循其官方配置，并尽量在评测中使用更多帧（P132）。主表按 short、medium、long 三档分别报告 “without subtitles” 与 “with subtitles” 两种设置，后者中字幕是按采样到的视频帧对应选取的（P127）。在模态消融上，又对 Gemini 1.5 Pro 比较 frames only、frames + subtitles、frames + audio 三种输入，并按六个大类分别统计（P177）。

结果层面：Gemini 1.5 Pro 是表现最好的商业模型，平均准确率 75%；开源模型中最好的是 VILA-1.5，总体 59%；图像模型扩展到多帧后准确率约 50%，接近视频专用模型 LLaVA-NeXT-Video，说明图像理解是视频理解的基础（P004）。加入字幕与音频分别把 Gemini 1.5 Pro 提升 6.2% 与 4.3%，对长视频增益更明显，且在需要大量领域知识的任务上尤其有用（P004）（P050）。模型性能整体随视频变长而下降，提示长视频序列处理能力可能是关键瓶颈，counting 类问题则是各类模型的共同短板（P050）（P131）。

材料中未给出的机制细节有两处：只说明“遵循官方配置并尽量使用更多帧”，没有给出具体采样帧数与 prompt 模板（P132）；也只说明 with subtitles 设置下字幕与采样帧对应，没有给出对齐的具体规则（P127）。

### D

输入 9152 tokens；输出 10395 tokens（含 reasoning）；耗时 43.37s。

**任务、输入与输出**
Video-MME 评估 MLLMs 的视频理解能力：输入是一段视频以及可选的 subtitles 与 audio tracks，输出是在 multiple-choice question 的四个候选选项中选出答案，并与 ground-truth answer 比对。[P003][P051] 数据集包含 900 videos、2,700 QA pairs，每题四个选项，视频长度覆盖 11 seconds 到 1 hour。[P003]

**分层采集与时长控制**
构建分三步：video collection、question-answer annotation、quality review。[P051] 视频采集先从 YouTube 建立 domain hierarchy，覆盖 6 个 domain，并细分为 30 个 fine-grained categories。[P003][P051] 每个 category 内按 duration 分三层收集：short（< 2 minutes）、medium（4–15 minutes）、long（30–60 minutes），以保证评测覆盖不同 temporal context。[P051] 采集视频时同步获取 meta-information：subtitles（若提供）和 audios，用于后续多模态条件控制。[P051] 最终得到 900 videos；并非每段视频都有 subtitles，但每段都有 audio，因此可分别构造字幕与音频条件。[P051][P053]

**人工 QA 标注**
标注采用 multiple-choice QA 格式，以方便直接且灵活的评测。[P051] 招募的 annotators 需要较强 English proficiency 和 vision-language learning 研究经验；每人完整观看视频后，围绕视频迭代创建 3 个问题，每个问题配 4 个 candidate options，最终形成 2,700 QA pairs。[P051] 问题覆盖 12 种 task types，包括 perception、reasoning 和 information synthesis，且每题都必须紧密依赖视频内容，使模型不能不看视频就作答。[P051]

**独立复核与 text-only 过滤**
质量复核先由另一位 annotator 独立检查每道 QA：语言是否清晰精确、问题是否可答且 candidate options 逻辑一致、指定 correct answer 是否合适。[P051] 然后进行 text-only 过滤：把只有文本的问题交给 Gemini 1.5 Pro，剔除仅凭文本问题就能答对的 QA pair；例如关于 Argentina 的 number 10 在 2022 年最大成就的问题可被推断为 World Cup victory，因此被排除。[P052] 不符合标准的题目退回原 annotator 修改；统计显示 Gemini 1.5 Pro 在 text-only 设置下准确率低于 15%，说明过滤后的问题确实需要视频内容。[P052]

**被评模型的输入方式**
评测时遵循各被评模型的 official configurations，并尽量使用更多 frames 来适配视频输入。[P132] 对于 image-based models，则通过扩展到 multi-frame images 让其参与视频评测。[P004] 对每段视频，输入形式可在 frames only、frames with subtitles、frames with audio 三种 modality setting 间切换，以分别考察视觉、字幕和音频信息的作用。[P177] 在 with subtitles 设置中，subtitles 选取与 sampled video frames 对应的部分。[P127] 评测按 short、medium、long 三个 duration subset 分别进行，并可在 without subtitles 与 with subtitles 两种条件下比较。[P127]

**accuracy 评分**
accuracy 通过直接比较模型输出与 ground-truth answer 计算，不调用 ChatGPT 等外部模型做判定。[P132][P178] 评测整体还围绕 modality 与 duration 展开分析，以观察帧、字幕、音频和视频长度对结果的影响。[P129][P177]

### split

输入 8881 tokens；输出 5252 tokens（含 reasoning）；耗时 22.1s。

核心贡献
① 交付 Video-MME：900 videos、2,700 道 multiple-choice questions（每视频 3 题），覆盖 6 visual domains 与 30 categories，时长 11 秒至 1 小时（P003）。数据集含 744 条 subtitles、900 条 audios（P051），并设 Video-MME-S/M/L 三档（P048）。
② 以 video collection、QA annotation、quality review 三步构建，用 Gemini 1.5 Pro 做 text-only 过滤，纯文本准确率低于 15%，剔除仅凭问题即可作答的 QA（P051, P052）。
③ 用 certificate length 量化时序难度，短/中/长中位数为 26s/164.7s/890.7s；作者据此主张其为当时最具挑战的 Video QA dataset，比较边界限于 EgoSchema 及 Table 1 所列 benchmark（P084, P049）。
④ 评测发现：Gemini 1.5 Pro 平均准确率 75%，为商业模型最高；开源最高 VILA-1.5 为 59%；subtitles、audios 分别提升 6.2% 与 4.3%，长视频增益更大，性能随视频变长下降（P004, P050）。

相对创新
作者称既有 video benchmarks 视频类型多样性不足、时序动态覆盖不足且偏单模态，Video-MME 因此强调多时长、开放域与 subtitles+audio 的多模态评测（P001, P049）。比较维度含 #Videos、#QA Pairs、Multi-level、Open-domain、Sub.&Aud. 等（P049），并设多级别子集（P048）。其意义在于把 MLLMs 评测从静态视觉理解推向时序视频，并指出长序列处理可能成为瓶颈（P001, P050）。“首个/最具挑战”为作者主张，未见独立第三方验证。

### merged

输入 8907 tokens；输出 2517 tokens（含 reasoning）；耗时 11.03s。

一、Video-MME 基准的提出：作者构建了含 900 个视频、2,700 道 multiple-choice QA 的评测集，覆盖 6 个视觉域与 30 个细分类别，视频时长由 11 秒到 1 小时，并附带字幕与音频（P003）。相对既有 video-based benchmarks，作者以 Multi-level、Open-domain、Sub.&Aud. 等维度标出其差异，但 Table 1 的比较明确只针对各数据集的 multiple-choice 子集，故这些差异的适用范围受此限制，"first-ever comprehensive" 亦属作者主张而非独立验证（P001、P049）。

二、构建与质控方式：流程为 video collection、question-answer annotation、quality review 三步，标注者完整观看视频后各写 3 题、每题 4 个选项，合计 12 类任务；复核阶段另以 Gemini 1.5 Pro 做 text-only 过滤，其准确率低于 15%（P051、P052）。相较表中标注方式为 A 或 A&M 的基准，Video-MME 为全人工标注 M（P021、P032、P042）。

三、评测结果：闭源模型中 Gemini 1.5 Pro 平均 75% 最高，开源最强的 VILA-1.5 为 59%；image MLLMs 扩展为 multi-frame 输入后接近 video-specific 模型，作者据此认为 image understanding 是 video understanding 的基础（P004）。

四、多模态与时长分析：字幕与音频分别使 Gemini 1.5 Pro 提升 6.2% 与 4.3%，长视频增益更明显，且性能随视频长度下降（P004、P050）。作者借 EgoSchema 的 certificate length 指出中、长视频中位数为 164.7s 与 890.7s，并称其为 most challenging Video QA dataset to date；该结论的比较对象仅限 EgoSchema，属推断性主张（P084）。

## LoopVL

### A

输入 2551 tokens；输出 4058 tokens（含 reasoning）；耗时 14.93s。

输入为图像与指令。视觉编码器保留 Penguin pretrained initialization，language backbone 用自文本预训练得到的 H2L3 checkpoint；visual features 先做 parameter-free RMS normalization，再校准到 language embedding vectors 的 median RMS，随后走 backbone 标准路径并沿用 inherited embedding scaling (E005)。alignment stage 用 LLaVA-559K WebDataset，token 分配 0.33B，max sequence length 2048，每图 256–1024 visual tokens；冻结 Penguin Vision Encoder 与 language backbone，仅优化 visual interface，以 image–caption supervision 训练且 loss 施加于 response tokens，建立稳定视觉输入通路 (E007)。dynamic-resolution Stage 1 中 projector 随机初始化并训练，不加载 previous optimizer、scheduler、trainer states；Penguin 与 language backbone 用 BF16，projector 保持 FP32 (E005)。循环结构从初始化独立训练 H1L1、H1L3、H2L1、H2L3，各模型自 language pre-training 起采用指定 H/L recurrence 结构，并在 alignment、multimodal training、post-training 中保持同一计算模式 (E008)。训练与推理 recurrence 配置需匹配：H1L3 与 H2L1 均执行 64 次 Transformer-layer calls，H2L2 与 H3L1 均 96 次，H2L3 与 H4L1 均 128 次，但 128 层对中 MMStar 在 H2L3 为 63.47、H4L1 仅 24.67 (E006)。训练前用 regression tests 验证 text-position compatibility、visual-slot counts、loss masks 与 frozen/trainable parameter boundaries (E005)。输出观察：参数复用可支持不同 effective reading roles；不能由单张 heatmap 推断层的永久固定语义功能，随 recurrent state 演化，同一 transformation 在不同 cycle 参与不同 visual attention allocations (E009)。

### B

输入 2608 tokens；输出 3465 tokens（含 reasoning）；耗时 14.62s。

本文要解决的问题是把 Loop Transformers 的 recurrent computation 扩展到 vision–language models：输入是一张图与一段 instruction，图像提供带显式 spatial structure 的候选证据，instruction 决定当前 query 的相关区域；输出是对应该 query 的文本 response。作者强调，一轮 vision–language interaction 之后 visual tokens 的表示与相对重要性都会变化，因此 recurrent computation 不是单纯增加 computational depth，而必须作用于持续演化的 vision–language states (E001)(E004)。

训练按阶段组织。language pre-training 之后是 visual–language alignment 阶段：使用 LLaVA-559K WebDataset，token allocation 为 0.33B，最大序列长度 2048，每张图使用 256–1024 visual tokens；该阶段 Penguin Vision Encoder 与 language backbone 均冻结，只优化 visual interface，监督信号是 image–caption 的 response tokens，目的是让 visual features 经可训练接口稳定进入冻结的 recurrent language backbone (E007)。

visual interface 的具体做法是：在 dynamic-resolution Stage 1 配置下 projector 随机初始化并在该阶段训练；先对 visual features 做 parameter-free RMS normalization，再校准到 language embedding vectors 的 median RMS；随后 visual representations 走标准 backbone 路径并沿用 inherited embedding scaling (E005)。其中 Penguin 与 language backbone 使用 BF16，projector 参数保持 FP32，且前一阶段的 optimizer、scheduler、trainer 状态不加载 (E005)。进入 multimodal training 前还做回归测试，检查 text-position compatibility、visual-slot counts、loss masks 与预期的 frozen/trainable 参数边界 (E005)。

recurrent 结构用 H/L 配置表示。H1L3 与 H2L1 均执行 64 次 Transformer-layer calls，H2L2 与 H3L1 均执行 96 次，H2L3 与 H4L1 均执行 128 次，但性能差异很大：在 128 次这一对中，MMStar 在 H2L3 下为 63.47，在 H4L1 下仅 24.67 (E006)。同一对内部，schedule 改变的是 L/H updates 的分配与顺序，而参数量与 executed depth 保持不变 (E006)。作者据此指出，模型在 training 与 inference 的 recurrence 配置匹配时表现最好，仅增加 depth 或重新分配 calls 无法恢复 matched 性能 (E006)。实验中 H1L1、H1L3、H2L1、H2L3 各自从初始化独立训练，自 language pre-training 起采用指定 H/L 结构，并在 visual–language alignment、multimodal training、post-training 全程保持同一 computation pattern (E008)。

在机制分析上，raw attention 被当作 allocation diagnostic 而非单独的因果解释：LoopVL 分别考察 attention amount 与 conditional spatial concentration，以及 query/key compatibility 与 visual-value perturbations (E003)。cross-loop 分析显示 parameter reuse 可支撑不同的有效 reading roles；作者不从单张 heatmap 推断某一层具有固定语义功能，而是将其作为 recurrent state 演化过程中同一变换参与不同 visual attention allocation 的对齐示例 (E009)。

现有材料未提供的核心定义包括：H 与 L 各自代表什么、recurrent state 如何跨 cycle 形成与更新，以及 multimodal training 与 post-training 的数据组成与训练细节；这些缺失处无法由已给摘录补足。

### C

输入 10863 tokens；输出 9666 tokens（含 reasoning）；耗时 39.11s。

LoopVL 解决的任务是 image–instruction → text response 的多模态生成：输入一张图像和一条自然语言指令，输出自回归生成的回答文本，其核心主张是把 recurrent computation 引入 vision–language models，即在统一的 vision–language state 上反复施加共享参数更新，用重复调用来换取有效计算深度，而不是靠堆叠独立参数化的 Transformer layers 增加深度 [P001]。之所以不能直接照搬语言模型中的循环做法：图像提供的是带显式空间结构的候选证据，而指令决定哪些区域与当前 query 相关，经过一轮 vision–language 交互后 visual tokens 的表征与相对重要性都可能改变，后续 recurrent steps 可能继续关注同一区域，也可能把 attention 重新分配到此前被忽略的区域 [P001]。

在数据通路上，LoopVL 用 Penguin Vision Encoder 作为冻结的视觉编码器，每个保留的 image patch 得到 1024 维特征；一个两层 GELU projector 经 1536 维隐层把特征从 1024 映射到 1536 维，投影后的 embeddings 替换序列中预留的 visual slots，该序列依次包含 conditioning header、image、instruction 与 response [P042]。语言侧是自行预训练的 recurrent language backbone，构建在 HRM-Text 的 open-source framework 上，包含 L 与 H 两套互不共享参数的参数栈，每套 16 层 Transformer layers [P042]。

循环组织为嵌套的两级：Module-Loop 在同一 high-level condition 下重复整个 L stack，Model-Loop 重复耦合的 L/H 更新周期，默认 schedule 为 [L×3→H]×2，即 H2L3，执行顺序为 L→L→L→H→L→L→L→H [P036][P042]。这里的 L 或 H 符号代表一次完整模块调用而非单层 attention，所以 backbone 只存两套 16 层栈，一次完整前向却执行 128 次 Transformer-layer 调用 [P045]。状态层面，H state 由经过缩放的 input embeddings 初始化，L state 初始化为零并在各 model cycle 之间保留；每个 cycle 内 L 先在该 high-level condition 下被反复更新，随后 H 更新并吸收被细化后的 L state，最终 H state 送入 language-modeling head [P046]。

每个 L/H module 内部由 normalization、gated self-attention、residual paths 与 SwiGLU feed-forward 构成，PrefixLM mask 施加在 attention 计算内部，attention 子层中的 gate 调制其输出通路，这些操作在被再次调用时原样复用 [P045][P046]。位置编码按模态区分：visual tokens 使用二维 spatial RoPE，以 image grid 上的行列坐标编码空间位置；text tokens 同样被赋予两个坐标，但两坐标沿文本序列同步推进，效果退化为原有一维 RoPE [P045]。attention 可见性方面，header、image 与 instruction 位置共同构成 bidirectional prefix，response 位置可以关注这个 prefix 以及前面的 response，而 prefix 位置看不到 response [P046]。

由于 visual tokens 持续演化，每个 model cycle 开始时会把由初始投影 visual embeddings 形成的固定 anchor 重新注入 H state 的视觉位置，注入强度由一个 query-conditioned token-wise visual gate 与一个可学习的 cycle-specific scale 控制 [P046]。这种快慢分工源于 vision–language 任务的粒度差异：颜色、文字、边界、局部空间关系属于细粒度视觉证据，而当前问题与整体场景决定 high-level semantic state；让 L 在相对稳定的 high-level 状态下反复细化当前 vision–language representation，再由 H 整合并形成下一个 cycle 的 high-level state，Module-Loop 提供同一 high-level condition 下更密的状态更新，Model-Loop 让整合后的 high-level state 再次参与后续计算 [P049]。

训练阶段的关键约束是 selective backpropagation：默认 H2L3 的调用顺序记为 L1→L2→L3→H1→L4→L5→L6→H2，反向图在 warmup 中从最后两次调用（L6、H2）逐步扩展到最后五次（L4、L5、L6、H1、H2），更早的 L1、L2、L3 被排除在梯度计算之外，但在前向中仍然全部执行 [P046]。

整体流程先做语言预训练：基于 HRM-Text 的 open-source framework，以其公开数据 recipe 为基础并加入自行整理的数据，文本阶段共 75B tokens，其中 60B 来自 HRM-Text base data recipe、15B 来自额外整理数据 [P143]。多模态部分从该语言 checkpoint 与预训练好的 Penguin Vision Encoder 出发：Stage 1: Visual Language Alignment 冻结语言 backbone 与 Penguin Vision Encoder，只训练 visual interface；Stage 2: Multimodal Mid-Training 联合更新 language model 与 visual interface，Penguin Vision Encoder 保持冻结 [P186]。

Stage 1 使用 LLaVA-559K WebDataset，token 配额 0.33B，最大序列长度 2048，每张图使用 256–1024 个 visual tokens，采用 image–caption 监督且 loss 只施加在 response tokens 上，目的是建立稳定的视觉输入通路，并保留输入梯度路径使冻结的 recurrent language backbone 能把学习信号传回 visual interface [P195]。初始化与数值配置上，projector 随机初始化且只在 Stage 1 训练，前序 optimizer、scheduler、trainer 状态均不加载；visual features 先做无参数的 RMS normalization，再校准到语言 embedding 向量的 median RMS；Penguin 与语言 backbone 使用 BF16，projector 参数保持 FP32；多模态训练前先做 regression tests 检查 text-position 兼容性、visual-slot 数量、loss masks 以及预期的冻结/可训练参数边界 [P189]。

Stage 2 从对齐后的 checkpoint 出发且不继承前一阶段的 optimizer 或 scheduler，最大序列长度 3072，global batch size 128，visual tokens 仍为 256–1024，语言 backbone 与 visual interface 同时可训练，数据为 OneVision-1.5 Mid-Training-85M 对应的 49B tokens，目标是 adapt 到 instruction-conditioned 的通用视觉问答、文本密集图像、图表、数学与短答案任务，训练目标仍只在 response 上计算 [P198][P200]。优化配置为 AdamW，(β1, β2)=(0.9, 0.95)，gradient-norm clipping 1.0，warmup 覆盖总训练步数的 3%，Stage 2 语言 backbone 学习率 2×10⁻⁵、projector 10⁻⁴，weight decay 为 0，warmup 后使用 cosine learning-rate decay，开启 gradient checkpointing 并禁用 inference caching，配合 length bucketing 与 batch-local padding；causal cross-entropy 只在有效 response tokens 上计算，prefix 与 padding 位置被 mask 掉 [P192]。数据侧保留原始 ground-truth response，用 instruction rewriting 规范任务措辞而 OCR 与文档类问题保留原文，多选统一为 option letter 加对应答案文本，yes/no 用合适的短回答，并用 image hash 与归一化问题文本支撑去重；超出序列长度预算的长回答样本直接删除而不截断或切分，以避免引入部分回答目标 [P200][P201]。

多模态 mid-training 之后是 supervised fine-tuning 与 visual reinforcement learning，分别使用 16.81B tokens 和来自 Vision-R1-RL 的 0.006B tokens [P215]。SFT 的数据混合为 OneVision-1.5 Instruct-22M（13B，约 77.3%）、OneVision Spatial-4M（3B，17.8%）、LLaVA v1.5 Mix665K（0.55B，3.3%）与 Vision-R1-Cold（0.26B，1.5%）[P218][P219]。SFT 继续使用 PrefixLM mask，image 与 instruction 位置共同构成 bidirectional conditioning prefix；设 x 为含图像与指令的 conditioning context，y=(y1,…,yT) 为参考回答，则 pθ(y∣x)=∏_{t=1}^{T} pθ(yt∣x,y<t)，训练用 teacher forcing 最小化一个 batch 内有效 response tokens 上的平均 cross-entropy 并 mask padding 位置，其中 Ti 是第 i 个样本的有效 response token 数，θ 是可训练参数 [P221][P222][P223][P226][P227][P232]。

视觉强化学习阶段使用 Group Relative Policy Optimization (GRPO)，奖励由答案正确性构成并配合 progressive reasoning-length schedule：对每个 image–question 输入，模型采样一组回答，最终答案与参考答案匹配时给正奖励、否则为零；GRPO 从组内归一化奖励计算 advantage，并用 probability-ratio clipping 与相对 reference policy 的 KL regularization 更新策略 [P235][P236]。该阶段采用 Progressive Thinking Suppression Training，把最大生成长度从 2048 提到 4096，前期鼓励紧凑且正确的推理、后期为复杂推导留出空间，并随着生成上限提高而减少每个输入的候选数量 [P236]。

方法的有效性通过同预算对照来验证：在相同的 0.14T-token 训练预算下比较 LoopVL 与三个非循环的 Transformer-VL baseline，它们采用与 LoopVL 相同的 Transformer block 设计，只在语言 backbone 的深度、宽度以及是否使用 recurrent computation 上不同——Transformer-VL 1B 为 32 层、hidden size 1536 且每层只执行一次，Transformer-VL 4B (Deep) 为 78 层、hidden size 1792，Transformer-VL 4B (Wide) 保留 32 层而把 hidden size 增到 2816 [P052][P053][P055]。文本给出的提升为 MMStar 从 55.33 到 63.47、RealWorldQA 从 55.29 到 70.98、ChartQA 从 51.12 到 74.52，并指出 LoopVL 与 Transformer-VL 1B 的唯一层数相同而执行深度由 32 次提升到 128 次 layer calls [P106]。同一来源还报告两个更大模型的估计训练 FLOPs 分别为 2.89×10²¹ 与 2.99×10²¹，LoopVL 为 2.47×10²¹ [P106]。

视觉状态是否真正演化则用干预实验检验：在 LogicVista、RealWorldQA、VMCBench-DEV、MMStar 上比较四种条件，Normal 是标准训练与推理；Block L visual updates 是仅在推理期生效的控制，保留第一个 cycle 不变但在第二个 cycle 的 L-module visual updates 传递前将其丢弃；Freeze visual states 同样是推理期控制，在第二个 cycle 内把 visual states 固定；Read-only trained 是单独训练的变体，只在第一个 cycle 允许 visual-state 更新，并在训练、验证、生成中使用同一 read-only 规则，此时 visual tokens 仍可被读取、非视觉状态继续更新 [P109][P139]。结果显示 Normal 在四项评测上都取得最高准确率，重训练的 read-only 变体仍低于它 [P109]。该 read-only 变体保持 H2L3 schedule、两套 16 层共享栈与最终 H-state readout，在第一个 cycle 边界分别保存 L/H 的 visual-state references；第二个 cycle 中 persistent visual states 在 writeback 后被恢复为对应 reference，模块内 visual residual states 在每次 attention 与 feed-forward 更新后恢复到取自该次调用正常组合输入的 reference，这一限制不增加 loss、不额外跑 visual encoder，也不冻结第二个 cycle 的模型参数 [P140]。

材料中缺少若干核心定义，需要指出具体缺口：描述 L/H 递归状态更新的公式 (1) 在给出的摘录里只有编号而未给出内容 [P043]；gated self-attention 中 gate 的作用虽被说明为调制输出通路，但其符号 g 对应的具体计算式没有定义 [P011]；评测表的列名以缩写形式出现，像同时列出的多项基准的完整名称、数据规模与评测协议（prompt 形式、few-shot 设置等）在摘录中均未交代 [P057]。

### D

输入 10989 tokens；输出 9923 tokens（含 reasoning）；耗时 43.03s。

LoopVL 将 recurrent computation 扩展到 vision–language modeling：输入是一张图像与一条 instruction（连同 conditioning header，训练时还给出 reference response），输出是文本 response。它先把视觉输入编码成 visual tokens，再与 instruction tokens 一起送入由共享参数反复调用的 recurrent backbone，最后从最终 H state 经 LM Head 产生 response。P002 P042 P046

视觉侧由 frozen Penguin Vision Encoder 对每个保留的 image patch 产生 1024 维特征。trainable visual interface 中的 two-layer GELU projector 先把 1024 维映射到 1536 维 hidden，再输出 1536 维 visual embedding；这些 embedding 替换序列中预留给图像的 visual slots，该序列同时包含 conditioning header、image、instruction 和 response。视觉接口还对视觉特征做 parameter-free RMS normalization，并校准到语言 embedding 向量的 median RMS 后再进入 backbone。Penguin 与 language backbone 使用 BF16，projector 保持 FP32。P042 P189

recurrent backbone 由独立的 L 与 H 参数栈组成，各 16 层 Transformer；每栈参数在重复调用间共享，L 与 H 互不共享。一次 L 或 H 符号表示一次完整 module invocation，而非单层 attention，因此完整前向会执行 128 次 Transformer-layer call；默认 H2L3 调度为 L→L→L→H→L→L→L→H，即 [L×3→H]×2。Module-Loop 反复调用完整 L 栈，Model-Loop 反复执行耦合的 L/H 更新 cycle，二者构成嵌套循环。P036 P042 P045

每个 L/H module 内部含 normalization、gated self-attention、residual paths 和 SwiGLU FFN；attention 内的 gate 调制其输出路径，这些操作在模块再次调用时复用。recurrent computation 维护耦合的 L state 与 H state：H state 由 scaled input embeddings 初始化，L state 初始化为零并在 model cycles 间保留。每个 cycle 内，L 在当前 high-level condition 下被反复更新，随后 H update 吸收 refined L state；最终 H state 送入 LM Head。每个 model cycle 开始时，模型把来自初始 projected visual embeddings 的固定 anchor 重新注入 H state 的 visual positions，注入强度由 query-conditioned token-wise visual gate 与可学习 cycle-specific scale 控制。训练时 forward 仍执行全部 recurrent invocations，但 selective backpropagation 的 active backward graph 在 warmup 中从最后两个 invocation（L6、H2）逐步扩展到最后五个（L4、L5、L6、H1、H2），更早的 L1–L3 不参与梯度计算。P036 P045 P046 P049

attention 使用 PrefixLM mask：header、image 与 instruction 位置共同形成 bidirectional prefix；response 位置可看 prefix 及更早 response，但 prefix 位置不能看 response。视觉与文本 token 使用不同 rotary positional encodings：visual tokens 用 two-dimensional spatial RoPE，以图像网格上的 row、column 坐标编码空间位置；text tokens 也被赋予二维坐标，但两坐标沿文本序列同步推进，效果等价于 original one-dimensional RoPE。P045 P046

Stage 1: Visual Language Alignment 从 text-pretrained 的 H2L3 language checkpoint 与 Penguin 预训练初始化出发，冻结 Penguin Vision Encoder 与 language backbone，只训练 visual interface（projector 随机初始化）。该阶段用 LLaVA-559K WebDataset、0.33B tokens，最大序列 2048，每图 256–1024 visual tokens，以 image–caption 监督在 response tokens 上计算 loss；目标是建立稳定视觉输入通路，使视觉特征经可训练接口进入 frozen recurrent backbone，并保留 input-gradient 路径把学习信号传回 visual interface。P186 P189 P195

Stage 2: Multimodal Mid-Training 从 aligned checkpoint 继续，不继承上一阶段 optimizer/scheduler；Penguin 冻结，language backbone 与 visual interface 可训练。该阶段用 OneVision-1.5 Mid-Training-85M（49B tokens），最大序列 3072，global batch 128，visual-token 范围仍为 256–1024；语言主干与视觉接口联合训练，采用 response-only objective，目标是让 recurrent model 适应 instruction-conditioned 的多模态回答，包括通用视觉、文本密集图像、图表、数学与短答。P198 P200

SFT 使用 16.81B tokens，混合 OneVision-1.5 Instruct-22M、OneVision Spatial-4M、LLaVA v1.5 Mix665K 与 Vision-R1-Cold；继续用 PrefixLM mask，把 image 与 instruction 作为双向 conditioning prefix，response 位置只 attend 到 prefix 及更早 response。训练用 teacher forcing，最小化 valid response tokens 上的 mean cross-entropy 并 mask padding；θ 为可训练参数。P215 P219 P221 P232

Visual Reinforcement Learning 从 SFT 模型继续，使用 Group Relative Policy Optimization（GRPO）：对每个 image–question 采样一组 response，最终答案与 reference answer 匹配得正 reward，否则零；GRPO 由 group-normalized rewards 计算 advantages，并用 probability-ratio clipping 与相对 reference policy 的 KL regularization 更新策略。该阶段还采用 Progressive Thinking Suppression Training，把最大 generation length 从 2048 提到 4096，并随生成上限提高而减少每输入候选数，以鼓励先短后长的推理。P215 P235 P236

推理时，图像只经 frozen Penguin 一次，visual interface 产生 visual slots，并与 conditioning header、instruction 一起构成 PrefixLM prefix；recurrent backbone 按 L/H schedule 反复调用共享参数，L state 与 H state 持续更新，视觉 token 的表示和相对重要性在 invocation 间被重新选择和分配，而无需再次经过 visual encoder。每个 model cycle 开始时 visual anchor 重新注入 H state 的 visual positions；cycle 结束后最终 H state 送入 LM Head，产生 logits 并以自回归方式输出文本，其条件概率按 pθ(y∣x)=∏_t pθ(y_t∣x,y_<t) 分解。P046 P109 P223

