# 已注册 actor 密度语料进度

## RED → GREEN

- RED：先新增仅导入不存在 `network-gameplay-density-corpus-recorder` 的 change-local 用例；Node 22 收集失败，明确报缺少该 collector，未把手写 JSON 当作采集完成。
- GREEN：补齐 collector 后，以两个独立的真实 `DedicatedServerHost`、固定 seed 与独立 `MemoryGamePersistence` 运行。每档通过 `local-developer` 身份在既有 `executeCommand` 边界执行 `spawn-actor`，没有直接写入 `EntityStore`、actor map 或 snapshot。
- 每档在最后一个真实命令后只推进一次有界 `wake`，确认 `physicsTick` 从先前快照推进至 3；本次未采集耗时、吞吐、CPU、内存或 p95。

## 最终 generation

输出根目录为 `/tmp/seedlands-network-gameplay-density-corpus-v1`。每档均写入同一顺序的 `player-correction`、`entity-pose`、`gameplay-consumer` 三条 records；后续 [C0/C1/C2 验证](network-density-codec-progress.md) 已只读消费这些 records，没有改写语料。

| 档位 | 固定 seed                             | registered actors | pose / total entities | Gameplay v2 非玩家实体 | gameplay revision | manifest payload SHA-256                                           | corpus SHA-256                                                     |
| ---- | ------------------------------------- | ----------------: | --------------------: | ---------------------: | ----------------: | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| 32   | `network-gameplay-density-actors-32`  |                32 |               34 / 34 |                     33 |               139 | `7435236b456386550828435cd4dc948faff68768c4131df38ffd8617fab09ae7` | `f42c90a33d07a9a794d8f6dab1190c36a59ab612ae63dc0fd8bd00f4337a59cc` |
| 128  | `network-gameplay-density-actors-128` |               128 |             130 / 130 |                    129 |               524 | `8f4ebd0eef84821a7d01eaf5370081adfed0063b6f4bf08ad3247ae385ef1b78` | `cc303124a2cd14e98e0b6cb35b2107d5bddf1de514ae6e96ab8fd42027556852` |

fixture 只有一名 player，故每次都断言 `poseEntityCount = totalEntityCount`、`gameplayEntityCount = totalEntityCount - 1`；当前 34/130 均在 256 pose gate 内。actor 格点依据实际玩家位置生成，使用 16 列、间距 3 的确定性布局，逐项验证互不重叠；starter ecology 与世界物品保持真实来源，未修改地形，也未要求 actor 达到特定 AI 活动率。

逐条 `contentSha256`：

| 档位 | correction                                                         | pose                                                               | Gameplay v2                                                        |
| ---- | ------------------------------------------------------------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| 32   | `6a4473615df23542814f9ab2e198416ea0a564679ae3926c7e670f18a41bf7d7` | `c584fe29b07661cb19989e048c6f37ff25d60ac724038e58d5014a3c99bf45f5` | `a267c667309ea0d3b2fcd6b8628e4fef2a27af27786a2cb047f6791ede66195d` |
| 128  | `e57f8698a68e5dcc218cd3b2fc5dfdab7bb0a7343029749c276eb59cb7e7749d` | `4de3ca0108a838022190e7eb9c7270ebd34bbba30a9db51deff2ca6419941184` | `d484ead3ac84ae83d54d0dd38ee8a2de62148e38f108a31ce9f4c13460251716` |

collector 在写盘后重读 frames 与 manifest，并同内存结果 `deepStrictEqual`；同时复算每条内容 hash、frame index、manifest payload/corpus hash、provenance、配置及显式 source hashes。运行前后比较已存在的旧 real/directional/entity/gameplay-consumer corpus 文件 hash，结果保持不变；历史临时文件不存在时只不纳入该比较，不把缺失当作新 generation 的证据。

## 验证与边界

- Node 22.23.2：`vitest run --config changes/2026-09-06-node-dedicated-server/e2e/vitest.gameplay-density-corpus.config.ts --no-file-parallelism --maxWorkers=1`，`2/2` 通过。
- 新 test、collector、config 与计划：Prettier、ESLint 通过；`pnpm typecheck`（含 `tsconfig.test.json`）通过；`git diff --check` 通过。
- 本语料只补当前公开 Gameplay v2、pose、correction 的真实密度来源。它不证明 startup、commit、interest、baseline、传输、浏览器 GUI、WAN、客户端生命周期、完整 N2 或任何性能结论；512 retained actor 上限和 256 pose gate 均未改变。

## 独立复核

另一位 Terra agent 只读检查生产调用路径和两档生成物，复算 manifest、逐条内容、当前五个显式 source hash 与数量、id 关联，未发现 P1；两个 Host 的时钟、存储、executor 和 records 均独立。复核没有重跑采集，也没有把历史 GREEN 当作新运行。

已知 P2：同档目录写入未使用原子成对替换或锁，故冻结后不并发重采或覆盖；未来重复采集应采用新 generation。显式输入只列关键投影与 collector/test，其他 tracked 依赖由当时 Git SHA 和 tracked diff SHA 共同定位，不声称拥有完整传递依赖闭包。
