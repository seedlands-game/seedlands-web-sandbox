# S2a ECS 实体 owner 接缝证据

## 范围与结论

本记录只覆盖 S2a：`EntityStore` 的稳定实体身份、类型/生命周期、位置/速度、生命、世界物品 stack 和 actor metadata 已切到每世界私有的 bitECS 0.4.0 component owner。`EntityStore` 保留原有宿主 facade、快照数组顺序、8 格派生 bucket 和 metrics；公开读取均重新组成复制投影，不暴露 EID、component ref、query view 或可变存储。

owner 为每个实例创建独立 world 与 component refs。稳定 ID 只映射到内部可回收 EID；删除后保留已发放 ID，自动分配会跳过已发放或显式保留的 ID。每次 `addEntity` 前固定 `commitRemovals(world)`，删除后立即分配不同类型实体时，旧 query/component 成员不会落到新生命周期。查询每次实际调用 bitECS `query` 并按组件内的创建顺序恢复既有稳定顺序。

`EntityLifetimeReference` 只包含 `{ entityId, epoch, lifetime }`。删除后引用失效；成功 restore 通过新候选 world 提高 epoch 后再替换，旧引用失效；坏 restore 会销毁候选并保留原 owner、bucket、引用和 metrics。恢复后把历史已发放 ID 合入新 owner，避免随后重发。

## RED

在生产 owner 与引用入口存在前执行：

```text
pnpm exec vitest run tests/server/ecs-entity-owner.test.ts tests/server/entity-store.test.ts

Test Files  2 failed (2)
Tests       2 failed | 1 passed (3)
```

- `ecs-entity-owner.test.ts` 在收集阶段因私有 owner 文件不存在失败。
- `entity-store.test.ts` 两项因 `createReference` 不存在失败，证明候选恢复与引用生命周期接缝尚未实现；复制/顺序基线仍通过。

首轮 GREEN 后补充自动身份分配反例并先取得 RED：

```text
pnpm exec vitest run tests/server/entity-store.test.ts

Test Files  1 failed (1)
Tests       1 failed | 3 passed (4)
```

失败精确证明：显式 `creature-1` 删除后，自动分配仍尝试重发 `creature-1`。实现随后改为单调推进并跳过所有已发放/保留身份。

## GREEN

S2a owner 与 facade 定向合同：

```text
pnpm exec vitest run tests/server/ecs-entity-owner.test.ts tests/server/entity-store.test.ts

Test Files  2 passed (2)
Tests       7 passed (7)
```

覆盖两世界隔离、组件初始化、世界物品与类型 query 成员、删除后立即分配、跨类型槽位清理、旧引用失效、稳定 ID 不重发、创建顺序、复制投影、坏 restore 原子拒绝、成功 restore 引用失效和派生 bucket 重建。

受影响的空间、数据写入和权威物理回归：

```text
pnpm exec vitest run tests/server/ecs-entity-owner.test.ts tests/server/entity-store.test.ts tests/server/data-plane-entity-store.test.ts tests/server/authority-entity-physics.test.ts tests/server/poi-perception.test.ts

Test Files  5 passed (5)
Tests       26 passed (26)
```

拥有文件的 lint 与格式检查：

```text
pnpm exec eslint packages/game-core/src/server/gameplay/entity-store.ts packages/game-core/src/server/gameplay/ecs-entity-owner.ts tests/server/ecs-entity-owner.test.ts tests/server/entity-store.test.ts
# exit 0

pnpm exec prettier --check packages/game-core/src/server/gameplay/entity-store.ts packages/game-core/src/server/gameplay/ecs-entity-owner.ts tests/server/ecs-entity-owner.test.ts tests/server/entity-store.test.ts
# All matched files use Prettier code style
```

core 类型检查确认 S2a 文件无错误；当前整体仍被主任务并行中的 S2b 接口接线阻塞：

```text
pnpm --filter @seedlands/game-core typecheck

TS2339: EntityStore 缺少 actorStateAccess（gameplay-runtime.ts、autonomy-runtime.ts）
TS2339: EntityStore 缺少 playerStateAccess（player-state.ts）
```

这三个接口属于主任务已声明的 S2b WIP；本子任务没有修改或伪造临时 fallback。主任务将在接管 owner/store 后组合已准备的 actor components，再运行完整 core/test 类型检查。

## 后续边界

- 本轮没有迁移 `PlayerState`、玩家 inventory/needs/equipment/control、NPC needs、`ActionRuntime`、`CombatRuntime` 或 `GameplayRuntime` owner；这些由 S2b/S2c 接入同一个 ECS world。
- 建议 S2b 不增加通用 ECS extension API：由内部 `ecs-actor-components.ts` 创建每 owner component refs，`EcsEntityOwner` 在构造、spawn/despawn 和候选 restore 路径组合它；`EntityStore` 只暴露按稳定 EntityId 的领域 state access，不向调用者交出 world/EID/ref。
- 当前 legacy V1/V2/V3 快照继续保持原实体数组格式和顺序，不写内部 EID。领域 lifetime、历史已发放 ID 与动作引用的 V4 codec 由主任务后续接入；本轮只保证当前进程内删除/恢复的引用失效与 ID 不重发。
- 未运行全量 `pnpm verify:static`、`pnpm build` 或 Browser 验收，也未做性能测量；由主任务集成 S2b/S2c 后统一验收。本实现不声称性能收益。
