# Living NPC Round 3 复核报告

冻结范围：`0ce2bfc3b53e6be179f6d315016972d4be5e1885..db0056142e5218c4ce0edf72831ac2ce0aca3106`。已核对 `round3-recheck.json` SHA-256：`4ac3923bd04d3ebb167a8996b5fea440c6d25a18f865f98b81183dd509902b7b`。读取 round3 triage、host/world/browser 修复报告、冻结 base 审阅规则、全部 16 个 apps/packages/tests 源码文件、两条 change E2E 与相关 spec/delivery/docs；只读静态复核，未运行测试、Browser、provider、依赖或 Git/repo 写操作。

## 变更

- UI 将调试时间倍率移为 Alt+T，普通 T 仍由伙伴面板独占；session 与按钮在连接初始化期间拒绝对话。
- Host 的首个经 binding 校验的 active observation 成为 history baseline：append context、记录 observation cursor，不调度、不重放，之后事件维持原有新鲜度与 debounce。
- Bridge 在 Host ready 后先发送首个 observation（暂停时同样如此），再发布 ready；generation 变化或初始化失败不发布 ready。
- Core restore 对无 action 的 active/suspended follow（current 和 suspendedGoal）验证 execution target 与持久 ref binding；自主 Actor 注册失败在 spawnAutonomous 内回滚 entity。

## 验证

### 3967294762 KeyT collision — 已解决 P1

`player-debug-time-keys.ts:36-41` 只在 Alt、非 Ctrl/Meta 的 T 上变更时间倍率并 consume；`companion-panel.svelte:42-59` 明确排除 Alt 后继续以普通 T 打开面板。`player-input-gates.test.ts` 覆盖裸 T 不调用 speed callback、Alt+T 调用一次；Browser E2E 在 T 打开交流后以 Authority clock 读出 1 秒为约 0.04 小时，保留真实 T 交流路径。

### 3967294781 reconnect history replay — 已解决 P1

`runtime.ts:145-173` 仅在 binding 校验后、`latestObservation` 为空时建立 baseline，完整 append 事件且将 `latestEventCursor` 与 `lastDecisionCursor` 设为 **observation.cursor**；直接 return，因此没有 scheduler/retry wakeup。后续 observation 才进入 fresh-event/notification 路径。deceased 和 invalid binding 保持基线之前的现有拒绝/终止边界。

`round3-host-fix.test.ts` 证明 retained dialogue 在新 runtime 的整个 fallback 窗口不产生请求，下一 cursor dialogue 只唤醒一次且 request 同时带有历史与新事件；另覆盖 paused 的 invalid 首帧、有效空事件 baseline、resume 后不重放。原 runtime/backoff/receipt 负例均改为显式 empty baseline 后触发，保留原本异步语义。

### Bridge/session initial baseline — 已解决

`controller-bridge.ts:182-249` 在 ready handler 内 await `poll(generation, true)`；该 poll 先发送 pause/resume control，再即使 paused 也 observe/send baseline，且在 generation 仍匹配、ready 未被 fail 后才通知 UI ready。await 后的 generation gate 与 `poll` 的 generation checks 阻止 late observe 在 disconnect 后发布。伙伴 form 禁用 connecting，`CompanionSession.dialogue()` 也在 domain session 层拒绝 connecting，防止刚输入事件被基线吞掉。client test 覆盖运行/暂停两种延迟 observe、baseline 已发送才 ready，以及旧 disconnect late-work 负例。

### 3967294795 no-action follow mismatch — 已解决 P1

`character-runtime-validation.ts:238-255` 的独立 helper 不再依赖 actionId，对 active/suspended follow 的 `currentGoal` 与 `suspendedGoal` 都要求 executionTargetId 和 target binding 的 entity/ref/revision/targetId 一致；`CharacterRuntime.restore()` 仍在 records map swap 前调用验证。failed/succeeded follow 不被错误要求保持可执行 link。`character-control-correctness.test.ts` 覆盖合法 no-action 近距离 follow restore、active 篡改拒绝、attack 后 suspended/suspendedGoal 篡改拒绝及失败后 state 不变。

### 3967294810 orphan entity on actor registration failure — 已解决 P1

`gameplay-runtime.ts:114-123` 将 actor registration 置入 spawnAutonomous 的 try/catch，失败立刻 despawn 新 entity，只有完整成功才 touch。真实 512 actor 容量 test 覆盖 direct overflow 和产品 character(create) 的连续 overflow；entity/actor/list/revision 与既有首尾 actor 都保持不变。

## 风险

- 首 observation baseline 有意把断线期间未确认的保留事件同样视为历史；它们等待下一个新事件或常规 fallback。这是已记录的产品边界，不是本实现遗漏。
- 本复核未执行 Root 负责的 full static/build 和真实 Browser；所述 2/2 Browser GREEN 仅作为 Root 提供的独立证据，未在本轮复跑。

## 实际成本

约 0.46 agent-hour，低于合同 0.5 小时上限。未执行外部调用、测试、浏览器、依赖操作、提交或外部写入。

## 独立审阅 Findings

未发现新的可证实 P0/P1/P2。覆盖：完整（限定的 round3 production/test/docs delta）。
