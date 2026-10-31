# B106 论文问答对照题集与原文验收要点

日期：2026-10-31。状态：题集在模型响应前冻结；仅用于设计／实验，不修改插件功能。

## 冻结与输入隔离

- 题集：`.local-cache/research/B106/cases.json`，24题，四篇各6题。
- SHA-256：`4366df3386565111075b38561ed8460eba339e93894767f49c7975ce036459e9`。
- 生成模型只获得相同的原始question、固定history、同一PDF及由待比较策略选择的原文。
- `expected_facts`、`evidence`、`gold_section_ids`、`diagnostic_search_query`均为评估专用，不能用来为章节／检索路线选择上下文。否则就是oracle实验，不具备可比较性。
- 固定history只提供指代目标，不嵌入当前待回答问题的关键事实；四种路线应完全相同。
- 本题集尚未证明各题难度相同；经典论文可能被模型记忆。答案正确但无当前有效来源，必须与有原文支持的正确答案分开统计。

## 覆盖矩阵

每篇各包含：整体机制、局部模块／动机、数字与适用范围、附录细节、固定历史追问、文中无依据问题。共4道附录题、4道多轮题、4道不可答题。
不可答题使用具体而未报告的硬件部署／临床验证要求，检查源文无结果时是否编造；这些题偏明确，不能据其通过率代表所有模糊不可答问题。
附录纳入测试是为比较证据范围，不代表用户已批准产品问答自动输入附录。

## 评估建议

逐题按原子事实检查必要答案要点，不能只用回答流畅度或长度评分：

1. 原文忠实：是否符合数值、作用范围与证据强度，是否命中forbidden_claims。
2. 解疑完整：是否覆盖expected_facts，模块是否解释了输入、操作、输出和设计关系。
3. 引用支持：先检查引用ID存在且本轮输入过，再检查该处原文是否支持对应论断。别名合法不等于引用正确。
4. 不可答：应说“给定论文没有报告该项实验／无法给出该数值”，不应推导“方法不能在该设备运行”。
5. 历史处理：保留真实指代，不能将固定history或旧assistant回答当来源引用。
6. 成本：记录所有规划、改写、摘要、回答调用的输入／输出token；分别报告回答调用与整条路线总量。

JSON内evidence.quote是PDF.js normalized block以空格拼接后的连续窗口，保留page和block_ids，故可能包含断词与双栏阅读顺序噪声。gold_section_ids由这些窗口与结构化段落成员交集得出，是可审查的证据位置而非严格最小必要章节集合；邻段窗口可能跨节。检索召回应以事实所需内容为准，不能强求覆盖整个噪声窗口。

## 逐题要点

### resnet-global · 1512.03385 · global_method

这篇论文要解决的 degradation problem 和过拟合有什么不同？请完整解释 residual block 如何针对这一问题工作，而不只是说“加了跳连”。

必要要点：
- 退化现象随深度增加训练误差反而更高，不是由过拟合导致。
- 把目标映射H(x)改写为F(x)+x，层学习残差F(x)=H(x)-x。
- 恒等shortcut跳过若干层并做逐元素相加；若恒等映射合适，残差趋近零比直接拟合恒等更容易。

禁止性错误：不能说退化就是训练误差下降而测试误差升高。；不能把shortcut说成拼接或仅增加层数。

来源：PDF第1页 E1；PDF第3页 E2；PDF第2页 E3。精确原文及block ID见JSON。
证据窗口对应章节：section:2, section:5。

### resnet-shortcut · 1512.03385 · module

identity shortcut 能否直接用于任意维度？维度增加时论文具体给了哪两种处理，分别是否引入参数？

必要要点：
- 同维度可直接使用恒等shortcut。
- A方案用额外零填充处理维度增加，不增加参数。
- B方案用1×1投影卷积匹配维度，引入可学习参数。

禁止性错误：不能说所有ResNet shortcut都完全无参数。

来源：PDF第4页 E1；PDF第3页 E2。精确原文及block ID见JSON。
证据窗口对应章节：section:6, section:7, section:8。

### resnet-results · 1512.03385 · numeric_scope

论文中 4.49% 和 3.57% 的 top-5 error 是同一种评测结果吗？分别是哪种模型组合和数据划分，为什么不能直接当作单模型改进来相减？

必要要点：
- 4.49%是ResNet-152单模型的ImageNet validation结果。
- 3.57%是ensemble在ImageNet test上由测试服务器报告的top-5 error。
- 两者模型组合和划分不同，不能把差值归因于单一设计改进。

禁止性错误：不能把3.57%说成单个ResNet-152 validation结果。

来源：PDF第6页 E1；PDF第6页 E2。精确原文及block ID见JSON。
证据窗口对应章节：section:10。

### resnet-appendix · 1512.03385 · appendix

请根据附录说明 ResNet 接入 Faster R-CNN 时，RoI pooling 放在哪里，BN 如何处理，作者为何这样处理 BN？

必要要点：
- RoI pooling在conv5_1之前，conv5_x及以上在每个RoI上运行。
- ImageNet预训练后用ImageNet训练集计算各BN层均值方差。
- 目标检测微调期间固定BN统计量，不继续更新；主要为降低Faster R-CNN训练内存。

禁止性错误：不能说目标检测微调继续用每个batch更新BN统计量。

来源：PDF第10页 E1；PDF第10页 E2。精确原文及block ID见JSON。
证据窗口对应章节：section:16。

### resnet-followup · 1512.03385 · multi_turn

那它比110层更差，是否说明 residual learning 又发生了前面那种优化退化？请区分论文给出的观测和作者的解释。

固定前文：user：这里所说的超1000层模型具体是哪一个？ / assistant：我们接下来讨论论文在CIFAR-10上探索的1202层ResNet，并和110层模型比较。

必要要点：
- 指代1202层CIFAR-10网络。
- 1202层训练误差低于0.1%，论文称没有优化困难。
- 1202层测试误差7.93%而110层更低，作者把差距解释为过拟合；不能与plain网络训练误差升高混同。

禁止性错误：不能断言1202层无法收敛。

来源：PDF第8页 E1；PDF第7页 E2。精确原文及block ID见JSON。
证据窗口对应章节：section:11, section:13。

### resnet-negative · 1512.03385 · unanswerable

本文有没有实测 ResNet-152 在 NVIDIA A100 上采用 FP8 时的单张推理延迟和能耗？请给出毫秒与焦耳数。

必要要点：
- 给定论文未报告A100上的FP8推理延迟和能耗，无法提供所求数值。
- 不能用FLOPs、其他硬件或训练时间换算为该实测结果。

禁止性错误：不得编造任何毫秒／焦耳数。

无正向结果证据。全文设备／临床特征检索结果：{"A100": 0, "FP8": 0}；另人工检查论文任务与实验范围，不把字面无匹配当一般不存在证明。

### sam-global · 2304.02643 · global_method

请把 SAM 的一次交互式分割流程讲清楚：图像、提示和掩码经过哪些模块，各模块实际做什么，为什么能反复快速响应提示？

必要要点：
- 图像编码器为MAE预训练ViT，按图像计算一次embedding，可在提示前预计算。
- 提示编码器处理稀疏点／框等和稠密mask；位置与类型编码或卷积嵌入与图像特征结合。
- 轻量mask decoder结合图像和提示，通过prompt自注意力与双向交叉注意力更新embedding并预测mask。
- 复用图像embedding使反复提示的成本摊销；不是每次提示都重新跑重图像编码器。

禁止性错误：不能仅罗列三个模块而不解释输入输出。；不能把文字提示实验说成所有SAM训练都默认使用自由文本。

来源：PDF第5页 E1；PDF第5页 E2；PDF第2页 E3。精确原文及block ID见JSON。
证据窗口对应章节：section:2, section:4。

### sam-ambiguity · 2304.02643 · module

一个点可能指衣服也可能指整个人，SAM 如何避免只输出一个折中掩码？训练时怎么选 loss，推理时又如何排序？

必要要点：
- 单一输出会对多个有效mask平均；SAM对同一提示预测多个mask。
- 论文发现3个mask输出足以覆盖常见整体／部分／子部分歧义。
- 训练只反传预测mask中的最小loss。
- 为各mask预测estimated IoU置信分数用于排序。

禁止性错误：不能说训练对所有候选mask的loss求平均后反传。

来源：PDF第5页 E1。精确原文及block ID见JSON。
证据窗口对应章节：section:4。

### sam-speed · 2304.02643 · numeric_scope

论文说浏览器上大约50ms，这是否是从原始图像开始运行整个 SAM 的耗时？请说明实际计时范围和成立条件。

必要要点：
- 约50ms指已有预计算image embedding后，prompt encoder和mask decoder在浏览器CPU上的运行。
- 不包括重图像编码器从原始图像提取embedding的时间。
- 该设计支持交互提示；不能将50ms当任意硬件与任意图片的端到端保证。

禁止性错误：不能声称整套ViT-H原始图像端到端浏览器CPU固定50ms。

来源：PDF第5页 E1；PDF第5页 E2。精确原文及block ID见JSON。
证据窗口对应章节：section:4。

### sam-appendix · 2304.02643 · appendix

附录 A 中 SAM 的优化与训练 schedule 是什么？请给出 warmup、初始学习率、总步数、衰减节点和 batch size，并说明是否使用数据增强。

必要要点：
- AdamW，250次迭代线性warmup后初始lr为8e-4。
- 训练90k iterations，约2个SA-1B epochs；60k与86666步分别将lr除以10。
- batch size为256张图像。
- 不使用数据增强；不要把无增强误说成无正则。

禁止性错误：不能说每epoch衰减或训练90个epoch。

来源：PDF第17页 E1。精确原文及block ID见JSON。
证据窗口对应章节：section:18。

### sam-followup · 2304.02643 · multi_turn

那为什么不从一开始就完全自动做？第三阶段具体怎样从一张图里产生多个 mask，又怎样筛掉不可靠的结果？

固定前文：user：data engine 的三个阶段分别是什么？ / assistant：依次是 assisted-manual、semi-automatic 和 fully automatic。这里我们继续讨论最后一个阶段。

必要要点：
- 这里指data engine三阶段中的fully automatic stage，不是模型训练warmup阶段。
- 自动化建立在前阶段累积足够数据和歧义感知模型成熟基础上。
- 用32×32规则点网格提示，每点可产多个有效mask。
- 用预测IoU筛置信结果、阈值扰动稳定性筛选，再NMS去重。

禁止性错误：不能把全自动阶段说成无需先前人工标注直接从零启动。

来源：PDF第6页 E1。精确原文及block ID见JSON。
证据窗口对应章节：section:5。

### sam-negative · 2304.02643 · unanswerable

论文是否在一个前瞻性、多中心乳腺癌临床试验中验证 SAM？具体患者人数、五年生存收益和临床 Dice 是多少？

必要要点：
- 论文没有报告该前瞻性乳腺癌临床试验，无法给出人数、五年生存收益或所指临床Dice。
- 零样本分割能力或数据集评测不能等同临床有效性证明。

禁止性错误：不得虚构患者数、临床Dice或生存率。

无正向结果证据。全文设备／临床特征检索结果：{"breast cancer": 0, "five-year survival": 0, "prospective clinical": 0}；另人工检查论文任务与实验范围，不把字面无匹配当一般不存在证明。

### attention-global · 1706.03762 · global_method

不依赖 RNN 和卷积，Transformer 如何完成从输入句子到自回归输出的过程？请解释编码器、解码器三种 attention、FFN 和位置信息的作用。

必要要点：
- 编码器多层self-attention与position-wise FFN生成输入表示。
- 解码器masked self-attention不能看未来输出；encoder-decoder attention的Q来自解码器而K/V来自编码器输出。
- decoder还有position-wise FFN，随后线性层与softmax得到下一个token分布。
- 位置编码加到encoder与decoder底部embedding，使无递归结构能使用位置。

禁止性错误：不能把encoder-decoder attention的K/V说成全来自decoder。；不能说encoder self-attention也必须遮住未来输入token。

来源：PDF第3页 E1；PDF第5页 E2；PDF第6页 E3；PDF第5页 E4。精确原文及block ID见JSON。
证据窗口对应章节：section:5, section:6, section:9, section:10, section:11, section:12。

### attention-scale · 1706.03762 · module

Scaled Dot-Product Attention 为什么要除以 sqrt(d_k)？请把论文给出的尺度分析和 softmax 梯度问题连起来，不要只复述公式。

必要要点：
- d_k较大时点积幅度增大，softmax可能落到梯度很小区域。
- 在q/k各分量独立、均值0方差1的示例假设下，点积方差是d_k。
- 除以sqrt(d_k)抵消随维数增长的尺度；这是文中的动机，不是严格证明模型总最优。

禁止性错误：不能说除以d_k或为了保持向量范数严格为1。

来源：PDF第4页 E1；PDF第4页 E2。精确原文及block ID见JSON。
证据窗口对应章节：section:7, section:8。

### attention-training · 1706.03762 · numeric_scope

base 与 big 模型的训练硬件和 schedule 有什么不同？请给出每步耗时、训练步数和总时长，避免把训练速度说成推理速度。

必要要点：
- 均在一台8张NVIDIA P100机器训练。
- base每步约0.4秒，共100000步／约12小时。
- big每步约1.0秒，共300000步／约3.5天。
- 这些是指定训练设置的耗时，不是逐token推理延迟。

禁止性错误：不能将0.4秒描述为单句推理延迟。

来源：PDF第7页 E1。精确原文及block ID见JSON。
证据窗口对应章节：section:16, section:17。

### attention-appendix · 1706.03762 · appendix

附录中的 Figure 3 和 Figure 4 分别用注意力可视化说明了什么现象？它们是否足以证明所有 attention head 都会稳定学习完整语法？

必要要点：
- Figure3展示第5/6层encoder self-attention中making与more difficult之间长距离依赖示例。
- Figure4展示同层两个head似乎参与anaphora resolution，尤其its的尖锐注意力。
- 这些是示例／定性观察，不能推出所有head稳定掌握完整语法或因果证明。

禁止性错误：不得把可视化示例当作普适因果或统计保证。

来源：PDF第13页 E1；PDF第14页 E2。精确原文及block ID见JSON。
证据窗口对应章节：section:25。

### attention-followup · 1706.03762 · multi_turn

那它比 learned positional embedding 好在哪里？论文是否真的证明了更长序列上的外推优势？

固定前文：user：它没有递归结构时怎样表示词序？ / assistant：论文在encoder和decoder底部的token embeddings上加入位置编码，这里采用不同频率的正弦与余弦。

必要要点：
- 指代sinusoidal positional encoding。
- 作者比较learned embedding发现结果几乎相同。
- 选择sinusoidal是因相对偏移可表达为线性函数的假设，以及可能外推更长长度。
- 文中这一段不是对更长序列外推优越性的正式证明或专门量化结果。

禁止性错误：不能声称论文已证明sinusoidal在长序列指标显著更好。

来源：PDF第6页 E1。精确原文及block ID见JSON。
证据窗口对应章节：section:12, section:13。

### attention-negative · 1706.03762 · unanswerable

请按本文实测结果给出原版 Transformer 在 Apple M4 上处理100k-token上下文的首token延迟和每token能耗。

必要要点：
- 论文未报告Apple M4、100k上下文的该项部署实测，不能给出延迟和能耗。
- 训练P100耗时或理论复杂度不能换算成所问实测。

禁止性错误：不得编造首token延迟／每token焦耳。

无正向结果证据。全文设备／临床特征检索结果：{"Apple M4": 0, "100k-token": 0}；另人工检查论文任务与实验范围，不把字面无匹配当一般不存在证明。

### mtedit-global · 2610.23751 · global_method

MTEdit 的 PTC 数据构造从原图到多轮训练样本究竟怎么走？请解释它相对 sequential rollout 为什么可能减少漂移，以及哪些后处理保证编辑对齐。

必要要点：
- 先筛高分辨率／审美质量seed image；VLM规划编辑并生成PTC prompt。
- 闭源图像模型在共享上下文中一次生成多个编辑状态，减少逐轮复用生成图造成的误差积累。
- Gemini3.1 Pro筛坏PTC并从保留画布与源图生成每轮指令。
- 按2×2分panel为目标图，SIFT匹配＋image warping提升像素对齐。

禁止性错误：不能说通过联合训练所有编辑生成模型消除漂移。；不能省略PTC切分与对齐而把整张四格图直接当最终单帧训练目标。

来源：PDF第4页 E1；PDF第4页 E2；PDF第4页 E3；PDF第5页 E4。精确原文及block ID见JSON。
证据窗口对应章节：section:7, section:8。

### mtedit-metrics · 2610.23751 · module

MTEdit-Bench 的 IF、CC、DRS 分别在衡量什么？某一轮 IF 或 CC 低于6之后哪些分数会归零，DRS是否也归零？

必要要点：
- IF看当前编辑前图／后图／当轮指令是否遵循；CC看初始图、当前图和截至当前全部指令的内容一致性。
- 任一轮IF或CC低于6意味着轨迹失败，后续轮二者均置0。
- DRS是VisualQuality-R1和RALI分数平均，范围0到5，衡量视觉漂移鲁棒性。
- context-aware的IF*／CC*沿用失败传播，DRS永不因失败归零。

禁止性错误：不能说DRS在IF失败后也全部置0。

来源：PDF第5页 E1；PDF第6页 E2。精确原文及block ID见JSON。
证据窗口对应章节：section:9, section:10。

### mtedit-stats · 2610.23751 · numeric_scope

MTEdit 数据集和 MTEdit-Bench 不是一回事：它们各有多少轨迹／编辑对和轮数？Bench的四类任务各怎样组织样本？

必要要点：
- MTEdit为500K轨迹、2.69M编辑对，最大8轮、平均5.38轮。
- Bench step-wise含100个八轮样本。
- persistent-constraint、textual-reference、short-instruction三种context-aware子集各50个四轮样本。
- 训练数据规模不能误当benchmark规模。

禁止性错误：不能说benchmark有500K轨迹。

来源：PDF第5页 E1；PDF第5页 E2。精确原文及block ID见JSON。
证据窗口对应章节：section:8, section:9。

### mtedit-appendix · 2610.23751 · appendix

请按 Appendix A.1 说明 Qwen-Image-MTEdit 的优化器、学习率、训练步数、GPU及单卡batch设置，不要只复述它用了 teacher forcing。

必要要点：
- AdamW固定lr5×10^-5，weight decay10^-2，betas(0.9,0.999)。
- 训练20000步，32张H100 GPU，每GPU batch1。
- 使用bfloat16 mixed precision。

禁止性错误：不能说batch size32是每卡或训练20个epoch。

来源：PDF第14页 E1。精确原文及block ID见JSON。
证据窗口对应章节：section:18。

### mtedit-followup · 2610.23751 · multi_turn

那8轮样本怎么得到？这是否意味着可以一直重复下去而不会漂移，例如做到24轮？

固定前文：user：论文的默认 packed trajectory canvas 每次产生几轮？ / assistant：默认使用2×2布局，一个PTC包含四个编辑状态，对应一次四轮样本。

必要要点：
- 默认2×2 PTC一次生成4轮样本。
- 8轮把最后一轮生成图作为新source，再跑一轮pipeline。
- 附录局限明确指出扩展到例如24轮仍可能发生视觉质量漂移，不能声称无限无漂移。

禁止性错误：不能声称PTC从数学上消除任意长轨迹漂移。

来源：PDF第5页 E1；PDF第21页 E2。精确原文及block ID见JSON。
证据窗口对应章节：section:7, section:8, section:32。

### mtedit-negative · 2610.23751 · unanswerable

本文有没有测 Qwen-Image-MTEdit 在 Raspberry Pi 5 本地离线执行八轮编辑的总耗时、峰值内存和能耗？请给出数值。

必要要点：
- 给定论文未报告Raspberry Pi5的该项离线部署实测，不能提供这些数值。
- 训练硬件和API构造成本不等于边缘设备推理测量。

禁止性错误：不得编造秒数、GB或焦耳数。

无正向结果证据。全文设备／临床特征检索结果：{"Raspberry Pi": 0}；另人工检查论文任务与实验范围，不把字面无匹配当一般不存在证明。

## 范围与后续

题集依据当前缓存的四篇PDF与插件提取结果，不包含扫描版、OCR失败或真实图片解析质量对照。图表相关题仅选择caption／正文能核验的内容，不假装已经测试VLM视觉能力。四篇共24题是小规模探索，不足以证明普遍最优或模型稳定性；最终方案应保留跨类型更多论文、重复采样与用户真实疑问复测。
