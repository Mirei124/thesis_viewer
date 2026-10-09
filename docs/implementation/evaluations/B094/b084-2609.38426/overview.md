## problem_motivation

作者要回答的核心问题是：Loop Transformers 能否被有效扩展到 vision–language models（E025）。既有 recurrent Transformers 以及后续 recurrent-depth language models 的工作主要面向语言模型，而图像提供具有显式空间结构的候选证据、instruction 决定哪些区域相关；一轮 vision–language 交互之后，visual tokens 的表征与相对重要性都可能发生变化，后续循环可能继续关注同一批区域，也可能重新分配 attention（E022,E024）。作者认为 visual tokens 与 image patches 保持空间对应，因而可把视觉模态当作观察 recurrent computation 的窗口（E026），据此在统一的 vision–language state 上执行持续的 recurrent computation（E027）。

## method

LoopVL 考察的核心问题是：能否把 Loop Transformers 有效扩展到 vision–language models（E156）。它的输入是一条包含 conditioning header、image、instruction 与 response 的序列：image 部分由 frozen 的 Penguin Vision Encoder 对每个保留的 image patch 产生 1024 维特征，再由两层 GELU projector 经 1536 维隐层把特征映射到 1536 维，投影后的 embedding 替换序列中预留的 visual slots（E171）。最终输出由 language-modeling head 产生，模型据此给出答案。

语言骨干建立在 HRM-Text 的开源框架之上，包含互不共享参数的 L 与 H 两个参数栈，每栈 16 层 Transformer，各自在被反复调用时复用自身参数（E172）。默认 H2L3 配置的执行顺序是 L→L→L→H→L→L→L→H（E173）。这里的 L 或 H 记号代表一次完整模块调用而非单个 attention 层，因此骨干虽只存两套 16 层堆叠，一次完整前向却执行 128 次 Transformer 层调用（E175）。模块内部由 normalization、gated self-attention、residual 路径与 SwiGLU feed-forward 组成（E176）。visual tokens 使用二维 spatial RoPE，以图像网格上的行、列坐标编码空间位置；text tokens 也被赋予二维坐标，但两个坐标沿文本序列同步推进，从而退化为与原来一维 RoPE 等价的效果（E176）。attention 计算内部施加 PrefixLM mask，attention 子层中的 gate 调制其输出路径，这些操作在模块再次被调用时复用（E178）。

状态更新上，recurrent computation 维护耦合的 L 与 H 状态：H 状态由缩放后的 input embedding 初始化，L 状态初始化为零并在 model cycles 之间保留（E179）。每个 cycle 内，L 在当前高层条件下被反复更新，随后 H 更新并纳入细化后的 L 状态，最终 H 状态送入 language-modeling head；这不同于堆叠一串独立 block，共享的 L 变换会在 H 更新下一个 cycle 的条件之前被多次重访。每个 model cycle 开始时，LoopVL 会把来自初始投影视觉 embedding 的固定 anchor 重新注入 H 状态的 visual positions，注入强度由 query-conditioned 的 token-wise visual gate 与可学习的 cycle-specific scale 控制（E179）。由此，Module-Loop 在同一高层条件下提供更密集的状态更新，Model-Loop 让整合后的高层状态再次参与后续计算，两者构成快慢两种时间尺度的嵌套更新（E184），默认调度为 [L × 3 → H] × 2（E167）。

训练时的反向传播采用 selective backpropagation：默认 H2L3 下的执行顺序为 L1→L2→L3→H1→L4→L5→L6→H2，warmup 期间 active backward graph 从最后两次调用（L6、H2）逐步扩展到最后五次（L4、L5、L6、H1、H2），较早的 L1–L3 不参与梯度计算，但所有 recurrent invocation 仍在前向中执行（E180）。所有 valid sequence positions 都参与模块调用，区别只在 attention 可见性：header、image、instruction 共同构成双向 prefix，response 位置可关注该 prefix 及其之前的 response 位置，而 prefix 位置不能关注 response（E180）。

整体训练流程分语言预训练与多模态两阶段。语言预训练沿用 HRM-Text 公开数据配方并加入自整理数据，共 75B tokens，其中 60B 来自 HRM-Text base、15B 为整理数据（E219）。Stage 1: Visual Language Alignment 冻结 language backbone 与 Penguin Vision Encoder，只训练 visual interface（E235）；该阶段使用 LLaVA-559K WebDataset、0.33B tokens、最大序列长度 2048、每图 256–1024 visual tokens，以 image–caption 监督并把 loss 落在 response tokens 上（E249）。Stage 2: Multimodal Mid-Training 改为联合更新 language model 与 visual interface，Penguin 仍冻结（E252）；此阶段最大序列长度 3072、global batch size 128、visual token 范围仍为 256–1024（E254），使用 OneVision-1.5 Mid-Training-85M 的 49B tokens 并维持 response-only 训练目标（E255）。初始化时视觉编码器保留 Penguin 预训练权重，language backbone 使用自训文本预训练的 H2L3 checkpoint，projector 随机初始化并在 Stage 1 训练，且不加载此前的 optimizer、scheduler 与 trainer 状态（E237）。视觉接口先对视觉特征做无参数 RMS 归一化，再校准到 language embedding 向量的中位 RMS，Penguin 与 language backbone 用 BF16，projector 参数保持 FP32（E238）。优化使用 AdamW，(β1,β2)=(0.9,0.95)，gradient-norm clipping 为 1.0，warmup 覆盖总训练步数的 3%（E240）；Stage 1 的 projector 学习率为 10^-3、Stage 2 的 language backbone 学习率为 2×10^-5（E243），Stage 2 的 projector 用 10^-4，weight decay 为 0（E245）；两阶段 global batch size 分别为 256 与 128，Stage 2 在 warmup 后使用 cosine 学习率衰减（E246）。

后训练阶段先用 supervised fine-tuning，仍使用 PrefixLM mask：image 与 instruction 组成双向 conditioning prefix，response 位置可关注该 prefix 及之前的 response tokens（E273）。条件生成概率分解为 p_θ(y∣x)=∏_{t=1}^{T} p_θ(y_t∣x, y_<t)（E275），训练以 teacher forcing 最小化一个 batch 内有效 response tokens 上的平均交叉熵，并屏蔽 padding 位置（E277）。SFT 共使用 16.81B tokens（E271）。随后进行 visual reinforcement learning，采用 GRPO 并组合答案正确性奖励与 progressive reasoning-length schedule（E287）：对每个 image–question 输入采样一组 responses，最终答案与参考答案一致给正奖励、否则为零，GRPO 由 group-normalized rewards 计算 advantage，并用 probability-ratio clipping 与对 reference policy 的 KL 正则更新策略（E288）；生成上限从 2048 逐步增加到 4096 tokens，并在上限提高时减少每个输入的候选数（E289）。

评测使用统一推理与打分流程，VLMEvalKit 为部分 benchmark 提供数据加载与 prompt 构建，主要采用 direct-answer prompts、greedy decoding、batch size 1、随机种子 0，多数样本生成预算为 32 tokens（部分为 8、64 或 512），预测通过 option extraction、answer normalization 与任务特定匹配规则打分（E339）。主模型使用 H2L3、每次前向 128 次层执行；H/L sweep 在同一 checkpoint 上遍历 H 取 1–4、L 取 1–3 共 12 种配置，H 状态由多模态 input embeddings 初始化、L 状态使用 checkpoint 中保存的初始状态，decoding 关闭 KV cache，最终 H-module 输出经共享 output head 生成答案（E341）。

## contributions_novelty

作者自述的第一项交付是把 recurrent computation 扩展到 vision–language 建模：LoopVL 以共享参数反复更新统一的 vision–language state，通过 Module-Loop 与 Model-Loop 的嵌套执行在不增加参数的前提下加深执行 (E348)，并把 Loop Transformer 能否有效扩展到 vision–language 模型作为核心问题提出 (E371, E375)。

实现上，语言 backbone 基于 HRM-Text 开源框架与数据自行预训练而非其已发布 checkpoint，L 与 H 为参数互不共享的 16 层 stack (E386, E710)；默认 H2L3 顺序为 L→L→L→H→L→L→L→H，一次前向共 128 次 layer 调用 (E388, E390, E760)。

在相同 0.14T token 预算下，与层数、宽度相同的非 recurrent Transformer-VL 1B 相比，LoopVL 在全部基准上更优，如 MMStar 55.33→63.47、RealWorldQA 55.29→70.98 (E408, E409)；其训练 FLOPs 2.47×10^21 也低于更大的 Transformer-VL 4B 变体 (E412)。

分析层面，作者以 32 样本诊断集报告跨 model cycle 的视觉注意力重分配，即 Visual Aha Moment，cycle 边界平均 Gini 由 0.405 升至 0.858 (E607, E609)；该现象在全反传对照模型与移除 visual anchor 及 query-conditioned visual gate 后仍出现 (E608)。

有依据的解读是：推理期改换 H/L schedule 并不自动带来增益，训练与推理配置匹配时表现最好 (E561, E562)；作者亦未训练更一般 Model-Loop 架构的匹配对照，故 Visual Aha Moments 是否内在于 Model-Loop 计算仍未确定，结论限于该 hierarchical framework (E747, E749)。

## experiments_ablations

评测设置：主模型为 H2L3，执行顺序 LLLHLLLH，每模块 16 层，单次前向共 128 次 layer 调用，解码关闭 KV cache（E1181）。主结果覆盖 16 个 benchmark family，使用 greedy decoding 与多数 32-token 预算（E970）；LoopVL-1B 训练 token 为 0.14T，比较模型为 3T–36T（E976）。其 MMStar 63.47、MMMU-Pro 38.67（E982, E981）。训练时 H/L 消融将 H1L1、H1L3、H2L1、H2L3 各自从初始化独立训练，unrolled layers 为 32/64/64/128，H2L3 在 MMStar、RealWorldQA、VMCBench、AI2D、ChartQA 五项最高；同为 64 次调用的 H1L3 与 H2L1 中后者五项全胜（E1010, E1012）。推理时 sweep 固定同一 H2L3 checkpoint、不重训：训练匹配配置五项最佳，H1L1–H1L3 读出近乎不可解析、分数近零（E1021）；MMStar 由 H2L1 的 29.40、H2L2 的 51.33 升至 H2L3 的 63.47，而 H3L3、H4L3 执行 192、256 次调用却降到 58.20、24.00（E1022, E1023）。模块更新消融方面，Figure 3 在 LogicVista、RealWorldQA、VMCBench-DEV、MMStar 上比较四种 visual-state 条件，其中两种为仅推理控制、一种为单独训练变体，Normal 四项最高（E881, E892）。注意力与状态分析基于抽样子集而非全量 benchmark：曲线用 32 个样例、12 个 head（E1183），state/output probe 用 VMCBench 与 AI2D 各 16 个样例（E1185）；速度指标在原文中无实测条件，无法给出。

## limitations

论文承认的限制如下。推理导向的 post-training 主要集中于 mathematical reasoning，在有限数据设定下长推理偶尔重复 token 或重复推理片段，导致推理中断 (E1496)。受算力限制，未训练更一般 Model-Loop 架构的 matched control，故 Visual Aha Moments 是否内在于 Model-Loop 计算尚未完全确立 (E1497)。LoopVL 基于 HRM-Text 层级循环框架，结果只刻画一种特定循环框架 (E1499)，且仅覆盖冻结视觉编码器的图像任务，multi-image、video 与 agentic 环境未探索 (E1500)。分析层面，更强的因果与泛化主张留待受控评估 (E1502)，case study 也不估计该现象的出现频率 (E1517)。