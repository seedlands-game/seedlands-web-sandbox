# Living NPC GitHub Round 2 问题分诊

冻结对象：`7c36c436f507d8401f13618411f233dbe34eb2f3`（parent `38771ccac7864b2744c64f6d78a0c3204efc8221`）。已核对 `github-round2-triage.json` SHA-256：`d2324b160196b19205e5d2ce439c5541c7b59cdaceaf3cb2ab7c99c920da0778`，并读取 `/tmp/seedlands-living-npc/github-review-round2.json`、冻结 base 的审阅规则、scheduler/runtime、character runtime/goal runtime、Autonomy 接缝和相关测试。未运行测试、Browser、provider 或 Git/repo 写操作。

## 变更

本轮不改源码。两条 review `5152630270` 都是可达的 **P1**，应在当前 change 修复。

### 3967001265：退避期间的事件被遗失（有效 P1）

- 位置：`apps/agent-server/src/scheduler.ts:109-124`，及 `runtime.ts:279-297,385-389`。
- 触发：一次 Flash 失败，将 `backoffUntil` 设为未来时间；退避期间收到 dialogue/attacked，scheduler 的 debounce 到期。`onTimer()` 先清空 `pendingEventReasons`，随后 `beginDispatch('event')` 因 `Date.now() < backoffUntil` 返回 `dispatched:false`。这不是 fallback due，故 scheduler 不更新 `dueAt`，finally 也没有 pending reason 可重排。
- 影响：已写入 context 的事件不会在退避截止时重新触发决定，必须等待之前成功 dispatch 设置的 60–600 秒 fallback；角色对话/受击反馈显著延迟。
- 最小修复范围：`scheduler.ts` 与 `runtime.ts`。让未派发的 event 不丢失，并把 Runtime 的明确 backoff deadline 传给/安排给 scheduler；deadline 到达后以已有 debounce 重新调度。不要把一般 `dispatched:false` 变为立即重试，否则缺观察、pending receipt 等分支会产生 250ms 自旋。pause/dispose 仍须取消或安全忽略 retry timer。
- RED：Runtime 使用同一 fake Date/clock。首个 significant observation 触发模型 transport failure；退避内收到 cursor 更高的 dialogue；确认其 debounce dispatch 被拒绝；在 backoff expiry + debounce 时断言第二次模型请求开始，且不推进至 fallback 周期。

### 3967001269：终态目标受击后永久 suspended（有效 P1）

- 位置：`packages/game-core/src/server/simulation/character-runtime.ts:161-174` 与 `character-goal-runtime.ts:35-47`。
- 触发：`move-to`/`return-home` 已 succeeded，或任一 active goal 已 failed 后受击。`recordAttacked()` 仅对 active goal 保存 `suspendedGoal`，但无条件将 `currentGoal.status` 写成 `suspended`。3 秒危险结束时，goal runtime 只在 `suspendedGoal` 存在时恢复并 record fallback；缺失时永远 return。
- 影响：角色保持 active lifecycle，却永久 `currentGoal.status='suspended'`，之后普通 goal progression 停止，也没有 `danger-cleared` 状态反馈。
- 最小修复范围：`character-goal-runtime.ts` 和 `tests/server/character-control-runtime.test.ts`。危险结束且无 `suspendedGoal` 时，clear danger 后转换到显式 fallback-life 的 active base goal（与注册默认一致的 forage），清理 execution/action 状态、更新 revision、record `fallback: danger-cleared`、调用 changed；不可恢复原来的 terminal goal。
- RED：通过正常 Headless/Gameplay 流使 `move-to` 或 `return-home` 终态（另可覆盖 failed），再 `attackEntity`；危险超过 3 秒后断言 state 是 active forage、收到 `fallback(danger-cleared)`、不再 suspended。可同时断言旧 terminal requestId/goal 未被伪造为 active。

## 验证

静态调用链确认两条触发均无需不可信输入或异常时序：前者只需一次可预期 transport 失败加一条正常 dialogue；后者只需正常 combat hit。现有 `scheduler.test.ts` 仅断言 skipped event 不重置 fallback，未保留被退避拒绝的 event；现有 flee 测试仅从 active forage 受击并因此有 `suspendedGoal`。

## 风险

- scheduler 修复若只保留 event 而没有 backoff deadline，会在 `dispatched:false` 时持续重排；必须把 backoff/不可重试原因区分开。
- danger 修复若把 terminal `suspendedGoal` 直接恢复，会将已完成/失败的命令错误复活；应走明确 base fallback。
- 未评估 Root 正在独立检查的 scheduler 实现细节、全量 static/build、Browser 或真实 provider 验收。

## 实际成本

约 0.18 agent-hour，低于合同 0.2 小时上限。未执行测试、外部调用、浏览器、依赖操作、提交或外部写入。
