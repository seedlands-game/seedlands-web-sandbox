# Living NPC Round 9 冻结增量独立复核

## 审阅对象

- Base：`fe5e0f11a92f9706bd1a5ef0f32a27cb36c09e9e`
- Head：`a63398dbd65fff581d9c07ec30a177a5647fca46`
- 范围：31 个变更文件，按 base tree 的 `AGENTS.md`、`.agents/skills/seedlands-code-review/SKILL.md` 及证据治理规则静态复核。
- 本审阅未执行测试、浏览器、provider、依赖或任何仓库写入。

## 变更与语义核对

### 持久目标与行动权属

`CharacterRuntime.persistentGoalFor()` 只从 active Character 的 active/suspended `currentGoal` 导出目标投影。每次 `AutonomyRuntime.snapshot()` 再附加投影；restore 先校验输入形状、通过 `cloneActor()` 删除输入投影，随后恢复 Character，因此投影既不是第二份权威状态，也不能用 checkpoint 中伪造的合法枚举覆盖 Character 记录。

`chooseGoal()` 的顺序符合既有反射优先级：inactive hold、已记录攻击者/可见威胁 flee、running move-to Action 续跑、非-forage 的持久目标无 Action 时 hold。故 suspended idle 不会压制避险，follow 的执行 Action 仍优先，ordinary actor 没有投影仍沿原居民规则；forage 明确保留无食物 roaming。

Headless 回归覆盖 idle 跨 Logic/Physics tick 保持、follow 到达后无 Action 保持、玩家位置改变后新建绑定目标的 move-to、旧/伪造投影恢复重建以及普通 settler 不受影响。平地 Authority fixture 只证明重新规划与 wish 接纳；测试未把它误作物理位移证据。

### 暂停边界与回执

`Game.setPaused()` 在异步 local Authority pause/resume 前，同步调用 `CompanionSession.setPaused()`，转发到 Bridge。ready 后 Bridge 立即发送 control；ready 前不会错误地记为“已发送”，首次 `poll(..., true)` 仍会按真实 `options.paused()` 发送 pause 并上送基线观察。

收到 intent 时，Bridge 在任何 `port.intent()` 前重读实时暂停状态。暂停则返回同 requestId 的 `rejected/WORLD_PAUSED` receipt，不触达 Authority，所以已在途中、但尚未跨浏览器到世界边界的 intent 不能改目标或发言。memory 不走此门禁，仍调用 Authority 并回 receipt，允许已准备压缩轮换完成 ACK/拒绝对账。generation 检查继续阻止断开后的异步回写。

`controller-connection.spec.ts` 的真实浏览器路径将 fixture model 的下一次完成保持住，暂停后确认 AbortSignal、释放一个故意忽略 abort 的迟到完成，并断言 Character revision、lastSpeech、currentGoal 不变；恢复后确认 resume control。它还以真实 WASD 测量玩家水平移动超过 4、NPC 超过 1 且与玩家距离缩小；到达前后跨 90 physics ticks 断言无 Action 与小于 0.02 的水平漂移。

### 历史 melee 就绪

历史 CI 记录显示首轮 `#melee-showcase-guide` 的固定 5 秒等待失败、retry 成功且被 `failOnFlakyTests` 正确标红。用例现在先等待“仍然进入”警告或完整 guide 任一可见，必要时点击前者，再以 15 秒等待 guide；后续武器、实体、受击、双次攻击/删除 dummy 断言、90 秒总超时和 CI retry 均保留。

6 秒 Authority Worker 延迟的证据显示旧断言 RED；延迟夹具在新启动阶段 GREEN，移除夹具的正常 journey 也 GREEN。延迟仅存在于证据 patch，生产源码没有增加等待。

## 文件覆盖

已逐项读取以下 31 个 frozen 变更：

- 生产：`apps/web/src/app/game.ts`、`apps/web/src/app/gameplay/companion/companion-session.ts`、`apps/web/src/client/character/controller-bridge.ts`、`packages/game-core/src/server/logic/logic-decision.ts`、`packages/game-core/src/server/simulation/actor-state.ts`、`packages/game-core/src/server/simulation/autonomy-runtime.ts`、`packages/game-core/src/server/simulation/character-runtime.ts`。
- 回归/E2E：`changes/2026-09-08-melee-action-showcase/e2e/melee-action-showcase.spec.ts`、`changes/2026-09-09-living-npc-mvp/e2e/controller-connection.spec.ts`、`tests/app/game-companion-pause.test.ts`、`tests/client/character-controller-bridge.test.ts`、`tests/server/character-logic-goal-ownership.test.ts`、`tests/server/logic/logic-decision.test.ts`。
- 交接/范围：`changes/2026-09-09-living-npc-mvp/contracts/ci-melee-triage.json`、`contracts/round9-pause-fix.json`、`contracts/round9-pause-fix-v2.json`、`contracts/round9-world-fix.json`、`ci-melee-triage.md`、`round9-pause-fix.md`、`round9-world-fix.md`、`spec.md`、`estimates.md`、`delivery.md`、`docs/living-npc-cognition.md`。
- 冻结证据：`evidence/ci-34357206570-failure.log`、`evidence/melee-delay-red.log`、`evidence/melee-delay-injection.log`、`evidence/melee-delay-green.log`、`evidence/melee-final-green.log`、`evidence/round9-world-red.log`、`evidence/round9-world-green.log`。

## 验证证据与未覆盖项

- 新世界修复报告记录 RED 为缺少 idle 投影/伪造 forage 投影被信任，GREEN 为 5 files、27 tests；暂停修复报告记录 RED 2 项、GREEN 3 files、9 tests。它们与当前实现和对应测试断言一致，但本审阅没有重跑。
- `delivery.md` 记录本轮 Browser 两项 18.7 秒通过，并给出 hold/follow、暂停迟到完成的数值边界；冻结提交中没有保存该轮生成的 `hold-and-follow-bodies` JSON attachment。现有 `browser-controller-green.json` 是更早的连接/两轮 receipt 摘要，不含这组身体坐标。因此此项只能将交付记录视为声明，不能在冻结树内独立复算实际坐标；E2E 源码本身包含完整断言。
- Root 的 full static、build 和 Browser 验收在本审阅期间进行中，未被计作本审阅的已验证结果。
- 原始 CI/evidence 日志包含捕获时的尾随空格，整体 `git diff --check` 会对此类非执行证据文本报格式项；不影响 TypeScript/测试语义。

## 风险

- 在 `Game.setPaused(true)` 调用之前已完成 `port.intent()` 的请求已经越过世界边界；本修复正确覆盖的是尚在模型/Bridge 途中、暂停时才到达的 intent，且不声称追回既已产生的模型成本。
- paused 初始连接仍会发送一次 observe，用于建立历史基线；后续 paused poll 不再观察。这与重连历史、ACK 和 resume 语义一致。
- 对真实身体运动的最终结论仍应附随当前 Browser 工件/日志交接；平地 fixture 只可证明重新规划，不可替代该证据。

## 实际成本

- 静态审阅约 0.3 agent 小时。
- 未执行模型调用、Browser、测试、依赖操作或仓库写入。

## Findings（按严重度，最后）

未发现此 frozen delta 中有可复现、具位置和可观察影响的 P0、P1 或 P2。
