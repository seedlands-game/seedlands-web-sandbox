# Visual Upgrade

**Status:** Delivered locally

## Context & Goal

Seedlands 已有确定性 Macro Worldgen、河湖、树木、Chunk Streaming 与编辑链路，但地形仍使用纯色材质，天空、日照和 HUD 也是技术原型。本 change 将其提升为具有统一 stylized fantasy voxel 语言的可玩垂直切片。

完成态：玩家进入任意 seed 后能明显辨认草地、土层、石地、沙地、树木、雪与水；日夜环境、雾、顶点 AO、透明水面和精简 HUD 共同提供空间层次，并保持 WebGL2 与现有确定性世界不变。

## Scope & Non-goals

- In scope: 原创体素材质母图与可重复 tile；Grass/Wood 分面材质；Greedy Mesh UV 与顶点 AO；opaque/water 分层；透明动态水；统一 world time 驱动的天空、太阳、环境光与雾；Low/Medium/High 质量档；player/debug HUD 分离；Harness 时间控制与浏览器验收。
- Non-goals: 世界生成或存档格式变更；光照传播；实时阴影系统；体积雾/云；流体模拟；SSR/SSAO/GI；移动端触摸操作；远景 LOD。

## Decisions

- 使用内置 Image Generation 生成一张 3×3 原创体素母图，以 768×768 WebP 作为唯一源资产。运行时对各 tile 构造镜像连续的 128×128 小纹理，镜像是纹理周期本身而非可见 padding 边框；该等价 atlas 方案隔离 mip bleeding，并允许 Greedy 大面用 `repeat` UV 而不拉伸。
- Mesh 按“面材质”而不再按 voxel id 分组。Grass 为 top/side/dirt，Wood 为 bark/end；其他体素使用单 tile。水使用独立透明材质和 mesh instance，不与 opaque 表面共用 pass 语义。
- AO 在纯逻辑 mesher 内根据每个顶点外侧的两个 side 与一个 corner occupancy 计算四级亮度，以 vertex color 传到 StandardMaterial。面材质、方向或 AO 四角签名不同时禁止 Greedy 合并；对角线根据 AO 和选择，避免明显插值折线。
- `World.edit()` 在一个边或角上发生改动时，按各轴 AO 一格采样半径的笛卡尔积失效直交与对角邻 Chunk，避免跨 Chunk 陈旧 AO。
- Worker 合约显式传输 `material` / `renderLayer` / `uvs` / `colors` 和原有几何 typed arrays，主线程不再用 voxel id 隐式推导材质。
- `worldTime` 是唯一环境时间源，连续驱动太阳方向/强度/色温、ambient、CSS 渐变天空和 PlayCanvas linear fog。`P` 暂停，`[` / `]` 调整时间，Harness 提供精确设置。
- CSS 天空使用 WebGL alpha 与透明 camera clear color 透过全屏 canvas 显示；太阳盘、top/horizon 颜色和 fog 来自同一环境状态。
- 质量档只改变视觉/载入策略，不参与 `baseVoxel` 或存档，避免破坏 `seed + generatorVersion` 确定性。

## Behaviour

- Given Grass 或 Wood 的不同朝向面, When Chunk 生成 mesh, Then 上/侧/下面使用对应 tile，且 Greedy 大面纹理逐 voxel 重复。
- Given 墙角、台阶或洞口邻域, When mesher 输出顶点, Then AO 亮度按 occupancy 变暗，不兼容 AO 图案不被强行合并。
- Given opaque voxel 与 water/air 相邻, When 渲染, Then 地形保持不透明，水体仅在外露面使用透明层，连续河湖不出现内部面。
- Given world time 连续运行, When 经过 dawn/day/sunset/night, Then sun、sky、ambient 和 fog 使用同一时间且连续变化；夜间仍保留可玩的最低环境光。
- Given 正常游玩, When HUD 显示, Then 只常驻准星、选中材质/快捷栏和交互反馈；Given 玩家按 F3, Then 调试 telemetry 可展开/隐藏。
- Given Low/Medium/High 档, When 世界启动, Then render radius、fog distance、resolution scale、water quality 和叶片 alpha 阈值使用对应预设，同一 seed 的 voxel 不变。

## Acceptance & Evidence

- [x] 体素纹理母图、分面 tile、UV repeat 与 mip 隔离已实现。
- [x] Vertex AO、AO-aware Greedy Mesh、对角 Chunk 失效与顶点合约有确定性 Vitest 证据。
- [x] 透明水层、水面动画、昼夜、天空、太阳与雾已实现。
- [x] Player HUD / Debug HUD 分离，质量档与时间 debug/Harness 控制已实现。
- [x] `CI=true pnpm verify:static` 与 `CI=true pnpm build` 通过；34 tests passed，`src/world/**` line coverage 95.44%。
- [x] 完整 Harness 的 11 个 Chromium 用例通过；视觉截图实际覆盖 plains、forest、mountain、river/water 及 day、sunset、night，并独立人工检查水面、fog、天空、HUD 与夜间可读性。
- [x] Harness 已记录相对性能和资产体积；基线未改写。

## Tasks & Current State

1. [done] 读取需求、现有 world/worker/app 边界与性能基线。
2. [done] Sol/xhigh 只读复核 Mesh/AO/材质分层与环境时间方案，并将四项关键合约纳入实现。
3. [done] 实现资产、Mesh/Worker 数据、渲染、环境、HUD 与测试。
4. [done] 运行静态、构建、Playwright/Harness 与浏览器视觉验收。
5. [done] 补齐 Delivery Snapshot，仅待创建本地语义化 commit。

## Delivery Snapshot

Changed paths: `public/assets/voxel-atlas.webp`, `src/world/voxel.ts`, `src/world/mesh.ts`, `src/worker/world-worker.ts`, `src/app/visual-environment.ts`, `src/app/main.ts`, `src/app/style.css`, `index.html`, `tests/world/*.test.ts`, `tests/e2e/support/harness.ts`, `tests/e2e/regression/visual-upgrade.spec.ts`, `scripts/run-harness.mjs`, `README.md` and this change record.

Validation: `CI=true pnpm verify:static` passed (34 Vitest tests, 95.44% world line coverage); `CI=true pnpm build` passed; `CI=true pnpm harness` passed with 11/11 Chromium tests, all load/input/player/interaction/streaming/persistence stages PASS and browser benchmark PASS. Visual screenshots under the ignored `test-results/visual-upgrade/` were inspected for four environment classes and three times of day.

Harness versus the retained pre-upgrade baseline: meshing p95 27.04 ms (+10.4%, WARNING) while throughput was 51.70 chunks/s (-0.3%, OK); AO-aware merge produced 4,336 triangles (+29.0%) and the newly truthful position/normal/UV/color/index payload was 364,224 bytes (+80.7%). These are expected absolute costs of AO/UV vertex data and conservative AO merge boundaries; worldgen p95 improved 1.6%, Node heap was flat, total build output increased 4.4%, gzip JS increased 1.0%, and initial Chromium world ready was 858.73 ms. At the sampled 35 chunks, the absolute geometry/payload remains small enough for this vertical slice; the baseline is intentionally unchanged so future work continues to see the cost.

Asset: `public/assets/voxel-atlas.webp` is 768×768 and about 68 KiB. It was generated with the built-in image generation tool from a normalized prompt requesting an original seamless 3×3 stylized-fantasy voxel albedo sheet (grass top/side, dirt, stone, sand, bark, wood end, leaves, snow), with no labels, gaps, baked shadows, perspective or copyrighted-game imitation; the selected image was downscaled and WebP-compressed into the project.

Git: implementation is on `codex/visual-upgrade`, based on `41eb96f`. No push or baseline rewrite was performed.
