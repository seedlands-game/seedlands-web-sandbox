# Living NPC MVP 最终集成审阅

冻结范围：`0d709f708c28d759c0e84806122239528b752d49..3c2735bf3dc9637fa9e1f08ca5d79164ad4f4612`（head `3c2735bf3dc9637fa9e1f08ca5d79164ad4f4612`）。合同 `contracts/integrated-review.json` 的 SHA-256 已核对为 `237e70b5f7ba5b5e7bc06d5457ea7c78e3bdafc6797af015fca1dd73fad1f3c7`。按 base tree 的 `AGENTS.md`、`.agents/skills/seedlands-code-review/SKILL.md` 及其 review workflow/project rules 进行；没有读取 WIP，也没有运行测试、浏览器、provider 或任何写生产操作。

## 结论

核心的 Authority 所有权、绑定失效、候选式 checkpoint restore、A2 的公共压缩转写、ACK 门和暂停/死亡取消链路是自洽的。核心仍未依赖 provider 或模型协议。发现 1 个 P1：角色的持久 target reference 表没有容量或淘汰策略，普通觅食即可无限增长 checkpoint。

## 114 个变更文件覆盖

已逐项审阅 `git diff --name-status` 的 114 个路径，覆盖如下（路径组中的每个条目均在冻结 head 中读取）。

- 仓库、包和文档入口：`.github/workflows/ci.yml`、`.ls-lint.yml`、`.prettierignore`、`README.md`、`README.zh-CN.md`、`docs/code-map.md`、`docs/living-npc-cognition.md`、`docs/living-world-alignment.md`、`docs/repository-structure.md`、`eslint.config.mjs`、`package.json`、`pnpm-lock.yaml`、`scripts/eslint/package-boundary-rule.mjs`、`tsconfig.test.json`。
- A2 host（新增完整包）：`apps/agent-server/README.md`、`package.json`、`tsconfig.json`，以及 `src/budget.ts`、`cognition-graph.ts`、`cognition-tools.ts`、`config.ts`、`context-session.ts`、`deepseek-transport.ts`、`index.ts`、`model-types.ts`、`runtime.ts`、`scheduler.ts`、`wire-validation.ts`、`node/main.ts`、`node/websocket-host.ts`。
- A3 浏览器组合、UI、bridge 和 Worker：`apps/web/package.json`、`src/app/bootstrap.ts`、`src/app/game-runtime-controls.ts`、`src/app/game.ts`、`src/app/gameplay/companion/companion-session.ts`、`src/app/ui/app-root.svelte`、`src/app/ui/companion-panel.svelte`、`src/app/ui/ui-contracts.ts`、`src/client/authority/browser-authority-client-contract.ts`、`src/client/authority/browser-authority-client.ts`、`src/client/authority/browser-character-control-port.ts`、`src/client/character/controller-bridge-validation.ts`、`src/client/character/controller-bridge.ts`、`src/worker/authority-worker-character-control.ts`、`src/worker/authority-worker.ts`。
- core shared protocol、Authority、gameplay、harness 与 simulation：`packages/cognition-protocol/package.json`、`packages/cognition-protocol/src/index.ts`；`packages/game-core/src/compute/authority-worker-protocol.ts`、`src/runtime/character-control-protocol.ts`、`src/server/authority/authority-runtime.ts`、`src/server/game-server-gameplay.ts`、`src/server/gameplay/gameplay-character-control.ts`、`src/server/gameplay/gameplay-runtime.ts`、`src/server/gameplay/player-state.ts`、`src/server/harness/authority-world-harness.ts`、`src/server/harness/world-authorization.ts`、`src/server/harness/world-harness-contract.ts`、`src/server/harness/world-harness-errors.ts`、`src/server/harness/world-harness-jsonl.ts`、`src/server/harness/world-harness-operations.ts`、`src/server/logic/logic-decision.ts`、`src/server/simulation/actor-state.ts`、`src/server/simulation/autonomy-runtime.ts`、`src/server/simulation/character-goal-runtime.ts`、`src/server/simulation/character-runtime-types.ts`、`src/server/simulation/character-runtime-validation.ts`、`src/server/simulation/character-runtime.ts`。
- change/spec/evidence/E2E：`changes/2026-09-09-developer-world-harness/e2e/browser-world-parity.spec.ts`、`spec.md`；以及 `changes/2026-09-09-living-npc-mvp/{baseline-integration.md,cognition-delivery.md,cognition-recheck.md,cognition-review.md,estimates.md,predecessor-ci-triage.md,predecessor-static-triage.md,spec.md,world-delivery.md}`、`contracts/{cognition-recheck.json,cognition-review.json,cognition.json,compression-fix.json,parent.json,predecessor-static-triage.json,predecessor-triage-low.json,predecessor-triage.json,world.json}`、`e2e/{controller-connection.spec.ts,living-companion.spec.ts,real-cognition.spec.ts,support.ts}`、`evidence/{live-model-smoke.json,live-semantic-fixed.json,model-contract.md,pro-semantic-red.json,read-batch-red.json}`、`experiments/live-model-smoke.mjs`。
- 覆盖用例：`tests/agent-server/{budget.test.ts,cognition-graph.test.ts,context-session.test.ts,deepseek-transport.test.ts,fixtures.ts,runtime.test.ts,scheduler.test.ts,websocket-host.test.ts,wire-validation.test.ts}`、`tests/app/companion-session.test.ts`、`tests/client/{browser-character-authority.test.ts,browser-character-client.test.ts,character-controller-bridge.test.ts}`、`tests/governance/{monorepo-package-boundaries.test.ts,runtime-purity-eslint.test.ts}`、`tests/server/{character-control-runtime.test.ts,gameplay-command-persistence.test.ts}`。

## 已核对的关键链路

- **世界 owner、权限和正常动作。** `CharacterRuntime` 只经 `GameplayRuntime`/`AutonomyRuntime` 执行目标；创建使用标准 NPC、Actor、导航、action、inventory 和 world-item 消耗，不给模型任意 world command。`BrowserCharacterAuthority` 拒绝未绑定的 `intent`/`memory`，并在每次 bound 调用同时核验 session、world、epoch、entity、incarnation、policy revision 及单调 sequence。dialogue 还检查玩家 alive、NPC alive 和 10m 距离。
- **死亡、行动与 checkpoint。** death 会提高 policy revision、终止 action/goal、掉落 inventory 并保留 deceased identity/terminal event。character restore 先构造完整新 map 后才 swap；browser restore 先以临时 persistence 建 candidate `AuthorityRuntime`，成功后才替换活动 runtime，随后更换 `worldEpoch` 和 character authority，故旧 binding 不能跨 restore 重放。`AuthorityWorldHarness.command()` 现在从 `current.runtime.snapshot().epoch` 取得 transaction epoch，避免 restore 后仍使用外层 epoch。
- **认知协议和压缩。** shared `cognition-protocol` 仅表达 controller envelopes，game-core 的 `character-control-protocol` 仅表达角色资源、观察、目标、binding 与 receipt；没有 provider/model import。`buildCompressionTranscript()` 将历史 assistant/tool 调用转成单一 `user` data document，标记来源和确定性，丢弃 `reasoning_content`；Pro 调用只有 system + 此 document，不携带 tools、原生 tool role 或 Flash reasoning。冻结与 `frozenLength` tail 保住 Flash 期间到达的事件；memory 只在 Authority receipt accepted/succeeded 后 `commitPreparedRotation()`，拒绝则保留旧 journal。
- **scheduler、取消、启动与传输。** scheduler 在 owner 确认 dispatch 后才重置 fallback；pause 保存剩余时间，dispose/死亡 abort provider 并解除 timers。已修复 paused receipt 将状态改回 ready 的问题：intent 与 memory receipt 都保持 paused。loopback host 检查 remote IP、exact Origin、`/` path、配对码、帧大小、不可变 binding 和递增 client sequence；browser 端同样限制 loopback URL、帧大小、host sequence 和 queued host work。预算对 Flash/Pro 请求预留 calls/input/output，失败也结算预留以防重试绕开总额。

## 验证边界和未验证项

- 本审阅为只读静态/冻结树审阅；未重复运行 56 个 focused tests、`verify:static`、浏览器用例或真实 provider。提交方记录的测试通过是支持性证据，不替代本审阅。
- Pro 的完整 public-transcript 压缩已在代码层取消 reasoning/tool replay；仍需 Root 的实际 provider run 确认 DeepSeek thinking-enabled 的无-tools Pro 请求在供应商端接受并保持 summary 语义。该问题不因 Flash 的 tool-replay 合同而静态地判为 400。
- 未对高 churn 世界进行长期 checkpoint 尺寸/写入压测；下列 P1 应先修复并加入此类测试。

## Findings（按严重度，最后列出）

### P1 — 普通观察和觅食会无限扩张持久 target 表

`packages/game-core/src/server/simulation/character-runtime.ts:322-348` 为每个首次可见的 entity/POI 调用 `reference()`；`:389-395` 找不到现有 binding 时直接 `push` 并标记 changed，但没有任何 prune/lease/cap。更直接地，`packages/game-core/src/server/simulation/character-goal-runtime.ts:146-157` 在成功消费 world-item **之后**仍为该已 despawn 的 item 调用 `reference()`，所以每次通常的 `forage → pickup → consume` 都永久加入一个以后不可能重新可见、不能用于 follow 的 binding。snapshot validation 在 `character-runtime-validation.ts:140-142,185-200` 只验证数组与唯一性，未限制 `targets.length`。

触发：让一个持久伙伴连续拾取/食用不同 dropped food，或在移动中经过不断出现的局部物品/POI；每个新 id 都留在 `CharacterSnapshotRecord.targets`。影响：角色 checkpoint 和每次新 binding 的 dirty 写持续增长，最终可耗尽 checkpoint/传输预算或使保存延迟无界；同时保留大量不可再用 capability reference。修复应给目标引用设有界容量和可验证的失效/淘汰策略（例如只保留当前可见与尚在事件保留窗口所需的 refs），在 item 已消失后不要创建新 binding 作为 pickup event target，并在 snapshot validator 强制同一上限；添加大于该上限的观察/连续觅食 + save/restore 回归用例。

未发现 P0 或其他可证实 P2。
