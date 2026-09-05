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

## Authority Actor 规则接线补充

### 问题与边界

主线接入 Logic Worker 后，Authority 只把高层意图转换为移动输入；原 `applyLogicAction()` 会让攻击只在首次意图时直接扣血、让进食直接删除整个掉落，并对 `start-existing-action` 永久保持 pending。与此同时 `advanceGameplayRules()` 没有推进 Actor needs、攻击冷却或动作完成条件。旧 `AutonomyRuntime.advance()` 同时执行感知、导航、直接坐标移动，不能重新接回新 Authority 物理路径。

本补充只恢复 Authority 拥有的规则和 Action canonical 生命周期：

- gameplay lane 按真实 active seconds 有界推进 Actor hunger、攻击冷却和移动动作到达判定。
- Logic 只提交意图；Authority 按当前实体、身份、距离、视线、冷却、食物类型和动作 ID 再校验。
- 攻击一次意图只产生一次伤害；同一 observation batch 重放拒绝，冷却结束后的新 observation 才能再次攻击。
- 进食只消费世界物品堆叠的一份，满足 Actor 饥饿并完成对应 Action；远处、隔墙或非食物目标不改变 canonical 状态。
- 移动仍由 `AuthoritySession` 固定步物理完成；Actor 规则只观察到达并结束 Action，不调用旧导航、感知或直接坐标移动大循环。
- 玩家受击会保留 Actor `flee` 状态和攻击者目标，供 Logic 的下一次观察生成逃跑意图。

### RED 用例

- `tests/server/authority-actor-rules.test.ts`
  - 夜行者在合法距离和视线内攻击一次，立即第二次被冷却拒绝；规则时间推进一秒后可再次攻击。
  - 远距离与隔墙攻击均拒绝且不创建 Action、不扣血。
  - 饥饿草食者消费数量为 2 的浆果掉落时只减少一份、饥饿归零、Action 成功；远处消费拒绝。
  - `move-to` Action 由 Authority 物理位置进入到达半径后成功，规则推进不会直接修改坐标。
  - 五秒规则时间增加 Actor hunger，且不增加旧感知/导航/行为评估指标。
  - 同一 `LogicIntentBatch` 重放只执行一次，避免重复消费或伤害。

预期 RED：当前 `GameServer` 不存在 `applyActorAuthorityAction()`，`advanceGameplayRules()` 不推进 Actor 状态，Authority 会重复接纳相同 observation 的 intent batch。

实际 RED（2026-09-06）：`pnpm exec vitest run tests/server/authority-actor-rules.test.ts` 共 6 项失败；失败分别证明动作 Authority API 缺失、Actor hunger 未推进，以及相同观察意图可被重复接纳。

### 实现与 GREEN

- 新增独立 Actor Authority 规则与 gameplay 校验模块；攻击、进食、移动 Action 的创建、完成、失败与冷却都只修改服务端 canonical 状态。
- 世界物品进食改为原子消费一个堆叠单位；当前距离、视线、玩家存活和食物类型校验失败时不创建动作。
- gameplay rules lane 只推进 Actor needs、冷却和到达判定，未重新调用旧的感知、寻路、行为评估和直接移动循环。
- `LogicIntentBatch` 的 observation 在首次处理时消费；重复包无法再次造成伤害或进食。动作导致的 canonical 变化由 Authority 统一计入一次提交。
- 玩家攻击 Actor 时保留受击者的 `flee` 及攻击者目标；Logic 决策覆盖从当前权威观察生成远离攻击者的移动意图。

实际 GREEN（2026-09-06）：

- `pnpm exec vitest run tests/server/authority-actor-rules.test.ts tests/server/logic/logic-decision.test.ts tests/server/authority-runtime.test.ts tests/server/simulation-command-persistence.test.ts`：4 文件、23 项通过。
- 本补充涉及的 TypeScript 与测试文件 ESLint 通过，新增拆分后未放宽 `max-lines` 规则。
- `git diff --check`：通过。
- `pnpm exec tsc --noEmit` 当前只被并行 world-clock Worker 协议接线的两项诊断阻塞；本补充文件未出现在诊断中，由主线接口收敛后统一复验。

阶段：Authority Actor 规则实现与局部验证完成，交还主线完成 Worker 与浏览器整体准出。
