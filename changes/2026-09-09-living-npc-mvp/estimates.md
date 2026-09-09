# NPC MVP 工作量与预算

2026-09-09 实施前估算，置信度中低。传统：A1 5–9PD，A2 4–7PD，A3+集成验证3–6PD，合计12–22PD。AI 活跃工时：core Sol12–20h，认知宿主Sol8–14h，Root集成/UI/真实验收8–14h，Terra独立验收3–5h，共31–53h。两条独立实现并行，Root集成并行；预计关键路径18–30h，加CI/外部等待2–5h，连续墙钟20–35h（0.83–1.46天）。单agent无并行预计40–65h。保守活跃53×120%=64h，墙钟35×120%=42h。父合同共享64h：core24、host17、Root17、review6；不创建goal。

计费假设（未缓存/缓存/输出，M tokens）：Root Astra .25/2/.08，两个Sol合计.6/4/.2，Terra .15/.7/.04。当天官方credits/MTok：Astra250/25/1250，Sol100/10/500，Terra50/5/300。正常分别212.5、200、23，总435.5；保守两倍871，加20%建议1046 credits。速度档未知，Astra Fast若启用另乘2.5，不伪称实测。API等价费率官方compare页未返回可用报价，记unknown；禁止从credits伪造美元。

起点账户共享周已用83%，余17%，重置1789444175；额外余额511.183598 credits，reset3未使用。included分母unknown，任务预测占比unknown；1046相对余额约205%，不能推导真实现金或必然购买。用户授权自主任务不自动授权购买/reset；按阶段记录偏差。

真实DeepSeek验证采用有界样本：首轮最多12次Flash与3次Pro，每次输出上限4096，长上下文最多各一组128K/256K，估算API上限5美元（非承诺付费额度，按实际provider usage记录）；先小请求准入，失败分类而不盲重试。服务默认独立运行预算，禁止测试启动无限模型循环。用户明确授权复用Midscene环境key，不读取.env或输出key。Flash Vision仅文本，Pro仅压缩。

来源：[credits](https://learn.chatgpt.com/docs/pricing)、[API compare](https://developers.openai.com/api/docs/models/compare)、[DeepSeek价格](https://api-docs.deepseek.com/quick_start/pricing/)。各模型实际tokens/credits/API等价与任务活跃工时尚unknown；墙钟起点以创建本spec时间记录，后续回填。

### 阶段复核（2026-09-09 实施中）

账户共享周用量90%（余10%），额外余额仍511.183598 credits；这是账户范围，不能归因本任务7个百分点的变化。未购买或使用reset。A2首次独立review实际约0.5 agent小时，覆盖39/39文件并发现一项事件覆盖P1；前置CI只读分诊和修复维持review6小时共享池。当前真实模型4次Flash、2次Pro：其中一轮Flash合法返回两个只读工具，被当前宿主拒绝，列为修复RED，不盲重试。预算不扩大，后续浏览器单次测试限制6次请求；真实长窗口质量A/B尚未完成，不宣称128K相对256K有实测优势。

全历史 Pro 真实测试检出语义失败（返回工具标记而非记忆），因此重估验证样本上限为16次Flash、4次Pro，原5美元估算上限保持。新增配额仅用于该已复现失败修复及真实浏览器两轮交谈；当前累计6次Flash、3次Pro，不能把HTTP成功计为语义验收通过。活跃工时仍在原64小时共享池内。

真实浏览器首次运行已完成4次Flash、两轮有个性回应、真实跟随位移；末尾测试用 document.exitPointerLock 触发产品正常暂停，导致后续点击失败。改用已实现的 T 交流路径并修复 CSS 被起始页全局 ID 样式覆盖。当前累计13 Flash/4 Pro，为最终浏览器复验预留最多6 Flash，预算上限调整为22 Flash/4 Pro，美元估算上限仍为5美元；不增加Pro或长窗口基准。

最终本地验收回填：实际模型调用16 Flash/4 Pro，供应商usage合计输入42,825、输出15,441；按官方峰时价格估算约$0.0454，非账单。没有运行128K/256K长经历质量/时延A/B；没有购买或消费reset。Codex实际credits、API等价费用与各模型完整活跃时间没有任务级计量，继续标unknown，不能用共享账户余额变化冒充本任务支出。传统PD与保守工时为估算，不作为实际值。

GitHub复核增量后：最后一次真实Flash浏览器复验27.2秒通过，line reporter未保存内存usage附件。该轮确切调用/usage unknown、由测试约束2–6 Flash；最终总调用范围18–22 Flash/4 Pro，保持22/4上限，不再补跑provider。已有回执估价$0.0454仅为已核算部分，最终总账单unknown。世界修复约25分钟、宿主约0.35 agent小时；处于原工时池内，不从账户余额推算任务credits。

第二轮恢复修复：世界实现约12分钟，独立复核约0.28 agent小时，仍在原工时池内；未新增真实provider调用、购买或使用reset。最终Codex实际credits和API等价仍无任务级计量。

第三轮：宿主约0.20 agent小时，世界约18分钟，初始独立分诊约0.28 agent小时，冻结复核实际见round3-recheck.md；继续使用原共享工时池。无新增provider调用或reset，实际Codex消费仍无任务级计量。

分页增量：宿主约0.18 agent小时，独立冻结复核见round4-recheck.md，维持原共享池；实际浏览器使用确定性model fixture，未增加真实provider调用。

动作历史增量由Root实现；被中止的子任务没有文件输出，实际计费unknown。新增5项回归，工时沿用原共享池；无provider、购买或reset。

动作历史最终窄复核约0.12 agent小时；完整静态1253测试、Web/Agent构建和2项Browser均通过，未新增provider调用。实际任务credits/API等价仍unknown。
