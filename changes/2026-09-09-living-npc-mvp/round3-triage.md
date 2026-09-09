# Living NPC Round 3 GitHub 问题分诊

冻结对象：`0ce2bfc3b53e6be179f6d315016972d4be5e1885`（parent `26ea89591e5f7a9a97c2a85dd04eaff2eb27d2d7`）。已核对 `round3-triage.json` SHA-256：`8755b6471e08acd500933b5eeae325250585877cb23b14262426eac6b2d67b72`，读取 `/tmp/seedlands-living-npc/final-review-comments.json`、冻结 base 审阅规则和全部四条调用链。未运行测试、Browser、provider、依赖、Git 或 repo 写操作。

## 变更

本轮仅分诊。review `5152979283` 的四项均为有效 **P1**。

### 3967294762：KeyT 同时打开面板和加速时钟

`companion-panel.svelte:42-59` 用 `KeyT`、`preventDefault()` 打开面板；`player-controller.ts:123-151` 仍无条件转交给 `PlayerDebugTimeKeys`，而 `player-debug-time-keys.ts:31-38` 不读取 `event.defaultPrevented`，会切换 1×/20×/100×。两种 window handler 的注册顺序不能作为消费保证。

最小修复：UI 改用经现有 input map 审计后未占用的键，或让 PlayerDebugTimeKeys 在任何副作用前拒绝 `defaultPrevented`（并确认 PlayerController 后续不会把该键加入移动 keys）。RED：无阻塞 UI 时按伙伴快捷键，只打开/聚焦面板，world clock speed 不变。

### 3967294781：重连首包把历史事件再次触发模型（优先，P1）

`controller-bridge.ts:135-151` 重连将 bridge cursor 归零，首次 poll 用 `observe(0)`；新 `CognitionRuntime` 的 `latestEventCursor=-1`，`runtime.ts:149-157` 将保留的 dialogue/attacked 等全部判 fresh、append 并通知 scheduler。已经在旧连接提交过的 speech/intent 可被再次决定。

最小修复：在 Runtime 的**首次通过 binding 验证的 active observation**分支建立 history baseline：

1. 保持 event 原始升序 append 到新 ContextSession，用于恢复公共经历；
2. 将 `latestObservation` 写为该 observation，`latestEventCursor` 直接设为 `observation.cursor`；
3. 不调用 `scheduler.notifyEvent()`，也不运行 `retryAfterObservation` 的 fresh-observation 唤醒；
4. 后续 observation 仍使用现有 cursor filter/append/notify，因此新事件照常唤醒；constructor 已有 fallback timer，不因历史另行重置或重放。

RED：先让一条 dialogue/attacked 在第一 Runtime 形成决定，断开重建 Runtime 并交付该段历史，断言无 model call/intent；随后 cursor 更高的新 dialogue 触发且只触发一次决定，并断言首次 request 的 context 仍含历史。另覆盖首包空 events 但高 cursor，后续同 cursor 不触发。

该方案的明确风险：它按首次 transport snapshot 视为历史，无法区分“旧连接已确认”与“断线期间刚发生但尚未被模型处理”的保留事件；后者将等待下一新事件或正常 fallback。此为用户指定最小方案的取舍，应写入交付边界。必须以 `observation.cursor` 而不是 payload 的最大 event cursor 作为 baseline，避免分页/空页重传。deterministic initial forage/life 不受影响，首次 baseline 不写世界状态。

### 3967294795：无 actionId 的 follow execution target 可被 checkpoint 篡改

`character-runtime-validation.ts:238-267` 在没有 `actionId` 时立即返回，仅检查 `executionTargetId` 是非空字符串；`character-goal-runtime.ts:103-118` 则直接信任它。损坏 snapshot 可令 active follow 的 persisted ref 指向 A、executionTargetId 指向可见 B，恢复后跟随 B。受击后的 suspended follow 已清掉 actionId，并带有 suspendedGoal，故同样可达。

最小修复：在 action-link 校验外增加 execution-target consistency 校验；对 `currentGoal` 与存在的 `suspendedGoal` 的 active/suspended follow，都要求 executionTargetId 存在，target ref 可解析为 entity binding，binding revision/ref/targetId 与 goal 一致。不要把 completed/failed follow 的残留 execution target 当成 active link。RED：无 actionId 的 active follow snapshot 中 A→B 篡改必须在 map swap 前原子 reject；对 attack 后 suspended follow（含 suspendedGoal）重复该夹具；失败后当前 runtime/action 不变。

### 3967294810：spawnAutonomous 注册失败遗留 persistent NPC

`gameplay-runtime.ts:114-119` 先 `entities.spawn()` 后 `registerActor()`；`gameplay-character-control.ts:50-67` 的 catch 在 spawnAutonomous 成功返回之后，容量到达 `MAX_RETAINED_ACTORS` 时 registerActor 抛错，创建路径拿不到 entity id，无法进入 cleanup。每次失败留下无 Actor/Character record 的 persistent NPC。

最小修复：将 rollback 放在 `GameplayRuntime.spawnAutonomous()`：spawn 后用 try/catch 注册，catch 内 `entities.despawn(entity.id)` 后原样抛出；仅成功时 touch/return。RED：填满 actor cap 后通过 character create 触发失败，断言 entities/snapshot/list 没有新增 NPC；释放一个 actor 后正常创建可成功，证明无残留 id/registration。

## 验证

四条触发均来自正常键盘输入、正常 reconnect、已验证可导入 checkpoint 或正常 actor-cap 边界，不依赖模型调用。现有 companion test 仅验证 late binding dispose；existing flee/restore tests 不覆盖 no-action follow ref cross-check；character creation catch 不能覆盖 spawnAutonomous 内部失败。

## 风险

- reconnect baseline 必须只执行一次，且发生在 binding 校验之后；若直接按 `latestEventCursor === -1` 判断，异常 cursor 或终止路径可能混淆初始化状态。建议单独的 `hasInitialObservation` 标志。
- baseline 只重建 host context，不能伪造 Authority receipt、修改 goal 或 reset budget/fallback；否则会超出重连幂等修复范围。
- Core restore cross-reference 要在 records map swap 前完成，保持 snapshot 恢复原子性。

## 实际成本

约 0.28 agent-hour，低于合同 0.3 小时。未执行外部调用、测试、Browser、依赖操作、提交或外部写入。
