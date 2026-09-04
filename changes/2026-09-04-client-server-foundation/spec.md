# 客户端 / 服务端基础

**状态：** 已交付；Harness 基线已按当前提交重新采集

## 背景与目标

当前仅在浏览器运行的 `World` 同时持有 canonical voxel 数据、生成和网格调度、修改历史、本地持久化以及 PlayCanvas 网格生命周期。本变更不增加网络，而是建立首个逻辑客户端 / 服务端边界：`GameServer` 持有纯逻辑的权威世界、实体状态、世界时钟、批量修改、脏状态 / revision 与快照；绑定 PlayCanvas 的 `GameClient` 持有渲染、相机、输入、HUD 和 Worker / 渲染生命周期。

浏览器通过直接调用使用同一个服务端。`Uint16Array` 在运行时无法真正设为只读：Integrated Mode 只允许可信同进程客户端在不转移、不写入 canonical buffer 的前提下读取网格输入；这不是安全隔离。完成后的服务端必须能在 Node 中独立运行，不依赖 DOM、PlayCanvas、Worker 全局对象、GPU 或浏览器存储。

## 范围与非目标

- 范围：纯逻辑的 `src/server/` 权威运行时；具有 revision / 脏状态的 Chunk 快照和增量持久化接口；聚合的 `WorldEditBatch` 结果；最小服务端实体和时钟状态；将现有浏览器运行时抽取为 PlayCanvas 客户端；浏览器 Integrated Mode 经由新服务端边界完成渲染、编辑、streaming 和持久化。
- 非目标：WebSocket / WebTransport、状态复制 / prediction、客户端副本、认证、专用服务部署、分片、生产 WAL / 崩溃恢复、区域文件 / 压缩、NPC / Agent、背包 / 战斗，以及跨引擎 Renderer 抽象。

## 关键决策

- 保持 `src/world/` 为纯逻辑、可共享的确定性数据和算法层。它不是客户端实现；服务端可导入它，但它不得导入 `src/server/`、`src/client/`、DOM、PlayCanvas 或 Worker 全局对象。
- 在 `src/server/` 下新增 `GameServer` 和 `ServerWorld`。Chunk 持有 canonical `Uint16Array`、整数 revision、脏标记和 materialized snapshot 来源标记。未 materialize 的 Chunk 由 `seed + generatorVersion` 生成；已 materialize 的 Chunk 必须先加载通过身份和数据校验的快照。
- 将 `editBatch` 作为唯一的权威写入入口。它在批次内直接写入 TypedArray；每个发生修改的归属 Chunk 每次提交只增加一次 revision、被标为脏，并产出一个 `VoxelRegionChanged` 聚合结果，其中包含去重后的归属 Chunk key、网格失效 Chunk key、修改 AABB 与实际写入数。`edit` 只代理一个元素的批次。值相同的 no-op 不得增加 revision 或产生脏快照。
- Chunk 快照必须包含 world seed、generator version、Chunk 坐标 / key、revision 与长度恰为 `CHUNK_SIZE ** 3` 的体素数据。服务端必须校验这些字段以及体素 ID 合法性；无效、跨 seed 或不兼容快照必须丢弃并确定性回退生成。旧 `seedlands-world-v2` mutation 存档首次加载时只迁移一次到服务端批次，下一次成功保存必须写为快照格式。
- 新增同步持久化端口，提供快照读取 / 写入，并提供内存实现供 headless 测试使用。浏览器 `localStorage` 只是适配器，不是服务端状态。`flushDirtyChunks()` 只能写入脏快照，并且只在整批写入成功返回后清除对应脏标记；写入抛错后所有待写 Chunk 必须保持为脏。
- 为 `GameServer` 提供可 headless 运行的最小实体和时钟 API。浏览器启动时创建服务端 Player；现有客户端控制器每帧将已解析的位置写回该 Player，环境时间只从服务端时钟读取。完整的输入 / 碰撞解析仍是后续 gameplay / entity 变更范围，但浏览器 Harness 必须证明显示位置和环境时间与服务端状态一致。
- 将依赖 PlayCanvas 的 Chunk Entity、GPU Mesh、相机、DOM / 输入 / HUD 和 `localStorage` 适配器抽到 `src/client/`。不新增 Renderer / Engine 通用接口。客户端不得把 canonical buffer 传给 Worker 或 transfer；Integrated Mode 网格在客户端直接调用纯 `meshChunk` 并通过服务端的相邻 Chunk 查询提供一格 halo，保证 materialized 邻块重载后的边界面与 AO 正确。
- Worker 保留为独立的浏览器网格实验适配器，但不处于 Integrated Mode canonical 数据链路；服务端的 headless 生成路径使用直接纯逻辑调用，任何服务端模块不得导入 Worker API。
- 在 `eslint.config.mjs` 注册自定义 `seedlands/world-purity` 和 `seedlands/server-purity` 规则，分别对 `src/world/**/*.ts` 与 `src/server/**/*.ts` 生效。前者拒绝 `src/server/`、`src/client/`、`playcanvas` 导入以及 DOM / Worker 全局对象；后者拒绝 PlayCanvas、DOM、Worker、GPU、相机、输入和 UI 依赖。两条规则都必须有真实 ESLint 的反例和正例测试。

## 行为

- 给定一个未 materialize 的坐标，当服务端读取它时，则服务端使用自身的 seed 和 generator version 确定性地生成 canonical Chunk 数据。
- 给定某坐标已有完整且兼容的持久化快照，当新服务端读取该坐标时，则必须加载快照，而不是重新生成后回放全局、无限增长的 history；给定不合法、跨 seed、长度错误或体素值错误的快照时，则必须忽略该快照并确定性生成。
- 给定一个修改了一个或多个 Chunk 的批次，当其提交时，则 canonical 数据发生变化；每个被修改归属 Chunk 的 revision 只前进一次、这些 Chunk 被标脏，并返回包含归属 key、网格失效 key 和边界的聚合结构变更结果。无效 / 重复写入不得推进 revision。
- 给定同时存在脏和干净 Chunk 的自动保存，当执行 flush 时，则只能写入脏 Chunk 快照，且成功写入的 Chunk变为干净；未变化 Chunk 不得产生快照。任意快照写入失败时，受影响 Chunk 必须保持脏状态以便安全重试。
- 给定相邻 Chunk 边界发生修改并保存 / 重载，当客户端以服务端邻块查询网格化时，则边界面和 AO 必须反映双方当前数据，而不是旧 procedural base 或历史 changes。
- 给定不存在浏览器客户端的服务端，当其生成 / 读取 / 编辑 / 保存 / 重载 Chunk、创建或更新实体并推进时钟时，则所有结果必须在 Node 中可用，且不依赖 DOM 或 PlayCanvas。
- 给定浏览器中的 Integrated Mode，当玩家探索、破坏 / 放置体素、跨 Chunk、保存、刷新并继续时，则现有可见行为必须保持；Harness 必须证明目标 voxel、服务端 Player 位置和服务端 world time 在刷新前后与客户端显示状态一致。

## 测试设计

- `tests/server/game-server.test.ts` 已先于实现写入，预期先 RED。它定义 headless 生成、一次跨 Chunk 修改批次的聚合结果、no-op revision、仅保存脏快照且精确重载、快照损坏 / 跨 seed 回退、写入失败保脏、边界相邻数据读取，以及独立实体 / 时钟状态。
- `changes/2026-09-04-client-server-foundation/e2e/client-server-foundation.spec.ts` 已先于实现写入，预期先 RED。它经由受控 Harness 路径断言浏览器报告 Integrated Mode 服务端权威、生产 `World.edit()` 路径会推进服务端 revision、读取目标 voxel 而非 mutation count、刷新后保持该 voxel，并证明客户端位置 / 时钟与服务端实体 / 时钟一致。
- `tests/governance/world-purity-eslint.test.ts` 已先于 ESLint 配置写入，预期先 RED。它用真实 ESLint 配置验证两条规则拒绝 world 的服务端 / 客户端 / PlayCanvas / DOM / Worker 依赖，拒绝 server 的 PlayCanvas / DOM / Worker 依赖，同时保留纯算法正例。
- 现有 `tests/world/**` 继续证明共享世界的确定性和编解码行为；现有 Playwright 基线与 Harness 继续证明 gameplay / streaming / persistence 未回归。本变更的用户可见契约是行为连续性而非新增视觉功能，Midscene 为 N/A。

## 验收与证据

- [x] **Vitest：** headless `GameServer` 能生成 / 读取、批量编辑、持久化 / 重载经过身份校验的快照，并更新实体 / 时钟状态，且不访问浏览器全局对象。`CI=true pnpm verify:static`：56/56 通过。
- [x] **Vitest：** 一次编辑批次只产生一个聚合结构结果，去重 Chunk、记录边界和网格失效邻块、推进 revision，且不形成每体素事件扇出；no-op 不得改变 revision。`tests/server/game-server.test.ts` 覆盖。
- [x] **Vitest：** 只持久化脏 Chunk；重载 materialized 快照后恢复精确体素状态；无效 / 跨 seed 快照确定性回退；失败写入保持脏状态。`tests/server/game-server.test.ts` 覆盖。
- [x] **Vitest：** 相邻 materialized Chunk 在保存 / 重载后仍可供边界网格查询其当前体素。`tests/server/game-server.test.ts` 覆盖。
- [x] **静态检查：** 自定义 `seedlands/world-purity` 和 `seedlands/server-purity` 规则在真实 ESLint 配置中分别拒绝规定的 world / server 运行时依赖；正例仍允许纯算法。`tests/governance/world-purity-eslint.test.ts` 覆盖。
- [x] **Playwright-change：** 浏览器 Harness 报告服务端权威；一次生产编辑推进归属服务端 revision；刷新后按坐标读取精确 voxel，且客户端位置 / 环境时间与服务端 Player / 时钟一致。`CI=true pnpm exec playwright test changes/2026-09-04-client-server-foundation/e2e`：1/1 通过。
- [x] **Playwright-baseline：** 现有浏览器加载 / 输入 / 玩家 / 交互 / streaming / persistence 用例全部通过。`CI=true pnpm test:e2e:regression`：7/7 通过；Harness 内关联浏览器阶段为 PASS。
- [x] **静态检查：** `CI=true pnpm verify:static` 通过；`src/world/**` V8 行覆盖率为 96.97%。
- [x] **构建：** `CI=true pnpm build` 通过。
- [x] **Harness：** 用户于 2026-09-04 明确授权按当前提交更新性能基线。`CI=true pnpm harness:baseline` 已在 `c2fcc1c` 的同一环境重新采集 `harness/baseline.json`；随后 `CI=true pnpm harness` 的正确性、关联浏览器 E2E、browser benchmark 均为 PASS，所有比较项均为 OK，初始世界就绪样本为 2936.58 ms。
- [x] **Midscene：** N/A——没有新增用户可见视觉语义；视觉连续性由现有浏览器 / Harness 证据覆盖。
- [x] `git diff --check` 通过。

## 任务与当前状态

1. [已完成] 已读取用户提供的架构变更、当前源码、当前 spec、测试和 Git 状态。
2. [已完成] 已完成一次只读架构复核；复核问题和修订结论记录在 `architecture-review.md`，修订 spec 经用户批准后实施。
3. [已完成] 已建立纯服务端权威、快照持久化端口、浏览器 Integrated Mode 和 ESLint 架构门禁。
4. [已完成] 已按用户授权重新采集 Harness 基线，并完成完整 Harness 复验；所有比较项均为 OK。
5. [已完成] 已在 `codex/` 功能分支创建基线更新的语义化本地 Git commit `cfd3976`；未执行 push。

## 交付快照

变更路径：`src/server/`、`src/client/browser-chunk-persistence.ts`、`src/app/main.ts`、`src/app/visual-environment.ts`、`src/world/voxel.ts`、`eslint.config.mjs`、对应 Vitest / Playwright 用例及本 change 记录。

已通过：`CI=true pnpm verify:static`（56/56；world 行覆盖率 96.97%）、`CI=true pnpm build`、change Playwright 1/1、长期浏览器回归 7/7。`CI=true pnpm harness` 的正确性、关联 Chromium E2E 和 browser benchmark 为 PASS，初始世界就绪样本为 3362.45 ms。

用户已明确接受按当前实现更新性能基线。旧基线来自 `0da6391`，早于 `c60d727` / `08bbb84` 的受测 mesh 变更；新基线采集时间为 2026-09-04T07:18:04.182Z。复验 Harness 关联 source SHA 为 `c2fcc1c21db4f19eea1fc48ff12a1fc5b1fc0b03`，所有比较项均为 OK；基线更新提交为 `cfd3976`，未推送。
