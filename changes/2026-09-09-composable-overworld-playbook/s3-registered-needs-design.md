# S3 注册 Needs 实际消费者

默认 Playbook 显式选择 Needs 标准模块与 Overworld Ruleset 的 needs 规则贡献。模块提供 world-target every-advance system、advance-needs operation 和 5 个至多 128 actor 的状态分片；不选择此 provider 的组合世界不运行旧隐式 player/NPC needs 分支。

分片仅包含稳定 lifetime reference、player/autonomous 类别、mode、health/maxHealth/lifecycle 和 needs 字段；不将库存或完整 EntityStore 暴露给需求计算。宿主依当前 player + retained autonomous actor 的 EntityId 稳定排序生成有界成员表，超过 640 明确拒绝，不截断。每个候选保持成员、引用与只读字段不变；玩家饥饿、治疗和饥饿死亡沿既有阈值，NPC deficit hunger 沿 5 秒阈值。NPC 在本模块不新增伤害或死亡语义。

Ruleset before 观察当前 immutable Ruleset revision，提供当前规则定义拥有的 profile 和启用模式；after 验证被免除的候选未改变需求和生命。operation 本身只运行标准需求计算，不写死 creative 判断。Host state port 将候选与最新 ECS 完整 actor 数据合并；死亡清空实际 24 格库存并准备掉落，使用共享 allocator mutation series，另将 Combat/Action 取消参与者完整预备后统一 apply，一次 revision/fact。No-Needs 组合不创建 state/system，也不消费旧 NPC needsAccumulator；旧 V1–V3 迁移在 detached 恢复候选内将原 NPC needsAccumulator + stepAccumulator 转为各 retained actor 的 needs phase，并清零不再消费的全局 needsAccumulator；V4 继续保留各 actor 现有 phase。

RED：真实 composed runtime 的 needs system 产生状态改变；移除模块后长时间推进不改变 needs；创造/生存同世界互不串扰；0.4 保存恢复加0.6与连续1一致；多个分片同时饥饿致死而最后掉落耗尽时全 ECS、Combat/Action、revision/fact 不变。
