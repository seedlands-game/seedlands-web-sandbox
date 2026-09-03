# Macro Worldgen

**Status:** Delivered locally

## Context & Goal

现有 `src/voxel.ts` 直接以局部坐标噪声决定高度、biome 与树木，无法先查询一个连贯的自然世界。本 change 将建立可按坐标惰性查询、与 Chunk 加载顺序无关的 Macro Natural World：Chunk 仅将其地理、气候、biome 与水文语义具体化为 voxel。

完成态：同一 seed 与 generator version 在任意查询/Worker 顺序下产生相同宏观字段、河湖和 Chunk；不同 seed 可观察到可区分的地形、气候、biome 与水系布局。

## Scope & Non-goals

- In scope: 无状态 Macro 查询模型、连续地理/气候/biome 字段、语义河流与湖泊、water voxel 的 Chunk 落地、植被规则、HUD macro overlay、全局 Macro 地图总览、确定性与 Harness macro 检查、generator version 升级和 README。
- Non-goals: settlement、road、NPC、完整流域/侵蚀/流体模拟、cave、water shader、纹理或视觉润色。

## Decisions

### Model boundary

新增 `src/macro-world.ts` 作为纯函数层。它不保留探索历史或无限地图缓存；所有 `macroAt(seed, x, z)` / `regionAt(seed, regionX, regionZ)` 结果只由全局坐标、seed 与版本决定。`src/voxel.ts` 保留为 voxel registry、坐标工具和最终的 `baseVoxel`，并消费 Macro 查询；Worker 和主线程继续只传递 seed、Chunk 坐标与 mutation，不传递可变 Macro 状态。

Macro Region 固定为 256m（8 x 8 Chunk），仅作为自然场的查询/解释尺度，而非未来行政或 Living World Region。Macro context 将包含：`continentalness`、`baseElevation`、`relief`、`erosion`、`temperature`、`humidity`、`biome`、`waterLevel` 与 hydrology feature。

### Geography, climate, and biome

用可平滑组合的多尺度 deterministic value-noise / domain-warp fields 取代局部 hash 阈值：大陆性和 base elevation 决定平原/低地的大势，relief 与 erosion 调整山地和盆地，较小尺度 detail 只作局部修饰。temperature 由纬度式变化、海拔冷却和 seed offset 组成；humidity 由区域湿度、低地/水体邻近与地形影响组成。Biome 通过连续字段及阈值带选择 `plains`、`forest`、`mountain`、`dry`、`cold`、`wet`，并通过同一连续地形字段避免按 Chunk 方格跳变。

### Hydrology

河流不使用独立的 `noise < threshold` 水方块。全局 Macro 格点中每个潜在 source 生成一个规范、有限长度的 downhill river descriptor（source、固定方向/逐段 path、宽度、water level）；查询某一点只枚举固定邻域内的 descriptor，并按到该 path 的距离判断河道。描述符的路径跨 Region/Chunk 时仍由同一 source 生成，因此不会由相邻 Chunk 各自决定河道。河床根据 river distance 连续下切；水面高度由 descriptor 决定。

湖泊是稳定 basin descriptor：对低地/湿润区域的 canonical basin center 查询椭圆距离、湖床与 water level。Lake 与 river 都返回解释字段（feature id、distance、water level、source/path direction），供调试、测试及未来 settlement/resource 系统使用。该方案刻意不是全局流体或真实汇水模拟。

### Chunk realization and rendering

`baseVoxel` 将从 Macro context 取得地表高度和水文结果：河/湖的 carved ground 到 water level 之间落地为新增 `Water` voxel；地表材料、土层、雪与树密度由 biome、climate、relief 和近水状态共同决定。`Water` 可渲染但不可碰撞；mesher 将“可渲染”与“可碰撞”分离，以保留现有移动与 raymarch 的 solid 语义。首版水材质使用现有不透明方块材质，避免超出水 shader non-goal。

### Observability and verification

现有 HUD 在玩家位置附加 Macro Overlay：region、elevation/relief、temperature/humidity、biome 以及 dry/river/lake、水位与 feature id。另增一个可打开的全局地图总览：以固定、可选的世界窗口和采样步长，从 `macroAt` 直接绘制 2D Canvas，而不生成 Chunk 或预计算无限 voxel map；地图会标注玩家位置，并允许切换 elevation、biome、temperature、humidity、hydrology 图层。它用于相同 seed 的宏观结构检查、不同 seed 的对比与河湖连续性观察，不是运行时导航或持久化地图系统。

地图绘制采用帧内分批采样或 Worker 侧离屏数据生成，打开面板不会在主线程做一次性大范围同步采样；关闭面板即释放其临时 image data。默认窗口、采样密度和图层范围将受明确上限约束，并在 README 中说明。Harness/确定性测试将覆盖：(1) 多 seed 的 Macro signature 可重复且相异，(2) Region/Chunk 边界两侧查询与 Chunk realization 无断裂，(3) canonical river descriptor 的连续 path，(4) biome 相邻采样连续性，(5) Macro query、总览采样与 Chunk generation 性能。Harness 只固化字段 hash/语义 fixture，不固化整个 voxel world snapshot。

### Compatibility

`GENERATOR_VERSION` 从 1 升至 2；旧存档按已有 decode 规则失效，符合本 change 的明确迁移非目标。Mutation format 和 `World.edit()` 边界保持不变。

## Behaviour

- Given 同一个 seed/version 与任意 Macro/Chunk 查询顺序, When 查询相同坐标, Then Macro context、河湖语义和 voxel 值相同。
- Given 一个 canonical river 穿过 Chunk 或 Macro Region 边界, When 两侧 Chunk 独立生成, Then river bed、water level 与方向来自相同 descriptor，河道连续。
- Given terrain、temperature、humidity 或 water proximity 改变, When 完成 biome/feature realization, Then surface、植被密度和水边规则随 Macro context 改变，而非独立 Chunk hash 阈值。
- Given 玩家移动到任意已加载位置, When HUD 刷新, Then 能读取当前 Macro fields 与 river/lake/dry 解释。
- Given 玩家输入一个 seed 并打开全局地图总览, When 选择一个 Macro 图层, Then 能在无需生成对应 Chunk 的前提下查看有界世界窗口内的 elevation、biome、temperature、humidity 或 river/lake 分布，并能看到玩家坐标。
- Given 总览采样尚未完成或面板关闭, When 游戏继续渲染, Then 地图采样受预算约束且其临时数据不作为探索历史永久保留。
- Given v1 存档, When 页面加载, Then 不恢复为 v2 世界；Given v2 存档, Then mutation roundtrip 不变。

## Acceptance & Evidence

- [x] Macro model、water voxel、Chunk realization 和 HUD overlay 已实现。
- [x] 全局 Macro 地图总览可显示并切换 elevation、biome、temperature、humidity、hydrology 图层，且不触发 Chunk 生成。
- [x] 多 seed deterministic、region boundary、river continuity、biome continuity 与 v2 storage fixtures 通过。
- [x] `CI=true corepack pnpm test` 与 `CI=true corepack pnpm build` 通过。
- [x] `CI=true corepack pnpm harness` 通过，并包含 Macro correctness/performance 报告。
- [x] Macro overlay/map 已以本地 Chromium E2E 独立验证：load、Macro map、图层切换均通过。

## Tasks & Current State

1. [done] 读取需求、现有实现和已有 Harness，形成 Macro 模型设计。
2. [done] 用户已于本会话准出设计。
3. [done] 实现 Macro 查询、Chunk realization、可观测性与验证。
4. [done] 本地提交已完成；按当前项目交付规则，默认不推送。

## Delivery Snapshot

Changed paths: `src/macro-world.ts`, `src/voxel.ts`, `src/world-mesh.ts`, `src/main.ts`, `src/style.css`, `index.html`, `scripts/verify-voxel.mjs`, `scripts/browser-harness.mjs`, `scripts/run-harness.mjs`, `harness/baseline.json`, `package.json`, `README.md` and this change record.

Validation: `CI=true corepack pnpm test` passed; `CI=true corepack pnpm build` passed; `CI=true corepack pnpm harness:baseline` passed; `CI=true corepack pnpm harness` passed. Chromium E2E stages Load, Input, Player, Interaction, Streaming, MacroMap and Persistence all passed. Independent `CI=true corepack pnpm harness:macro-map` passed for map load and hydrology-layer sampling.

Final local Harness: Macro p95 `0.037 ms` (65,692 queries/s; signature `f3ef5cb5`), Chunk worldgen p95 `66.07 ms`, meshing p95 `25.15 ms`. These are machine-local baseline measurements, not a cross-device guarantee. Production bundle remains above Vite's 500 kB compressed warning threshold (`502.70 kB` gzip); this change does not alter bundling scope.

Git: implemented on `codex/macro-worldgen`, based on `f9cf9f6`; implementation commit `0da6391` (`feat: add macro worldgen`).

Push: 未执行。已配置目标为 `origin`（GitHub）；先前推送请求被安全策略拒绝，未有源码或文档外发。当前项目规则已改为默认只保留 worktree 分支与本地 commit；只有用户在当轮明确要求外发时才推送。
