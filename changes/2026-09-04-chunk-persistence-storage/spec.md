# Chunk 持久化存储

**状态：** Breaking flow，已完成实现、准出、本地主分支集成与本地提交

## 背景与目标（Context & Goal）

当前服务端已经把发生永久变化的 Chunk 保存为完整 `Uint16Array` snapshot，但浏览器适配器会把每个 snapshot 展开为 `number[]`，并在每次保存时将内存中的全部 snapshot 同步序列化后写入 `localStorage`。一个 `32³` Chunk 的 raw voxel payload 是 64 KiB；只修改一个 voxel 也会产生完整 snapshot。随着玩家、AI 和世界模拟物化更多 Chunk，当前实现会同时出现存储容量、全量写放大、主线程停顿和权威 Chunk 常驻内存增长问题。

本变更把长期浏览器持久化升级为“隐式 procedural 空间 + 版本化自适应 Chunk record + IndexedDB 增量事务”，并建立异步保存 ACK 与安全淘汰状态机。完成后，存储成本由每个 Chunk 的最终内容复杂度决定，不随 lifetime mutation history 增长；数据库规模增大时，启动和附近 Chunk 解码只与当前 working set 相关。

用户明确允许本变更与 Change 5 在独立 worktree 并行实现，后续再显式解决接口冲突；本变更不因潜在冲突暂停 codec、存储后端和独立验收实现。

## 范围与明确不做（Scope & Non-goals）

### 范围

- 新增纯逻辑、确定性的版本化 Chunk record codec，支持 `procedural-diff-v1`、`palette-bitpack-v1` 与 `raw-u16-v1`，每次选择有效编码中尺寸最小者。
- `procedural-diff-v1` 保存当前状态相对精确 `seed + generatorVersion` 基础 Chunk 的最终差异，不保存操作历史；解码成本最多是一次固定体积 Chunk 生成和一次有界 patch。
- 在浏览器中使用 IndexedDB，以 `worldId + Chunk coord` 为记录键，分别保存 world metadata 与 Chunk 二进制 payload；新写入不再使用 `localStorage`。
- codec 与 IndexedDB I/O 在独立 persistence worker 中执行；canonical buffer 不得 transfer，只允许传递 snapshot clone。
- 保存只处理 dirty Chunk；以 revision ACK 推进 `persistedRevision`，处理保存期间再次编辑、重复 flush 与旧 ACK。
- 加入异步 Chunk residency / eviction：数据库读取区分 `found`、`missing`、`error`，脏 Chunk 只有在目标 revision 成功持久化且 await 后复检仍可淘汰时才删除。
- 将旧 `seedlands-world-v2` 数据作为只读迁移源；成功写入并读回验证 IndexedDB 前不删除或覆盖旧数据。
- 接入 `navigator.storage.estimate()` 的 usage / quota 观测，并记录 persistent-storage 状态；是否请求 `persist()` 必须通过可解释的用户交互触发。
- Harness 同时覆盖低负载 8 个物化 Chunk 与高负载 1,024 个物化 Chunk的存储占用、增量写、加载 working set、codec 解码和 IndexedDB 读取性能。

### 非目标

- Production WAL、崩溃恢复协议、Region container、OPFS 文件布局、SQLite、云端同步或专用服务器物理存储。
- Generator migration 的完整产品流程；但格式必须保留独立的 `formatVersion`、`voxelSchemaVersion` 与 `generatorVersion`，不允许把不兼容记录静默当成 missing。
- Entity / Simulation 完整持久化、备份历史、多人并发编辑与跨设备同步。
- 以压缩后的 voxel 表示替换运行时 canonical `Uint16Array`；meshing、碰撞和采样继续使用现有运行时表示。
- 将用户代理返回的模糊磁盘 usage estimate 当作精确字节门禁。

## 关键决策（Decisions）

1. **逻辑 snapshot 与物理编码分离。** `ChunkSnapshot` 仍表示完整当前状态；`StoredChunkRecord` 包含 `worldId`、坐标、revision、三个独立版本、codec、payload、payload byte length 与校验值。任何 codec 都必须解码回长度恰为 `32³` 的 `Uint16Array`，之后继续执行 voxel schema 校验。
2. **自适应选择最小合法编码。** `procedural-diff-v1` 使用排序后的最终 index/value 对并对 index 做 delta-varint；`palette-bitpack-v1` 使用 `ceil(log2(paletteSize))` 位索引和 `Uint16` palette；`raw-u16-v1` 是 little-endian 64 KiB 有界兜底。选择结果必须确定性且不依赖 Map 枚举、locale 或运行平台。
3. **procedural diff 不是 mutation log。** 同一 voxel 无论被改写多少次只保存一个最终值。record 保存 procedural base signature；精确 generator 实现不可用或 signature 不符时返回 incompatible/error，不得 procedural fallback 后覆盖 materialized 历史。Generator 退役前应由未来 migration 将依赖它的 record 转成自包含编码。
4. **损坏与不存在分离。** IndexedDB 没有记录才是 `missing`，可生成 implicit Chunk；事务失败、反序列化失败、checksum 错误、identity 或版本不符均为 `error/incompatible`，Chunk 保持不可写或显示可恢复错误，禁止静默创建并覆盖。
5. **IndexedDB 每 Chunk 一条记录。** `worlds` object store 以 `worldId` 为 key；`chunks` 以 `[worldId, cx, cy, cz]` 为 key。一次 dirty batch 在一个 readwrite transaction 中写入对应 Chunk 与 world metadata，不枚举或重写未变化 record。二进制 payload 通过 structured clone 保存，不转成 JSON/base64。
6. **异步工作不进入 Change 5 的原子 apply 区间。** residency load 在 transaction commit 前完成；Change 5 的 validation / resolve / plan / apply / publish 内不得 `await`。publish 后只 enqueue snapshot 保存。并行开发期间允许接口暂时分叉，集成时以这条时序解决冲突。
7. **revision ACK 是唯一清脏依据。** 保存开始时 clone `revision=R`；同一 key 的 store write 按 revision 串行，或在事务中拒绝小于已存 revision 的记录。ACK 只把 `persistedRevision` 推进到实际落盘的 R。若当前 revision 已到 R+1，则仍为 dirty；旧 ACK 不得倒退状态或覆盖新 record。
8. **淘汰采用 lease + epoch 并在 await 后复检。** implicit clean Chunk 可直接淘汰；materialized Chunk 只有在 `revision === persistedRevision`、没有 save/load/mesh lease 且 eviction epoch 未失效时才可删除。保存或读取等待期间的新 edit、load 或 mesh 请求会使旧 eviction 失效。
9. **pagehide 不是唯一 durability 保证。** 正常 autosave 使用可等待的后台队列；`visibilitychange/pagehide` 只触发 best-effort drain。Quota、事务或 worker 失败必须保留 dirty state、结构化错误和可重试状态，不能显示“已保存”。
10. **OPFS 保留为 backend 扩展点。** 当前 Chunk KV、事务和按 key 读取直接使用 IndexedDB；只有未来确定 Region/container、原地更新或数据库文件需求后再增加 OPFS，不在本变更中同时维护两套浏览器后端。
11. **容量门禁使用精确 record bytes。** `rawBytes`、legacy JSON UTF-8 bytes、metadata bytes、payload bytes、record bytes 分别报告。`navigator.storage.estimate()` 的 before/after delta 只作浏览器实测证据，因为浏览器可能压缩、分配页或混入同 origin 数据。
12. **高负载不允许全库启动解码。** 1,024 个已存 Chunk 的世界启动只读取 world metadata；随后只按 key 读取固定的 8 个 active Chunk。数据库规模不得使 decoded record count、IDB get count 或 resident canonical Chunk 数线性增长。

## 行为（Behaviour）

- **Given** 一个只含少量最终修改的 Chunk，**When** 编码，**Then** 选择 `procedural-diff-v1`，每个坐标只保留最终值，roundtrip 得到完整当前 snapshot。
- **Given** 一个大面积改写但 palette 有界的 Chunk，**When** 编码，**Then** 选择 `palette-bitpack-v1`，当前 9 种 voxel 最多使用 4 bit/voxel；若其他编码都不更小则使用 `raw-u16-v1`。
- **Given** 相同 snapshot 和 procedural base，**When** 在不同输入 Map 顺序或多次运行编码，**Then** record bytes 完全一致。
- **Given** payload 被截断、翻转、identity 不符、generator 不可用或 base signature 不符，**When** 加载，**Then** 返回 error/incompatible，原记录和 dirty state 不被覆盖。
- **Given** 只修改高负载数据库中的一个 Chunk，**When** flush，**Then** 只产生一个 Chunk put；不得读取、编码或重写其余 1,023 个 record。
- **Given** revision R 保存中又 commit 到 R+1，**When** R 的 ACK 到达，**Then** `persistedRevision=R` 且 Chunk 仍 dirty；R+1 成功后才能 clean。旧 ACK 晚到不得覆盖 R+1。
- **Given** 一个 dirty Chunk 离开缓存半径，**When** 开始异步保存并等待淘汰，**Then** 只有 ACK 后复检 revision、epoch 与 lease 仍匹配才可删除；期间的新 edit 会取消旧淘汰。
- **Given** IndexedDB 返回 missing，**When** 加载 Chunk，**Then** 可以由当前 seed / generator 创建 implicit Chunk；Given IndexedDB 报错或 record 损坏，Then 不得走同一路径。
- **Given** 高负载数据库有 1,024 个物化 Chunk，**When** 启动并请求固定 8 个 active Chunk，**Then** 只读取和解码这 8 个 record，resident 数保持在配置上限与 in-flight 余量内。
- **Given** 旧 `localStorage` v2 存档，**When** 首次迁移，**Then** 先在 IndexedDB 写入并按 key/数量/revision/checksum 读回；验证失败时继续保留旧数据并报告迁移失败。

## 测试设计（Test Design）

### 确定性 codec 用例

- `tests/world/chunk-snapshot-codec.test.ts` 在实现前写入并预期 RED：覆盖三种 codec、确定性最小选择、稀疏最终差异、palette bit packing、raw fallback、checksum、截断、identity/version/base signature、roundtrip 与输入 buffer 不被修改。
- 低负载 corpus 固定为 8 个物化 Chunk，分别含 1、4、16、64 个最终 override；精确 record bytes 必须不高于 8 个 raw snapshot 总量的 10%，并小于旧 JSON 表示。
- 高负载 corpus 固定为 1,024 个物化 Chunk：512 个稀疏 Chunk、384 个 terrain-like 不超过 8 palette 的 Chunk、128 个确定性 9-palette dense Chunk。raw 总量为 64 MiB；精确 record bytes 必须不高于 raw 总量的 30%，并小于旧 JSON 表示。

### 保存状态机与失败路径

- `tests/server/chunk-save-coordinator.test.ts` 在实现前写入并预期 RED：覆盖 edit-during-save、连续两次 flush、旧 ACK、store 旧 revision 拒绝、error 保脏、load found/missing/error 三态、dirty unload 与 await 后 epoch/lease 复检。
- `tests/server/game-server.test.ts` 在实现阶段补集成用例：Change 5 commit 只负责 revision/dirty，持久化 ACK 才推进 persisted revision；resident Chunk 在跨越大量坐标后保持有界。

### 浏览器容量与 runtime 性能

- `changes/2026-09-04-chunk-persistence-storage/e2e/chunk-persistence-storage.spec.ts` 在实现前写入并预期 RED，使用隔离 Browser Context 和独立数据库名分别运行低负载与高负载：
  - 校验 IndexedDB record 数量、record/payload 精确字节、codec 分布、storage estimate delta 与 quota；estimate 只报告，不作为精确门禁。
  - 高负载启动和 active working-set load 只允许 8 次 Chunk get/decode，不允许 cursor 全库扫描。
  - 高负载数据库中修改一个 Chunk 后，增量保存的 put/encode 数必须都是 1。
  - codec lane 必须是 persistence worker；主线程只接收控制消息和 decoded buffer。
- `tests/world/chunk-snapshot-codec-performance.test.ts` 在 `SEEDLANDS_PERFORMANCE_GATE=1` 时运行。每个场景预热后执行至少 3 个独立 round、每 round 9 个 sample，报告 encode/decode p50、p95、MiB/s、codec 分布与有效 payload bytes。
- 解码性能采用同机相对门禁：对相同 8-Chunk active working set，高负载数据库的 IndexedDB get+decode 跨 round p50 不得超过低负载的 2 倍；p95 超过 2.5 倍视为 regression。该门禁验证 key lookup/启动不随总记录数线性增长，不使用跨机器绝对毫秒阈值。
- 二进制 codec kernel 另与旧 `JSON.parse + Uint16Array.from` 对相同完整 snapshot 做 A/B；新格式跨 round p50 不得慢于旧路径 25% 以上。`procedural-diff-v1` 另行报告包含 base generation 的 end-to-end decode，不用 raw hydrate 掩盖生成成本。
- 完整 Harness 增加 `chunkPersistence` 报告段；不得以 storage ratio 掩盖 runtime regression，也不得以 worker 不阻塞主线程代替记录实际 worker decode 时间。

## 验收与证据（Acceptance & Evidence）

- [x] **Vitest：** 三种 codec 均确定性 roundtrip；最小选择、checksum、损坏、版本、identity 和 procedural base signature 失败路径通过。
- [x] **Vitest：** 低负载 8-Chunk corpus 的精确 record bytes ≤ raw 的 10%，且小于 legacy JSON bytes。
- [x] **Vitest / Harness：** 高负载 1,024-Chunk corpus 的精确 record bytes ≤ 64 MiB raw 的 30%，且小于 legacy JSON bytes；报告 payload、metadata、record 与 codec 分布。
- [x] **Vitest：** revision ACK、edit-during-save、旧 ACK、失败保脏、load 三态及 dirty eviction 状态机通过。
- [x] **Playwright-change：** 真实 Chromium IndexedDB 保存 8 / 1,024 个 record；报告 `navigator.storage.estimate()` 的 usage/quota/persisted 状态，且不发生 QuotaExceededError。
- [x] **Playwright-change：** 高负载启动只读取 metadata，active working set 只 get/decode 8 个 Chunk；单 Chunk 再保存只 put/encode 1 个 record。
- [x] **Harness-performance：** 低/高负载 get+decode 的 p50 比值 ≤ 2.0，p95 比值 ≤ 2.5；完整 snapshot 的新 codec kernel p50 不比 legacy JSON hydrate 慢超过 25%；另行报告 procedural base generation 成本。
- [x] **Playwright-change / Harness：** codec 与 IndexedDB 工作位于 persistence worker；高负载保存、读取和解码不形成全库主线程 JSON stringify/parse。
- [x] **Playwright-baseline：** 核心加载、编辑、streaming、刷新恢复和输入回归通过。
- [x] **Static：** `pnpm verify:static` 通过，`src/world/**` 行覆盖率为 95.70%。
- [x] **Build：** `pnpm build` 通过。
- [x] **Midscene：** N/A——没有新增视觉语义或存储错误 UI。
- [x] `git diff --check` 通过。

## 任务与当前状态（Tasks & Current State）

1. [已完成] 已读取用户提供的 Change 6、Change 5 实时任务、现有 snapshot / localStorage / GameServer / streaming 实现与浏览器存储标准。
2. [已完成] 已完成一次只读 Sol/xhigh 架构复核；结论为有条件通过，revision ACK、load 三态、async eviction 与 generator/version 冲突已纳入本 spec。
3. [已完成] 已建立 codec、保存状态机和浏览器容量/性能预期 RED 用例。`CI=true pnpm exec vitest run tests/world/chunk-snapshot-codec.test.ts tests/server/chunk-save-coordinator.test.ts` 因缺少 `chunk-snapshot-codec` 与 `chunk-save-coordinator` 两个生产模块而 2 suite RED；测试尚未执行断言。`pnpm exec tsc -p tsconfig.test.json --noEmit` 只报告上述两个生产模块、性能用例复用的 codec 模块及浏览器 Harness helper 尚不存在。
4. [已完成] 用户已按 SHA-256 `622ef75fcdb944d71dedb4c89b33c187c064ed4f66a4d87c8e353d50b0c82179` 批准 Breaking flow 实施。
5. [已完成] 已实现 codec、IndexedDB persistence worker、legacy 读回迁移、revision ACK、residency/eviction 和 Harness 指标。
6. [已完成] Vitest、Static、Build、change/baseline Playwright 与低/高负载 Harness 已按准出标准通过。
7. [已完成] Change 5 已独立合并到本地 `main` 的 `84816ac`；Change 6 已创建本地语义化 commit，未 push。
8. [已完成] 已按用户授权将 Change 6 合入本地 `main`，保留 Change 5 的模块化 app 边界并将持久化入口迁入 `Game`、`World`、`MeshTaskScheduler`、Harness 与 legacy Store；冲突解决后的静态、构建、change Playwright 和基线 Playwright 均通过。

## 交付快照（Delivery Snapshot）

### 变更路径

- `src/world/chunk-snapshot-codec.ts`：版本化自适应二进制 codec、校验、identity 与 procedural base signature。
- `src/worker/persistence-worker.ts`：IndexedDB world/chunk stores、串行读写、revision 防倒退、codec worker lane 与基准 corpus。
- `src/client/browser-chunk-persistence.ts`：异步预取、working-set staging cache、legacy 一次迁移和读回、metadata 与观测指标。
- `src/client/chunk-persistence-benchmark.ts`、change Playwright 与 E2E support：仅在 `?harness=1` 动态加载的真实浏览器容量/runtime 验收。
- `src/server/game-server.ts` 与 `src/app/main.ts`：持久化前置加载、revision ACK 清脏、安全 eviction、增量 autosave 和最后使用 world 恢复。
- `vitest.config.ts`：将覆盖率门禁修正为真实的 `src/world/**/*.ts`。

### 容量与 runtime 结果

- 低负载 8 Chunk：raw `524,288 B`，legacy JSON `524,296 B`，record `2,409 B`（payload `172 B`、metadata `2,237 B`），为 raw 的 `0.46%`；codec 全部为 `procedural-diff-v1`。
- 高负载 1,024 Chunk：raw `67,108,864 B`，legacy JSON `67,109,888 B`，record `7,020,953 B`（payload `6,747,667 B`、metadata `273,286 B`），为 raw 的 `10.46%`；`procedural-diff-v1=512`、`palette-bitpack-v1=512`。
- Vitest codec kernel：8 Chunk p50 `1.278 ms`、p95 `2.408 ms`、p50 throughput `391.15 MiB/s`；旧 JSON hydrate p50 `1.346 ms`、p95 `1.416 ms`、`371.44 MiB/s`，新 codec p50 未回归。
- Chromium get+decode：低负载 p50/p95 `33.6/40.5 ms`；高负载 `1.4/80.1 ms`，比值约 `0.04x/1.98x`。高负载只发生 8 get / 8 decode，启动 Chunk scan 为 0，resident staging Chunk 为 8。
- Chromium 增量保存：1 个 changed Chunk 对应 `1 encode + 1 IndexedDB put + 0 untouched Chunk read`。
- Chromium `navigator.storage.estimate()`：低负载采样 usage/quota `147,456 / 6,442,598,400 B`，高负载采样 `741,376 / 6,443,192,320 B`；`persisted=false`。该值受浏览器压缩、页分配和同 origin 数据影响，只作观测，不代替精确 record bytes。

### 验证证据

- `CI=true SEEDLANDS_PERFORMANCE_GATE=1 pnpm exec vitest run tests/world/chunk-snapshot-codec-performance.test.ts --reporter=verbose`：1/1 通过。
- `pnpm exec playwright test changes/2026-09-04-chunk-persistence-storage/e2e --reporter=line`：2/2 通过，包括 8/1,024 corpus 与 legacy 一次迁移/二次启动。
- `pnpm test:e2e:regression -- --reporter=line`：8/8 通过；刷新恢复竞态修复后目标 persistence 用例另连续重复 5 次通过。
- `pnpm verify:static`：12 files 通过、1 个性能门用例按环境变量跳过；80 tests 通过、1 skipped；`src/world/**` 行覆盖率 95.70%。
- `pnpm build`：TypeScript 与 Vite production build 通过；保留既有主 bundle 大于 500 kB 的 Vite warning。
- `git diff --check`：通过。

### 本地主分支集成证据

- 合并基线：本地 `main` 的 `9b2de4e`，包含 Change 5 `84816ac` 与 app 模块拆分 `7eaa675`；Change 6 来源提交为 `3f1ba51`。
- 冲突范围：仅 `src/app/main.ts` 发生文本冲突；集成保留模块化入口，并将 IndexedDB 生命周期、异步保存、邻域预取、淘汰与 Harness 能力分别迁入既有模块。
- `pnpm verify:static`：16 files 通过、2 files 按既有条件跳过；106 tests 通过、4 skipped；`src/world/**` 行覆盖率 95.70%。
- `pnpm build`：TypeScript 与 Vite production build 通过；保留既有主 bundle 大于 500 kB 的 Vite warning。
- `pnpm exec playwright test changes/2026-09-04-chunk-persistence-storage/e2e`：2/2 通过；高负载仍只读取/解码 8 个 active Chunk，单 Chunk 增量保存仍为 `1 encode + 1 put + 0 untouched read`。
- `pnpm test:e2e`：9/9 通过，包括 Change 5 的 transaction/collision 旅程与 Change 6 的刷新恢复、streaming 旅程。
- 集成后的 Chromium 样本：低负载 record `2,409 B`，高负载 record `7,020,953 B`；低负载 decode p50/p95 `33.5/42.4 ms`，高负载 `1.3/80.7 ms`，相对门禁继续通过。

### 已知限制

- 当前不主动请求 persistent-storage 权限，实测状态为 `persisted=false`；未来只能在可解释的用户交互中请求。
- Generator migration、云同步、WAL/崩溃恢复与 OPFS region container 不在本 change 范围。
- 1,024 Chunk 的一次性浏览器 corpus 构造约 56 秒，是验收数据准备成本，不属于启动或 active working-set 解码耗时。
- 本地合并尚未推送；远端分支和 `origin/main` 未发生变化。
