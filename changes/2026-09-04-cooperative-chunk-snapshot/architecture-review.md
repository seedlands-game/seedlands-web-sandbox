# 独立架构复核记录

**复核范围：** 当前 streaming 卡顿的优化优先级与 A/B 合同。  
**方式：** 固定 `SOL_INTENT_RECEIPT` 的只读独立复核；请求模型为 `gpt-5.6-sol`、`xhigh`。  
**结论：** 不批准此前的主线程 cursor-first 草案；批准将其改写为先测量、Worker-first、再 A/B 的候选方案，实施仍需用户审核新 spec SHA。

## 结论依据

- `src/app/main.ts` 的 `drainWorker()` 在同步循环中构造 snapshot；`src/server/game-server.ts` 首次 `getChunk()` 会同步 `makeChunk()`，随后 `createDerivedMeshSnapshot()` 遍历完整 `34³` Halo。
- 已有 profile 中 `WorkerMesh` 最高 `3.1ms`、`MeshCommit` 最高 `0.1ms`，不能支持继续优先优化 meshing 或 commit。
- 浏览器架构将 Worldgen 与 Meshing 都归入 Worker，并要求重计算不占用 Main Thread。
- 主线程 cursor 虽能切碎长 task，却仍把重计算留在 Main Thread，并可能增加总 CPU、队列和 request-to-visible；只能作为 Worker-first 不可行时的备选。

## 强制补齐项

1. 将现有 `HaloSnapshot` 拆分为 canonical、Halo、authority overlay copy 等 span，并记录 work unit 和分配字节。
2. 对每个 scenario 清空或按 scenario 过滤 frame、trace、incident 聚合；否则 A/B 会串样。
3. 异步 canonical 必须定义未就绪 Chunk 的同步 `getVoxel()`/碰撞语义；Worker provisional 不能成为隐式权威。
4. Worker 返回必须含 identity 和版本校验；A/B 同时验证 canonical、Halo shell、mesh hash、编辑、取消、persistence 与 stale result。
5. P0 每 variant 至少记录 20 个完成 Chunk，以 frame p95/p99/max 和 long-frame 为主指标、request-to-visible 与队列为副指标；不因结果删样本。

## 后置项

Worker Pool、WASM/SAB、WebGPU、LOD、渲染分类和新的 commit 策略都缺少当前瓶颈证据，保持后置；其中 Halo shell/列缓存应在分段 profile 显示 Halo 是独立主因后再单独 A/B。
