# Authority 完整基线真实语料计划

## 目标

以已提交 `46d1729` 的 `DedicatedServerHost.captureBaseline()` 为唯一生产采集入口，留下可复核的完整块语料和现有网格输入消费者 oracle。该语料证明 Host 能从真实 `runDedicatedComputeTask` 生成的远离初始区块取得 owned 27 块 mesh 基线，以及 edited main 与 collision-resync 的真实 revision/checkpoint；不声明远端会话、分页、浏览器安装、codec 或性能结论。

## 范围与准出

1. 在 `network-baseline-corpus.test.ts` 先取得缺少 recorder 的 RED，再实现 change-local recorder 与专用 Vitest 配置。
2. 固定受控 seed、远离 starter 的主 key，运行三个真实 Host 场景：未编辑 mesh 27 块；通过 `AuthorityRuntime.editWorld()` 修改 main 后的 mesh 27 块；同 key 的 collision-resync 1 块。
3. 首次调用本地 `prepareWorkerMeshInput()` 必须证明确实允许省略未 materialized 基础块；三个 capture 则必须按 role 取得完整 27/1 项。将 owned entry 全量输入 `createProceduralMeshInput()`，断言 `proceduralVoxelSamples=0`、`macroContextCount=0`，并保持 canonical/fluid 值。
4. 采集器把 canonical 转为明确的 `uint16-le` sidecar，fluid 保持 `uint8`；每个块绑定长度、revision、SHA-256、producer input/output 哈希、真实 checkpoint，以及 git SHA、tracked diff 和显式 source 文件哈希。
5. 最终目标 `/tmp/seedlands-network-baseline-corpus-v1-r2` 以发布 claim 保护；已存在即失败，普通测试绝不覆盖或重写。capture 后再 edit，不得改变先前 owned entry 的字节。此前 r1 在格式/类型检查前被默认测试超时中断，保留为未采纳的失败 generation，绝不覆盖。

## 已知缺口

当前 Host capture 仍是内部 Authority 能力：没有公开 interest/session owner、分页/descriptor、可靠传输、浏览器 Remote adapter 或实际安装。任何 capture 失败/取消、跨 stream 乱序和 1 MiB 分片预算仍由后续真实 adapter 覆盖。

## 预期命令与证据

仅运行官方 Node `v22.23.2` 下的专用 Vitest 配置、受影响文件的 Prettier 与 ESLint。生成物 manifest/frames/block sidecars 与 JSON 证据记录实际命令、版本、环境、哈希和 `NOT_COLLECTED` 项；不运行全仓检查、构建或性能采样。
