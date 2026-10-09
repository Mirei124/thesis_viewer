## method

本节按“任务—模型—数据引擎”的顺序说明该论文的核心方法。论文的目标是构建图像分割的 foundation model，即一个 promptable model，用能在广泛数据上带来强泛化的任务做预训练，从而仅靠 prompt engineering 就能在新数据分布上解决多种下游分割问题（E012）。

一、任务定义与预训练目标
受 NLP 中 prompting 思路启发，论文提出 promptable segmentation task：给定图像与任意 segmentation prompt，模型需返回一个 valid segmentation mask（E015，E020）。prompt 可以是前景/背景点、粗略的 box 或 mask、free-form text，或任何指示“分割什么”的信息（E020）。“valid”的含义是：即使 prompt 有歧义（例如衬衫上的一个点既可能指衬衫，也可能指穿着它的人），输出至少要对其中一个对象给出合理 mask（E015，E020）。该任务既作为预训练目标，也用于经 prompt engineering 解决下游任务（E021）。

预训练算法为每个训练样本模拟一串 prompt（点、box、mask），并将预测 mask 与 ground truth 比较（E021）。与 interactive segmentation 不同——后者追求在足够用户输入后得到有效 mask——这里要求对任何 prompt 都始终预测出有效 mask，即便 prompt 有歧义，这正是 data engine 自动标注所依赖的性质（E021）。推理阶段，下游任务通过设计合适的 prompt 解决：例如把猫的 bounding box detector 输出作为 prompt，即可完成猫的 instance segmentation，模型由此可作为更大系统的组件（E022，E026）。

二、模型：SAM
SAM 由三个组件构成：image encoder、flexible prompt encoder、fast mask decoder（E035）。这种拆分使同一个 image embedding 可被不同 prompt 复用，其计算代价得以摊薄（E016）。

image encoder：使用经 MAE 预训练的 Vision Transformer (ViT)，并针对高分辨率输入做最小改动（E036）。它每张图像只运行一次，可在 prompting 之前预先完成，输出供后续查询的 image embedding（E032，E036）。

prompt encoder：prompt 分稀疏与稠密两类。稀疏 prompt（points、boxes、text）中，points 与 boxes 用 positional encodings 加上各 prompt type 对应的 learned embedding 表示；free-form text 用 CLIP 的 off-the-shelf text encoder 编码。dense prompt（即 masks）用卷积嵌入，并与 image embedding 逐元素相加（E037）。

mask decoder：把 image embedding、prompt embeddings 与一个 output token 高效映射为 mask（E038）。它是对 Transformer decoder block 的修改，后接 dynamic mask prediction head；修改后的 block 使用 prompt self-attention，以及两个方向的 cross-attention（prompt-to-image embedding 与反向）来更新所有 embedding。运行两个 block 后，对 image embedding 上采样，再由 MLP 把 output token 映射成 dynamic linear classifier，在图像每个位置计算 mask foreground probability（E038）。

歧义处理：单输出模型面对歧义 prompt 会把多个有效 mask 平均掉，因此模型对单个 prompt 预测多个 mask，论文发现 3 个输出足以覆盖大多数常见情形（嵌套 mask 通常最多三层：whole、part、subpart）（E039）。训练时只对 loss 最小的 mask 做 backprop；模型还为每个 mask 预测 confidence score（即估计的 IoU）用于排序（E039，E040）。

损失与训练：mask 预测由 focal loss 与 dice loss 的线性组合监督；在 promptable segmentation task 上训练，使用 geometric prompts 的混合（text prompt 见 §7.5）；参照交互式设定，对每个 mask 随机采样 prompt 共 11 轮，使 SAM 能无缝接入 data engine（E041）。

效率：给定预先算好的 image embedding，prompt encoder 与 mask decoder 可在 web browser 的 CPU 上以约 50ms 运行，从而支持实时交互式 prompting（E040）。论文以点、box、mask prompt 为主，并给出 free-form text prompt 的初步结果（E016）；对歧义 prompt，SAM 可输出多个 valid mask 及对应 confidence score（E033）。

三、数据引擎
由于互联网上不存在 web-scale 的 segmentation 数据，作者构建 data engine，让模型与模型在环的标注共同演进，最终得到 1.1B mask 的 SA-1B（E014，E017，E043）。引擎分三阶段（E017，E043）：

（1）assisted-manual：类似经典 interactive segmentation，专业标注员在由 SAM 驱动的浏览器工具中点击前景/背景点来标注 mask，可用像素级 brush 与 eraser 精修；不设语义约束，stuff 与 things 都可标注，但不收集名称或描述；要求按显著性顺序标注，单个 mask 超过 30 秒即进入下一张（E044）。初始 SAM 用公开分割数据集训练，之后只用新标注 mask 重训；随数据增多 image encoder 从 ViT-B 扩到 ViT-H，共重训 6 次；平均单 mask 标注时间由 34 秒降到 14 秒，每图 mask 数由 20 增至 44；本阶段从 120k 图像收集 4.3M mask（E046）。

（2）semi-automatic：为提升 mask 多样性并让标注员关注不显著对象，先自动检测 confident mask——在第一阶段全部 mask 上以通用 “object” 类别训练一个 bounding box detector——再把预填这些 mask 的图像交给标注员补充未标注对象（E046）。本阶段新增 5.9M mask、180k 图像（累计 10.2M），期间重训模型 5 次；平均标注时间（不含自动 mask）回升至 34 秒，每图 mask 数由 44 增至 72（E046）。

（3）fully automatic：此时模型已足够强且具备 ambiguity-aware 能力，于是用 32×32 规则网格点作 prompt，对每个点预测一组可能对应有效对象的 mask；若点落在 part 或 subpart 上，模型会返回 subpart、part 与 whole（E046）。随后用模型自带的 IoU prediction module 选出 confident mask，并只保留 stable mask（把概率图在 0.5−δ 与 0.5+δ 处阈值化得到相似 mask 才算 stable）（E046，E047）；再以 non-maximal suppression (NMS) 去重；为改善小 mask 质量，还处理多个相互重叠的放大图像裁剪（E048）。该阶段应用于全部 11M 图像，共产生 1.1B 高质量 mask，即 SA-1B（E048）。