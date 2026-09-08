# 真实客户端基线消费接线审阅

本页主体保留实施前的接线审阅与范围判断。`234e4c8` 已实现完整 worker/source 接缝，随后 consumer 与真实组合测试按独立切片推进；最新实施和验证状态从 [阶段快照](validation-summary.md) 进入，不把下面的历史缺口当成当前源码结论。

## 实施前事实

本记录只审阅当前已提交的基线参考、浏览器 `World`、worker-first 调度和预测碰撞调用链；不代表远端会话、codec、传输或 GUI 已采用。

- `src/server/protocol/network-reference-baseline-reassembly.ts` 已能把已验证的 descriptor/page 交付为独立的 LE canonical 与 fluid block，但没有任何客户端消费者接收该产物。
- `src/app/world/world-runtime.ts` 的 `World` 在流送时固定经 `ensureChunkNeighborhood()`、`prepareWorkerInput()` 和 `acceptWorkerCanonical()` 组合 `MeshTaskScheduler`。`WorldAuthorityPort` 同时还含 `setFluidActiveChunks()`、编辑、时钟和本地 Authority 资源释放能力，不能原样作为远端端口导出。
- `src/app/world/mesh-task-dispatch.ts` 的 worker-first `WorkerInput` 只有主 revision，`haloRevision` 是 `worker-input-${sequence}`；overlay 没有 revision。结果回包因此无法识别任一 26 项 halo 被提交替换后的旧任务。
- `src/worker/world-compute-task.ts` 的 `generate-mesh` 接收缺失 canonical/overlay 时会调用 `makeChunk()` 或 `createProceduralMeshInput()` 的程序化兜底。完整基线没有在此入口强制 27 项输入，故仅把 reassembler 输出转成旧 `WorkerInput` 仍会留下浏览器生成路径。
- `BrowserAuthorityClient` 的 `acceptWorkerCanonical()` 在 prepared canonical 不相等时发送 `accept-generated-chunk`（`src/client/authority/browser-authority-client.ts`）。该路径对当前本地 Authority 合法，但远端基线接线不得调用它。
- 预测碰撞的实际门禁位于 `PlayerController.collisionWorld()`：revision 为 `null` 时返回未知 voxel；`VoxelCollisionWorld` 将未知作阻挡。远端接线必须继续由 `getChunkRevision()` 控制可读性，不能让 `AuthorityCollisionBaselineClient.getVoxel()` 的 Air fallback 绕过此门禁。
- `World.consumeServerCommit()` 只按 `structuralChange.meshChunks` 调度重网格；它不知道完整 halo owner 对 `chunkRevisions` 的反向依赖。因此只接入主 key 会让 overlay 变更后的旧 preparation 继续被 worker 使用。
- `AuthorityCollisionRevisionGuard.satisfy()` 会将该 key 的 `minimumRevision` 清为零，不能作为远端 mesh preparation 的“当前所需版本”唯一来源。consumer 需要独立保存 owner 的完整 revision vector/每 key 水位；guard 继续只负责 collision 可读性与基线 lease。
- `publishAuthorityCollisionCommits()` 记录连续性和溢出重同步，但乱序 commit 仍在到达时立即调用现有应用回调；它不是把 commit 缓冲到严格顺序后再应用的队列。本切片只能在该实际语义上失效 preparation，不能误称已获得严格重排交付。

## 可执行的最小切片

本切片只让**已经由可信 session/codec/reassembler 接纳的完整 bundle**驱动现有浏览器 mesh worker 与预测碰撞。它不实现网络监听、interest 状态机、基线请求发送、动作、fluid/logic 上行或 GUI。外层后续 adapter 以显式 `acceptReassembledBaseline(owner, bundle)` 调用本切片；没有此调用时不得把浏览器切到远端模式。

建议同时修改下列生产边界，缺任何一项都不能宣称“基线替代浏览器生成”。

1. 新增 `src/client/authority/network-baseline-consumer.ts`，只接受 `ReassembledBaselineReference` 和已认证的 owner 上下文。它验证连接代次、request/purpose/key/generatorVersion、完整 27/1 entry、每项 role/key/revision、以及 owner generation；以显式 LE 读取生成 `Uint16Array`，复制 fluid，并预留自己的 cache/preparation 字节。它保存 key 到 owner 的反向依赖和引用计数，安装 collision 仍复用 `cacheAuthorityCollisionBaseline()` 与 `AuthorityCollisionRevisionGuard`。不完整、过期、取消或预算不足的 bundle 必须整组拒绝，不能安装部分数据。
2. 新增小的 `src/client/authority/network-baseline-worker-input.ts`（或与消费者同文件，若大小允许），从已接纳的完整 preparation 生成 worker transfer 副本。它给 main 与每个 overlay 保留 revision，并用固定数值 Chunk key 顺序的完整 27 项 `(key, revision, generatorVersion)` 向量生成 `haloRevision`。每次 `snapshotForWorker()` 都复制 buffer；worker 的 transfer 不得 detach consumer cache。
3. 修改 `src/app/world/mesh-task-dispatch.ts` 和 `src/client/compute/mesh-task-snapshot.ts`，让 worker-first dispatch 接收上述稳定 halo identity，而不是 `worker-input-${sequence}`。本地旧 Authority 路径可明确提供其现有 identity，远端路径不得回退合成 sequence。`WorkerOverlay` 至少携带消费层用于失效核对的 key/revision；wire message 可只携带坐标和已由 task 绑定的 identity。
4. 修改 `src/worker/world-compute-task.ts` 的 `generate-mesh` 入口：远端完整-baseline variant 必须要求 main canonical/fluid 和完整、唯一的 26 项 canonical/fluid overlay，缺一项、重复、坐标不匹配或长度不符即失败，随后再调用既有 `createProceduralMeshInput()`。这样保留现有网格算法，同时可以用其 `proceduralVoxelSamples === 0` 证明没有兜底生成；不能另写测试 reducer 或另一个 mesh 算法。
5. 修改 `src/app/world/mesh-task-scheduler.ts` 与 `src/app/world/world-runtime.ts`，把“worker 结果是否可接纳”的本地身份核对从 `acceptWorkerCanonical()` 的 Authority 写入语义中分离。远端 consumer 只比较 task 的连接代次、main revision、完整 halo identity、generatorVersion 和 canonical；不相等即丢弃。远端回包绝不能转为 `accept-generated-chunk`。`WorldAuthorityPort` 应拆出仅供流送/碰撞读取的受限客户端端口，或在 `World` 构造处显式注入该受限端口；不得把 `editWorld()`、`setFluidActiveChunks()`、`release-mesh` 等本地 Authority 控制能力封装成远端通道。
6. 在 `src/app/world/world-runtime.ts` 的 commit 入口或 consumer 的 commit bridge 中，先按所有 `structuralChange.chunkRevisions` 查反向 halo owner 依赖并失效对应 preparation/task，再继续现有 `meshChunks` 的表现重网格。consumer 的独立每 key 水位不能在 guard `satisfy()` 后丢失。commit 仍按 `publishAuthorityCollisionCommits()` / `applyAuthorityCollisionCommit()` 当前到达即应用的语义处理；链断或重排窗口溢出时保持 revision 不可读、请求重同步，不能由基线 consumer 补 Air，也不能把它说成严格重排队列。

这六项可作为一个有限的“已接纳基线到现有 worker/碰撞读取”包。它不应同时重做 `BrowserAuthorityClient` 的完整动作、存档或 transport；这些仍由后续 session adapter 提供。为避免远端模式误调用本地控制方法，实际 app 组合要等受限端口和上游 session adapter 同时具备后才启用，不能用空函数或 silent fallback 启动。

## 预置 RED 与可复用测试

| RED 场景                                               | 复用入口                                                                                                                                                                                           | 必须断言                                                                                                                 |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 真实 capture → 参考投影/重组 → consumer → worker-first | `changes/2026-09-06-node-dedicated-server/e2e/network-baseline-reference-corpus.test.ts`、`tests/server/network-reference-baseline-reassembly.test.ts`、`tests/worker/compute-worker-task.test.ts` | 27 项均进入 worker，`proceduralVoxelSamples` 为 0，结果不出现 `accept-generated-chunk`                                   |
| 缺 overlay/fluid、重复 key、错误 LE 长度或错误 owner   | 新 consumer 单元测试；复用 `tests/server/network-reference-baseline-reassembly.test.ts` 的严格输入夹具                                                                                             | worker 不被 postMessage，collision/preparation 均无部分安装                                                              |
| overlay revision 改变后旧 worker 回包                  | `tests/client/mesh-task-snapshot.test.ts`、`tests/app/mesh-task-scheduler.test.ts`、`tests/app/world-authority-commit-routing.test.ts`                                                             | 完整 halo vector 变化使旧回包 stale；反向依赖 owner 被失效，即使 overlay 不在旧 `meshChunks`                             |
| transfer 所有权与取消                                  | `tests/client/authority-collision-mirror-client.test.ts`、`tests/app/mesh-task-scheduler-retry.test.ts`                                                                                            | worker transfer 后 consumer cache 未 detach；取消一个 owner 不影响共享 collision key；迟到页/结果不复活                  |
| collision delta 连续/乱序到达/链断和预测读取           | `tests/client/authority-collision-mirror.test.ts`、`tests/client/authority-collision-mirror-client.test.ts`、`tests/client/local-player-prediction.test.ts`                                        | 验证当前到达即应用与窗口重同步语义；链断后 `getChunkRevision()` 为不可读，`PlayerController` 经未知阻挡而非 Air 继续取样 |

首个 integration RED 必须实际调用 `MeshTaskScheduler`、`runWorldComputeTask()` 和 consumer，不可用仅比较 DTO 的 reducer 替代。若暂时无法构造 PlayCanvas `World`，Vitest 可先覆盖 scheduler 的真实 worker port 与 consumer，但准出时仍需一个 change-local 浏览器候选旅程验证“完整基线后可见地形”。

## 本切片不完成的事项

- 认证 owner/interest 许可、cancel ACK、socket 背压、wire 编解码与请求调度；本切片只消费已经通过这些门的 bundle。
- 远端玩家动作、输入、pose、存档、fluid/logic 候选或浏览器 GUI。
- 远端同步期间完全暂停预测的产品策略；当前唯一既有事实是 unknown collision 为阻挡。
- 任何性能结论或正式 N2/N4 wire 采用。

## 审阅结论

最小可交付不是“把 baseline bytes 放入新缓存”，而是上述完整闭环：完整项与版本向量接纳、owned worker copy、禁止生成兜底、纯本地 worker result 接纳、以及 overlay commit 失效。范围限定在客户端消费和现有 worker 接口，避免把网络 session、GUI 与动作协议作为前置条件；同时保留真实生产消费链，避免原型长期停留在 DTO/reassembler 层。
