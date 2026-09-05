# Game Logic Worker 实施记录

## 范围

本任务只实现 `src/server/logic/**` 的纯观察到意图计算、`src/worker/game-logic-worker.ts` 执行环境适配，以及对应的 server/worker 单元测试。Authority 的观察构造、revision 复核、动作执行与浏览器路由由主线集成任务负责。

## RED 设计

- `tests/server/logic/logic-decision.test.ts`：锁定觅食、昼夜敌对、居民日程、身体尺寸导航、未知地形保持、读集版本与窗口边界。
- `tests/worker/game-logic-worker.test.ts`：锁定初始化/epoch、观察到意图包、dispose，以及只在明确 Harness 会话启用的阻塞注入。

## 当前状态

阶段：已取得预期 RED，开始实现。

首次 RED（2026-09-06）：

```text
FAIL tests/server/logic/logic-decision.test.ts
Cannot find module '../../../src/server/logic/logic-decision'

FAIL tests/worker/game-logic-worker.test.ts
Cannot find module '../../src/worker/game-logic-worker'
```

两套用例均在生产模块缺失时失败，证明用例不是在验证旧路径。

## 实现结论

- `LogicObservation` 与 `LogicIntentBatch` 的协议、Worker 包络和边界常量已集中在 `logic-protocol.ts`。
- 意图有效期按 `LOGIC_INTENT_TTL_MS = 200` 换算为物理 tick；初始化必须显式提供 `physicsHz`，30/60/120Hz 分别得到 6/12/24 tick，避免切频后墙钟语义变化。
- 地形窗口限制为单轴最多 32、单窗最多 32768 cell，禁止重叠；占用索引固定为 `x + sizeX * (z + sizeZ * y)`，支持非 32 尺寸窗口。
- 决策保留原有生物/NPC 的视距、觅食、逃跑、昼夜敌对、攻击距离、居民日程、POI 与既有 Action 语义。Worker 只输出移动、跳跃和高层动作意图，不修改坐标、速度、库存、伤害、体素或 Action canonical 状态。
- 导航使用 `bodyConfigFor()` 的真实身体宽高，未知 terrain cell 一律视为阻挡；若目标所需窗口缺失则返回零移动保持意图。
- `block-for-test` 仅在 `init-logic.harnessEnabled=true` 时执行，普通产品会返回明确 `logic-fatal` 拒绝。

## GREEN 与静态证据

- `CI=true corepack pnpm exec vitest run tests/server/logic/logic-decision.test.ts tests/worker/game-logic-worker.test.ts`：2 文件、10 用例通过。
- 所属文件 Prettier 检查通过。
- 所属 TypeScript/测试文件 ESLint 通过。
- 所属 TypeScript/测试文件以项目等价 strict/noUnused/DOM+Worker lib 参数单独编译通过。
- `git diff --check`：通过。

完整项目 `pnpm typecheck` 当前仍被主线并行开发中的 `browser-authority-client.ts`、`authority-worker.ts` Mesh payload 接口未完成阻塞；本任务文件未出现在诊断中。最终项目静态准出由主线集成任务在接口收敛后统一执行。

## 交接接口

- `decideLogicIntents(observation, { physicsHz })`
- `createGameLogicWorkerHandler({ postMessage, nowMs?, close? })`
- `LogicWorkerRequest` / `LogicWorkerResponse`
- `terrainOccupancyIndex(size, localX, localY, localZ)`

阶段：模块实现与局部验证完成，等待 Authority/app 主线接线。
