# S3 有界世界状态分片

真实注册 needs/Combat 系统保持 world target，不增加实体 cadence。为有界 state owner 增加显式 `ModStateDefinition.partitions` 与 `ModStateAddress.partition`：只有声明分片的 world state 才接受分片地址，非负安全整数且小于声明数量；未分片 state 禁止带 partition。数量 1..128，进入组合 checkpoint identity。授权仍针对原 world resource，分片不授予额外权限。

分片是同一个权威 owner 的有限投影，不是独立世界或复制整份 ECS。一次 registered operation 可以读取多个分片，仍在既有 128-address transaction 预算内；跨分片修改由 owner 全部准备、全部校验后统一提交一次 revision/fact。此基础不承诺掉落分配跨多个 allocator plan 可直接组合，needs 致死与 Combat 结算须单独准入完整参与者。

RED：world partition 0/1 的读取不能串值或去重为同地址；负数/小数/越界/缺失 partition、entity target 和未声明分片地址在 owner.read 前拒绝；分片数量变化必须改变组合 identity。

Needs 致死采用同一 ECS owner 的 mutation series：至多 192 段、每段 1..128 entries；整条 series 共享捕获的 owner/epoch/allocator frontier，统一分配全部 ID 和构建所有候选，全部 validate 后再单次 apply。不得把独立 prepareMutation 结果依次执行，因为首个 spawn 会使后续计划失效。段只是输入与预算边界，不构成提前提交点；全 series 最多 24576 entries。它覆盖 640 个有界 needs actors 加各最多 32 个库存掉落；超限在首次写入前拒绝。单操作仍限 128，公开 mod-api 不暴露 host allocator。

规则的 after 阶段新增 `state.readOriginal(address)`：仍校验同一资源 read 权限、复用同一次 revision 观察，但返回未被候选 write 覆盖的独立只读值副本。用于验证免除角色和不可变字段，避免另造一份 baseline state owner；候选关闭后同样禁止读取。
