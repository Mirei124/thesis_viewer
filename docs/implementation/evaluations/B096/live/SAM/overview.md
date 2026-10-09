## problem_motivation

作者旨在构建分割 foundation model（E003）；因分割缺乏 web-scale 数据源（E005、E008），提出 promptable segmentation task 作预训练目标（E006）。

## method

论文的核心贡献是面向图像分割的基础模型 SAM 与配套数据引擎 SA-1B：模型被设计为可提示，并在广泛数据上用能带来强泛化的任务预训练 [E012][E014]。任务层定义为 promptable segmentation task：输入图像与任意分割提示，输出针对该提示的合法 mask；提示可表示点、框、mask、自由文本等指示“分割什么”的信息 [E015][E020]。所谓合法不要求唯一解释：提示有歧义（如衬衫上一点可指衬衫或人）时，至少对一个可能对象输出合理 mask [E015][E020]。预训练对每个样本模拟一串点/框/mask 提示，将预测 mask 与 ground truth 比较，目标是在任何提示下都输出合法 mask，即使提示有歧义 [E021]。训练采用 focal loss 与 dice loss 的线性组合监督 mask 预测，并在每个 mask 上随机采样 11 轮提示来模拟交互，使模型能接入数据引擎 [E041]。下游泛化靠 prompt engineering：例如将检测器给出的框作为提示完成实例分割，模型也可作为更大系统的组件，而非固定多任务系统 [E022][E026]。

模型 SAM 有三组件：image encoder、prompt encoder、mask decoder，均建立在 Transformer vision models 上 [E035]。image encoder 用 MAE 预训练的 Vision Transformer (ViT) 并最小改造以处理高分辨率输入，每图只运行一次，产生 image embedding [E036]。prompt encoder 处理两类提示：稀疏的点、框、text 与稠密 mask；点和框用 positional encodings 加上各提示类型的 learned embeddings，自由文本用 CLIP 的 off-the-shelf text encoder，mask 用卷积嵌入并与 image embedding 逐元素相加 [E037]。mask decoder 把 image embedding、prompt embeddings 和 output token 映射为 mask：修改过的 Transformer decoder block 做 prompt self-attention 与双向 cross-attention（prompt-to-image 和 image-to-prompt），两轮后上采样 image embedding，由 MLP 将 output token 变成 dynamic linear classifier，在每个图像位置计算前景概率 [E038]。

为处理歧义，SAM 对同一提示输出多个 mask（3 个足以覆盖 whole、part、subpart），训练只反传其中最小 loss；同时为每个 mask 预测 confidence score（估计 IoU）以排序 [E039][E040]。效率上，给定预计算 image embedding，prompt encoder 与 mask decoder 可在浏览器 CPU 约 50ms 运行，支持实时交互 [E040]。推理时先算一次 image embedding，再对不同提示复用并快速解码出 mask 与置信分数 [E016][E040]。

数据侧，由于互联网不存在 web-scale segmentation masks，作者构建 data engine，让模型与标注互相迭代，分 assisted-manual、semi-automatic、fully automatic 三阶段，最终产出 SA-1B [E014][E043]。第一阶段专业标注员用 SAM 驱动的浏览器交互工具点前景/背景并用画笔/橡皮精修；SAM 起初用公共分割数据集训练，之后仅用新标注 mask 重训，image encoder 由 ViT-B 扩到 ViT-H，共重训 6 次，每 mask 平均标注时间从 34 秒降到 14 秒，每图 mask 从 20 增到 44，累积 4.3M masks/120k images [E044][E046]。第二阶段先自动检测 confident masks 并预填图像，让标注员补充遗漏对象以提高多样性；用第一阶段 masks 训练 generic “object” bounding box detector 来检测，再收 5.9M masks/180k images，总计 10.2M，并重训模型 5 次 [E046]。第三阶段全自动：用 32×32 规则点网格提示 ambiguity-aware SAM，每点输出可能对应有效对象的 mask 集合；再用 IoU prediction module 选 confident masks [E046]。随后保留在阈值 0.5−δ 与 0.5+δ 下相似的 stable masks，用 NMS 去重，并用多重叠放大裁剪改善小 mask；最终对 11M 图像生成 1.1B masks，即 SA-1B [E047][E048]。

## contributions_novelty

提出 promptable segmentation task：任意 segmentation prompt 返回有效 mask，兼作预训练/下游接口（E055）。

相对 CLIP/ALIGN 的 paired text and images 范式，本文把 foundation model 目标移到 image segmentation（E051, E052）。

SAM 分离 image encoder、prompt encoder、lightweight mask decoder，约 50ms 出 mask，歧义时输出多 mask（E056）。

data engine 三阶段产出 SA-1B：11M 图像、1.1B masks，比既有 segmentation 数据集多 400×（E057, E058, E063）。

23 个 segmentation 数据集单点提示接近人工 mask，并 zero-shot 迁移，但仍有改进空间（E060）。

## experiments_ablations

23数据集单中心点mIoU：SAM在16个胜过RITM，最高约+47 IoU；oracle取3掩码中最相关者则全数据集胜出（E098）。消融：数据引擎各阶段提升mIoU，仅automatic低约0.5 mIoU（E155）；1M图像近11M（E156）；ViT-H较ViT-L增益边际（E167）；single out.在LVIS AR全项更差（E124）。

## limitations

SAM 会遗漏精细结构、虚构小连通分量，边界不如 zoom-in 方法清晰；整体非实时，text-to-mask 不够稳健 E170。