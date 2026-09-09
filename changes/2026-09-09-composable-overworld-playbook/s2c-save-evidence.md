# S2c 组件与身份 checkpoint codec 证据

## 范围与结论

本记录只覆盖 S2c 存档接缝。`GameplayRuntime` 现在只写 `GameplaySnapshotV4`：顶层保留 revision、Gameplay/world time、坐标/物理 schema 与 simulation，实体状态集中在 `entityStore` component checkpoint，不再重复写 `players`。checkpoint 写稳定 EntityId、领域 lifetime、allocator high-water、当前进程已发放 ID、领域实体投影和 actor facets，不写 bitECS EID、component ref 或内部数组。

`EntityStore.exportComponentSnapshot()` 保存玩家与 NPC 的 health/lifecycle、needs 及 accumulator、inventory、equipment、control source；玩家另存 spawn position 与 break action。`restoreComponentSnapshot()` 先验证身份集合、lifetime 唯一性、已发放 ID、实体和 actor facets，再在新 bitECS world 中建立候选 owner、bucket 与组件；全部成功后才替换 live owner。成功恢复保留存档中的领域 lifetime、提高 runtime epoch，并把存档与当前进程的已发放 ID 及 lifetime high-water 合并，因此旧引用失效且已退休稳定 ID 不会再次发放。失败候选会销毁，不修改 live world、facets、inventory、identity 或 simulation/action 状态。

候选资源生命周期也显式闭合：`validateGameplaySnapshot` 对成功和失败路径都在 `finally` 中调用临时 `EntityStore.dispose()`，后者清除 component slots 并经 `EcsEntityOwner.dispose()` 调用 bitECS `deleteWorld`；被 live restore 替换的旧 owner 与 `restoreComponentSnapshot` 内失败的候选同样显式 dispose。临时 `AutonomyRuntime` 没有独立平台资源或全局注册，它只随函数局部引用释放。

V4 校验先在候选 `EntityStore` 恢复身份 metadata 与 actor components，再创建带该身份端口的 `AutonomyRuntime` 校验 Action/Combat v2 引用。实际安装也先替换 EntityStore，再恢复 simulation，使保存的 lifetime 能绑定到新 epoch。V4 的 identity-bound combat 保留合法 phase；真实 V1/V2/V3 fixture 仍走显式迁移，旧 combat v1 保持 restore-cancelled/legacy cooldown 语义。

## RED

在 production component checkpoint API 存在前执行：

```text
pnpm exec vitest run tests/server/ecs-component-snapshot.test.ts

Test Files  1 failed (1)
Tests       2 failed (2)
```

两项分别因 `EntityStore.exportComponentSnapshot` 与 `restoreComponentSnapshot` 不存在失败，证明领域 lifetime、allocator 和 actor facets 尚无 component codec，也没有坏 facet 的候选恢复边界。

加入 Gameplay V4 合同后，在 runtime 仍只写 V3 时执行：

```text
pnpm exec vitest run tests/server/ecs-component-snapshot.test.ts -t 'GameplaySnapshot V4'

Test Files  1 failed (1)
Tests       2 failed | 2 skipped (4)
```

两项精确失败于新快照仍为 version 3 且没有 `entityStore`，证明顶层 V4 codec、NPC component 往返和 V4 原子拒绝尚未实现。

## GREEN

最终拥有范围的定向测试：

```text
pnpm exec vitest run tests/server/ecs-component-snapshot.test.ts tests/server/gameplay-snapshot-migration.test.ts tests/server/gameplay-foundation.test.ts tests/server/game-save-persistence.test.ts tests/server/gameplay-command-persistence.test.ts

Test Files  5 passed (5)
Tests       37 passed (37)
```

覆盖：

- component checkpoint 往返玩家/NPC inventory、needs/accumulator、equipment、control、health/lifecycle、spawn/break、速度与稳定 identity；序列化结果不含 EID/component ref。
- 成功恢复保持领域 lifetime、提高 epoch、使旧引用失效，并保留保存前及保存后当前进程中已退休的 ID；自动 allocator 不重发它们。
- 坏 item/facet、缺 actor component、坏 schema 与非有限数值均在候选阶段拒绝，live snapshot、引用、inventory 和 simulation 保持不变。
- V1/V2 legacy 坐标只迁移一次；真实 V3 fixture 保留速度、玩家状态、NPC actor 与 legacy Action/Combat 行为；迁移后的 V4 再往返不二次迁移。
- V4 identity-bound Combat 在 windup/hit/buffered combo 中恢复原 phase；已结算伤害不重放，剩余 hit 各结算一次。旧 V3 无 combat codec 的 cooldown 仍迁入 combat owner。
- `FrozenGameSaveSnapshot` 与保存 runtime 的类型升级到 V4；冻结 token 与 live state 不共享引用，失败保存不推进 ACK 的既有持久化回归保持通过。

core 与测试类型检查：

```text
pnpm --filter @seedlands/game-core typecheck
# exit 0

pnpm exec tsc -p tsconfig.test.json --noEmit
# exit 0
```

拥有文件 lint 与格式检查：

```text
pnpm exec eslint <S2c owned TypeScript files>
# exit 0

pnpm exec prettier --check <S2c owned TypeScript files>
# All matched files use Prettier code style
```

## 仍未验证与后续依赖

- V4 尚未写入锁定的 Pack/module/Playbook 组合身份；这是 S3 composition codec 的明确待办，当前 checkpoint 不能证明恢复世界使用同一玩法组合。
- ActionRuntime、CombatRuntime 与 Authority/Autonomy identity port 的实现由其他互斥 owner 完成；本记录只声明本定向 suite 实际覆盖到的 Gameplay V4 phase/rebind 行为，不把它扩张为这些模块的独立完整验收。
- 本子任务没有运行全量 `pnpm verify:static`、`pnpm build`、Browser 验收或性能测量；由主任务接管文件后统一运行。本实现不声称性能收益。
