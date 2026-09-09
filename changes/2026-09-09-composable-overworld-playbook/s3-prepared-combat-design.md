# S3 Prepared Combat frontier 设计

## API 与边界

保留 `advance()`、`cancelActor()`、`cancelTarget()` 和 `takeLifecycleEvents()` 的 legacy 直接行为。组合宿主使用新增 host-only API：

```ts
type PreparedCombatMutationInput = Readonly<{
  advanceSeconds?: number;
  resolveHit?: CombatPendingHitResolution;
  cancelActorIds?: readonly string[];
  cancelTargetIds?: readonly string[];
  exceptActorId?: string;
  actorCancellationReason?: string; // 默认 attacker-dead
  targetCancellationReason?: string; // 默认 target-missing
}>;

type PreparedCombatMutation = Readonly<{
  pendingHits: readonly CombatPendingHit[];
  lifecycleEvents: readonly CombatLifecycleEvent[];
  validate(): void;
  apply(): void;
}>;

combat.prepareMutation(input): PreparedCombatMutation;
combat.peekPendingHits(): readonly CombatPendingHit[];
combat.peekLifecycleEvents(): readonly CombatLifecycleEvent[];
combat.acknowledgeLifecycleEvents(count: number): void;
```

单次输入只允许一个 `resolveHit`，actor/target cancellation ID 合计、Combat frontier 与 pending hits 分别最多 1024。该边界覆盖 128 个玩家加 512 个 retained autonomous actor 的合法满规模场景，并保留明确的有界上限。空 active cancellation 可形成合法 no-op candidate。root 必须循环处理 pending，直到 `peekPendingHits()` 为空后才保存稳定 frontier；每次 resolve 可能因为保留的 logical remainder 立即产生下一 due hit。

## Detached candidate

prepare 捕获当前 Combat frontier 签名，并深复制 combatant map、allocator、pending hit 和 lifecycle event queue。所有可能失败的工作只作用于该 candidate：

- 参数、重复 ID、result capacity 与 transition bound；
- actor/target lifetime、actor/target availability；
- durable origin actor/lifetime 与当前 policy rebind；
- `validateHit` callback。

`applyDamage` 不在 prepared 路径调用。`validate()` 只比较当前 Combat frontier；`apply()` 在第一处写入前再次比较同一 Combat frontier，然后一次安装预构造 map/scalars/events。它不调用 callback，也不重验可能已经由协调器提交的 ECS/World/Action owner。

同一 Combat owner 的 resolve、actor cancellation 和 target cancellation必须放进一个输入，按 resolve → actor cancellation → target cancellation 组合到同一 candidate，不能创建相互 stale 的独立计划。

## Pending hit

windup 到期时，prepared advance 在命中前完成 identity/origin/validateHit 校验。可直接确定的 miss/cancelled result 在 candidate 内记录；需要实际 damage 的命中冻结为：

```ts
type CombatPendingHit = Readonly<{
  version: 1;
  token: string;
  actorId: string;
  actionId: string;
  definitionId: string;
  targetId: string;
  comboStep: number;
  baseDamage: number;
  remainingSeconds: number;
  actorIdentity: EntityLifetimeReference;
  targetIdentity: EntityLifetimeReference;
  origin: DurableExecutionOriginV1;
}>;
```

对应 active 停在 `windup` 结束点。`remainingSeconds` 保存本次 advance 尚未消费的逻辑时间。resolve 必须匹配唯一 pending token，提交宿主已获得的 `hit | miss` 最终 damage/reason，消费 token 一次，写 result 后从 remainder 继续推进；因此可以跨 hit/recovery、完成 lifecycle，或进入 buffered step 并产生下一个 pending hit。

## Event queue

prepared plan 的 `lifecycleEvents` 是 candidate 完整队列的冻结副本，root 可先据此 prepare `ActionRuntime.prepareSettlements`，不会像 `takeLifecycleEvents()` 那样提前破坏 Combat。所有 participant 成功 apply 后，root 用精确 count acknowledge 已结算的队首事件。ack 会改变 Combat frontier，使旧 plan stale。

## V3 checkpoint

V3 combatant entry 增加 `pendingHit: CombatPendingHit | null`，不新增公开版本。codec 校验 pending 的自有 data descriptor、所有字段、token、actor/action/definition/target/combo/baseDamage、active windup 完成点、current origin、actor/target identity 和 dedupe 一致性。restore 将 actor/target identity rebind 到当前 epoch，保留 token 与 remainder；缺失 target 继续走既有 restore cancellation，不猜测命中结果。

## RED

1. prepared advance 穿过 windup 时 `applyDamage` 调用数仍为零，live snapshot 不变；放弃计划模拟后续 ECS 失败。
2. apply pending 后 resolve，结果/timing 与 direct advance 相同；大 delta 跨 recovery 到 buffered step时保留 remainder 并产生下一 pending。
3. token 错误/重用、validate 后 Combat 变化、plan 重用均拒绝。
4. pending V3 save/restore 后只 resolve 一次，命中不重放；坏 pending accessor/shape 原子拒绝。
5. resolve 加 actor/target cancellations 在一个 candidate 内完成；末尾 result capacity 失败时 live Combat 与 event queue 完全不变。
