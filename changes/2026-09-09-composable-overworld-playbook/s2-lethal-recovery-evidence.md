# S2 致死命中恢复回归证据

## 结果

- `CombatRuntime.retain` 和 `advanceActor` 只在当前攻击仍处于 `windup`、即伤害尚未提交时要求目标生命周期绑定有效。
- `enterHit` 继续在应用伤害前验证 actor/target 绑定并重新执行命中条件，因此陈旧 windup 目标不会产生伤害。
- 命中已提交后，即使伤害回调杀死并 despawn 目标，当前 `hit`/`recovery` 仍可完成，保留原始 hit 结果并只发出一次 completed 生命周期事件。
- buffered target 不会借用前一目标的提交状态：进入下一 combo step 后重新成为 windup target，并在下一次命中前验证绑定；已删除目标会取消下一步且不产生第二次伤害。
- V2 combat restore 对 post-hit 当前目标不再强制恢复时 rebind；它保留已验证快照中的保存绑定和 dedupe result。windup target 仍在恢复时缺失/错代即取消，buffered target 则在实际推进到下一步时验证。
- allocator 反例改用对象展开构造错误快照，避免修改 readonly snapshot。

## RED

新增 `tests/server/combat-lethal-recovery.test.ts` 后首次运行：1 个文件共 5 项，4 项失败、1 项通过。

失败均为目标在命中提交后消失时，运行时或恢复 decoder 将 `active` 清空，并把 `{ outcome: 'hit', damage: 5 }` 覆盖为 `{ outcome: 'cancelled', damage: 0 }`。stale windup/buffered 目标不受伤害的反例当时已通过。

## GREEN

- `combat-lethal-recovery.test.ts` 与 `combat-identity-restore.test.ts`：2 个文件、15 项通过。
- 扩展回归集合：`combat-lethal-recovery`、`combat-identity-restore`、`action-identity-restore`、`gameplay-foundation`、`authority-actor-rules` 共 5 个文件、39 项通过。
- 新回归覆盖：直接 CombatRuntime 致死 despawn、retain、completed result、stale windup、buffered next target、删除目标后的 hit/recovery restore、删除 buffered target 后 restore、真实 Gameplay player→NPC 致死命中与 V4 恢复、NPC ActionRuntime 共享 combat owner 的致死攻击完成。
- owned ESLint 通过。
- `pnpm --filter @seedlands/game-core typecheck` 与 `pnpm exec tsc -p tsconfig.test.json --noEmit` 通过。
- `git diff --check` 通过。

## 边界

- 未修改 combat snapshot 版本或公开数据形状；这是 V2 阶段语义修复，V1 restore-cancelled 行为由既有 identity 回归继续覆盖。
- 未运行完整 static/build；本证据仅覆盖合同要求的定向测试、owned lint 和相关 TypeScript 检查。
- 未发现需要修改授权范围外文件的缺口。
