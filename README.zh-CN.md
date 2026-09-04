# Seedlands Web Sandbox

[English](README.md) | [简体中文](README.zh-CN.md)

[![CI and Pages](https://github.com/seedlands-game/seedlands-web-sandbox/actions/workflows/ci.yml/badge.svg)](https://github.com/seedlands-game/seedlands-web-sandbox/actions/workflows/ci.yml)

一个处于实验阶段、可在浏览器中直接游玩的体素沙盒，同时是更广泛的 **Seedlands** 世界项目的技术基础。

本仓库不是完整的 Seedlands 游戏，也不把自己定义为通用的 Seedlands 引擎。它是一个自包含的 Web 原型，用于验证确定性地形、Chunk streaming、权威世界状态、可编辑体素、持久化和浏览器渲染。

预期部署地址为 [seedlands-game.github.io/seedlands-web-sandbox](https://seedlands-game.github.io/seedlands-web-sandbox/)。仓库公开并启用 GitHub Pages 后，`main` 每次验证成功的构建都会自动部署。线上版本右下角会显示短 commit hash 和世界生成器版本。

## 当前状态

这仍是早期技术原型，目前包含：

- 确定性 Macro 地理、气候、biome、河流、湖泊、树木与地形；同一 `seed + generatorVersion` 不受 Chunk 加载顺序影响。
- 紧凑的 `32³` `Uint16Array` Chunk，以及按 Chunk 生成的 greedy mesh，而非每个体素一个 Entity 或 draw call。
- Chunk mesh 按 opaque、cutout、transparent 三类批量提交；voxel-specific GLSL/WGSL chunk 从纹理数组采样，Float16 UV 与安全的 Uint16 index 用于缩减网格传输体积。
- 以玩家为中心、会释放超出范围 CPU/GPU 资源的 Chunk streaming。
- 同进程 `GameServer` 持有权威 Chunk、玩家状态、实体和世界时钟。
- 第一人称移动、碰撞、跳跃、限时体素采集、掉落物、拾取和由背包物品驱动的放置。
- 最小生存闭环：生命、饥饿、24 格背包、8 格快捷栏、食物、三条配方、工具、静止战斗目标、死亡掉落与复活。
- 存储 Seed、玩家状态、玩法实体、背包和已 materialize Chunk 快照的浏览器持久化。
- 日夜环境、透明水面、质量档位、Macro 世界地图和 Svelte 5 retained HUD。

完整 Seedlands 的核心系统尚未实现：源质与魔法、自主 NPC 社会、持久历史事件、长生与转生，以及六界内容。

## 快速开始

需要 Node.js 22.12 或更高版本，以及 Corepack。

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

打开 Vite 在终端输出的本地地址。生成并预览生产构建：

```bash
pnpm build
pnpm preview
```

运行和构建沙盒不需要私有 `.env` 文件。

## 操作

| 输入         | 行为                              |
| ------------ | --------------------------------- |
| 鼠标点击画面 | 锁定鼠标并开始视角控制            |
| WASD         | 移动                              |
| 鼠标         | 观察                              |
| 空格         | 跳跃                              |
| 按住左键     | 采集准星指向的体素或攻击生物      |
| 右键         | 放置选中的方块物品                |
| 1–8          | 选择快捷栏槽位                    |
| E            | 开关背包与合成                    |
| M            | 开关 Macro 世界地图               |
| F3           | 开关调试 HUD                      |
| F4           | 开关服务端调试命令 Shell          |
| P            | 暂停或继续世界时间                |
| [ / ]        | 将世界时间向前或向后调整一小时    |
| T            | 在 1×、20×、100× 时间速度之间切换 |
| Esc          | 解除鼠标锁定                      |

## 服务端命令调试

进入世界后按 F4 可打开简易 Debug Shell。世界命令包括 `/setblock`、`/fill`、`/tp`、`/time get`、`/time set`、`/seed`、`/save`、`/inspect voxel` 和 `/inspect chunk`。玩法命令包括 `/inventory`、`/give`、`/damage`、`/heal`、`/spawnitem`、`/spawn creature`、`/craft`、`/break`、`/cancelbreak`、`/pickup`、`/drop`、`/place`、`/use`、`/attack`、`/respawn`、`/tick` 和 `/nearby`；参数无效时 Shell 会显示用法。Shell 打开时会释放鼠标锁定；按 Esc 关闭。日志文本可以用浏览器原生方式选择和复制，输入框支持正常粘贴；上下方向键可浏览最近 20 条已提交命令，并在回到末尾时恢复未执行草稿。

同一套结构化命令边界也可以在没有 PlayCanvas、Canvas 或 DOM 的环境中运行：

```bash
pnpm server:headless -- --seed my-debug-world
```

首版无头 Harness 使用进程内存持久化。`/save` 会真实经过 Chunk 与 gameplay snapshot 的 persistence boundary，并可在同一进程的重载测试中恢复；进程退出后不会生成持久世界文件。

## 架构

`GameServer.editBatch()` 是批量世界修改的权威事务边界。浏览器运行时按职责拆分为启动、玩家控制、渲染适配、世界 streaming、环境、HUD 与持久化模块。运行期 UI 由单个 Svelte 5 root 持有；Game 只通过 `UiBridge` 发布可独立订阅的 Shell、HUD、Interaction 与 Debug 小型投影，组件经 action port 回传意图，不持有权威 World 或 Server 状态。

```text
src/app/       浏览器启动、PlayCanvas 生命周期、retained UI bridge、输入与样式
src/client/    浏览器持久化与客户端适配
src/server/    权威世界、实体、时钟与快照接口
src/world/     确定性世界、体素、网格、坐标与存档逻辑
src/worker/    实验性 Worker 入口与传输适配
tests/         单元、架构与长期浏览器回归测试
changes/       变更合同及所属的交付证据
scripts/       本地 Harness 与工程脚本
```

`src/world/` 刻意保持不依赖 DOM、PlayCanvas 或 Worker global。世界编辑会经过权威世界路径，渲染单位是优化后的 Chunk mesh。

## 验证

```bash
pnpm test
pnpm verify:static
pnpm build
pnpm test:e2e:regression
```

这些命令提供不同证据：单元测试覆盖确定性逻辑；静态验证覆盖格式、lint、路径规则、覆盖率和 TypeScript；生产构建证明 bundling；Playwright 覆盖确定性浏览器行为。视觉语义由 change 所属的 Midscene 流程独立评估。

架构 lint 还将 JavaScript 与 TypeScript 模块限制为不超过 500 行有效代码（不计空行与注释），避免职责重新堆积为单体文件。

完整开发流程、测试分层和 Pull Request 要求见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 与 Seedlands 的关系

Seedlands 的目标是一个由统一自然规律、自主居民、持久后果以及跨转生的生命共同构成的剑与魔法开放世界。体素是这个愿景中的一种物质与交互语言，而不是项目本身的定义。

即使未来的完整游戏转向独立客户端与服务端，本仓库仍可作为独立的开源 Web 沙盒继续存在。

## 已知限制

- 水面可渲染，但尚无压力、流动或瀑布模拟。
- 尚无洞穴、体素光照传播、移动端触摸操作、Floating Origin 或远景 LOD。
- 浏览器持久化优先保证原型易部署，不是大世界存储方案。
- 生物目前只是静止的战斗底座，没有 AI、导航、追逐或反击。
- 当前垂直 streaming 范围只针对本原型的地形高度。
- 主 JavaScript bundle 体积较大，尚未拆分为延迟加载的运行时 Chunk。

## 贡献与安全

欢迎在本仓库当前范围内贡献。提交 Pull Request 前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md) 和 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)。

Playwright 默认使用 4173 端口；并行 worktree 可设置 `SEEDLANDS_E2E_PORT` 避免端口冲突。

请勿在公开 Issue 中报告漏洞，请遵循 [SECURITY.md](SECURITY.md)。

## 许可

- 源代码与仓库文档：[Apache License 2.0](LICENSE)
- 体素母图：参见 [ASSETS.md](ASSETS.md) 中独立的 CC BY 4.0 条款与归属要求
- Seedlands 名称与品牌识别：参见 [TRADEMARKS.md](TRADEMARKS.md)
- 第三方依赖继续遵循各自的许可证
