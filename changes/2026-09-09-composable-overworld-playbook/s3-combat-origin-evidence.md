# S3 Combat durable origin 证据

## result

已为实际 `CombatRuntime` 增加 current step 与 buffered step 相互独立的 durable execution origin。`requireOrigin` 模式在新请求接受前校验 origin schema、actor ID/lifetime 和当前授权来源，并在每个延迟 windup 命中调用 `applyDamage` 前再次校验；失败产生确定性 cancelled result，damage 不执行。

新增 Combat checkpoint V3 保存 current/buffer 两份 origin，同时继续保存 V2 的 actor/target lifetime binding、phase/elapsed、buffer 与 hit dedupe result。V3 restore 先构造并验证完整 candidate，最后一次替换 live map/allocator/events。用户可见的 `snapshotFor()`/active HUD projection没有 origin。

## changes

- `combat-origin.ts`：定义 `CombatOriginValidationPort`、checkpoint/result/options，封装 origin actor/lifetime 校验、policy checkpoint 校验与 V1/V2/V3 restore candidate。validation port 的失败 reason 必须是非空且不超过 256 字符，否则归一化为 `origin-validation-failed`；port 抛错也 fail closed。
- `combat-runtime.ts`：构造函数第四参增加 `{ requireOrigin?, validationPort? }`；`request` 第五参接收 host 已 capture 的 `DurableExecutionOriginV1`。current/buffer 分别保存自己的 origin，combo transition 只移动对应 buffered origin，命中前重授权。
- `combat-runtime-snapshot.ts`：增加 `CombatRuntimeSnapshotV3`、V3 encode、origin descriptor/schema 验证，并让既有 bound decoder复用 V3 的 identity/phase/dedupe 校验。
- `requireOrigin` 构造必须同时有 entity identity port 与 origin validation port。V1/V2 active restore 产生 `restore-origin-missing` cancellation；terminal history 与 action/result allocator high-water 保留。未启用 requireOrigin 的旧构造、V1 `restore-cancelled` 与 V2 合法 in-flight restore 保持兼容。

稳定接线：

```ts
const combat = new CombatRuntime(callbacks, registry, identity, {
  requireOrigin: true,
  validationPort: {
    validate(origin, checkpoint) {
      // 用 checkpoint 的 actor/target/definition/comboStep 构造当前授权请求，
      // 调 rebindDurableExecutionOrigin；成功返回 { ok: true }。
      return { ok: false, reason: 'origin-revoked' };
    },
  },
});

combat.request(actorId, targetId, definitionId, createActionId, capturedOrigin);
```

`checkpoint.stage` 为 `request | restore | hit`。根任务 adapter 必须从 checkpoint 形成当前 resource/operation/target 请求，不能只验证 subject 或 alias。

## validation

真实 RED：新测试首次运行 `1 file / 7 tests`，其中 `6 failed / 1 passed`。可观察失败包括：撤权后仍施加 5 damage、buffer 第二击仍施加 7 damage、快照仍为 V2、requireOrigin 恢复旧快照未取消、origin accessor 未拒绝。唯一先通过的是旧 V2 自带的 committed lethal dedupe，尚未证明 V3 origin 行为。

GREEN：

- `pnpm exec vitest run tests/server/combat-durable-origin.test.ts`：`1 file / 9 tests` 通过。覆盖缺 origin 零写拒绝、命中前撤权、current/buffer 来源隔离、来源不匹配、跨 epoch/宿主 alias 的同 subject V3 restore、致死 recovery 不重放、V1/V2 originless cancel、terminal history/allocator 保留、request/restore accessor 与 actor lifetime mismatch 原子拒绝。
- `pnpm exec vitest run tests/server/combat-durable-origin.test.ts tests/server/combat-identity-restore.test.ts tests/server/combat-lethal-recovery.test.ts tests/server/gameplay-foundation.test.ts tests/server/gameplay-snapshot-migration.test.ts`：`5 files / 48 tests` 通过。证明既有 V1/V2 identity restore、lethal recovery、Gameplay timing 与 snapshot migration 未回归。
- `pnpm --filter @seedlands/game-core typecheck`：通过。
- `pnpm exec tsc -p tsconfig.test.json --noEmit`：通过。
- owned source/test ESLint：通过，零 error/warning。
- owned design/source/test/evidence Prettier check：通过。

## unverified

- 根任务拥有 GameplayRuntime、Autonomy、authorized host context 与实际 `rebindDurableExecutionOrigin` adapter 接线；本切片测试使用等价的注入 policy port，没有宣称真实 Browser/Headless policy 已接通。
- 当前 `enterHit` 在调用 `applyDamage` 前先修改 Combat phase/elapsed。若 damage/ECS participant 的 apply 意外抛错，Combat 仍可能留下局部状态。跨 ECS、Combat、Action、needs 的真正原子命中需要根任务后续 prepared Combat advance/settlement 协调；本切片只保证 origin 失败发生在 phase 修改和 damage 之前，不把 callback 调用顺序声明为多 owner 原子提交。
- 未运行完整 workspace static/build、Browser 或性能采样；合同禁止本切片作这些声明。
