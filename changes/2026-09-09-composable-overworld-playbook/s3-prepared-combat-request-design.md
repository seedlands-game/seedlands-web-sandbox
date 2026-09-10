# S3 Prepared Combat request 设计

## API

```ts
type PreparedCombatRequestInput = Readonly<{
  actorId: string;
  targetId: string;
  definitionId: string;
  origin: DurableExecutionOriginV1;
  actionId?: string;
}>;

type PreparedCombatRequestResult =
  | Readonly<{ success: false; reason: string }>
  | Readonly<{
      success: true;
      result: Readonly<{ success: true; actionId: string; buffered: boolean }>;
      pendingHits: readonly CombatPendingHit[];
      lifecycleEvents: readonly CombatLifecycleEvent[];
      validate(): void;
      apply(): void;
    }>;

combat.prepareRequest(input): PreparedCombatRequestResult;
```

`success: false` 是纯 rejection，没有 plan。成功分支复用 detached Combat frontier 的 one-use `validate/apply` 语义，并暴露 apply 后完整 pending hit 与 lifecycle event 队列。`origin` 是宿主此前捕获的 durable origin；prepared request 仍通过当前 identity binding 与当前 policy port 校验，不能由 gameplay payload 合成。

外部分配 `actionId` 必须 trim 后非空、最多 256 字符，并不得占用 `combat-<ordinal>` 内部 allocator namespace。buffer request 若携带 `actionId`，只能与当前 active action 相同。没有外部 ID 的新请求才在 detached candidate 上推进 Combat action allocator；rejection、放弃或 stale plan 均不消耗 allocator。

## 候选与 zero-windup

prepare 捕获当前 frontier signature，深复制 combatant map、allocator、pending hits 与 events，在 candidate 上执行与 legacy request 相同的 definition、capacity、availability、identity、cooldown/combo-window、buffer 与 origin 检查。`validateHit` 也在 prepare 阶段完成。apply 只安装已构造状态，不调用 callback。

zero-windup 新请求在 candidate 中立即到达 windup frontier，冻结为 `CombatPendingHit`，但不调用 `applyDamage`。宿主在 candidate apply 后通过既有 `prepareMutation({resolveHit})` 解析；因此实际 damage 仍处于 registered operation 与多 owner coordinator 内。

legacy `request()` 保持原直接行为，包括 zero-windup 即时 damage。prepared current/buffered origin 分别保存，buffer request 不复制 current origin。

## RED

1. zero-windup prepared request 在 prepare/apply 时 damage 为零，产生 pending；显式 resolve 仅结算一次。
2. rejection、放弃计划、stale plan 不改变 map/event/action allocator；之后内部 ID 仍从原 high-water 开始。
3. 外部 Action ID 保存到 Combat，但不推进 Combat allocator；随后内部 request 使用原下一 ordinal；非法/保留 ID 原子拒绝。
4. direct 与 prepared 的 cooldown、combo window、buffer full 结果一致；buffered step 保存独立 origin，并在后续 pending 中出现。
