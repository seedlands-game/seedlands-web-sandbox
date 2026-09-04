# Worker 网格耗时分段

**状态：** 实施中（Agile flow）

## 背景与目标

Halo 缓存后，跨 Chunk 的 request-to-visible 仍包含未分段时间。当前 trace 只记录 Worker 开始与完成 mark，未记录实际 `meshChunk()` 时长，无法区分 Worker CPU 计算与队列等待。

目标是把 Worker 内部实际网格计算时长作为独立 `meshing:WorkerMesh` span 返回主线程 telemetry；该 span 使用 Worker 测得的 duration，不归入主线程 frame top spans。

## 范围与非目标

- 范围：Worker result 增加 `workerMeshingMs`，telemetry 增加已完成的外部 duration span，Harness Chrome Trace 可导出该 span。
- 非目标：改变 Worker 调度、网格算法、GPU 提交预算或将 Worker 时长当作主线程阻塞时间。

## 测试设计

- `tests/client/performance-telemetry.test.ts` 先 RED：外部完成 span 保留 lane、traceId、duration，并出现在 Chrome Trace export；它不进入当前 frame 的 top spans。
- 使用固定 diagnostic 跨 Chunk probe 读取 `meshing:WorkerMesh`，将其与 request-to-visible 和 HaloSnapshot 对照。

## 验收与证据

- [x] **Vitest：** 外部 Worker duration span 语义确定性通过。
- [x] **Playwright-change：** diagnostic trace 能导出 Worker mesh span，且不会将 Worker duration 当作主线程 frame span。
- [待验证] **Static：** `pnpm verify:static`。
- [待验证] **Build：** `pnpm build`。

## 任务与当前状态

1. [已完成] 确认剩余 request-to-visible 时间缺少 Worker/队列分段。
2. [已完成] 预置 RED telemetry 测试：缺少 `recordCompletedSpan()` 时失败。
3. [已完成] 接入 Worker 时长并复测。
4. [进行中] 运行静态/构建检查，本地提交；不 push。

## 交付快照

固定 diagnostic 跨 Chunk probe 中，`meshing:WorkerMesh` 共 3 次、合计 7.2ms、单次最高 3.1ms；`HaloSnapshot` 共 4 次、合计约 160ms、单次约 50ms；一个 Chunk request-to-visible 为约 318.9ms。结论是 Worker meshing 与 GPU 提交不是当前主因，剩余延迟集中在主线程 Halo 与帧/队列调度。该结果为当前机器单次诊断样本，不作为跨机器阈值。
