# S3 生命与需求原子候选

已批准的死亡掉落与 needs 机制迁移先补真实失败链路。当前直接扣血、改需求累加器、标记死亡和清空库存后才生成掉落，ID 或结果序号耗尽会留下部分状态。先把玩家 needs 运算改为 detached 纯数据候选，生命/需求/生命周期/库存清空和有界掉落实体一次 prepared ECS 提交；Combat 取消容量与 gameplay revision 容量在 ECS apply 前检查。允许正常同步 owner 取消，不允许任意外部回调。此切片不宣称整个 gameplay tick 回滚，也不把旧隐式 needs 调用当成注册迁移完成。

RED：普通 applyDamage 致死时掉落序号不足，完整 GameplaySnapshot 不变；饥饿致死的同一步失败时 ECS needs/生命/库存原样保留；成功致死清空库存并保留物品实例，产生一次 mutation revision；非致死需求曲线保持既有时间阈值。随后实际 Combat 玩家目标改用同一候选 owner，NPC 结算和动作事件仍需独立准入。

Action 参与者补充：一次最多 128 个终态候选，全部 clone/校验 result 和原动作状态后才 apply。validate 捕获动作对象、字段与当前 actor→action 绑定；apply 只安装已准备候选、不调用 clone 端口。普通 succeed/fail/interrupt 也复用该机制，修复 result clone 失败先改 status 的旧漏洞。RED 由真实不可 clone 结果与后一个候选失败构成；不将此参与者通过当成 Combat 待命中 frontier 已完成。
