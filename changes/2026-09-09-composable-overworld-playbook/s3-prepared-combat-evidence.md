# S3 Prepared Combat frontier 证据

## 结果

CombatRuntime 新增 host-only detached mutation frontier。组合宿主可以先推进逻辑时间并取得 durable pending hit，再与 ECS、World、Action participant 一起验证和同步安装。prepared advance 不调用 `applyDamage`；resolve 以 pending token 精确消费一次，并继续使用冻结的 logical remainder。actor/target cancellations 与 resolve 在同一 candidate 中组合，因此末尾容量失败不会留下部分 Combat 状态或事件。

V3 checkpoint 在每个 combat entry 保存 `pendingHit`。恢复会先完整校验 descriptor、shape、token、active phase/dedupe、definition/damage、actor/target lifetime 和 durable origin，再将 identity rebind 到当前 epoch。坏 accessor 或不一致 pending 在替换 live frontier 前拒绝。

## RED / GREEN

RED 命令：

```text
pnpm exec vitest run tests/server/prepared-combat-frontier.test.ts
```

实现前为 `1 file / 5 tests failed`，共同的首个可执行失败为 `TypeError: runtime.prepareMutation is not a function`。覆盖用例已先于生产实现写入。

GREEN：

```text
pnpm exec vitest run tests/server/prepared-combat-frontier.test.ts \
  tests/server/combat-durable-origin.test.ts \
  tests/server/combat-identity-restore.test.ts \
  tests/server/combat-lethal-recovery.test.ts
# 4 files / 29 tests passed

pnpm --filter @seedlands/game-core typecheck
# passed

pnpm exec tsc -p tsconfig.test.json --noEmit --pretty false
# passed

pnpm exec eslint \
  packages/game-core/src/server/gameplay/combat-runtime.ts \
  packages/game-core/src/server/gameplay/combat-runtime-snapshot.ts \
  packages/game-core/src/server/gameplay/prepared-combat-mutation.ts \
  packages/game-core/src/server/gameplay/combat-pending-hit.ts \
  tests/server/prepared-combat-frontier.test.ts
# passed
```

定向测试证明：放弃 prepared plan 不改变 live Combat 且不造成 damage；prepare + resolve 与 direct timing/result 等价，包括 recovery remainder、buffered 第二击与 lifecycle completion；stale/reused plan、错 token/重复 token 拒绝；pending V3 跨 epoch 恢复后只消费一次；坏 pending accessor 原子拒绝；resolve 加 target cancellation 的末尾 allocator capacity failure 不改变 snapshot 或 event queue。

## 集成 API

```ts
combat.prepareMutation(input: PreparedCombatMutationInput): PreparedCombatMutation;
combat.peekPendingHits(): readonly CombatPendingHit[];
combat.peekLifecycleEvents(): readonly CombatLifecycleEvent[];
combat.acknowledgeLifecycleEvents(count: number): void;
```

`PreparedCombatMutation` 暴露 `{ pendingHits, lifecycleEvents, validate(), apply() }`。两个数组都是 candidate apply 后的完整冻结队列视图；`lifecycleEvents` 包括之前尚未 acknowledge 的队首事件。协调器应先 prepare 全部 owner，再 validate 全部 owner，最后同步 apply；Action settlement 可由完整 lifecycle 队列预备，所有 participant 成功后再按队首精确 count acknowledge。

`CombatPendingHitResolution` 为 `{ token, outcome: 'hit' | 'miss', damage, reason? }`。mutation 固定按 resolve → actor cancellations → target cancellations → advance 组合。单次 cancellation IDs 合计、Combat frontier、pending hits 各自最多 1024，覆盖 128 player + 512 retained autonomous actor 的既有规模上限。

## 边界

- root 负责 registered damage operation、ECS/World/Action 多 owner coordinator 和实际 host drain loop；本 slice 未声称这些产品接缝已由本文件验证。
- legacy `advance()`、`cancelActor()`、`cancelTarget()` 与 `takeLifecycleEvents()` 保持直接路径。prepared `apply()` 不调用 callback，也不会在其他 owner 已提交后重验它们。
- legacy `request()` 对 zero-windup melee definition 仍可立即进入 direct hit。组合宿主若开放 zero-windup 注册定义，需要单独的 prepared request/scheduling 接缝；不能假设 `prepareMutation` 会回收 request 阶段已经产生的 hit。
- 未运行 full static/build、Browser 或性能测试，符合本子任务禁区；root 的全局串行验收负责这些层级。
