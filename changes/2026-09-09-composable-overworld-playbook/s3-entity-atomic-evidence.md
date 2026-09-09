# S3 EntityStore 预备事务参与者证据

## result

已实现单 `EntityStore`、有界、宿主内部的预备事务参与者。它在 prepare 阶段完成 actor 全组件、health、world-item stack/instance、位置、ID 和 allocator 容量校验；`validate()` 检查 owner/epoch/sequence、lifetime/order high-water、精确 lifetime reference 以及 touched entity/actor 全快照新鲜度；`apply()` 只安装已经验证且已从调用者输入隔离的候选，并在执行前再次检查新鲜度。

本切片没有分配候选 ECS world、没有替换 world epoch。成功提交后 untouched reference 与被更新 actor 的 lifetime reference 继续有效；participant 在 apply 尝试后关闭，不能重用。

## changes

- `prepared-entity-mutation.ts`：增加 `PreparedActorReplacement`、`PreparedWorldItemSpawn`、`PreparedEntityMutationInput/Result`、`PreparedEntityMutation` 和入口 `prepareEntityMutation(store, input)`。总 entries 限制为 `1..128`，actor/despawn 需要完整 `EntityLifetimeReference`，`spawnIds` 在 prepare 阶段确定。
- `entity-store.ts`：增加 `prepareMutation(input)` 以及单 actor 的 `actorComponentSnapshot(id)` 转发；内部 host port 只允许 participant 读当前 owner/sequence、规范化 world-item，并在 apply 内更新本地 buckets/sequence。
- `ecs-entity-owner.ts`：增加 lifetime/order capacity preflight、prepared world-item installation、prepared actor component installation 和 order high-water 读取。普通 create/restore 仍保留原验证路径。
- `ecs-actor-state.ts`：将 actor component restore 拆为 `prepareActorComponentSnapshot` 和 `installPreparedActorComponentSnapshot`。Inventory 与 item instance、needs/equipment/lifecycle/control、mode facets、player spawn/break action 全部先验证和复制，再进行第一次写入；普通 restore 复用同一路径。

稳定调用面：

```ts
const prepared = prepareEntityMutation(store, {
  actors: [{ reference, health, components }],
  despawns: [worldItemReference],
  spawns: [{ position, physicsVelocity, stack }],
});

prepared.spawnIds;
prepared.validate();
const result = prepared.apply();
```

协调器必须先 prepare 所有 owner participant，再 validate 所有 participant，随后在没有交错状态修改的同步阶段逐一 apply。`EntityStore.actorComponentSnapshot(id)` 可用于构造 actor 的完整 replacement candidate，无需导出或扫描整个 world。

## validation

真实 RED：新增测试首次运行时 suite 在加载阶段失败，错误为找不到 `server/gameplay/prepared-entity-mutation`；当时 `0 tests` 执行，证明新入口和行为尚不存在。

实现后的定向证据：

- `pnpm exec vitest run tests/server/prepared-entity-mutation.test.ts`：`1 file / 8 tests` 通过。覆盖 actor health/Inventory + despawn + drop batch；调用者输入随后修改不泄漏；最后一个坏 durability candidate 和 lifetime capacity 在零写入时失败；精确 retained Inventory handle 在 validate 后修改使 apply stale 且不产生 spawn；owner/epoch restore 后拒绝；duplicate/conflict/retired/oversized/sequence-exhausted/未 validate/reuse 拒绝；普通 actor restore 遇到末尾坏 player break action 不部分写入。
- `pnpm exec vitest run tests/server/prepared-entity-mutation.test.ts tests/server/ecs-entity-owner.test.ts tests/server/entity-store.test.ts tests/server/ecs-component-snapshot.test.ts tests/server/data-plane-entity-store.test.ts`：`5 files / 23 tests` 通过，包含上述 8 项 participant/restore 测试和既有 owner/store/component/data-plane 回归。
- 根任务接入实际 drop/pickup 后的日志 `/tmp/seedlands-s3-atomic-inventory-green.log` 已读回：atomic inventory、inventory interaction、item instance owner、gameplay content integration、foundation、survival 共 `6 files / 38 tests` 通过。这证明当前 consumer 能使用稳定 API；不替代多 owner 协调器或 Browser 验收。
- `pnpm --filter @seedlands/game-core typecheck`：通过。
- `pnpm exec tsc -p tsconfig.test.json --noEmit`：通过。
- 对 4 个 owned source 与 owned test 执行 ESLint：通过，零 error/warning。
- 对 owned source/test/design/evidence 执行 Prettier check：通过。

## unverified

- 根任务拥有的多 owner coordinator、World edit、Combat、GameplayRuntime、needs module 与 Browser 产品接线不属于本切片；这里没有宣称它们已完成或原子。
- `apply()` 的安全前提是根协调器已经 validate 全部 participant，且 validate 与同步 apply 阶段之间不存在合法的交错写入。跨 owner rollback 不由本 participant 提供。
- 没有运行完整 workspace static/build、Browser 或性能采样；合同禁止以本切片执行这些门禁或作相关声明。
