## problem_motivation

既有 sequence modeling 与 transduction 以 recurrent 结构（如 LSTM、gated recurrent）为主，其沿符号位置逐步生成隐藏状态，这种固有顺序性使样本内部无法并行，序列变长时更受内存与批处理限制；factorization tricks 与 conditional computation 只能提升效率，顺序计算的根本约束仍在（E011、E012）。attention 虽能无视距离建模依赖，却几乎总与 recurrent 网络结合使用（E013）；卷积路线上，ConvS2S、ByteNet 关联任意两位置所需运算数随距离线性或对数增长，远距离依赖更难学习（E016）。作者由此提出 Transformer，完全摒弃 recurrence 与 convolution，仅靠 attention 建立输入输出间的全局依赖，以获得更强并行性与更短训练时间（E014）。

## method

论文处理的任务是 sequence transduction：encoder 把输入符号序列 (x1,...,xn) 映射为连续表示 z=(z1,...,zn)，decoder 再据 z 逐个生成输出符号序列 (y1,...,ym)，且是 auto-regressive 的，每一步会把先前生成的符号作为额外输入 (E045)。Transformer 沿用 encoder-decoder 结构，但在 encoder 与 decoder 中都改用堆叠的 self-attention 与 point-wise、fully connected 层 (E048)，完全不用 recurrence 与 convolution，而让 attention 机制直接刻画输入与输出之间的全局依赖 (E038)。self-attention（有时称 intra-attention）是在单个序列的不同位置之间建立关联以计算该序列表示的机制 (E041)；论文称 Transformer 是第一个完全依赖 self-attention 计算输入与输出表示、不用 sequence-aligned RNN 或 convolution 的 transduction 模型 (E043)。

encoder 由 N=6 个相同层堆叠，每层两个 sub-layer：先做 multi-head self-attention，再做逐位置的全连接前馈网络；两个 sub-layer 各自外包 residual connection 并接 layer normalization，即输出为 LayerNorm(x + Sublayer(x))；为使残差可加，所有 sub-layer 与 embedding 层输出维度统一为 d_model=512 (E050)。decoder 同样是 6 层，但在 encoder 的两个 sub-layer 之外插入第三个 sub-layer，对 encoder stack 的输出做 multi-head attention (E051)。decoder 的 self-attention 被改成不允许关注其后的位置：这种 masking 加上输出 embedding 整体偏移一位，保证位置 i 的预测只依赖位置小于 i 的已知输出 (E051)。

attention function 把 query 与一组 key-value pair 映射为输出，query、key、value、输出都是向量；输出是 value 的加权和，每个 value 的权重由 query 与相应 key 的 compatibility function 给出 (E053, E058)。本文的具体形式是 Scaled Dot-Product Attention：输入为维度 d_k 的 queries 与 keys、维度 d_v 的 values，先算 query 与所有 key 的点积，除以 √d_k，再经 softmax 得到 value 上的权重 (E060)。实现时把一组 query 打包成矩阵 Q，key 与 value 分别打包成 K 与 V，一次算出 softmax(QK^T/√d_k)V——该公式在 PDF 抽取中被打散，形式依正文描述复原 (E061, E064)。缩放的理由是 d_k 较大时点积量级变大，会把 softmax 推入梯度极小的区域，因此用 1/√d_k 抵消 (E071, E073)。作者给出的解释是：若 q、k 各分量独立、均值为 0、方差为 1，则点积均值为 0、方差为 d_k (E078, E080)。

Multi-Head Attention 不做 d_model 维的单次 attention，而是用 h 组不同的、可学习的线性投影把 query、key、value 分别投到 d_k、d_k、d_v 维，在这些投影上并行执行 attention，得到 d_v 维输出 (E076)。这些输出被拼接、再投影一次得到最终结果，即 MultiHead(Q,K,V)=Concat(head_1,...,head_h)W^O，其中 head_i=Attention(QW_i^Q, KW_i^K, VW_i^V) (E083, E086)。投影矩阵维度为 W_i^Q∈R^{d_model×d_k}、W_i^K∈R^{d_model×d_k}、W_i^V∈R^{d_model×d_v}、W^O∈R^{hd_v×d_model} (E091, E093)。本文取 h=8、d_k=d_v=d_model/h=64；因每个 head 维度降低，总计算量与全维度单头 attention 相当 (E094)。这样做的目的是让模型在不同位置、不同表示子空间上联合关注信息，单个 head 时 averaging 会抑制这种能力 (E084)。

multi-head attention 在模型中出现于三处：encoder-decoder attention 层中 query 来自上一层 decoder、key 与 value 来自 encoder 的输出，使 decoder 每个位置都能关注输入序列的所有位置 (E097)；encoder 内的 self-attention 层中 key、value、query 全部来自上一层 encoder 的输出 (E098)；decoder 内的 self-attention 层则把 softmax 输入中对应非法连接的值置为 −∞ 来 masking，阻止向左的信息流以维持 auto-regressive 性质 (E099)。

除 attention 外，encoder 与 decoder 每层都含一个对每个位置独立、同式施加的全连接前馈网络，由两次线性变换、中间一次 ReLU 组成：FFN(x)=max(0, xW1+b1)W2+b2 (E101, E102)。线性变换跨位置共享但逐层不同，也可描述为两个 kernel size 为 1 的卷积；输入输出维度 d_model=512，内层维度 d_ff=2048 (E103)。

输入与输出 token 用可学习 embedding 转成 d_model 维向量，decoder 输出再经可学习线性变换与 softmax 转成下一个 token 的预测概率；两个 embedding 层与 pre-softmax 线性变换共享同一权重矩阵，embedding 层中这些权重乘以 √d_model (E105)。由于模型既无 recurrence 也无 convolution，必须在 encoder 与 decoder 栈底把 positional encoding 加到输入 embedding 上以注入位置信息，两者维度同为 d_model 才能相加 (E117)。本文采用不同频率的 sine 与 cosine 函数作为 positional encoding (E118)。偶数维为 PE(pos,2i)=sin(pos/10000^{2i/d_model})，其中 pos 为位置、i 为维度 (E120, E123)；奇数维为 PE(pos,2i+1)=cos(pos/10000^{2i/d_model})，每个维度对应一条 sinusoid，波长构成从 2π 到 10000·2π 的几何级数 (E122, E124)。选这一形式是因为作者假设它便于模型学到按相对位置关注：对任意固定偏移 k，PE_{pos+k} 可写成 PE_pos 的线性函数 (E125)。作者也试过 learned positional embedding，两种版本结果几乎相同，最终选正弦版本是因其可能外推到训练中更长的序列 (E126)。

作者用每层计算复杂度、最小顺序操作数与最大路径长度三项标准比较 self-attention 与 recurrent、convolutional 层 (E131, E132)。Table 1 中 self-attention 以 O(1) 个顺序操作连接所有位置、最大路径长度为 O(1) (E111)；recurrent 层则需要 O(n) 个顺序操作 (E113, E133)。

训练使用 WMT 2014 English-German 数据集，约 4.5M 句对，用 byte-pair encoding 编码，source 与 target 共享约 37000 token 的词表；English-French 用更大的 WMT 2014 English-French 数据集（36M 句），切成 32000 的 word-piece 词表；句对按近似序列长度分批，每批约含 25000 个 source token 与 25000 个 target token (E143)。训练在单机 8 块 NVIDIA P100 GPU 上进行：base 模型每步约 0.4 秒、共 100,000 步（12 小时），big 模型每步 1.0 秒、共 300,000 步（3.5 天）(E145)。优化器用 Adam，β1=0.9、β2=0.98、ε=10^-9 (E148)；学习率按 lrate = d_model^{-0.5}·min(step_num^{-0.5}, step_num·warmup_steps^{-1.5}) 变化 (E151)，即前 warmup_steps 步线性升高、之后按步数平方根的倒数衰减，warmup_steps=4000 (E152)。正则化方面，每个 sub-layer 的输出在加回 sub-layer 输入并归一化之前施加 dropout，embedding 与 positional encoding 之和也施加 dropout，base 模型取 P_drop=0.1 (E177, E178)；训练还使用 ε_ls=0.1 的 label smoothing，它使 perplexity 变差，但提升 accuracy 与 BLEU (E179)。

评测在 WMT 2014 English-to-German 与 English-to-French 的 newstest2014 上用 BLEU (E157)：base 模型为 27.3 与 38.1 (E174)，big 模型为 28.4 与 41.8 (E176)。model variations 一节在 English-to-German 的 newstest2013 开发集上比较，使用前一节的 beam search 但不做 checkpoint averaging；beam search 的具体配置不在本次摘录范围内 (E186, E195)。

## contributions_novelty

论文提出 Transformer，一种完全基于 attention 的序列转导架构，以 multi-head self-attention 取代 encoder-decoder 中常用的循环层（E396、E210）；相对前文所述占主导的 recurrent、long short-term memory 与 gated recurrent 方法（E207），以及以卷积为基本构建块的 Extended Neural GPU、ByteNet、ConvS2S（E212），其改变在于不使用 recurrence 与 convolution。作者自述它是首个完全依赖 self-attention 计算输入与输出表示、不用 sequence-aligned RNN 或 convolution 的转导模型（E215）。

方法上，论文给出 scaled dot-product attention，即点积按 1/√d_k 缩放后经 softmax 加权求和（E232、E245），并采用 h=8 个并行注意力头、每个 d_k=d_v=64 的 multi-head attention（E266、E248）；文中称 dot-product attention 与 additive attention 理论复杂度相近，但前者可利用高度优化的矩阵乘法实现，实践中更快更省空间（E238、E242）。

效率论证以 Table 1 给出：self-attention 每层复杂度 O(n²·d)、O(1) 顺序操作与 O(1) 最大路径长度，recurrent 层则为 O(n²·d)、O(n)、O(n)（E283、E285、E307）。

作者据此主张序列长度小于表示维度时 self-attention 更快，且更短路径更利于学习长程依赖（E305、E304）；将 self-attention 限制在邻域 r 以处理超长序列被列为未来工作（E307）。

WMT 2014 英德任务上 Transformer (big) 得 28.4 BLEU，超出此前报告的最好模型（含 ensembles）2.0 BLEU 以上（E355、E198）；英法任务得 41.8 的单模型 state-of-the-art BLEU（E198、E348）。base 模型亦超过此前发表模型与 ensembles，而训练成本仅为其一小部分（E356）；base 与 big 分别训练 12 小时与 3.5 天，均为 8 块 P100（E317）。

解读：English constituency parsing 上 4 层 Transformer 在 WSJ only 与 semi-supervised 设置分别得 91.3 与 92.7 F1，作者称除 Recurrent Neural Network Grammar 外优于所有此前报告模型（E390、E393）；该结果来自 Section 23，且仅少量超参在 Section 22 开发集上调（E389、E387），应视为该设定下的观察，不宜外推为其他任务或数据规模上的普遍优势。

## experiments_ablations

实验在 WMT 2014 EN-DE（约 4.5M 句对，byte-pair encoding，共享词表约 37000 tokens）与 EN-FR（36M 句，32000 word-piece）上展开，每批约 25000 source 与 25000 target tokens (E518)。训练用单机 8 张 NVIDIA P100 GPU：base 模型每步约 0.4 秒、共 100K 步（12 小时），big 模型每步 1.0 秒、300K 步（3.5 天）(E520)。Table 2 中 Transformer (base) 的 EN-DE/EN-FR BLEU 为 27.3/38.1，Transformer (big) 为 28.4/41.8 (E549, E551)；正文另称 EN-FR 的 big 模型为 41.0，其 dropout 设为 0.1 而非 0.3 (E560, E562)。在 EN-DE 上 big 模型超过此前含 ensemble 的最佳结果逾 2.0 BLEU，base 也已超过所有已发表模型 (E558, E559)；EN-FR 的训练成本不到此前模型最佳结果的 1/4 (E561)。base 平均最后 5 个 checkpoint、big 平均最后 20 个，解码用 beam size 4 与 α=0.6 (E563, E564)。消融 Table 3 全部在 EN-DE 开发集 newstest2013、不做 checkpoint 平均，perplexity 按 wordpiece 计算 (E576, E585)。单头注意力 BLEU 24.9，比最佳设置低 0.9，头过多同样下降 (E578, E586)；缩小 d_k 损害质量 (E580, E586)；更大模型更好、dropout 有助避免过拟合，学习式 positional embedding 与正弦式近乎一致（25.7 对 25.8）(E583, E586)。解析实验用 4 层、d_model=1024 的模型，仅 WSJ 约 40K 句时词表 16K，半监督则用约 17M 句与 32K 词表 (E589)；超参数仅在 Section 22 开发集上小范围选取 (E590)，Table 4 中 WSJ-only 得 91.3 F1，半监督设置得 92.7 F1 (E593)。

## limitations

材料明确承认的局限较有限。在 English constituency parsing 上，Transformer 仍逊于 Recurrent Neural Network Grammar (E658)。机制层面，averaging attention-weighted positions 会降低 effective resolution，需由 Multi-Head Attention 补偿 (E613)；缩小 attention key size d_k 会损害质量，暗示 dot product 未必是理想的 compatibility function (E648)。此外，面向 images、audio、video 等非文本模态与 large inputs and outputs 的 local, restricted attention 仅属未来计划，尚未验证 (E663)。