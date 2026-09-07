# 完整 Authority 基线的 worker 输入计划

## 目标

本切片只为现有 `generate-mesh` worker 路径增加一个显式 opt-in 的 `authority-complete` 输入策略。它让后续远端消费者能够把已验证的 main canonical/fluid 和完整 26 个 overlay 交给既有 `createProceduralMeshInput()`、`meshChunk()`，并在生产 worker 入口拒绝任何缺项或不一致输入。

本切片不接收网络数据、不创建基线 owner/cache、不修改 `World`、`MeshTaskScheduler`、预测碰撞、Authority 上行或 session 状态机。远端 consumer 由后续独立切片负责构造该输入；本切片不宣称客户端已能连接远端世界。

## 当前事实与边界

- `src/app/world/mesh-task-dispatch.ts` 的 `WorkerInput` 允许缺 main canonical/fluid 或任意 overlay，且 worker-first task 使用 `worker-input-${sequence}` 作为 halo identity。
- `src/worker/world-compute-task.ts` 的 `generate-mesh` 在 main 缺失时调用 `makeChunk()`，在 overlay 缺失时由 `createProceduralMeshInput()` 采样 `baseVoxel()`；fluid 缺失时走 legacy 推导。这个旧路径必须继续兼容本地浏览器 Authority。
- `src/worker/world-compute-task.ts` 已让 result 透传 task 的 `haloRevision`；`src/app/app-contracts.ts` 的 `PendingMeshTask` 和 `WorkerResult` 已含该字段。为观察本切片不发生回退，result 需要新增可选、只读的 complete-input diagnostics，至少含 `proceduralVoxelSamples` 与 `macroContextCount`，而不是在测试重写 mesh 算法。
- `src/worker/world-worker.ts` 将 `WorldComputePayload` 原样运行并转移 `worldComputeTransfers()` 返回的 buffers；不需要引入新的 worker 入口或网络格式。

## 决策与精确合同

`GenerateMeshTaskPayload` 新增可选判别字段：

```ts
inputStrategy?: 'authority-complete';
```

字段缺失时保持当前 legacy worker-first 行为，包含现有 canonical/overlay 可选性和合成 `haloRevision`。若字段存在但不是精确的 `authority-complete`，dispatch 与 worker 生产入口都必须拒绝，拼写错误不得退回 legacy。字段为 `authority-complete` 时，以下规则必须在 `makeChunk()`、`createProceduralMeshInput()`、`Uint16Array`/`Uint8Array` 视图创建之前完成：

1. 中心 `(cx, cy, cz)` 必须是可安全参与 `±1` 邻接运算的安全整数，`chunkKey` 必须等于其规范 key；`generatorVersion`、`chunkRevision` 必须为有效的非负安全整数；`canonical`、`fluid` 必须是各自准确的 `32³×2`、`32³` 字节 `ArrayBuffer`。
2. `overlays` 恰有 26 个稠密项，坐标恰为中心周围 `3×3×3` 中排除中心的每一个项；不允许重复、未知或遗漏坐标。
3. 每个 overlay 必须同时有 canonical `voxels` 和 `fluid`，长度分别为 `32³×2`、`32³`；每个输入 `ArrayBuffer` 必须唯一，不能让 main/overlay 或两种 block 共享同一 buffer。
4. 远端输入必须携带非空、显式提供的完整版本向量 identity `haloRevision`。本切片把该字符串视为已由后续 consumer 按规范数值 key 顺序生成的不可拆分身份，不在 worker 重新猜版本。
5. 成功后仍调用当前 `createProceduralMeshInput()` 和 `meshChunk()`；result 回显 task `haloRevision`，并返回 `{ authorityComplete: true, proceduralVoxelSamples, macroContextCount }`。验收要求两个计数都为零。不会产生 canonical generation task、不会调用 `makeChunk()`，也不发送 `accept-generated-chunk` 或任何上行。

`WorkerInput` 以 `inputStrategy: 'authority-complete'` 作为唯一完整输入判别字段，其中完整输入的 canonical、fluid、overlay fluid 与 `haloRevision` 在 TypeScript 层为必填。`createWorkerFirstDispatch()`：

- 对 `authorityComplete` 分支使用输入给出的 `haloRevision` 写入 `PendingMeshTask`、worker message 和 transfer list；传输顺序仍为 main canonical/fluid、每个 overlay canonical/fluid。
- 对旧分支维持 `worker-input-${sequence}` 和现有可选字段，不要求现有 `BrowserAuthorityClient` 立即生成 26 项版本向量。

这保证完整版本向量在 dispatch → task → message → worker result 的同一身份链中存在，而不改变 scheduler 的 stale 判定语义。

## 文件所有权与最小修改

| 文件                                                                                                                                                        | 修改责任                                                                                                              |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `src/app/world/mesh-task-dispatch.ts`                                                                                                                       | 将 `WorkerInput` 表示为 legacy/`authority-complete` 联合；complete 分支使用显式 halo identity 并传全部 block buffer。 |
| `src/worker/authority-complete-mesh-input.ts`（新）                                                                                                         | 纯、无 DOM 的完整输入结构校验和规范 26 overlay 坐标核对；不生成体素，不持有 cache，不导入客户端/服务器会话。          |
| `src/worker/world-compute-task.ts`                                                                                                                          | 在 `generate-mesh` 的生产入口调用校验器；complete 成功后使用当前 mesh 算法并返回真实回退计数，legacy 分支不变。       |
| `src/app/app-contracts.ts`                                                                                                                                  | 仅扩充 `WorkerResult` 的可选 complete-input diagnostics 类型，使结果能通过 worker/调度边界而不以 cast 隐藏。          |
| `changes/2026-09-06-node-dedicated-server/tests/network-complete-baseline-worker.test.ts`（新）及独立 Vitest 配置（如现有 runner 不发现 change-local test） | 调用真实 `createWorkerFirstDispatch()` 与 `runWorldComputeTask()`；不自造 mesh reducer。                              |

不修改 `src/app/world/world-runtime.ts`、`src/app/world/mesh-task-scheduler.ts`、`src/client/authority/**`、`src/world/mesh.ts`、Node lane 或协议/codec。`world-worker.ts` 的现有 `WorldComputePayload` 分发与 transfer 函数也无需改变。

## RED 测试设计

先写 change-local 用例，取得缺少 `authority-complete` 类型/校验器的真实 RED：

1. 用 27 个真实大小 buffer 构造 complete 输入，经 `createWorkerFirstDispatch()` 后断言 task/message/result 的 `haloRevision` 相同，所有 54 个 buffer 都在 transfer list；调用真实 `runWorldComputeTask()` 后断言 `authorityComplete=true`、`proceduralVoxelSamples=0`、`macroContextCount=0`，并保留现有 mesh 输出。
2. 参数化删除 main fluid、任一 overlay canonical/fluid、重复坐标、中心坐标混入、错误坐标、稀疏 array、错误长度、共享 buffer、空 halo identity、非法整数和未知策略。每一种必须在生产 `runWorldComputeTask()` 入口抛错。测试用对真实 `mesh` 模块函数的 spy 包裹原实现，明确断言 `makeChunk()` 与 `createProceduralMeshInput()` 调用数均为零，而不是只依赖没有 result 的现象。
3. 旧 `generate-mesh` 输入（无 `inputStrategy`、可为空 overlay）继续在 `tests/worker/compute-worker-task.test.ts` 的现有旅程中工作；新的 change-local 用例也直接断言 dispatch 仍给 legacy 输入合成 sequence identity。
4. complete 输入故意使用 26 项但扰动 `haloRevision`，worker 必须仅原样回显该显式身份，不按 payload 或 sequence 替换；完整版本有效性由后续 consumer 的任务接纳门检验，本切片不增加 scheduler 策略。

## 验收与非目标

- Vitest：上述 RED 转 GREEN；再定向运行 `tests/worker/compute-worker-task.test.ts` 与 mesh dispatch/snapshot 受影响用例，证明 legacy 未回归。
- Static：新/改文件通过 Prettier、ESLint、TypeScript；不跑全仓 coverage、生产 build、浏览器或 benchmark。
- 不把 `proceduralVoxelSamples=0` 宣称为网络、认证、缓存所有权、socket 背压或远端 GUI 证据；它只证明完整 worker 输入没有触发当前两处程序化回退。

## 当前状态

已完成本计划的 RED → GREEN，尚未接入远端 consumer：

- RED：Node 22 对“缺中心 fluid”的完整标志任务实测仍返回 mesh-result，证明旧入口会静默走 legacy fallback。
- GREEN：新增 20 项 change-local 定向 Vitest。真实完整路径传输 54 个互异 block，保留 `haloRevision`，并由原始 mesh 函数 spy 观察 `makeChunk()=0`、`createProceduralMeshInput()=1`、两个真实回退计数均为零；缺失中心或 overlay block、别名、坐标、长度、空集合、整数和策略错误均在生产入口拒绝，两个调用计数均为零。纯校验还证明中心 `MAX_SAFE_INTEGER - 1` 的外层 overlay 可合法抵达 `MAX_SAFE_INTEGER`，且 `generatorVersion=0` 被拒绝。
- 回归：既有 `tests/worker/compute-worker-task.test.ts` 4 项通过，完整 `pnpm typecheck`、目标 Prettier、目标 ESLint 与 `git diff --check` 通过。

未运行全仓 coverage、生产 build、浏览器或 benchmark。后续远端 consumer 仍须负责形成并接纳完整版本向量，再 opt-in 调用本 worker 路径。

本次冻结来源 SHA-256：

| 文件                                                                                     | SHA-256                                                            |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `src/app/world/mesh-task-dispatch.ts`                                                    | `e8455d8e3ec1c5e9f9d43974fa61911efda3cfdffa1612d458b5b35e9fbc9aa1` |
| `src/worker/authority-complete-mesh-input.ts`                                            | `fe4105f1487891975464f47f1907ed571a8ecd0e803ec35ceb8244e07bb285e1` |
| `src/worker/world-compute-task.ts`                                                       | `31559ef49939a257c2f236e59bcdfa9fc7298a77456306995c8b620b7a923b07` |
| `src/app/app-contracts.ts`                                                               | `98fe5c68a0f45200fd9e137c3e25a896d2cedd0f20219b544ae80612246441dd` |
| `changes/2026-09-06-node-dedicated-server/e2e/network-complete-baseline-worker.test.ts`  | `58ae16a91cbb4ac3f1d21914c794c3256a712075fd998239f061bada98dff818` |
| `changes/2026-09-06-node-dedicated-server/e2e/vitest.complete-baseline-worker.config.ts` | `2dc9a26c47c4f37a84aa2003aac756027d2def7c69d780bfa95c2a85ff30ed67` |
