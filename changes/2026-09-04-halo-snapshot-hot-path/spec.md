# Halo Snapshot 热路径缓存

**状态：** 实施中（Agile flow）

## 背景与目标

`diagnostic` 档固定跨 Chunk 采样显示 frame p95 为 704ms，`HaloSnapshot` 单次最高 701.9ms，而 `MeshCommit` 最高 0.1ms。`GameServer.createDerivedMeshSnapshot()` 对 Halo 外壳的程序化体素逐点调用 `baseVoxel()`；后者默认重复计算 Macro context 与特征邻域，导致 Worker 之前仍有长时间主线程工作。

目标是在不物化邻 Chunk、不改变确定性世界和 Halo 内容的前提下，将本次 snapshot 内相同 `(x,z)` 的 Macro context 缓存并传给 `baseVoxel()`。

## 范围与非目标

- 范围：仅优化服务端派生 Halo 的程序化采样热路径，并暴露仅供测试的 snapshot 采样计数。
- 非目标：改变 world 生成算法、Chunk 存档、Worker 协议、网格算法或提交预算。

## 决策

同一 Halo snapshot 的 `(x,z)` Macro context 是确定性的且会跨多个 `y` 与树木邻域查询重复使用，因此按 `(x,z)` 本地缓存。缓存生命周期限于单个 snapshot，不保留邻 Chunk，也不改变 canonical 数据。

## 行为

- 给定没有相邻持久化或内存 Chunk 的 Halo 外壳，当需要程序化采样时，同一个 `(x,z)` 的 Macro context 只计算一次。
- 给定相同 seed、坐标、编辑与持久化状态，缓存前后的 Halo 内容与 revision 签名一致。
- 给定 snapshot 结束，缓存不被保留为世界状态，且邻 Chunk 不会被物化。

## 测试设计

- `tests/server/game-server.test.ts` 先 RED：派生 Halo 返回程序化样本计数和 Macro context 数；存在程序化样本时 context 数大于零且小于样本数，并保留已有 Halo 边界与不物化断言。
- `changes/2026-09-04-client-performance-observability/e2e/profile-probe.spec.ts` 仅作临时诊断，不纳入交付；修复后在相同 seed、路径与 diagnostic 档下重新采样，对比 `HaloSnapshot` 最大耗时。

## 验收与证据

- [x] **Vitest：** Halo 缓存计数、不物化邻 Chunk、边界编辑可见且 signature 改变。
- [x] **Playwright-change：** 同一 diagnostic 跨 Chunk 场景中 `HaloSnapshot` 不再是数百毫秒级主线程 span；记录实际样本，不设跨机器硬阈值。
- [待验证] **Static：** `pnpm verify:static`。
- [待验证] **Build：** `pnpm build`。
- [x] **Midscene：** N/A——无新增视觉语义。

## 任务与当前状态

1. [已完成] 采集 diagnostic profile 并定位 `HaloSnapshot` 热路径。
2. [已完成] 预置 RED 服务端测试：新增计数字段前失败，字段缺失导致断言收到 `undefined`。
3. [已完成] 缓存 Macro context 并复测 profile。
4. [进行中] 运行静态/构建检查，完成本地语义化提交；不 push。

## 交付快照

缓存后，固定诊断场景的 `HaloSnapshot` 单次最高从 701.9ms 降至 49.9ms；在排空初始队列后重新跨 Chunk，单次最高为 111.2ms、总计 277.7ms，Chunk request-to-visible 为 323.6ms，frame p95/p99 为 121.5ms / 299.9ms。缓存消除了原先数百毫秒级单次 Halo 主线程长任务，但首次进入完全新区域仍会产生约百毫秒 Halo 采样；余下 request-to-visible 时间需要新增 Worker meshing/排队分段测量后再决定是否采用可中断 snapshot 或 Worker 侧程序化 Halo，当前不伪称已完全消除卡顿。
