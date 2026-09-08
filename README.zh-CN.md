# Seedlands Web Sandbox

[English](README.md) | [简体中文](README.zh-CN.md)

[![CI and Pages](https://github.com/seedlands-game/seedlands-web-sandbox/actions/workflows/ci.yml/badge.svg)](https://github.com/seedlands-game/seedlands-web-sandbox/actions/workflows/ci.yml)

一个处于实验阶段、可在浏览器中直接游玩的体素沙盒，同时是更广泛的 **Seedlands** 世界项目的技术基础。

本仓库不是完整的 Seedlands 游戏，也不把自己定义为通用的 Seedlands 引擎。它是一个自包含的 Web 原型，用于验证确定性地形、Chunk streaming、权威世界状态、可编辑体素、持久化和浏览器渲染。

预期部署地址为 [seedlands-game.github.io/seedlands-web-sandbox](https://seedlands-game.github.io/seedlands-web-sandbox/)。仓库公开并启用 GitHub Pages 后，`main` 每次验证成功的构建都会自动部署。线上版本右下角会显示短 commit hash 和世界生成器版本。

## 当前状态

当前包含可本地游玩的单人生存与探索 MVP：

- 确定性 Macro 地理、气候、biome、河流、湖泊、树木与地形；同一 `seed + generatorVersion` 不受 Chunk 加载顺序影响。
- 紧凑的 `32³` `Uint16Array` Chunk，以及按 Chunk 生成的 greedy mesh，而非每个体素一个 Entity 或 draw call。
- Chunk mesh 按 opaque、cutout、transparent 三类批量提交；voxel-specific GLSL/WGSL chunk 从纹理数组采样，Float16 UV 与安全的 Uint16 index 用于缩减网格传输体积。
- 以玩家为中心、会释放超出范围 CPU/GPU 资源的 Chunk streaming。
- Authority Worker 内唯一的 `GameServer` 持有权威 Chunk、玩家状态、实体和世界时钟。
- 第一人称移动、碰撞、跳跃、限时体素采集、掉落物、拾取和由背包物品驱动的放置。
- 最小生存闭环：生命、饥饿、24 格背包、8 格快捷栏、食物、四条配方、工具、战斗、死亡掉落与复活。
- 确定性的初始生态：被动林鹿、仅夜间主动的敌对生物、有日程的营地居民、附近 POI、有界体素地面导航与可查询的异步 Action。
- 浏览器持久化覆盖 Seed、世界时钟、玩家状态、玩法实体、Actor 需求与 Action、POI、背包及已 materialize Chunk 快照。
- 完整的新建/继续/暂停/保存退出外壳、设置与操作指南、Macro 地图，以及采用深石面、黄铜与奥术语言的 Svelte 5 retained HUD。
- 可制作的非整格 3D 模型灯笼方块与紧凑碰撞、保留兼容的整格辉光石、有界人工光源与稳定局部阴影、带树叶镂空的太阳阴影、水面真实场景反射及分档调色。
- 原创稀疏电子音乐、材质相关音效、空间生物短鸣、独立音量总线与可选的本地参考曲导入。
- 手持工具、采集/使用反馈、可区分的生物形体、行走与受击表现。

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

## 第一段旅程

推荐 **mosslight-68** 的林间河岸，或 **living-world-autonomy** 的干燥开阔营地。主菜单的推荐按钮只填写 Seed，不会自动开始；输入相同 Seed 会继续已保存的进度。

采集附近树木并走近拾取掉落物，按 **E** 用原木合成木板与木斧。树叶可以取得浆果。向下挖成阶梯寻找石头，保留能跳回地面的路线；制作石镐和灯笼，再搭建一处有光的小据点。林鹿与居民按本地算法活动，夜行兽在天黑后会主动威胁玩家。选中浆果右键食用，也可以在背包选中食物后点“食用”。通过暂停菜单保存退出，然后从主菜单继续。

背包支持先点来源、再点目标的移动、合并与交换；前八格就是快捷栏。当前配方：一原木 → 四木板；三木板 → 木斧；两木板 + 三石块 → 石镐；两木板 + 一石块 → 灯笼。

## 操作

| 输入         | 行为                              |
| ------------ | --------------------------------- |
| 鼠标点击画面 | 锁定鼠标并开始视角控制            |
| WASD         | 移动                              |
| 鼠标         | 观察                              |
| 空格         | 跳跃；在水中上浮                  |
| 水中 Shift   | 下潜                              |
| 按住左键     | 采集准星指向的体素或攻击生物      |
| 右键         | 食用选中的食物，或放置方块物品    |
| 1–8          | 选择快捷栏槽位                    |
| E            | 开关背包与合成                    |
| M            | 开关 Macro 世界地图               |
| F3           | 开关调试 HUD                      |
| F4           | 开关服务端调试命令 Shell          |
| P            | 暂停或继续世界时间                |
| [ / ]        | 将世界时间向前或向后调整一小时    |
| T            | 在 1×、20×、100× 时间速度之间切换 |
| Esc          | 关闭当前面板或暂停游戏            |

## 声音与视觉质量

主菜单和暂停菜单均可打开设置。音量即时生效，视觉质量在下次进入世界时应用。浏览器音频在用户操作后解锁；内置三首原创稀疏 Cue，曲间有意保留静默，风、水环境与玩法音效独立继续。

设置中可选择本地参考曲（不超过30 MiB、10分钟），仅在本机播放且不上传。刷新页面后需重新选文件；移除参考曲会恢复内置音乐。

| 档位   | 局部光源 / 带阴影光源 | 太阳阴影 | 水面反射          | 调色 |
| ------ | --------------------- | -------- | ----------------- | ---- |
| Low    | 2 / 0                 | 关闭     | 关闭              | 关闭 |
| Medium | 4 / 1                 | 512 px   | 128 px，每8帧更新 | 开启 |
| High   | 6 / 2                 | 1024 px  | 256 px，每4帧更新 | 开启 |

反射使用附近的一处水平水面。High优先细节，Medium是桌面默认档；这是有界的表现功能，不包含全局光照或水体物理。

## 实验性性能设置

优化后的 TypeScript 数据路径始终启用，并作为不可关闭的兜底基线。当前实测默认组合是 WebGL2、Rust WebAssembly `w02–w06` 和标准 SIMD128 优先；其中只有 `w06` 打包核包含显式 SIMD 指令，`w07/w10/w14/w15` 继续使用优化 TypeScript。WebGPU 保留为实验选项，但历史配对浏览器样本没有端到端收益，因此不是默认后端。

设置界面可独立选择 WebGL2/WebGPU、Rust Wasm 和 SIMD。修改会立即持久化，但必须刷新页面才生效；退出世界再进入不会热重载 graphics device 或 Worker。WebGPU 不可用时只回退 WebGL2，Wasm 不可用时只回退优化 TypeScript，SIMD 不可用时只回退标量 Rust。Debug Harness 会同时暴露请求值与实际生效值。

URL 也支持 `?renderer=webgl2|webgpu&wasm=on|off&simd=on|off`；`?wasm=w04,w06` 形式只用于性能消融。宿主页面还可在入口模块执行前指定：

```js
window.__SEEDLANDS_INITIAL_OPTIONS__ = {
  experiments: { renderer: 'webgl2', wasm: true, simd: false },
};
```

优先级为“显式初始化 > URL > 持久化 > 默认值”。宿主每次加载都提供的显式字段继续由宿主控制。进入游戏必须支持同源 module Worker；默认长期运行五个 Worker。当浏览器估算可用核心数少于五个时，进入前会显示可继续的性能警告。

## 服务端命令调试

进入世界后按 F4 可打开简易 Debug Shell。世界命令包括 `/setblock`、`/fill`、`/tp`、`/time get`、`/time set`、`/seed`、`/save`、`/inspect voxel` 和 `/inspect chunk`。玩法命令包括 `/inventory`、`/give`、`/damage`、`/heal`、`/spawnitem`、`/spawn creature`、`/craft`、`/break`、`/cancelbreak`、`/pickup`、`/drop`、`/place`、`/use`、`/attack`、`/respawn`、`/tick` 和 `/nearby`。Actor 调试另有 `/summon`、`/observe`、`/entity action`、`/entity move`、`/entity stop`、`/path` 与 `/poi nearby`；参数无效时 Shell 会显示用法。Shell 打开时会释放鼠标锁定；按 Esc 关闭。日志文本可以用浏览器原生方式选择和复制，输入框支持正常粘贴；上下方向键可浏览最近 20 条已提交命令，并在回到末尾时恢复未执行草稿。

同一套结构化命令边界也可以在没有 PlayCanvas、Canvas 或 DOM 的环境中运行：

```bash
pnpm server:headless -- --seed my-debug-world
```

首版无头 Harness 使用进程内存持久化。`/save` 会真实经过 Chunk 与 gameplay snapshot 的 persistence boundary，并可在同一进程的重载测试中恢复；进程退出后不会生成持久世界文件。

## 实验性 Node 世界宿主

独立 TypeScript 世界宿主可以脱离浏览器常驻运行，并将检查点保存到独立目录。目前仍在实施：网络连接与服务器选择界面尚不可用。

```bash
pnpm build:server
pnpm server:dedicated --data-directory /absolute/path/to/new-world --seed my-world
```

`apps/node-server/dist/` 内的五个 ESM 入口及清单可由 Node 22.12 或更高版本直接运行，不需要源码、Vite 或在服务器安装运行依赖。默认 Authority、Logic、Fluid、general、persistence 各一条执行 lane。`--compute child-process` 可选择实验性进程执行器；这不是已测得更快的默认建议。按 Ctrl+C 会排空工作并保存最终检查点。请使用独立目录，不会自动导入浏览器存档；同一目录的第二个写者会被拒绝。

## 架构

阅读源码先看[代码地图](docs/code-map.md)：包含推荐阅读顺序、运行链路和按功能查找的实现与测试入口。新增文件与当前目录归属见[仓库结构规范](docs/repository-structure.md)，证据规则见[开发治理](docs/development-governance.md)，项目目标和演进路线见[长期对齐](docs/living-world-alignment.md)；归档历史可由[归档索引](docs/change-archive.md)恢复。

`GameServer.editBatch()` 是批量世界修改的权威事务边界。浏览器运行时按职责拆分为启动、玩家控制、渲染适配、世界 streaming、环境、HUD 与持久化模块。运行期 UI 由单个 Svelte 5 root 持有；Game 只通过 `UiBridge` 发布可独立订阅的 Shell、HUD、Interaction 与 Debug 小型投影，组件经 action port 回传意图，不持有权威 World 或 Server 状态。

```text
apps/web/          浏览器产品、Vite/SSG、PlayCanvas、Svelte 与浏览器 Worker
apps/node-server/  Node CLI、线程/进程、持久化适配与五入口构建
packages/game-core/ Web/Node 共享的世界、物理、运行时、服务端与纯计算
tests/             单元、架构与长期浏览器回归测试
crates/            纯 Rust 计算内核与浏览器 Wasm 适配层
changes/           变更合同及所属的交付证据
scripts/           workspace Harness 与工程脚本
```

workspace 使用一个 lockfile。Web 与 Node 仅经 `@seedlands/game-core` 声明的 subpath exports 共享逻辑，彼此不依赖。`packages/game-core/` 不获得 DOM、WebWorker、Node ambient types，也不依赖两个 app 包；平台能力经窄实例端口注入。产品依赖由所属 package 声明；根 devDependencies 中重复的 PlayCanvas、Svelte 与 Tone 只供根级整合测试解析，Node 的类型检查、构建和隔离运行不消费它们。

浏览器默认运行五个后台 Worker：权威状态与固定步长物理、游戏逻辑、流体计算、通用计算和持久化各一个。可选第二个通用计算 Worker，此时总数为六个。渲染与本地玩家预测留在主线程。物理、玩法与流体分别使用独立频率和有界追赶，耗时逻辑与网格计算不驱动物理时钟；通信使用带版本的消息与可转移缓冲，不要求共享内存。

玩家、生物与掉落物共用注册碰撞形状和扫掠求解，实体坐标统一为脚底中心。一格河岸需要跳跃，走向侧面不会自动抬升或传送。浸水量按身体覆盖体积计算，水下画面与音效按相机深度变化。F3+B 展示真实权威身体与本地预测身体，调试面板还可显示接触细节和拾取传感器。

## 验证

```bash
pnpm test
pnpm verify:static
pnpm build
pnpm build:server
pnpm verify:node-isolation
pnpm test:e2e:regression
```

General 计算 Worker 默认启用实测采纳的 Rust Chunk填充、halo、mesh描述符和网格打包；打包在能力可用时使用标准SIMD128，保留标量与优化 TypeScript 回退。Fluid、Authority、Logic、Persistence 默认仍用 TypeScript。每个启用 Worker 独立持有 Wasm 实例，不要求共享内存或跨源隔离。`crates/rust-toolchain.toml` 固定 Rust 1.88.0 与 Wasm 目标；`pnpm wasm:rust:build` 重建两种生产产物，常规生产构建校验源码与二进制 hash；`pnpm rust:check` 约束纯 core 边界。已淘汰的 MoonBit 实现和工具链不再保留，冻结测量仍可在[结果快照](changes/2026-09-07-remove-moonbit-toolchain/moonbit-results.md)中审阅。采纳原因和实际收益见[本轮方案](changes/2026-09-07-data-plane-adoption/adoption-plan.md)。

这些命令提供不同证据：单元测试覆盖确定性逻辑；静态验证覆盖格式、lint、路径规则、覆盖率和 TypeScript；生产构建证明 bundling；Playwright 覆盖确定性浏览器行为。视觉语义由 change 所属的 Midscene 流程独立评估。

架构 lint 还将 JavaScript 与 TypeScript 模块限制为不超过 500 行有效代码（不计空行与注释），避免职责重新堆积为单体文件。

完整开发流程、测试分层和 Pull Request 要求见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 与 Seedlands 的关系

Seedlands 的目标是一个由统一自然规律、自主居民、持久后果以及跨转生的生命共同构成的剑与魔法开放世界。体素是这个愿景中的一种物质与交互语言，而不是项目本身的定义。

即使未来的完整游戏转向独立客户端与服务端，本仓库仍可作为独立的开源 Web 沙盒继续存在。

## 已知限制

本次不依赖或接入 AgentServer/LLM 服务。

- 水采用有界体素水位与单个邻近水面反射平面，活动 streaming 范围外暂停模拟；尚无压力、浮力和海浪模拟。
- 尚无洞穴、体素光照传播、移动端触摸操作、Floating Origin 或远景 LOD。
- 浏览器持久化优先保证原型易部署，不是大世界存储方案。
- 生物与居民行为仍是有界的确定性底座，尚无对话、交易、繁殖、人群避让或完整生态模拟。
- 浏览器 MVP 的呈现与普通建造范围为 y=0–63，第0层作为基底不可通过普通输入采集；超界放置提示原因并保留物品。此呈现限制不改变核心世界坐标或已有存档数据。
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

## 实玩修订

按住左键可持续采集。掉落物采用带纹理的三维模型，会受重力落地并在玩家附近吸附；满背包时保留物品。手和工具为真实三维持握模型，生物采用同一套体素材质与关节动画。生命、饥饿图标位于居中的八槽快捷栏上方；可操作距离内的方块显示三维轮廓及顶部信息框。水支持有界下落、障碍改道、水平衰减与跨区块存档恢复；太阳方向由世界时间决定，转头时会移出视野。
