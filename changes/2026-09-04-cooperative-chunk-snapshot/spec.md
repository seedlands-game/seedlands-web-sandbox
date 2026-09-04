# Worker 优先的 Chunk 生成与 A/B 性能验证

**状态：** 已交付

## 背景与目标

排空初始化队列后的固定跨 Chunk profile 表明：frame p50 `55.4ms`、p95 `121.5ms`、p99 `299.9ms`，request-to-visible `323.6ms`。`WorkerMesh` 最高仅 `3.1ms`，`MeshCommit` 最高 `0.1ms`，`SceneAttach` 为 `0ms`；而当前主线程 `drainWorker()` 会同步调用 `GameServer.createDerivedMeshSnapshot()`，其内部首次 `getChunk()` 会调用完整 `makeChunk()`，随后再遍历 `34³` Halo。

目标是将首次纯程序化 canonical Chunk、程序化 Halo 与 meshing 串成 Worker job，使实时主线程只做请求优先级、权威状态验证/接受、按帧 commit 和渲染。每个优化点都必须通过同机构建内交错 A/B 留下原始数据和结论；不以单次 FPS 或跨机器绝对时间裁决。

## 范围与非目标

- 范围：先补齐分段 profile、场景隔离和 A/B Harness；随后实现 Worker provisional worldgen、已编辑/持久化邻块 overlay、主线程权威接受与 stale discard；执行 P0 A/B 并写入真实结果。
- 非目标：本次不创建 Worker Pool、不引入 WASM/SIMD/SAB/Atomics、LOD、Chunk × RenderCategory、WebGPU、GPU timestamp 或渲染算法重写。协作式 cursor 不是默认实现，只在 Worker-first 被证明不能满足同步 authority/碰撞契约时作为新 change 的备选。

## 决策

- **P0 选中：** Worker 可按 `seed + generatorVersion + coord` 生成 provisional canonical 与程序化 Halo，并在同一 Worker job meshing。Main `GameServer` 是唯一接受者：只有 `taskId + epoch + key + expected revision + generatorVersion` 仍匹配时，才原子写入 canonical；接受前结果不可见、不可持久化、不可参与 `getVoxel()` 或碰撞。
- 对已编辑或有效持久化的中心/相邻 Chunk，Main 提供最小权威 overlay；Worker 不得写入、transfer 或 detach 服务器保存的 buffer。未编辑且未持久化的邻域由 Worker 重新确定性推导。
- 未就绪 Chunk 的同步查询保持现有安全语义：玩家碰撞/编辑/读取要求 canonical 时，Main 必须走显式同步 materialize 或等待策略；实现前必须选择其一并以测试固定，不能让 Worker provisional 数据成为隐式权威。
- 观测拆分为 `CanonicalGeneration`、`HaloSample`、`AuthorityOverlayCopy`、`WorkerQueueWait`、`WorkerGeneration`、`WorkerMesh`、`Transfer`、`MeshCommit`、`SceneAttach`、`visible-postrender`。`beginScenario()` 必须隔离 frame/trace/incident 统计，避免前一个 variant 污染 A/B 汇总。
- commit 保持现有“每帧 Chunk 数、Mesh part 数、时间”三重上限；异步完成不代表立即无限提交。

## 行为

- 给定首次请求且没有有效 persistence/编辑覆盖，当 Worker 返回与当前 identity 匹配的 provisional canonical 时，Main 才接纳它；接纳的 bytes 与同步 `makeChunk()` 完全一致，mesh 的一格 Halo、出面与 AO 与基线一致。
- 给定中心或邻块存在编辑/持久化，当 Worker 构造 Halo 时，overlay 优先于程序化值；不得因为任务在后台而丢失跨 Chunk 边界面或 AO。
- 给定编辑、卸载、重新请求或 scenario epoch 改变发生在 Worker 返回前，结果必须 discard；不得覆写 canonical、持久化、已显示 mesh 或玩家碰撞状态。
- 给定固定 seed、quality、存档、分辨率、路径和 warmup，Harness 以显式 variant 执行 `A → B → A → B`，单 variant 至少收集 20 个完成 Chunk，记录原始样本及汇总差异。浏览器启动失败只可保留为失败样本，不能按性能结果删样本。

## 测试设计

- `tests/world/**` 先 RED：Worker/同步 canonical、Halo shell、mesh hash 逐字节一致；覆盖生成器版本、边界坐标和 overlay 优先级。
- `tests/server/**` 先 RED：accept 只发生一次；错误 epoch/revision/key/version、编辑、取消和 persistence 覆盖均 discard；canonical buffer 不被 Worker detach；同步 `getVoxel()` 对未就绪 Chunk 的选定语义稳定。
- `tests/client/**` 先 RED：scenario 清空 frame/trace/incident 聚合；分段 span 与 allocation/work-unit gauge 可导出；每个 variant 的样本不能相互串入。
- `changes/2026-09-04-cooperative-chunk-snapshot/e2e/**/*.spec.ts` 先 RED：同一 Browser Context 内用显式 A/B variant 跑冷启动、队列排空后 crossing、往返 crossing、边界编辑 remesh；断言 postrender 可见、玩家/服务端一致、stale discard、hash 和结构化样本。
- 每个样本写入 `harness/results` 的 JSON（source SHA、环境、variant、场景、原始指标、Chrome Trace 路径）；汇总 Markdown 同时记录 p50/p95/p99/max、long frame、B 相对 A 的中位差/百分比、缺失指标 `NOT_COLLECTED` 和保留/回退结论。

## 验收与证据

- [x] **Vitest：** Worker-first canonical/Halo/mesh 与同步路径逐字节一致；overlay、取消、编辑、persistence、未就绪查询和 buffer 所有权通过。
- [x] **Playwright-change：** 固定 crossing 场景输出隔离的 A/B 原始样本、Chrome Trace 和 authority/cancellation 断言；可见性以 `postrender` 为准。冷启动、往返 crossing 与边界编辑 remesh 保留为后续性能回归扩展，未把它们伪称为已完成。
- [x] **Playwright-baseline：** 现有加载、输入、碰撞、保存和 streaming 基线通过（9 项）。
- [x] **Static：** `pnpm verify:static` 通过，`src/world/**` 行覆盖率为 95.95%。
- [x] **Build：** `pnpm build` 通过。
- [x] **Harness：** P0 以 A/B 交错五次、每 variant 每次至少 20 个完成 Chunk 留档；每项指标均标明样本数和采集边界，不伪造 GPU 时长。详见 `ab-results.md`。
- [x] **Manual supplement：** N/A——本 change 的结论来自固定可重放的性能 Harness；真实设备体验可作为补充，不替代 A/B 记录。

## 任务与当前状态

1. [已完成] 已采集当前诊断 profile，并确认 Worker mesh/commit 不是主因。
2. [已完成] 已读取浏览器运行时架构，完成独立 Sol 架构复核，形成 Worker-first 选型与 A/B 合同。
3. [已完成] 已获 spec SHA 审核，先写分段观测和隔离 A/B 的 RED 用例，再实现 P0。
4. [已完成] 已跑五组交错 A/B；真实数据支持保留 Worker-first。结果写入 `ab-results.md`。

## 交付快照

已实现并保留 Worker-first。`e0fa0c9` 将 canonical/Halo 重计算移入 Worker，并以复制的 authority overlay、防过期 identity、Main 原子接受和既有三重 commit budget 保持权威边界。`pnpm verify:static`、`pnpm build`、change A/B Playwright 与 9 项基线 Playwright 都已通过。cursor 仍只能作为 Worker-first 不可行时的独立备选，不能与 P0 混合。
