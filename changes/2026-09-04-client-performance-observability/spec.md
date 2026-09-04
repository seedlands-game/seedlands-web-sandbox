# 客户端性能可观测性与流式掉帧修复

**状态：** 已实施，等待提交后的关联 Harness 读回

## 背景与目标

在 `c2fcc1c` 的 Integrated Mode 中，Chunk 请求进入 `setTimeout(0)` 队列后，会在主线程连续完成整块 greedy meshing、PlayCanvas Mesh 创建、缓冲上传和场景挂载。初始化和跨 Chunk streaming 时，这会形成明显的连续长帧；此前 Worker 版本没有相同的主线程爆发。

本 change 先建立低开销、跨运行时的客户端性能观测基础：帧 profile、嵌套 span、Chunk 异步 trace、队列/内存指标、长帧 flight recorder、Chrome Trace JSON 导出和 Harness 场景结果。随后只基于这些证据，对确认的主线程 mesh build / commit 峰值做 A/B 改进，目标是恢复可玩流畅度而非追求 Browser 峰值性能。

## 范围与非目标

- 范围：`src/client/` 中与引擎无关的 telemetry contract 和性能 profile；浏览器运行时帧/输入/玩家/streaming/网格提交/HUD/持久化 span；Chunk request-to-visible trace；低成本环形 flight recorder 和事故摘要；Chrome Trace Event JSON 导出；Debug HUD 摘要；Harness 的 idle、初始加载、边界跨越、重复 load/unload、mutation 场景与 A/B JSON 摘要；以复制派生体素数据的 Worker meshing 和按帧 GPU/场景提交预算修复已测得的掉帧。
- 非目标：WASM、SIMD、GPU compute、SharedArrayBuffer、Atomics、Worker pool、mesh 算法重写、LOD、浏览器 DevTools 替代品、完整 GPU timestamp、生产 APM、原生客户端迁移或网络分布式追踪。

## 关键决策

- telemetry schema 保持引擎/运行时无关，只使用 `Span`、`Trace`、`Metric`、`Incident`、`PerformanceProfile` 语义和注入时钟；它不得依赖 PlayCanvas、DOM 或 Worker 全局。浏览器适配器只在 `src/app/` 读取时间、内存和 UI。
- Always-on 只写入固定上限 ring buffer 与聚合统计，不在 voxel/vertex 热路径创建 span、动态属性对象或日志。详细 trace 仅在 Harness、手工导出或 spike capture 中保留；满载时记录 dropped 数而不阻塞游戏。
- 每帧记录真实 `frame` 间隔和实际发生的 `player`、`streaming`、`render`、`hud`、`persistence` span；输入只在真实交互事件中记录，避免为每帧伪造零耗时 span。浏览器/引擎无法可靠测量的 GPU 执行时间标为 `engine-owned`，不伪造精确数值。
- 每个 Chunk 具有统一 `traceId`，记录 request、排队、服务端读取、meshing、主线程 commit、scene attach、visible；当前 Integrated Server 与浏览器主线程使用不同 lane 名而非伪造 Worker lane。未来 Worker 任务继续携带同一 `traceId`。
- frame profile 以未截断的 `performance.now()` 边界计算真实帧间隔；游戏 simulation 可以继续限制 `dt`，但该限制不得用于 long-frame 统计。
- profile 至少包含 `balanced`、`diagnostic`、`benchmark` 三档。它们控制 detail trace、long-frame/spike 阈值、环形窗口、Worker in-flight 数和每帧 mesh commit 上限；阈值是可配置诊断门槛，不是跨设备产品 FPS 承诺。
- 事故捕获在长帧、Chunk 可见延迟、队列异常或手工触发时保留前后窗口，且依据 span/队列证据给出规则化类别，不生成未经证据支持的根因结论。
- 本次根因对照以改造前的主线程直接 `meshChunk + receive` 为 A，改造后的派生 Worker 输入为 B。B 将 canonical `Uint16Array` 和所需一格邻接 halo 复制为 Worker 输入。任务快照包含 `taskId`、scenario epoch、归属 Chunk revision 和 halo revision 签名；canonical buffer 从不 transfer 或由 Worker 写入。halo snapshot 由服务端提供只读派生切片，不通过 `getVoxel()` 隐式物化或长期保留 streaming 半径外的邻 Chunk。Worker 只返回派生 mesh 数据。
- Worker 返回结果只有在 `taskId`、epoch、归属 revision 和 halo revision 签名仍匹配时才可进入 commit；编辑、取消、卸载或中心迁移造成不匹配时必须 discard，计入 stale-result/cancelled counter，且不得覆盖新权威状态。
- 主线程 commit 在 animation frame 中按 profile 的 `maxMeshCommitsPerFrame`、`maxMeshPartsPerFrame` 和 `maxCommitMs` 三重预算分段执行。未完成的 Chunk Entity 不得 attach；单个 part 超过时间预算也必须记录其自身 long task，而不是伪称已被预算消除。trace 的 `visible` 定义为 entity attach 后的首次 `postrender`，不是 `addChild()`。
- 保留新旧方案的固定 seed、质量档、相机路径、warmup 和操作序列。仅当 B 的 frame p95/p99、long frame 与 request-to-visible 尾延迟的实际权衡可读，且不损害边界网格正确性、服务端权威和玩家输入，才保留 B；否则回退 A 并保留诊断记录。

## 行为

- 给定正常游戏帧，当一次更新结束时，telemetry 记录该帧的主要子系统耗时、队列/内存 gauge 和 frameId；帧统计可返回 p50/p95/p99/max、long frame 数与最后一次 long frame。
- 给定 Chunk 被请求，当它可见时，telemetry 能用同一 traceId 查询完整 request-to-visible 时间线，并区分实际 meshing、Worker/主线程等待、mesh 创建、上传估算和场景挂载。
- 给定 ring buffer 已满或 export 失败，当游戏继续时，world 数据、编辑命令和渲染调度不受影响；telemetry 只聚合或丢弃并计数。
- 给定一帧超过 profile 阈值或 Chunk trace 超时，当之后的配置窗口结束时，flight recorder 产生 incident，其中包含帧范围、触发条件、关联 trace、top spans、队列/内存摘要和基于证据的类别。
- 给定 Harness 的初始加载、边界跨越、重复 load/unload 和 mutation 场景，当其结束时，结构化结果包含 frame、Chunk latency、pipeline、queue、memory 和 workload 的分位数；A/B 在相同 scenario 下输出差异而非只输出孤立 kernel 时间。
- 给定当前掉帧路径，profile 必须先显示主线程 meshing/commit 为长帧贡献者；启用 B 后，派生 Worker meshing 不再占主线程帧 span，且每帧 commit 同时不超过数量、part 和时间预算。可见延迟如有变化必须在 Harness A/B 结果中体现。

## 测试设计

- `tests/client/performance-telemetry.test.ts` 先 RED：嵌套 span、分位数、固定环形上限与 dropped 计数、trace 跨 lane 关联、spike incident 和 Chrome Trace export；注入时钟保证 Node 确定性。
- `tests/client/performance-profile.test.ts` 先 RED：三档 profile 的预算/阈值有效，且没有 profile 能设置每 voxel 或无限制事件记录。
- `tests/client/mesh-task-snapshot.test.ts` 先 RED：mesh task 的数据和 halo 都是独立复制、带 revision/epoch 签名；编辑、取消或 epoch 改变会使结果不可提交，且不会使源数据 detached。
- `changes/2026-09-04-client-performance-observability/e2e/performance-observability.spec.ts` 先 RED：经 scenario epoch 隔离的真实 Harness 完成固定边界跨越，断言属于该 scenario 的 postrender-visible Chunk trace、frame/Chunk latency 分位数、三重 commit budget、incident/trace export 和 server authority 同时存在。
- `tests/world/**`、服务端测试和既有浏览器基线继续证明确定性、边界网格、保存、输入与 streaming 行为。对 Worker 派生输入补充 world 或 client 单测，验证边界 halo 不改变 materialized 邻块的出面/AO。
- Harness 以同一 telemetry 生成 JSON/Markdown；A/B 在同一次固定 scenario 下按 `A → B → A → B` 采样，报告 median/p95/p99，不以单次平均 FPS 决策。

## 验收与证据

- [x] **Vitest：** 可移植 telemetry 的 span、trace、统计、ring buffer、incident 和 Chrome Trace export 全部确定性通过。
- [x] **Vitest：** performance profile 限定低开销 Always-on 和有界 detailed capture，并验证派生 Worker 输入不转移 canonical buffer、halo/revision/epoch 签名正确、过期结果被丢弃。
- [x] **Playwright-change：** 固定 streaming scenario 产生属于该 scenario 的 postrender-visible Chunk trace、真实 frame 分位数、队列/内存摘要和 trace export；真实玩家/服务端权威状态保持一致。
- [x] **Playwright-change：** 源码与运行时 profile 共同确认主线程整块 meshing/commit 是改造前 spike 的同步贡献；B 每帧 mesh commit 同时符合数量、part 和时间预算。跨版本绝对时间不作为门槛，提交后用关联 Harness 留档本次样本。
- [x] **Playwright-baseline：** 现有加载、输入、碰撞、保存和 streaming 基线全部通过。
- [x] **Static：** `pnpm verify:static` 通过，`src/world/**` 行覆盖率为 96.72%。
- [x] **Build：** `pnpm build` 通过。
- [进行中] **Harness：** 已得到当前工作树的 structured browser 样本；提交后重新运行，使 source SHA 与最终提交精确关联。不把跨机器绝对时间当硬门槛。
- [x] **Midscene：** N/A——本 change 的可见变化是开发者 Debug HUD 摘要，掉帧与 trace 正确性由 Playwright/Harness 精确验证；不新增需要视觉语义模型判断的用户旅程。

## 任务与当前状态

1. [已完成] 已读取用户提供的性能可观测性 change、当前 runtime、Harness、基线和 Git 状态。
2. [已完成] 固定 Sol 架构复核指出主线程长任务、过期异步结果、halo 物化、frame 截断和可见定义缺口；结论记录在 `architecture-review.md`。
3. [已完成] Breaking-flow 审核通过；批准的 spec SHA-256 为 `06f51550b932a6bd1890b00602aca0d7175fc7bce6be046df2bde956d1eb4992`。
4. [已完成] 实现 telemetry/profile、Worker derived meshing、场景 epoch 隔离与三重 commit budget。
5. [已完成] 以源码、profile 和浏览器场景确认并修复了同步网格/提交爆发，以及首次实现中一次性构造所有 Halo 快照的次生主线程爆发。
6. [进行中] 创建仅包含本 change 的语义化本地 Git commit；不 push。提交后补一次关联 Harness 读回。

## 交付快照

### 根因与改进

- 改造前 `World` 把每个 `setTimeout(0)` 回调中的 `meshChunk()`、所有 `Mesh.update()` 和场景挂载连续放在主线程执行；初始化或跨 Chunk 时会连续排入多个整块任务，因此形成 burst 长帧。
- 首次 Worker 化后，profile 还发现 `updateStreaming()` 在同一调用内为所有待加载 Chunk 构造 Halo。虽然 meshing 已离开主线程，这个批量 snapshot 仍会阻塞开始进入世界。现已改为请求队列，仅在 Worker 空闲时构造一个 snapshot。
- 现在 canonical 数据只在服务端保存，Worker 接收独立复制的 canonical + 一格 Halo；结果以 `taskId + epoch + chunkRevision + haloRevision` 验证。旧场景队列、旧提交和旧结果不会覆盖新场景。
- 主线程每帧最多提交 1 个 Chunk、2 个 Mesh part，且总提交时间不超过 4 ms；Chunk 仅在首次 `postrender` 后计为 visible。

### 实际证据

- 预置 RED：缺少 telemetry/profile/task-snapshot 模块时对应 Vitest 用例失败；实现后 `tests/client/*.test.ts` 与 `tests/server/game-server.test.ts` 共 15 项通过。
- `pnpm verify:static`：63 项 Vitest 通过；Prettier、ESLint、ls-lint、V8 coverage、TypeScript 均通过；world 行覆盖率 96.72%。
- `pnpm build`：通过。Vite 保留既有的大 bundle 警告，非本 change 新增失败。
- `pnpm exec playwright test changes/2026-09-04-client-performance-observability/e2e/performance-observability.spec.ts`：通过，验证场景隔离、真实帧 profile、postrender 可见、三重预算、Chrome Trace export 与 integrated server authority。
- `pnpm harness:e2e`：9 项基线浏览器用例通过；当前工作树的初始 ready 样本为 2399.42 ms。该数值是环境样本，不是跨机器门槛；其结果文件在提交前仍标记旧 `HEAD`，所以最终提交后需要重新关联。
