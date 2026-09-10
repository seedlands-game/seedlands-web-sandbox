# S3d 模式化方块交互证据

## 结果

- `GameplayRuntime` 将 `beginBreak`、`cancelBreak`、`placeVoxel` 与 break advance 委托给新的 `BlockInteractionRuntime`。该 owner 只接收玩家、实体、每世界 item registry、体素读写、变更记账与掉落生成回调，没有平行库存或世界状态。
- creative 放置从 `creativeCatalog.hotbar[selectedSlot]` 解析当前世界物品能力，不读取、选择或扣除 survival inventory。`selectHotbarSlot` 在 creative 时调用 `ModeRuntime.selectCreativeSlot`，survival 继续调用原 `ActorInventoryRuntime.select`。
- creative break 在 `beginBreak` 中立即调用真实 `editVoxel`，成功返回同一个 `WorldCommitResult`、`requiredSeconds: 0`，不创建 survival drop。失败 commit 返回 `world-not-changed`，不建立 break action 或修改 gameplay state。
- survival 仍使用 hardness、选中工具 multiplier、累计时间、完成 commit 与原 voxel drop；survival 放置仍在 commit 成功后扣除一件物品并记一次 inventory operation。
- mode owner 的 `changed` 回调现在只推进 gameplay revision；切换时清零 velocity 已由根任务放入 `ModeRuntime.switchMode` 的真实事务提交，因此 creative 目录选择不会错误清零飞行速度。
- 提取后 `gameplay-runtime.ts` 通过既有 500 effective lines ESLint 门禁，没有禁用或放宽规则。

## RED

生产方块行为修改前执行：

```text
pnpm exec vitest run tests/server/creative-block-interactions.test.ts

Test Files  1 failed (1)
Tests       3 failed | 1 passed (4)
```

三个失败分别为：creative slot 选择仍改 survival slot 而没有改变目录 selected slot；creative break 返回 1.2 秒计时且没有 commit；creative placement 因读取空 survival slot 返回 `no-selected-item`。同一文件的 survival 工具、计时、掉落与放置消耗基线先行通过。

## GREEN 与回归

```text
pnpm exec vitest run tests/server/creative-block-interactions.test.ts

Test Files  1 passed (1)
Tests       4 passed (4)
```

覆盖实际 GameplayRuntime 的 creative 目录选槽/放置、库存不变、立即破坏、原 commit identity、无掉落；以及未加载、越界、玩家碰撞、破坏与放置 commit 拒绝的无副作用验证。

```text
pnpm exec vitest run tests/server/creative-block-interactions.test.ts tests/server/survival-gameplay.test.ts tests/server/lantern-gameplay.test.ts tests/server/fluid-interactive-priority.test.ts tests/server/gameplay-foundation.test.ts tests/server/composition/gameplay-registered-mode.test.ts

Test Files  6 passed (6)
Tests       41 passed (41)
```

`pnpm --filter @seedlands/game-core typecheck`、owned ESLint/Prettier 与 `git diff --check` 均通过。`pnpm exec tsc -p tsconfig.test.json --noEmit` 没有报告 owned 文件错误，但整条命令当前被根任务并行中的 `tests/client/creative-mode-ui.test.ts` 两项类型错误阻塞，待根任务收敛 UI fixture 后统一复跑。

## 集成 API 与边界

```ts
beginBreak(
  id: string,
  position: [number, number, number],
): GameplayResult<{ requiredSeconds: number; commit?: WorldCommitResult }>;
```

survival 成功开始计时不含 `commit`；creative 成功立即破坏并含 `commit`。根任务已在 `authority-player-action.ts` 的 `begin-break` 分支读取该可选 commit 并调用 `publishCommit`，与 place 使用同一 AuthorityRuntime pending commit 通路。

本切片没有修改 facade、命令、Authority、GameServer 或 UI；这些文件由根任务集成。未运行全量 static/build、真实 GameServer 世界编辑旅程或浏览器验收，不声明完整 S3d 交付。未新增 block definition、工具系统或并行物理/库存实现。
