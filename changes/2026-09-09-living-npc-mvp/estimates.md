# NPC MVP 工作量与预算

2026-09-09 实施前估算，置信度中低。传统：A1 5–9PD，A2 4–7PD，A3+集成验证3–6PD，合计12–22PD。AI 活跃工时：core Sol12–20h，认知宿主Sol8–14h，Root集成/UI/真实验收8–14h，Terra独立验收3–5h，共31–53h。两条独立实现并行，Root集成并行；预计关键路径18–30h，加CI/外部等待2–5h，连续墙钟20–35h（0.83–1.46天）。单agent无并行预计40–65h。保守活跃53×120%=64h，墙钟35×120%=42h。父合同共享64h：core24、host17、Root17、review6；不创建goal。

计费假设（未缓存/缓存/输出，M tokens）：Root Astra .25/2/.08，两个Sol合计.6/4/.2，Terra .15/.7/.04。当天官方credits/MTok：Astra250/25/1250，Sol100/10/500，Terra50/5/300。正常分别212.5、200、23，总435.5；保守两倍871，加20%建议1046 credits。速度档未知，Astra Fast若启用另乘2.5，不伪称实测。API等价费率官方compare页未返回可用报价，记unknown；禁止从credits伪造美元。

起点账户共享周已用83%，余17%，重置1789444175；额外余额511.183598 credits，reset3未使用。included分母unknown，任务预测占比unknown；1046相对余额约205%，不能推导真实现金或必然购买。用户授权自主任务不自动授权购买/reset；按阶段记录偏差。

真实DeepSeek验证采用有界样本：首轮最多12次Flash与3次Pro，每次输出上限4096，长上下文最多各一组128K/256K，估算API上限5美元（非承诺付费额度，按实际provider usage记录）；先小请求准入，失败分类而不盲重试。服务默认独立运行预算，禁止测试启动无限模型循环。用户明确授权复用Midscene环境key，不读取.env或输出key。Flash Vision仅文本，Pro仅压缩。

来源：[credits](https://learn.chatgpt.com/docs/pricing)、[API compare](https://developers.openai.com/api/docs/models/compare)、[DeepSeek价格](https://api-docs.deepseek.com/quick_start/pricing/)。各模型实际tokens/credits/API等价与任务活跃工时尚unknown；墙钟起点以创建本spec时间记录，后续回填。
