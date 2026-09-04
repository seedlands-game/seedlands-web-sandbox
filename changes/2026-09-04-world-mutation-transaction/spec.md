# 世界修改事务

**状态：** 已交付；用户已批准实现合同 SHA-256 `60aec2bc75d88af18211f8a5ca143cfe39c0b38688bbe2e67bdb56530af2a43f`

## 背景与目标

客户端 / 服务端基础已经让 `GameServer` 持有权威 Chunk，并提供了初版 `editBatch()`、Chunk revision、脏 Chunk 和聚合边界。不过现有实现仍会按输入顺序直接写 canonical `Uint16Array`：同坐标重复写入不能合并，回到原值仍被视为修改，批次中后置非法写入会留下前置修改，world revision 只是所有 Chunk revision 的临时求和，批量场景也没有可合并的 mutation buffer、结构事件与语义事件边界或 `/fill` 压测入口。

本 change 在既有 `GameServer` 上正式建立 transaction / commit boundary：系统先读取 canonical state 并写入紧凑 mutation buffer，服务端在一次 commit 中验证、确定性合并、按 Chunk 应用并输出一个聚合结构变化；昂贵的持久化、网格和表现层工作只消费聚合结果。完成后，1 个 voxel 与 100,000 个 voxel 都遵循同一权威语义，同时不会把 100,000 次底层写入放大为 100,000 个结构事件或 remesh 调度。

## 范围与非目标

### 范围

- 新增基于 TypedArray 的 `WorldMutationBuffer`，支持多个系统先独立计算、再由 `editBatch()` 确定性合并。
- 将 `GameServer.editBatch()` 升级为先完整校验、再 resolve / coalesce、最后一次 commit 的原子写入口；`edit()` 继续只是单 voxel convenience API。
- 同一坐标在确定性命令序列内采用 last-write-wins；最终值等于 commit 前 canonical 值时不产生实际写入、Chunk revision、脏 Chunk 或结构事件。
- 新增独立 `worldRevision`。每个包含有效状态变化或显式语义事件的成功 commit 只增长一次；完全空或纯状态 no-op 批次不增长。
- 每个有效状态 commit 只产生一个 `VoxelRegionChanged`，包含 world revision、实际 mutation 数、排序后的受影响 Chunk / mesh Chunk、每个受影响 Chunk 的 revision 和实际变化 AABB。
- 显式语义事件由 gameplay / simulation 调用方提供，服务端不从 voxel write 猜测。状态可被 coalesce，但语义事件按确定性顺序保留；只有语义事件的 commit 不产生结构事件。
- 新增结构化 `FillCommand`，将 inclusive AABB 解析到紧凑 mutation buffer，并通过一次 `editBatch()` 提交；不实现 slash parser。
- 客户端新增批量应用聚合结果的路径。一次 batch 对每个 mesh Chunk 最多失效一次，并只触发一次 debounce remesh 调度。
- 为 1、1,000、10,000、100,000 voxel fill 采集 resolve / apply / commit 时间、实际 mutation 数、dirty Chunk 数、结构事件数、mesh invalidation 数、紧凑 buffer 字节数和 Node heap 近似变化；浏览器 change E2E 证明 100k fill 只推进一次 world revision 和一次客户端 remesh 调度。
- 建立可重复的同环境性能门禁：现有单 voxel convenience path 不得相对本 change 开始前的实测基线发生超过 15% 的 p50 regression；目标批处理相对逐 voxel commit 必须至少达到 2 倍吞吐，并将结构事件与客户端 remesh 调度从 N 次聚合为 1 次。

### 非目标

- 不实现 Chunk Snapshot persistence 新格式、WAL、Region Storage、崩溃恢复或 world revision 持久化。
- 不实现 slash command parser、Headless REPL、网络复制、多人冲突解决、Worker/WASM 并行 commit、Region 分片或全局锁。
- 不实现 ECS、完整 tick scheduler、Agent、Navigation、Hydrology 或 Semantic World；只提供其未来可消费的 commit 契约。
- 不为底层 voxel write 自动生成 `BlockBroken`、`TreeFelled` 等玩法语义，也不新增玩家可见 UI。
- 不使用跨机器绝对毫秒阈值，也不因新增观测指标自动改写现有 Harness 性能基线；只有环境元数据一致时才将 change 前后绝对基线用于“不劣化”判定。

## 关键决策

1. **事务分为 validation、resolve、plan、apply 与 publish。** 所有 actor、坐标、voxel ID、buffer 身份和语义事件先完整校验；再完成全部归属 Chunk 的 materialize / 旧值读取、数值排序、bounds、事件与 revision 计划；直到上述步骤全部成功后才允许第一次 canonical 写入。任何非法输入或 Chunk 加载失败都会抛错，canonical voxel、revision、dirty state、mutationCount 和事件结果均保持不变。成功缓存只读 procedural Chunk 不算 canonical mutation，但不能成为部分 commit 的借口。
2. **mutation buffer 使用平坦 TypedArray，并在写入前校验。** 坐标以 `Int32Array` 保存，voxel 以 `Uint16Array` 保存；`write()` 必须在值进入 TypedArray、发生静默截断或转换前拒绝 `NaN`、小数、超出 int32 的坐标及非法 voxel ID。动态扩容按容量成倍增长。对小型旧调用仍允许 `edits` 数组兼容入口，但 `FillCommand` 和未来系统 buffer 不为每个 voxel 创建复杂 runtime object。
3. **多 buffer 顺序显式且可复现。** buffer 以 `priority` 升序、再以 `sourceId` 的 Unicode code-point 顺序合并；同一 buffer 内保持 append 顺序，后出现的写入覆盖前写入。一个 batch 内重复的 `priority + sourceId` 非法，避免依赖调用方数组顺序或 Worker 完成顺序。`edits` 与 `buffers` 不能同时提供；兼容 `edits` 只形成一个固定身份的内部 buffer。
4. **coalescing 比较最终值与 commit 前值。** resolve 阶段按归属 Chunk 和 voxel index 保存最终候选；apply 前读取一次原值。`Stone → Air → Dirt` 只写 `Dirt`，`Stone → Air → Stone` 是结构 no-op。
5. **revision 表示 commit，而不是 voxel 数。** 有状态变化或显式语义事件的 commit 令 `worldRevision += 1`；每个有实际状态变化的 Chunk 令 `chunk.revision += 1`。`mutationCount` 改为累计实际 voxel write 数，避免再把 Chunk revision 求和误称为 mutation 数。`worldRevision` 与 `mutationCount` 在本 change 中是 `GameServer` 进程期计数，新实例从 0 开始；现有持久化只恢复 Chunk revision，本 change 不伪造一个无法从分散 Chunk snapshot 准确还原的全局 revision。
6. **结构变化与语义事实分离。** `WorldCommitResult` 返回 `structuralChange | null` 与原顺序保留的 `semanticEvents`。结构变化至多一个；语义事件由上层解释行为后显式传入，即使最终 voxel 状态未变化也不能被 coalesce。
7. **publish 结果是下游唯一失效输入。** Server 不访问定时器、PlayCanvas、GPU 或存档实现细节；客户端只根据 `meshChunks` 去重并调度一次 remesh，现有 `flushDirtyChunks()` 继续根据 commit 标记的 dirty Chunk 保存。
8. **结果按 Chunk 数值坐标稳定排序。** 归属 Chunk、Chunk revision 与 mesh Chunk 都按 `cx → cy → cz` 数值升序排列，不使用字符串字典序或 locale；负坐标和多位坐标也必须得到同一顺序。
9. **Fill 在分配前以安全体积限额失败。** inclusive AABB 的每轴长度先由安全整数计算，再以 `BigInt` 相乘并与 `MAX_FILL_VOXELS = 1_000_000` 比较；超限或不能表示的输入不得分配 buffer。结果 metrics 分别报告实际 payload bytes 和已分配 capacity bytes，不能把扩容余量伪装成有效数据量。
10. **性能采用“同环境前后基线 + 同进程 A/B”双门禁。** change 前在 `2b5d22b`、Node v24.20.0 / darwin / arm64 上预热并 materialize Chunk 后，以 3 次独立运行、每次 9 个样本采集到 10,000 次 `edit()` 的跨运行 p50 中位数为 3.352459 ms、p95 中位数为 3.784292 ms。实现后环境完全匹配时，10,000 次 `edit()` 的跨运行 p50 中位数不得高于 3.855328 ms（+15%）；p95 只作诊断，超过 +25% 必须标记 regression 并停止交付。不同环境不套用绝对值，只报告不可比较。
11. **批处理优化用同进程相对值硬判定。** 在相同已 materialize 世界、相同最终 voxel 集和交替值下，分别执行 100,000 次单 voxel `edit()` 与一个 100,000-input `FillCommand` / `editBatch()`；排除 worldgen、buffer 构造、持久化和 meshing，只测 transaction resolve / apply / publish。批处理跨运行 p50 必须不高于逐 voxel p50 的 50%（至少 2 倍吞吐），实际结构事件为 1，客户端一次性消费 commit 后 remesh debounce 调度为 1。另加 overwrite-heavy 的 100,000 输入 / 10,000 唯一坐标场景，证明 coalescing 只执行 10,000 次 canonical write。
12. **既有 Harness 指标不得劣化。** 完整 Harness 的 worldgen、meshing、memory proxy、bundle 与浏览器样本继续使用现有 5% warning / 15% regression 规则；不得出现 `REGRESSION`。与 mutation 无关的波动若出现 warning，必须保留证据并解释，不得用批处理加速掩盖。

## 行为

- **Given** 一个含跨 Chunk 写入的合法 batch，**When** commit，**Then** 所有最终值一次生效，world revision 只增长一次，每个实际改变的 Chunk revision 只增长一次，并只返回一个排序稳定的结构变化。
- **Given** 同坐标在一个或多个 buffer 中被多次写入，**When** resolve，**Then** 按显式 buffer 顺序与 buffer 内 append 顺序 last-write-wins；改变调用方 buffers 数组顺序不改变结果。
- **Given** 某坐标最终写回 commit 前值，**When** commit，**Then** 该坐标不计入 mutation、bounds、dirty Chunk 或 mesh invalidation；若整个 batch 都如此且无语义事件，则 commit 为 no-op，world revision 不变。
- **Given** batch 任一坐标、voxel、actor、buffer 身份或语义事件非法，**When** 提交，**Then** 整个 batch 失败且 canonical state、world / Chunk revision、dirty state 和 mutationCount 均不改变。
- **Given** batch 的后续归属 Chunk 在 materialize / snapshot 读取时抛错，**When** commit plan 尚未完整建立，**Then** 前面已读取 Chunk 的 voxel、revision 与 dirty state 仍保持不变。
- **Given** 同一 batch 同时提供 `edits` 与 `buffers`，**When** validation，**Then** 明确拒绝，不能让两类输入之间的优先级依赖实现偶然。
- **Given** 一个状态 no-op 但包含 `ActorPassedDoorway` 的 batch，**When** commit，**Then**不产生 `VoxelRegionChanged`，但语义事件仍按输入顺序返回并使 world revision 前进一次。
- **Given** inclusive AABB 的 `FillCommand`，**When** resolve，**Then** 对反向 from / to 先规范化，使用 `BigInt` 在分配前校验体积，得到恰好体积数量的紧凑写入；非法体积或超过 1,000,000 voxel 时在分配 / commit 前失败。
- **Given** 100,000 voxel fill，**When** headless commit，**Then** structural event count 为 1，world revision 增长 1，每个 dirty Chunk revision 增长 1，mesh invalidation 与 dirty 数按 Chunk 去重。
- **Given** 浏览器 Integrated Mode 对 100,000 voxel 执行一次 fill，**When** 客户端消费 commit，**Then** 只执行一次 debounce remesh 调度，且实际 remesh 目标按聚合 mesh Chunk 去重；Server 不直接触碰表现层。
- **Given** 与 change 前基线相同的已 materialize 单 voxel workload，**When** 在同 Node / OS / arch 上按相同预热与采样方法复测，**Then** 10,000 次 `edit()` 的跨运行 p50 中位数不超过基线 15%，p95 超过 25% 视为 regression。
- **Given** 相同最终 voxel 集的逐 voxel 与批量两种路径，**When** 在同一进程交替采样，**Then** 100k 批量路径的 p50 不高于逐 voxel路径的 50%，并且结构事件与客户端 remesh 调度从 N 聚合为 1。

## 测试设计

- `tests/server/world-mutation-transaction.test.ts` 在实现前写入并预期 RED：
  - 跨 Chunk commit 的 world / Chunk revision、排序结果、bounds 与结构事件聚合；
  - 单 buffer 重复写入、多 buffer 确定性 merge、回到原值 no-op；
  - buffer 在 TypedArray 写入前拒绝 `NaN` / 小数 / int32 越界 / 非法 voxel；`edits` 与 `buffers` 混用失败；
  - 非法批次及后续 Chunk 加载失败时原子失败；
  - 负数 / 多位 Chunk 坐标按 `cx → cy → cz` 数值排序；
  - 状态 coalescing 不删除显式语义事件；
  - `FillCommand` inclusive / 反向边界、BigInt 体积上限、payload / capacity bytes 与 100k 一次提交；
  - `edit()` 代理单元素 batch，`mutationCount` 统计实际写入数。
- `tests/server/world-mutation-performance.test.ts` 在实现前写入并预期 RED；默认静态 / correctness 流程跳过 wall-clock gate，`SEEDLANDS_PERFORMANCE_GATE=1` 时执行：
  - 同环境 10k 单 voxel before / after regression 门；
  - 同进程 100k sequential-vs-batch 至少 2x；
  - 100k input / 10k unique overwrite-heavy coalescing 的 canonical write 与结构事件计数。
- `changes/2026-09-04-world-mutation-transaction/e2e/world-mutation-transaction.spec.ts` 在实现前写入并预期 RED：通过受控 Harness 执行 100k fill，断言一次 world revision、一个结构事件、一次 remesh 调度和有界去重后的 mesh Chunk 数。它只验证客户端聚合消费，不替代 headless 算法断言。
- `changes/2026-09-04-world-mutation-transaction/performance-baseline.json` 已在生产实现前从 `2b5d22b` 采集，保留环境、预热、采样数及原始跨运行 p50 / p95；它只用于环境完全相同时的 before / after 判定。
- `scripts/run-harness.mjs` 在实现阶段加入 1 / 1k / 10k / 100k fill 样本、10k 单 voxel 不劣化复测、100k sequential-vs-batch 同进程 A/B，以及 100k 输入 / 10k 唯一坐标 coalescing 样本。结果进入独立 `worldMutation` 报告段；不把新指标混入既有 baseline 自动更新。
- mutation benchmark 每种路径先 warm-up，已 materialize 所有目标 Chunk，payload 构造在计时外；至少 3 次独立运行、每次 9 个样本，使用跨运行 p50 中位数。执行顺序每轮交替，避免固定先后顺序偏差；若环境不匹配，绝对基线判定标记 `NOT_COMPARABLE`，但同进程 2x A/B 仍是硬门禁。
- 现有 `tests/server/game-server.test.ts`、`tests/world/**`、Playwright 回归继续证明基础 authority、快照、网格 halo、输入、streaming 与持久化不回归。
- 该 change 不新增视觉语义，Midscene 为 N/A；真实浏览器调度与 frame 样本由 Playwright-change / Harness 覆盖。

## 验收与证据

- [x] **Vitest：** validation / resolve / plan / apply / publish 原子；输入非法或后续 Chunk 加载失败时不留下部分写入；重复写入 coalesce、最终回原值 no-op、多 buffer merge 不依赖 buffers 数组顺序。
- [x] **Vitest：** 每个成功 commit 只推进一次 world revision，每个实际改变的 Chunk 只推进一次 Chunk revision；非法或纯状态 no-op 不推进。
- [x] **Vitest：** 每次状态 commit 至多一个 `VoxelRegionChanged`；语义事件与结构事件分离，并在状态 no-op 时仍保留因果。
- [x] **Vitest：** mutation buffer 在 TypedArray 写入前校验；`edits` / `buffers` 禁止混用；Chunk 输出按数值坐标排序。
- [x] **Vitest：** `FillCommand` 以 BigInt 在分配前正确处理 inclusive / 反向 AABB 与 1,000,000 上限，区分 payload / capacity bytes；100k fill 一次 commit、一个结构事件、Chunk 级 dirty / mesh invalidation。
- [x] **Playwright-change：** 100k Integrated Mode fill 只推进一次 world revision、产生一个结构事件并触发一次客户端 remesh 调度；独立 change 用例 1/1 通过。
- [x] **Playwright-baseline：** 现有浏览器核心回归 8/8 通过，覆盖页面加载、输入、玩家、编辑、streaming 与刷新持久化。
- [x] **Harness-performance：** Node v24.20.0 / darwin / arm64 同环境 10k 单 voxel 路径 p50 为 2.413416 ms、p95 为 2.560542 ms，分别低于 3.855328 ms 与 4.730365 ms 门限。
- [x] **Harness-performance：** 100k batch p50 为 1.961625 ms，100k sequential commit p50 为 27.950542 ms，达到 14.25x；100k input / 10k unique workload 仅有 10k canonical writes；结构事件与客户端 remesh 调度均聚合为 1。
- [x] **Harness：** 已记录 1 / 1k / 10k / 100k fill 阶段时间、buffer payload / capacity bytes、Node heap 代理、dirty Chunk、mesh invalidation 与结构事件数；100k fill p50 / p95 为 1.793708 / 1.925375 ms，产生 1 个结构事件、16 个 dirty Chunk、50 个去重 mesh invalidation；既有 comparison 全部为 `OK`，无 `REGRESSION`。
- [x] **Static：** `CI=true pnpm verify:static` 通过；11 个 suite 通过、1 个显式性能 suite 默认跳过，82 个用例通过、3 个用例跳过；`src/world/**` 行覆盖率 97.27%（357/367）。
- [x] **Build：** `CI=true pnpm build` 通过；仅保留既有大 chunk 提示，无构建错误。
- [x] **Midscene：** N/A——没有新增用户可见视觉或语义 UI。
- [x] `git diff --check` 通过。

## 任务与当前状态

1. [已完成] 已读取用户提供的 Change 5、当前 `GameServer` / 客户端 / Harness、最近 change 与 Git 状态，并确认本 change 是已存在批量基础之上的事务语义增量。
2. [已完成] 已建立 spec 与预期 RED 用例，并完成一次只读 Sol/xhigh 架构复核；复核提出的 TypedArray 前置校验、输入混用、Chunk 加载原子性、数值排序、Fill 体积和进程期 revision 边界已写回。用户随后新增“不劣化且批处理明显优化”要求，已从未修改生产代码的 `2b5d22b` 采集 pre-change 基线，并补充绝对 regression 与同进程 A/B 门禁；固定意图 reviewer 的每任务一次额度已消费，新增阈值由父级与用户精确 hash 审核负责。
3. [已完成] 用户已批准精确 spec SHA-256 `60aec2bc75d88af18211f8a5ca143cfe39c0b38688bbe2e67bdb56530af2a43f`。
4. [已完成] 已实现 mutation buffer、原子 commit、revision / event、FillCommand 和客户端聚合调度。
5. [已完成] Vitest、Static、Build、change / baseline Playwright 与完整 Harness 均通过，真实证据已写回。
6. [已完成] 已更新 Delivery Snapshot；交付时仅暂存本 change 文件并创建本地语义化 commit，不 push。

## 交付快照

### 变更路径

- `src/server/world-mutation.ts`：新增紧凑 mutation buffer、前置校验、确定性来源元数据及 Fill 快路径所需 Chunk run。
- `src/server/game-server.ts`：新增事务 validation / resolve / plan / apply / publish、原子 commit、revision、结构 / 语义事件、coalescing 与聚合 metrics；保留优化后的单 voxel convenience path。
- `src/server/commands/fill-command.ts`：新增结构化 FillCommand、反向 inclusive AABB 规范化及 BigInt 分配前限额。
- `src/app/main.ts`、`tests/e2e/support/harness.ts`：客户端统一消费 commit，按聚合 mesh Chunk 去重，并只安排一次 remesh；受控 Harness 暴露事务观测值。
- `tests/server/world-mutation-transaction.test.ts`、`tests/server/world-mutation-performance.test.ts`、`changes/2026-09-04-world-mutation-transaction/e2e/world-mutation-transaction.spec.ts`：覆盖事务正确性、性能硬门禁和浏览器聚合消费。
- `scripts/run-harness.mjs`、`scripts/run-playwright-harness.mjs`、`package.json`：把同环境单编辑基线、同进程批处理 A/B、分档 Fill 指标及稳定 heap 采样纳入 Harness。
- `README.md` 及既有 GameServer / Playwright 回归：同步当前能力与进程期计数恢复语义。

### 验证结果

- `CI=true pnpm verify:static`：通过；82 passed、3 skipped，`src/world/**` 行覆盖率 97.27%。
- `CI=true pnpm build`：通过。
- `CI=true pnpm exec playwright test changes/2026-09-04-world-mutation-transaction/e2e`：1 passed。
- `CI=true pnpm exec playwright test tests/e2e/regression`：8 passed。
- `CI=true pnpm harness`：通过；Vitest、Build、8 个浏览器回归、1 个浏览器 benchmark 及 world mutation 性能门禁全部为 PASS。
- `git diff --check`：通过。

### 性能证据

- 环境与 change 前基线完全可比：Node v24.20.0、darwin、arm64。
- 10k 单 voxel `edit()` p50 / p95 从 change 前 3.352459 / 3.784292 ms 到 2.413416 / 2.560542 ms，未发生劣化。
- 100k Fill batch p50 为 1.961625 ms，100k sequential commit p50 为 27.950542 ms，批处理快 14.25x，明显超过 2x 硬门禁。
- 100k Fill 分档样本 p50 / p95 为 1.793708 / 1.925375 ms；一次 commit 只发布 1 个结构事件，客户端只安排 1 次 remesh，16 个 dirty Chunk 与 50 个 mesh invalidation 均按 Chunk 去重。
- overwrite-heavy 的 100k 输入 / 10k 唯一坐标只执行 10k canonical writes。
- 既有 Harness comparison 全部为 `OK`；heap proxy 相对基线 +4.62%、JS bundle +1.96%、gzip JS +2.44%，均低于既有 warning / regression 门限。

### 已知边界

- `worldRevision` 与 `mutationCount` 仍是 `GameServer` 进程期计数；重启后从 0 开始，Chunk revision 按既有 snapshot 恢复。
- Fill 快路径只用于由可信 resolver 生成、坐标唯一的结构化 Fill buffer；普通 buffer 仍走完整确定性合并与 coalescing。
- mutation heap 指标是带 benchmark 保留对象的同环境进程代理，不等同于浏览器或生产常驻内存。
- 为避免观测代码拖慢常用路径，单 voxel commit 内部 metrics 标记为 `not-collected-hot-path`；外部 Harness 对完整调用路径计时并执行不劣化门禁。
- 本 change 不新增持久化格式、slash parser、网络复制或视觉 UI；Midscene 不适用。
