# GIT-03 A1 提交计划

基线：`800c13c4ed0b90d3ab3fc3ad33edacf6e2681833`。A1 已由 root 基于 `a1-r2-closing-review.md` 正式定向准出；该准出不代表完整 Classic、CI、build 或 browser 准出。以下代码批次已按计划执行并推送为 `101c600d6fbc9f3547e4262cecd47cebe9b2daba`。

## Commit 1：A1 原子 world/fluid commit 闭包

整文件暂存：

```text
packages/stdlib/src/server/fluid/fluid-active-window.ts
packages/stdlib/src/server/fluid/fluid-candidate-commit.ts
packages/stdlib/src/server/fluid/fluid-candidate-settlement.ts
packages/stdlib/src/server/fluid/fluid-candidate-validator.ts
packages/stdlib/src/server/fluid/fluid-edit-effect-plan.ts
packages/stdlib/src/server/fluid/fluid-edit-sidecars.ts
packages/stdlib/src/server/fluid/fluid-priority-frontier.ts
packages/stdlib/src/server/fluid/fluid-transaction-runtime.ts
packages/stdlib/src/server/fluid/fluid-transaction.ts
packages/stdlib/src/server/game-server-gameplay-world-port.ts
packages/stdlib/src/server/game-server-world-commit-adapter.ts
packages/stdlib/src/server/prepared-world-commit-metadata.ts
packages/stdlib/src/server/prepared-world-edit.ts
packages/stdlib/src/server/server-world-commit-host.ts
packages/stdlib/src/server/single-world-edit.ts
packages/stdlib/src/server/station-world-integrity.ts
packages/stdlib/src/server/world-edit-batch-plan.ts
packages/stdlib/src/server/world-edit-runtime.ts
packages/stdlib/src/server/world-mutation.ts
packages/stdlib/src/server/world-transaction-commit.ts
packages/stdlib/src/server/game-server.ts
packages/stdlib/tests/server/fluid-candidate-settlement.test.ts
packages/stdlib/tests/server/fluid-edit-effect-plan.test.ts
packages/stdlib/tests/server/fluid-transaction.test.ts
packages/stdlib/tests/server/prepared-world-edit-batch.test.ts
packages/stdlib/tests/server/world-collision-delta.test.ts
packages/stdlib/tests/server/world-transaction-atomicity.test.ts
apps/web/tests/integration/runtime/server/composition/gameplay-block-stations.test.ts
apps/web/tests/integration/runtime/server/prepared-world-edit.test.ts
```

共享文件精确 hunk：

- `packages/stdlib/src/server/game-server-gameplay-host.ts`：只取 `GameServerGameplayWorldPort` 抽取所需 import/export 和 `createGameplay()` 的 `prepareVoxelEdits` 转发；不取 `ItemInteraction` import、`resolveItemInteraction()` 或无关 import 合并。
- `packages/stdlib/src/server/gameplay/gameplay-runtime-contracts.ts`：只取 `ExpectedWorldVoxelEdit` / `PreparedWorldEditBatch` type import 与可选 `prepareVoxelEdits` callback。

该闭包必须同时提交，因为 `game-server.ts` 已改由新 public/private commit adapter 安装 `editBatch/prepareVoxelEdit/prepareVoxelEdits`，adapter 又依赖 prepared metadata、batch planner、fluid sidecar prepared state 和 host。只提交 R2 十文件或只提交 planner 会产生不可编译中间态。

暂存后把 `git diff --cached --binary` 应用到从 HEAD 创建的 detached 临时 worktree，在该隔离树中运行 A1 stdlib `71`、Web `16`、stdlib typecheck、targeted lint/format 与 diff check；不得用主工作树未暂存的 A2/A3/B1 依赖冒充 commit 闭包通过。实际结果全部 PASS，临时 worktree 已清理；自然 hooks 的 Prettier/ESLint 通过，提交 `feat: make world and fluid commits atomic` 已 push，local/remote SHA 均为 `101c600d6fbc9f3547e4262cecd47cebe9b2daba`，ahead/behind `0/0`。

## Commit 2：A1 准出证据和恢复状态

```text
changes/2026-09-23-classic-functional-completion/a1-closure-evidence.md
changes/2026-09-23-classic-functional-completion/a1-closure-review.md
changes/2026-09-23-classic-functional-completion/a1-close-r2-evidence.md
changes/2026-09-23-classic-functional-completion/a1-r2-closing-review.md
changes/2026-09-23-classic-functional-completion/git-03-plan.md
changes/2026-09-23-classic-functional-completion/execution-state.md
```

提交主题：`docs: record A1 atomic commit gate`。自然 hooks 通过后 push，并读回远端 SHA 与 ahead/behind。

## 明确排除与后续批次

- V1.2/A2：`composition/mod-api.ts`、item interaction/fluid-container modules、Authority action/preparation、authorization、network protocol/copy/semantics、Web secondary input、Classic `item-interactions.ts`/`pack.ts` 及相关测试必须形成同一个通用 `interact` 语义闭包；`game-server-gameplay-host.ts` 的 `ItemInteraction`/`resolveItemInteraction` 与 `game-server-gameplay-api.ts` 同批。当前 `classic-fluid-interactions` 的两个 obsolete public-port spy 需先改成真实可控失败接缝，不能恢复 public Station bypass 或删测试。
- V1.3/B1：Structure definition/multi-edit/target/candidate、Classic structures/descriptors/policy 依赖 A1 和后续 B2 host/runtime 接线，不并入 A1。
- A3.2：Authority geometry consumer、protocol projection、mesh/Worker/Web consumer 及 tests 必须等 tuple fixture 收口和 root 冻结完整闭包；`authority-worker-protocol.ts` 同时含 A2 `interact` 与 A3 geometry，必须按批准后的共同批次或精确 hunk处理。
- Media、Lighting、保护清单与其他 change 均不暂存。受保护 dirty：`.github/workflows/ci.yml`、`README.md`、`README.zh-CN.md`、`apps/web/index.html`、`package.json`、两个 unrelated change 目录和两份 browser reports。
