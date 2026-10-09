## method

### 方法

**任务设定与总体设计.** 论文要回答的问题是:在给定固定 FLOPs 预算 C 时,应如何权衡模型规模 N 与训练 token 数 D(E175)。方法把最终预训练损失 L(N, D) 建模为 N 与 D 的函数,并把计算预算 C 视为 FLOPs(N, D) 的确定性函数,于是问题化为在约束 FLOPs(N, D) = C 下最小化 L(E177)。最优分配由 N_opt(C)、D_opt(C) 给出,即式(1)中的 argmin(E178, E179)。由于训练 token 数少于整个语料库的 token 数,分析处于无限数据机制,因此用平滑后的训练损失作为测试损失的无偏估计(E182)。

**经验数据与总体策略.** 对 N_opt、D_opt 的经验估计基于 400 多个模型,参数量从不到 70M 到超过 16B,token 数从 5B 到超过 400B,且每个模型配置都在多个不同训练长度下训练过(E180)。论文用三种互补方法做拟合:先训练一批同时改变模型规模和训练 token 数的模型,再用所得训练曲线拟合经验 scaling 估计器;三者都假定 compute 与模型规模之间是 power-law 关系(E190)。

**Approach 1:固定模型规模、改变训练 token 数.** 固定一族从 70M 到 10B 以上的模型,每个规模训练 4 个不同训练序列数的版本,即 4 种不同 cosine cycle length,得到各自的训练曲线(E203, E199)。对每个参数数 N,学习率在长度相差 16× 的 horizon 上衰减 10× 因子(E204)。流程是:对每条 run 先平滑、再插值训练损失曲线,得到该 run 从 FLOP 数到训练损失的连续映射;在 1500 个对数间隔的 FLOP 取值上,挑出损失最低的 run,从而得到从任意 C 到最省算力的 N 与 D 的映射(E204, E206)。最后拟合 N_opt ∝ C^a、D_opt ∝ C^b,得 a ≈ 0.50、b ≈ 0.50(E206, E208)。曲线平滑用窗口长度 10 步的 Gaussian smoothing(E427);D.1 给出了随模型规模变化的最大学习率设定,并采用 cosine schedule 做 10× 衰减(E424, E425)。与 Approach 2 不同,Approach 1 使用的是沿整条训练过程取得的 (N, D, L) 点(E215)。

**Approach 2:IsoFLOP profiles.** 第二种方法固定 9 个不同的训练 FLOP 预算(从 6e18 到 3e21 FLOPs),改变模型规模,只取每个点的最终训练损失(E213, E215, E219)。这一设计直接回答“给定 FLOP 预算,最优参数数是多少”(E215)。cosine cycle length 按目标 token 数/FLOP 数设置,所有被采用的损失点都落在训练的最后 15% 以内,模型规模最大到 16B(E216, E217)。对每个 FLOP 预算,把平滑后的最终损失对参数数作图,拟合抛物线以估计损失最低处的模型规模(E224, E226);随后像前一种方法一样,在 FLOPs 与 loss-optimal 的模型规模、训练 token 数之间拟合 power law(E226, E228),得 a ≈ 0.49、b ≈ 0.51(E229)。

**Approach 3:参数化损失函数拟合.** 该方法把 Approach 1 与 2 的全部最终损失建模为参数数与已见 token 数的参数化函数 L̂(N, D) = E + A/N^α + B/D^β(E231, E232)。三项分别对应:理想生成过程在数据分布上的损失(即自然文本熵);N 参数 transformer 虽训练充分仍逊于理想过程的函数逼近项;以及在数据分布样本上只做有限步优化、未训练到收敛的项(E235, E453)。其推导来自风险分解:Bayes risk、取决于假设空间大小的 functional approximation 项(在两层网络上预期正比于 1/N^{1/2}),以及对应随机一阶方法早停的 stochastic approximation 项,后者按这些方法的收敛速度缩放,下界为 1/D^{1/2}(E453, E456, E459)。

拟合做法是最小化预测 log loss 与观测 log loss 之间的 Huber loss,用 L-BFGS 求解;实现上写成 min Huber_δ(LSE(a − α log N_i, b − β log D_i, e) − log L_i),其中 LSE 为 log-sum-exp,随后令 A、B、E = exp(a)、exp(b)、exp(e)(E469, E471)。α、β、e、a、b 在一个网格上取多个初始化,并取最佳拟合以规避局部极小(E238, E473)。δ = 10⁻³:更大的 δ 会使模型过拟合小计算量区间,更小的 δ 不影响预测(E476)。拟合结果为 L(N, D) = E + A/N^0.34 + B/D^0.28,其中 E = 1.69、A = 406.4、B = 410.7(E462, E463, E464)。在 FLOPs(N, D) ≈ 6ND 约束下最小化 L̂ 可得到 efficient frontier 的闭式 power-law 形式:N_opt(C) = G(C/6)^a、D_opt(C) = G^{-1}(C/6)^b,其中 G = (αA/βB)^{1/(α+β)}、a = β/(α+β)、b = α/(α+β)(E249, E251),据此得 a ≈ 0.46、b ≈ 0.54(E252)。

**三种方法的一致性与差异.** 三种方法用不同的拟合流程和不同的已训练模型,却给出可比的预测:随计算预算增加,模型规模与训练数据量应大致等比例增加(E254, E192)。Approach 3 在大计算预算下预测更小的模型,原因之一是 frontier C → N_opt 存在经验上的负曲率,加之 Huber loss 把低计算预算点(残差更大)自动视作 outlier(E255, E259)。Table 2 汇总三种方法的 a、b,并用 bootstrap(对 80% 数据采样 100 次)给出第 10/90 百分位(E262, E266, E269);作为对照,Kaplan et al. (2020) 的对应指数为 0.73 与 0.27(E270)。

**FLOPs 计算.** FLOPs 计入 embedding 矩阵的贡献,embedding 矩阵同时计入总参数量,乘加成本用因子 2 表示(E520)。前向 pass 的贡献被逐项列出:embeddings、每层 attention(key、query、value 投影;key @ query logits;softmax;softmax @ query reductions;final linear)、dense block 以及 final logits,总前向 FLOPs = embeddings + num_layers × (total_attention + dense_block) + logits(E521, E532, E533, E534, E535)。反向 pass 假定为前向的 2 倍(E536)。与常用近似 C = 6ND 相比,不同规模下二者比值落在 0.99–1.10,不影响分析结论(E538, E539)。

**cosine cycle length 的关键假设.** 分析假定 optimally trained 模型的 cosine cycle length 与目标训练步数相匹配,并配合 10× 的学习率衰减(E391, E393, E425);实验显示 cosine cycle 若超出目标步数 25% 以上,性能会明显下降(E393, E404)。

**从 scaling 分析到 Chinchilla 模型.** 分析预测 Gopher 计算预算下的最优规模在 40B 到 70B 参数之间;论文在区间上端训练 70B 参数、1.4T token 的模型,称为 Chinchilla,它与 Gopher 消耗相同 FLOPs,但模型规模与训练 token 数不同(E286)。Chinchilla 沿用 Gopher 的模型架构与训练设置,差别为:在 MassiveText 上使用略有不同的子集采样分布以适配增加的 token 数(E290);用 AdamW 替代 Adam(E291);SentencePiece tokenizer 不做 NFKC normalisation,与 Gopher 的 token 有 94.15% 相同,对数学与化学等内容的表示尤其有帮助(E294, E591);前向与反向在 bfloat16 下计算,但在分布式 optimizer state 中保存一份 float32 的权重副本(E295)。架构上两者同为 80 层、key/value size 128、feed-forward size 固定为 4 × d_model;Gopher 为 128 heads、d_model 16,384、batch size 3M→6M token,Chinchilla 为 64 heads、d_model 8,192、batch size 1.5M→3M token,且二者都在训练中途把 batch size 加倍(E299, E301, E303)。

**训练数据构成.** Chinchilla 与全部 scaling runs 共用 MassiveText 的各子集,并给出磁盘大小、文档数与采样比例:MassiveWeb 1.9TB/604M/45%(Gopher 为 48%)、Books 2.1TB/4M/30%(27%)、C4 0.75TB/361M/10%、News 2.7TB/1.1B/10%、GitHub 3.1TB/142M/4%(3%)、Wikipedia 0.001TB/6M/1%(2%);在 1.4T token 下 MassiveWeb 与 Wikipedia 会被使用多于一个 epoch,对应 epoch 数分别为 1.24 与 3.40,其余子集不足一个 epoch(E388, E386)。

**跨数据集的一致性检验.** 在 C4 与 GitHub code 上复现 IsoFLOP 分析,得到类似结论:a ≈ 0.50/0.53、b ≈ 0.50/0.47,说明只要训练不超过一个 epoch,结果与所用数据集无关(E283, E395, E396, E414)。除模型规模与 token 数外,Chinchilla 与 Gopher 还存在优化器(AdamW vs Adam)以及在 sharded optimiser state 中保存更高精度权重这两点差别(E544)。需要指出的是,受训练成本限制,Chinchilla 并未重复训练多次(E581)。