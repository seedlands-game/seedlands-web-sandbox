# S3 Prepared Combat request 证据

## 结果

CombatRuntime 新增 host-only `prepareRequest()`。它复用现有 detached Combat frontier，在 prepare 阶段完成 definition、result/action capacity、actor/target availability 与 lifetime、origin policy、cooldown/combo window、buffer 和 `validateHit` 检查。成功 plan 的 apply 只安装 candidate，不调用 callback；rejection、放弃或 stale plan 都不改变 live map、allocator 或 event queue。

zero-windup request 在 candidate 中直接形成 durable pending hit。prepare 与 apply 都不会调用 `applyDamage`，后续只能用既有 `prepareMutation({ resolveHit })` 的精确 token 消费一次。

## API

```ts
combat.prepareRequest(input: PreparedCombatRequestInput): PreparedCombatRequestResult;

type PreparedCombatRequestResult =
  | { success: false; reason: string }
  | {
      success: true;
      result: { success: true; actionId: string; buffered: boolean };
      pendingHits: readonly CombatPendingHit[];
      lifecycleEvents: readonly CombatLifecycleEvent[];
      validate(): void;
      apply(): void;
    };
```

输入为 `{ actorId, targetId, definitionId, origin, actionId? }`。外部 `actionId` 必须 trim 后非空、最多 256 字符，且不能占用 `combat-<ordinal>` 内部 namespace。buffer request 若传 actionId，只能等于 current action。没有外部 ID 的新请求才推进 detached Combat allocator。

成功分支的 `pendingHits` 与 `lifecycleEvents` 是 apply 后完整冻结队列，和 `prepareMutation()` 的队列语义一致。

## RED / GREEN

RED：

```text
pnpm exec vitest run tests/server/prepared-combat-request.test.ts
# 1 file / 4 tests failed
# TypeError: combat.prepareRequest is not a function
```

GREEN：

```text
pnpm exec vitest run \
  tests/server/prepared-combat-request.test.ts \
  tests/server/prepared-combat-frontier.test.ts \
  tests/server/combat-durable-origin.test.ts \
  tests/server/combat-identity-restore.test.ts \
  tests/server/combat-lethal-recovery.test.ts
# 5 files / 33 tests passed

pnpm --filter @seedlands/game-core typecheck
# passed

pnpm exec tsc -p tsconfig.test.json --noEmit --pretty false
# passed

pnpm exec eslint \
  packages/game-core/src/server/gameplay/combat-runtime.ts \
  packages/game-core/src/server/gameplay/prepared-combat-mutation.ts \
  packages/game-core/src/server/gameplay/combat-request-candidate.ts \
  tests/server/prepared-combat-request.test.ts
# passed
```

定向用例证明：zero-windup 无 damage 并只 resolve 一次；rejection、abandoned 和 stale plan 不消耗 allocator；外部 Action ID 不推进 Combat allocator，后续内部 ID 仍从原 high-water 分配；combo-window rejection 与 legacy 规则一致；buffered origin 与 current origin 独立并进入第二击 pending。

## 边界

- prepared request 明确要求 host-bound identity、durable origin 与当前 validation port。legacy standalone runtime 继续使用 `request()`，其 zero-windup 即时 damage 行为未改变。
- root 负责 ActionRuntime prepared start、registered operation、host origin 捕获与跨 owner apply 顺序；本 slice 未修改或声称验证这些路径。
- 一次 request candidate 只创建或 buffer 一个 Combat step；批量注册调度由 root 在现有 1024 frontier 上协调。
- 未运行 full static/build、Browser 或性能采样，符合合同禁区。
