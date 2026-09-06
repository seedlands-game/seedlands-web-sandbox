# 计算 Worker 取消与释放进展

绑定方案：`changes/2026-09-06-independent-loops-unified-physics/spec.md`，批准 SHA-256：`c14711d82070e0b9c255eda0bfc5b2bbd134d130a8c45dacf662480e9b953512`。

## 审计范围

本项核对通用世界计算与流体计算两个 Worker 入口的任务状态，覆盖未知取消、运行中取消、成功、失败、重复请求、迟到取消和销毁。只修入口生命周期，不改变计算池配额、任务内容、流体候选或世界网格算法。

另只读追踪 `GameSaveRuntime.evictChunk()` 与权威 Chunk 缓存，不在本项修改保存或世界运行时。

## 预置测试

`tests/worker/compute-worker-entry-lifecycle.test.ts` 预置以下规则：

1. 大量未知、错误 epoch 和完成后的取消不留下取消标记。
2. 运行中取消无论落在计算检查点还是 Promise 完成边界，必须返回一次 `cancelled` 结果，让池释放槽位。
3. 失败释放活动状态；运行中或完成后的重复 taskId 不重复计算或回执。
4. dispose 清空活动/取消状态，迟到完成不再外发结果，销毁后拒绝新任务。

## RED

`CI=true corepack pnpm exec vitest run tests/worker/compute-worker-entry-lifecycle.test.ts`：预期 RED。测试文件无法导入尚不存在的 `compute-worker-entry-lifecycle` 模块，测试套件在收集阶段失败。旧入口只有无界 `cancelled Set`，且世界计算在 Promise 已完成、取消刚好到达的竞态中会删除标记后静默返回，不发送结果让池释放运行槽。

## 当前状态

- 基于 A9 指标提交 `648e90f`，新增两个入口共用的单槽生命周期。取消状态只保存在当前活动任务对象上；未知、错误 epoch 和完成后取消均为无状态 no-op。
- 最近完成 taskId 去重窗口固定为 `256`，用于拦截运行中及迟到重复请求；第 `257` 条会淘汰最旧记录，不随会话时长增长。实际 epoch 切换与 dispose 仍由 `ComputeWorkerPool` 终止 Worker；生命周期的 dispose 同时清空活动和近期状态，迟到 Promise 不再发回结果。
- 世界计算在取消恰好晚于最后一个计算检查点时，不再静默吞掉成功 Promise，而是统一发回一次 `ok: false, error: cancelled`。计算池据此释放槽、取消依赖且不把错误结果交给业务层。流体入口使用同一状态机，保留 A9 的纯计算耗时口径。

## GREEN

- `CI=true corepack pnpm exec vitest run tests/worker/compute-worker-entry-lifecycle.test.ts tests/client/compute-worker-pool.test.ts tests/worker/compute-worker-task.test.ts`：`3` 个文件、`19` 项全部通过。
- 其中 `10,000` 个未知取消后活动/取消状态均为零；连续 `300` 个完成任务后近期去重记录稳定为 `256`；成功、失败、取消、运行中/迟到重复和 dispose 均不产生重复结果或残留活动 ID。
- `corepack pnpm exec eslint` 对两个入口、生命周期模块和新测试执行：通过。
- `corepack pnpm exec tsc --noEmit` 与 `corepack pnpm exec tsc -p tsconfig.test.json --noEmit`：通过。

## Chunk 驱逐只读结论

- `GameSaveRuntime.evictChunk()` 对 dirty Chunk 先调用 `flushDirtyChunks()`；当持久层提供 Gameplay 接口时，后者按原子冻结存档合同主动抛错。因此浏览器与 `MemoryGamePersistence` 的正常 Gameplay 模式不能直接驱逐 dirty Chunk。必须先用同一冻结 checkpoint 原子保存 Gameplay 与 dirty Chunk，再按对象身份、`accessEpoch`、revision 和 persisted revision 二次确认后驱逐。
- 生产调用图中没有 `GameServer.evictChunk()` 的调用者。浏览器 `release-mesh` 只经过 `releaseChunkNeighborhood()` 清理 `BrowserChunkPersistence` 的待加载 snapshot 缓存，不删除 `GameServer` 的 canonical `chunks` Map。
- `accessEpoch` 当前只保护手工驱逐期间的异步竞态，没有 LRU 扫描或 resident 数量/字节上限。持续探索会让权威 canonical Chunk Map 累积；这是真实未闭环的有界缓存问题。
- 本项不修改保存与权威运行时。建议建立独立 change：定义 Chunk resident 数量/字节预算、以 `accessEpoch` 选 clean 候选；dirty 候选先进入有界 frozen save，再二次校验后批量驱逐。流体活动窗口、碰撞近场与在途 Mesh/保存引用须作为 pin 条件。
