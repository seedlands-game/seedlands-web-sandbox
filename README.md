# Seedlands — Web 3D Voxel Sandbox Foundation

一个采用 **TypeScript + Vite + PlayCanvas v2 + Browser Storage** 的可玩 3D 体素沙盒基础原型。

## 运行

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm dev
```

浏览器打开终端显示的本地地址。生产构建：

```bash
corepack pnpm build
corepack pnpm preview
```

## 操作

| 输入               | 行为                                                  |
| ------------------ | ----------------------------------------------------- |
| 鼠标点击画面       | 锁定鼠标并开始视角控制                                |
| WASD               | 移动                                                  |
| 鼠标               | 观察                                                  |
| 空格               | 跳跃                                                  |
| 左键               | 破坏准星指向的体素                                    |
| 右键               | 放置选中的体素                                        |
| 1–4                | 选择泥土、石头、原木、沙砾                            |
| M / Macro 地图按钮 | 打开或关闭世界总览，并切换高度、biome、气候和河湖图层 |
| F3                 | 展开或隐藏调试 HUD                                    |
| P                  | 暂停或继续世界时间                                    |
| [ / ]              | 向前或向后调整一小时                                  |
| T                  | 在 1×、20×、100× 时间速度间切换                       |
| Esc                | 解除鼠标锁定                                          |

## 当前能力

- Seed 驱动、坐标确定性的 Macro geography、气候、biome、河湖与树木生成；同一 `seed + generatorVersion` 与加载顺序无关。
- `32³` 的 `Uint16Array` Chunk 数据；基础材料包括 Grass、Dirt、Stone、Wood、Leaves、Sand、Snow、Water 与 Air。
- 以玩家为中心的双层 Chunk streaming；超出缓存半径的 GPU Mesh/Chunk 会卸载，不会把探索历史永久留在内存中。
- `GameServer` 在同进程内持有权威 Chunk、实体和世界时钟；浏览器客户端只读取服务端数据进行渲染，并将已解析的玩家位置写回服务端。
- Integrated Mode 直接对服务端权威体素数据执行 CPU greedy meshing，并按帧调度首屏 Chunk，避免网格构建阻塞真实输入；独立 Worker 入口保留为实验适配器，不处于权威数据链路。
- 一张 68 KiB 原创风格母图提供 Grass/Wood 分面及 Dirt、Stone、Sand、Leaves、Snow 材质；运行时小 tile 隔离 mip，Greedy 大面逐 voxel 重复而不拉伸。
- Mesh 以 Chunk + 面材质为单位，进行非对称 opaque/water 出面、顶点 AO 与 AO-aware 贪心合并，不产生逐体素 Entity / draw call。
- 世界时间统一驱动太阳方向/色温/强度、天空渐变、ambient 与 linear fog，连续经过 Dawn、Day、Sunset 和 Night。
- 河湖使用独立透明水材质、波纹 UV 动画与关闭 depth write 的延后绘制；水下地形面保持可见。
- 启动页提供 Low/Medium/High 三档视觉质量，分别调整 render/fog distance、resolution scale、水体和叶片密度；High 附带低分辨率阴影。
- 第一人称移动、重力、跳跃、直接基于 voxel occupancy 的碰撞，以及基于体素 raymarch 的破坏/放置。
- 中央 `World.edit()` 将浏览器编辑提交到服务端批次；边界编辑会同时使邻居 Chunk 失效并重新网格化。
- `localStorage` 只作为浏览器快照适配器，存储 Seed、玩家位置和 materialized Chunk snapshot；旧 mutation delta 存档会在首次读取时迁移。
- Player HUD 仅常驻准星、世界时间、快捷栏与交互反馈；F3 调试面板额外显示 FPS、backend、Seed、坐标、Chunk、队列、三角形、draw call 与 mutation。

## 结构

```text
src/app/             浏览器启动、PlayCanvas 生命周期、输入、UI 与样式
src/client/          浏览器持久化与客户端适配
src/server/          Node 可独立运行的权威世界、实体、时钟与快照端口
src/world/           可共享的确定性 Macro、voxel、Chunk mesh 与存档纯逻辑
src/worker/          独立的 Worker 实验入口及传输适配
tests/world/         `src/world/` 的 Vitest 单测
tests/e2e/           Playwright 的确定性浏览器回归、性能样本与共享支持代码
scripts/             Harness 和本地工程脚本
changes/<change-id>/midscene/  与 change 一起归档的视觉驱动 YAML 自动验证脚本
```

## 静态质量检查

```bash
corepack pnpm format:check  # Prettier 只读格式检查
corepack pnpm lint          # ESLint：TS、Node 脚本与运行时 globals
corepack pnpm lint:paths    # ls-lint：受控目录和文件命名
corepack pnpm test:coverage # Vitest V8：仅 src/world/，行覆盖率至少 80%
corepack pnpm verify:static # 上述静态检查的组合入口
```

`src/world/` 不依赖 DOM、PlayCanvas、Worker、`src/server/` 或 `src/client/`，由自定义 ESLint 规则与 Vitest 共同验证；`src/server/` 同样禁止 PlayCanvas、DOM 和 Worker 依赖。ESLint 还统一限制仓库内 JavaScript/TypeScript 单文件最多 500 行有效代码（忽略空行和注释），且禁止文件内关闭规则；超过阈值时应按职责继续拆分。当前 coverage 会生成本地 `coverage/` 报告，不纳入版本控制。浏览器运行时行为由 Playwright、Harness 与 Midscene 分别证明。

依赖安装会启用 Husky。pre-commit 只检查暂存文件的格式与 ESLint，并运行快速的目录规则；commit-msg 接受 `feat`、`fix`、`refactor`、`test`、`docs`、`chore`、`ci`、`build` 前缀及可选 scope，不强制 Conventional Commits 的 body、footer 或 breaking-change 结构。

## Midscene 视觉自动验证

本项目通过项目级 `@midscene/cli` 使用 YAML 脚本进行本地 smoke 验证。官方当前将 DeepSeek 的可用视觉模型配置为 `deepseek-v4-flash-vision-exp`，模型族为 `deepseek`。

1. 将 `.env.example` 复制为 `.env`，在本地填入 `MIDSCENE_MODEL_API_KEY`；不要提交该文件。
2. 在终端 A 启动游戏：`corepack pnpm exec vite --host 127.0.0.1`。
3. 在终端 B 先运行 `corepack pnpm test` 与 `corepack pnpm midscene:verify-model`，再运行 `corepack pnpm midscene:smoke`。后者会显式使用 `--dotenv-override`，避免开发机已有的模型环境变量覆盖项目配置。

`corepack pnpm test` 使用 Vitest 在 Node 环境运行纯逻辑和 headless 服务端测试，覆盖无需 UI 的坐标/体素注册、确定性世界生成、Chunk 网格、存档编解码和服务端权威状态。开发时可运行 `corepack pnpm test:watch`。它不加载 DOM、PlayCanvas 或 Web Worker，因此通过结果只证明纯逻辑；Midscene 与 Harness 仍负责真实浏览器交互和渲染链路。Midscene 脚本会创建固定 Seed 世界，并断言 HUD、渲染后端和已加载 Chunk；其 YAML 与所属 change 同目录存放。运行结果与视觉报告写入被忽略的 `midscene_run/`，因此它是本地浏览器验证证据，不会混入源码提交。

## Playwright 确定性浏览器测试

```bash
corepack pnpm test:e2e             # Chromium：回归与环境标记的浏览器样本
corepack pnpm test:e2e:regression  # 固定功能回归
corepack pnpm test:e2e:benchmark   # 非跨机器门禁的浏览器性能样本
```

Playwright 用于固定 seed 的功能回归、输入链路和可重复的浏览器样本；其用例位于 `tests/e2e/`，并以单 worker 运行，避免 benchmark 与回归争用同一浏览器资源。默认使用 Chromium：CI 应先执行 `corepack pnpm exec playwright install --with-deps chromium`，本机若需指定浏览器则设置 `SEEDLANDS_CHROME_PATH`。默认测试服务端口为 4173；并行 worktree 可通过 `SEEDLANDS_E2E_PORT` 分配独立端口。`?harness=1` 的受控入口仅用于确定性 world 编辑与 streaming 状态，并继续调用生产 `World.edit()`、Store 与 `updateStreaming()`；真实键鼠输入另有独立 Playwright 覆盖。Midscene 仍仅承担 change 内 YAML 的用户旅程与语义/视觉验收；可以稳定程序化验证的规则应迁移为 Playwright 回归，而不长期重复两套断言。

Macro 地图是固定 seed 的确定性浏览器回归，可单独运行：

```bash
corepack pnpm harness:macro-map
```

## Regression & Performance Harness

完整 Harness 使用固定 seed、坐标集和操作路径，分别报告 correctness、真实 Chromium 玩法、环境关联的浏览器样本、worldgen/meshing、Node memory proxy、存档体积和生产 bundle。运行：

```bash
corepack pnpm harness
```

它会执行确定性/synthetic Chunk 测试、生产构建，以及真实浏览器的 Pointer Lock、移动/跳跃、鼠标破坏/放置、跨 Chunk streaming 与刷新恢复。浏览器结果只在 run id、source SHA 与环境元数据均匹配时才会被汇总，不能将遗留 `browser-e2e.json` 当作本次证据。最终 JSON 和 Markdown 位于被忽略的 `harness/results/`，所以每次运行只提供本机证据，不污染提交。

首次或有意接受新的性能基线时运行：

```bash
corepack pnpm harness:baseline
```

该命令更新受版本控制的 `harness/baseline.json`。后续 `harness` 将以相对变化标记 5% warning、15% regression；吞吐量越高越好，其余当前指标越低越好。基准变化只报告，不自动掩盖或替代 correctness/E2E 失败。GPU 内存没有可移植的精确读数，因此报告 Node heap、voxel 与 mesh typed-array 载荷；GPU 资源是否释放仍以真实浏览器 streaming 链路和代码级 `destroy()` 生命周期为证据。

## 已知限制

- 当前水是静态自然水面，未实现流动/瀑布/压力模拟；也未实现洞穴、voxel 光照传播、移动端触摸操作、Floating Origin 或远景 LOD。
- 持久化使用易部署的 `localStorage` mutation delta；复杂存档和大批量编辑应升级至 IndexedDB/OPFS。
- 当前使用两个垂直 Chunk 层，适配本原型的地形高度；未来地下洞穴与高山应让垂直 streaming 跟随玩家扩展。
