# Authority 完整基线真实语料进度

## 已完成

2026-09-07，以已提交 `46d1729` 的 `DedicatedServerHost.captureBaseline()` 和真实 `runDedicatedComputeTask` 生成最终 generation：`/tmp/seedlands-network-baseline-corpus-v1-r2`。该目录已发布后只读校验；采集器遇到已存在 generation 会拒绝，普通测试不会覆盖、重写或重新采集它。

Node `v22.23.2` 的专用 Vitest 实际通过 1 文件、1 用例。采集前受影响文件的 Prettier 与 ESLint 通过；当时全 `tsconfig.test.json` 的唯一错误是并行未落盘的 `network-reference-baseline` 模块，不属于本 collector，root 已确认不阻塞本次采集。r2 发布后再运行专用用例，只读校验 manifest、frame、block SHA-256、producer input/output 原文与当前明确 source 集合，无任何写入。

| 场景                                               | request                                       | checkpoint                         | 主项 revision | entries             |
| -------------------------------------------------- | --------------------------------------------- | ---------------------------------- | ------------- | ------------------- |
| 未编辑 mesh                                        | `captureId=0`，`mesh`，`80,0,80`，minimum `0` | physics `0`，commit `2`，world `1` | `0`           | main 1 + overlay 26 |
| main 经 `AuthorityRuntime.editWorld()` 修改后 mesh | `captureId=1`，`mesh`，minimum `1`            | physics `0`，commit `3`，world `2` | `1`           | main 1 + overlay 26 |
| 同 key collision-resync                            | `captureId=2`，minimum `1`                    | physics `0`，commit `3`，world `2` | `1`           | collision-resync 1  |

第一次本地 `prepareWorkerMeshInput(80,0,80)` 在远处基础块未驻留时没有 canonical、fluid 或 overlay；第一份 27 块 capture 完成后，同一 API 对已经驻留但仍未 materialized 的基础块仍省略它们。两份 mesh capture 都把完整 owned main 与 26 overlay 输入 `createProceduralMeshInput()`，得到 `proceduralVoxelSamples=0`、`macroContextCount=0`；左侧 overlay 的真实非 Air 边界体素也与生成的 halo 对应位置相同。capture 后的 `editWorld()` 没有改变第一份 owned canonical/fluid 副本。

每个 canonical block 都由 `Uint16Array` 数值明确重写成 `uint16-le`；fluid 为 `uint8`。目录有 110 个 block sidecar：两份 mesh 各 54 个、collision 2 个。每份 mesh 原始块总量为 2,654,208 B，collision 为 98,304 B；这只是块容量，不是 RPC、wire、吞吐或延迟测量。

完整精确哈希、source 文件集合和命令在 [JSON 证据](network-baseline-corpus-evidence.json)；r2 的 manifest SHA-256 为 `0d2959e728f73a30efec8c9bac0f58269b9d0b51f3c73c23b0640fbbb1b7b0ad`，frames SHA-256 为 `2d3a0a9fd1670c087367fbb1c9330eda9e2484d9e7facd665892c6128e5f3b91`。

## 仍未采集

这只证明 Authority 内部 owned baseline capture 与既有纯 world mesh 输入的强数据关系。公开 interest/session owner、取消状态机、descriptor/page 分片、可靠传输与背压、Remote adapter、浏览器安装、capture 中取消/superseded/传输故障都仍是 `NOT_COLLECTED`，不得把本语料称作远端接线或浏览器 E2E。

先前 `/tmp/seedlands-network-baseline-corpus-v1-r1` 曾在 Vitest 默认 5 秒超时后才完成写入，且早于最终 formatter/type 门；它保留且不覆盖，但不作为本 change 的采用证据。最终 r2 在显式 30 秒用例上限、最终 source 输入和 fail-closed 发布条件下生成。
