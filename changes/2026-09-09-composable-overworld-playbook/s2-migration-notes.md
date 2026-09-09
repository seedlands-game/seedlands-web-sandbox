# S2 存档与动作迁移定位

以下是对当前源代码的只读定位，不是运行时验收。原有规则和测试在实施中继续适用，获批补充合同明确改变的行为须增加对应 fixture。

- `gameplay-snapshot.ts` 先读取 V1/V2/V3；V1 补空 simulation，V1/V2 迁移脚底坐标。player/entity 必须一一对应，候选 AutonomyRuntime 校验 simulation/actions/combat。
- `gameplay-runtime.ts` 当前先构造候选，再替换 entities/players/time/simulation；ECS 接线后必须让所有新 facade 绑定已提交的 owner，不能保留候选世界的 PlayerState 引用。
- `EntityStore.restore` 原来 clear 后逐个 spawn，非法后续实体会留下半恢复状态；S2a 改为独立候选校验后一次替换。
- `ActionRuntime.restore` 验证动作和每 actor 至多一个非终态动作，但旧格式只存稳定字符串 ID。S2c 需补 actor/target lifetime 与 session epoch 的接收和执行校验。
- `AutonomyRuntime.restore` 校验实体/archetype，旧版无 combat 快照的攻击保留 restore-cancelled；CombatRuntime 原先取消活动攻击并保留冷却/结果。获批新格式须保持合法阶段、剩余时间和去重结果，不能无差别套用旧取消行为。
- AuthoritySession/AuthorityRuntime 已有 LogicIntent epoch gate，session-protocol 有 epoch/序列/事务去重。必须保留，并在候选替换时撤销旧控制和路径/逻辑结果。

优先回归：`gameplay-snapshot-migration.test.ts`、`gameplay-foundation.test.ts`、`action-runtime.test.ts`、`authority-actor-rules.test.ts`、`authority-checkpoint-restore.test.ts`、`game-save-persistence.test.ts` 和 `tests/runtime/session-protocol.test.ts`。还需新增各版本非终态/终态、缺失目标、同名生命周期变化、恢复继续执行且不重复结算 fixtures。
