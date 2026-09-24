# Item Interaction 可信视线原点修复证据

记录时间：2026-09-25 06:41:36 CST  
阶段：`V1-ITEM-INTERACTION-ORIGIN-01`  
输入证据：Browser-03 在真实 DOM/PointerLock 路径中选中 `water-bucket`、瞄准 hit `[68,30,2]` / adjacent `[68,31,2]` 并右键，Authority 返回 `blocked`，目标保持 Air。

## 修复

- `dispatchItemInteraction()` 的 voxel 分支现在只从服务端权威 actor body position 计算一次 `playerInteractionOrigin(actor.position)`。
- 半径 5 的 hit/adjacent 距离检查、hit LOS 与 adjacent LOS 全部使用该可信 origin。
- 曼哈顿正交相邻、selection freshness、operation binding/authorization、unknown Chunk 与双 LOS fail-closed 保持。
- entity/self 分支、客户端协议/输入、Structure、Media、fluid handler 和 scenario 均未修改。
- `block-host-commit.ts` 的 registered fluid 分支也在 prepare 与最终 validate 共用可信 eye origin，并对 hit/adjacent 各自复核半径 5；其他 block/mining/Station 分支未改。

## RED

stdlib 精确坐标：

```sh
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec vitest run --config packages/stdlib/vitest.config.ts packages/stdlib/tests/server/item-interaction-security.test.ts --maxWorkers=1
```

首轮结果：`1 failed | 5 passed`。Browser-03 坐标用例期望 handler 被调用，实际收到 `{success:false, reason:'blocked'}`。

Classic 正式 registered route：

```sh
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/tests/integration/runtime/server/composition/classic-fluid-interactions.test.ts --maxWorkers=1 -t 'Browser-03 trusted eye origin'
```

首轮结果：`1 failed | 10 skipped`。正式 Authority interact 同样收到 `{success:false, reason:'blocked'}`，未进入 handler。

fluid host 直接 operation：

```sh
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/tests/integration/runtime/server/composition/classic-fluid-interactions.test.ts --maxWorkers=1 -t 'direct fluid operation'
```

首轮结果：`1 failed | 1 passed | 11 skipped`。合法目标 actor `[0.5,0,0.5]`、hit `[4,3,0]`、adjacent `[4,4,0]` 对可信 eye 均在半径 5 内，但旧 host 从 feet 复核 hit 后返回失败；eye 也超范围的 direct operation 已保持拒绝和零写。

修复后同一命令结果：`2 passed | 11 skipped`。

## GREEN

```sh
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec vitest run --config packages/stdlib/vitest.config.ts packages/stdlib/tests/server/item-interaction-security.test.ts packages/stdlib/tests/server/item-interaction-module.test.ts --maxWorkers=1
```

结果：`1 file / 8 tests PASS`。第二个传入路径在仓库中不存在，Vitest 实际只选择并执行 `item-interaction-security.test.ts`，不把缺失文件计为通过。该文件覆盖 Browser-03 向下目标、非法远 adjacent/对角 adjacent、hit wall、adjacent wall、unknown、可信 eye-origin 半径外和 stale selection；拒绝路径均不调用 handler。

```sh
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/tests/integration/runtime/server/composition/classic-fluid-interactions.test.ts --maxWorkers=1
```

首次 Origin 修复结果：`1 file / 11 tests PASS`。追加 host 闭环后，direct operation 子集为 `2 passed | 11 skipped`，完整最终结果为 `1 file / 13 tests PASS`。Browser-03 精确坐标通过正式 Authority/registry/registered fluid handler 完成创造模式 Water source 放置与空桶收回；每步 world/gameplay revision 各只推进一次，creative inventory 不变。合法 eye 边界 direct operation 现在提交 Water source；eye 超过半径 5 的 direct operation 返回 `OPERATION_FAILED/out-of-range`，world、inventory、gameplay、commitSequence 与 pending receipt 全部不变。既有 Water/Lava 对称、四类 selection stale、occupied/not-source/full、world unchanged/stale 原子失败继续通过。既有 occupied 复合 fixture 仅把 actor 调整到真实可见侧向位置，原断言未削弱。

```sh
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/tests/integration/runtime/server/composition/item-interaction-spine.test.ts apps/web/tests/integration/runtime/server/composition/classic-item-interaction-red.test.ts apps/web/tests/integration/runtime/server/composition/classic-fluid-interactions.test.ts --maxWorkers=1
```

结果：`3 files / 20 tests PASS`。

类型与静态检查：

```sh
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm --filter @seedlands/stdlib typecheck
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec tsc -p tsconfig.test.json --noEmit
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec tsc -p tsconfig.classic-tests.json --noEmit
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec eslint packages/stdlib/src/server/gameplay/modules/item-interaction-module.ts packages/stdlib/tests/server/item-interaction-security.test.ts apps/web/tests/integration/runtime/server/composition/classic-fluid-interactions.test.ts
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec prettier --check packages/stdlib/src/server/gameplay/modules/item-interaction-module.ts packages/stdlib/tests/server/item-interaction-security.test.ts apps/web/tests/integration/runtime/server/composition/classic-fluid-interactions.test.ts changes/2026-09-23-classic-functional-completion/item-interaction-origin-contract.md
```

结果：全部 PASS；`git diff --check` 无输出。所有重命令均各自完整位于默认 `benchmark-window` 内。

## 文件身份

- `5d0e61e339297314e0342a17fa4b32191b3384ff4b16c601e9e678056659cd0a` `packages/stdlib/src/server/gameplay/modules/item-interaction-module.ts`
- `1e2dd14718df37673678a89612d4b5a8d169120f87f2c6313a0ff74753e017f7` `packages/stdlib/tests/server/item-interaction-security.test.ts`
- `89421e4f4be44d0a18e22965f73745dffb3a4f905ca1c1b61765a178eede062f` `packages/stdlib/src/server/gameplay/modules/block-host-commit.ts`
- `affe1a64ef385efdc56fb5f0f50438b7083c375758b3e5c1817f1a567a66ec36` `apps/web/tests/integration/runtime/server/composition/classic-fluid-interactions.test.ts`
- `82e9aa5a4a7fdeeafb1b1018140e5b4f6e8190bdef6dd456bf11c3e6b437da3e` `changes/2026-09-23-classic-functional-completion/item-interaction-origin-contract.md`

## 残余与未执行

- 未运行 Browser-04、完整 build、Cua、CI、Git commit/push 或部署。产品层仍需 root 在新提交和新 artifact 后授予下一次唯一 browser lease。
