## method

方法以图像和任意分割提示为输入，输出有效 segmentation mask；在 prompt 有歧义时 SAM 可给出多个 valid masks 及 confidence scores。E020 E033
方法范围围绕 promptable model 与 data engine 展开。E012 E014
promptable segmentation task 将 prompt 定义为点、box、mask 或 free-form text 等指示分割对象的信息；valid mask 允许歧义 prompt 至少对其中一个物体合理。E015
该任务既作 pre-training objective，也通过 prompt engineering 迁移下游。E021 E022
SAM 由 image encoder、flexible prompt encoder、fast mask decoder 组成，目的是把同一 image embedding 复用给不同 prompt。E035 E016
image encoder 使用 MAE 预训练的 Vision Transformer (ViT) 并做少量高分辨率适配，对每张图像只运行一次得到 image embedding，因此可在 prompting 之前预计算。E036
prompt encoder 处理 sparse 与 dense 两类提示：points、boxes 用 positional encodings 与各 prompt type 的 learned embeddings 相加，free-form text 用 CLIP 的 off-the-shelf text encoder；mask 这类 dense prompt 经 convolutions 嵌入并与 image embedding 逐元素相加。E037
mask decoder 把 image embedding、prompt embeddings 与一个 output token 映射为 mask；其 modified Transformer decoder block 做 prompt self-attention 以及 prompt-to-image 与 image-to-prompt 双向 cross-attention，两个 block 后上采样 image embedding，由 MLP 将 output token 变为 dynamic linear classifier，在每个图像位置输出 mask foreground probability。E038
为处理歧义，SAM 对同一 prompt 预测多个 mask（3 个足以覆盖 whole、part、subpart 这类嵌套），训练时只对 loss 最小的 mask 反传，并预测每个 mask 的 confidence score（estimated IoU）用于排序。E039 E040
训练目标用 focal loss 与 dice loss 的线性组合；对每个 mask 随机采样 11 轮 prompts 模拟 interactive 设置，以 mixture of geometric prompts 监督，使模型适配 data engine 的交互使用，text prompt 训练另见后文。E041
推理时先算好 image embedding，prompt encoder 与 mask decoder 只需在该 embedding 上按新 prompt 查询，可在 web browser CPU 上约 50ms 出 mask，实现 amortized real-time interactive prompting。E040 E033
由于 segmentation masks 不像网页文本那样天然充足，data engine 采用 model-in-the-loop，在模型辅助标注与用新数据改进模型之间迭代。E014 E017
它分三阶段：assisted-manual 由标注者在浏览器交互工具中点击前景/背景点并用 brush/eraser 修 mask，模型实时辅助。E043 E044
semi-automatic 先用在前阶段 mask 上训练的 bounding box detector 以 generic “object” 类别找出 confident masks，标注者再补标剩余物体并周期性用新数据重训。E046
fully automatic 用 32×32 规则前景点网格提示 ambiguity-aware 模型，使点落在 part/subpart 时返回 subpart、part 与 whole，再用 IoU prediction module 选 confident masks，以概率图在 0.5−δ 与 0.5+δ 阈值下结果相似来判 stable mask，并以 NMS 去重，另处理重叠的 zoomed-in crops 以改善小物体。E046 E048
最终汇成 SA-1B，用于训练 SAM。E043 E017