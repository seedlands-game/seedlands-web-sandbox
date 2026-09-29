# Legacy Gameplay 布局转换收口证据

## 范围

- 仅修改 `gameplay-snapshot.ts` 与本阶段定向测试/证据。
- V1-V3 转换保留旧 24/8 布局；V4 验证继续使用当前 composition 的 player layout。
- 不修改 EntityStore、PlayerState、checkpoint owner、Classic padding 或旧存档语义。

## RED

使用新的 stdlib 定向测试，通过真实 `validateGameplaySnapshot` 构造 V1、V2、V3 player-only snapshot；每个 player 都是合法 legacy 24 格 inventory、8 格 hotbar、`selectedSlot=7`，并在 slot 7/23 保存不同物品。验证选项传入当前 36/9 `playerLayout`。没有修改或调用 a288 的 lineage/needs 测试。

```text
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec vitest run --config packages/stdlib/vitest.config.ts packages/stdlib/tests/server/legacy-gameplay-layout.test.ts --maxWorkers=1
```

RED 结果：`1 file / 7 tests`，`3 failed / 4 passed`。V1、V2、V3 三个合法 legacy case 均失败于：

```text
TypeError: Inventory snapshot capacity does not match.
Inventory.replace -> new PlayerState -> validateGameplaySnapshot
```

同一 RED 中，当前 V4 36/9 保留用例和三种畸形 legacy 负例已经通过，证明问题仅发生在 V1-V3 转换 owner 过早采用目标 36/9 布局。

## 修复与回归

- `validateGameplaySnapshot` 仍只创建一个临时 validation `EntityStore`，但 layout 按 source version 分流：V4 使用 `options.playerLayout`，V1-V3 传 `undefined`，即复用既有默认 24/8。
- 没有修改 `EntityStore`、`PlayerState`、checkpoint owner、inventory layout validator 或 Classic content；没有 padding、截断、复制到 36 格，也没有把新建 player 的默认布局改成 24/8。
- V1-V3 输出的 V4 candidate 继续携带原 24 格 inventory、8 格 hotbar、`selectedSlot=7`；slot 7/23 的物品和数量保持。调用方 source 对象在成功和失败路径都不被修改。
- 输出 V4 的 `entityStore` 通过既有 `restoreComponentSnapshot` 装入当前 36/9 `EntityStore`，并按既有合同保留 legacy 24/8 player 布局。
- V4 输入仍在目标 36/9 validation owner 中验证；36 格 inventory、9 格 hotbar、`selectedSlot=8` 与 slot 35 物品保持。
- legacy inventory 23 格、hotbar 9、selected slot 8 均继续拒绝，默认 24/8 owner 不吞掉畸形输入。

所有重命令均独立通过默认 `benchmark-window`；Vitest 使用 `--maxWorkers=1`：

- `node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec vitest run --config packages/stdlib/vitest.config.ts packages/stdlib/tests/server/legacy-gameplay-layout.test.ts --maxWorkers=1` -> `1 file / 7 tests PASS`。
- `node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec vitest run --config packages/stdlib/vitest.config.ts packages/stdlib/tests/server/legacy-gameplay-layout.test.ts packages/stdlib/tests/server/player-inventory-layout.test.ts --maxWorkers=1` -> `2 files / 11 tests PASS`。最终格式化后复跑同一命令仍为 `2 files / 11 tests PASS`。
- `node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm --filter @seedlands/stdlib typecheck` -> PASS。
- `node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec tsc -p tsconfig.test.json --noEmit` -> 首轮只报新测试三条 inline mutation lambda 的 TS7024；补显式 `: void` 后复跑 PASS。
- `node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec eslint packages/stdlib/src/server/gameplay/gameplay-snapshot.ts packages/stdlib/tests/server/player-inventory-layout.test.ts packages/stdlib/tests/server/legacy-gameplay-layout.test.ts` -> PASS。
- `node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec prettier --check packages/stdlib/src/server/gameplay/gameplay-snapshot.ts packages/stdlib/tests/server/player-inventory-layout.test.ts packages/stdlib/tests/server/legacy-gameplay-layout.test.ts changes/2026-09-23-classic-functional-completion/legacy-layout-closure-evidence.md` -> PASS。
- `git diff --check -- packages/stdlib/src/server/gameplay/gameplay-snapshot.ts packages/stdlib/tests/server/player-inventory-layout.test.ts packages/stdlib/tests/server/legacy-gameplay-layout.test.ts changes/2026-09-23-classic-functional-completion/legacy-layout-closure-evidence.md` -> PASS。

最终 SHA-256：

```text
0d1df1e75f11117631dfd99515319602d35cc866983fa1dfabacd287e03ccd2e  packages/stdlib/src/server/gameplay/gameplay-snapshot.ts
b498c79ff6fbcfbe5f1d949f141a0bead6075d24e7212e3a9e51da8d321ed6f6  packages/stdlib/tests/server/player-inventory-layout.test.ts
080a168141a639e8b7c4773cee7879afad1af86f5c5243d752dacc97636d03ce  packages/stdlib/tests/server/legacy-gameplay-layout.test.ts
0f953ca5921500998e0106e21446ee7aa4650c7fa62152780d8f6cdfb798edbf  changes/2026-09-23-classic-functional-completion/legacy-layout-contract.md
```

`gameplay-snapshot.ts` 的哈希包含此前已存在的 Media optional child 修改；本任务新增的 production diff 仅为 sourceVersion layout 分流。本任务未修改的既有合同测试 `player-inventory-layout.test.ts` 哈希保持不变。

## 未执行项

- 未运行 build、browser/dev server、Web tests、完整仓库测试、CI、Git commit/push 或部署。
- 未复跑 a288 的真实 needs/lineage 测试；root 将在接收本 checkpoint 后通知 a288 复跑。
