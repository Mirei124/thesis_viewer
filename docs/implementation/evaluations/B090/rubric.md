# B090 评估口径

六篇各8项，本轮由主 agent 对照原文做定性核查并在报告逐篇记录差距，未给出总分或开展独立盲评。后续盲评可按0=缺失或错误、1=仅提及/局部解释、2=足够理解此项实际工作方式逐项评分。各组同模型、temperature=0、max_tokens=12000、JSON；A/B共用一次真实问题栏与原文前序，C独立使用人工确定的整章范围。C同时改变完整上下文、抽取器与来源组织，不能把C-B提升全部归因于段落切分。每组一次采样。

|论文|8项方法理解要点|
|---|---|
|SAM|promptable segmentation任务与歧义；image encoder及图像embedding；sparse/dense prompt encoder；mask decoder如何融合与输出mask；multiple masks及quality score；训练模拟prompt与loss；data engine三阶段操作；最终数据与zero-shot使用方式|
|3DGS|SfM输入与初始化；Gaussian各参数/SH表示；3D到2D投影及alpha合成；图像监督/优化参数/损失；clone/split触发和操作；prune及opacity处理；tile分配/depth排序/前向渲染；反向梯度与最终新视角输出|
|Transformer|序列输入输出与autoregressive生成；embedding/position；scaled dot-product QKV操作；multi-head投影/并行/合并；encoder残差归一化FFN；decoder causal self-attention与cross-attention；训练目标/优化；训练与推理区别|
|Chinchilla|固定预算N/D/L目标；训练模型/token网格与控制；Approach1训练曲线包络；Approach2 IsoFLOP极小值；Approach3参数loss拟合；预算约束下求最优及scaling；Chinchilla大模型验证设置；预测分歧和外推边界|
|Video-MME|采集层级与时长；视频筛选；QA标注及选项；独立复核与纯文本过滤；评测任务与规模；视频输入采样；audio/subtitle评测条件；评分聚合/评测协议|
|LoopVL|输入/视觉编码及projector；共享参数循环与state；高低层H/L调度及连接；2D-RoPE/PrefixLM机制；视觉语言alignment；mid-training；SFT及visual RL目标；训练与推理循环/输出关系|

另外逐篇检查：新增事实是否有原文支持、公式是否误读、引用alias是否合法、是否把作者主张变成已验证事实。引用合法不等于蕴含正确。记录格式、输入/输出token、缓存命中与时间，不用回答变长本身作为质量指标。
