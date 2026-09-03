# Seedlands — Web 3D Voxel Sandbox Foundation

一个采用 **TypeScript + Vite + PlayCanvas v2 + Web Worker + Browser Storage** 的可玩 3D 体素沙盒基础原型。

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

| 输入 | 行为 |
| --- | --- |
| 鼠标点击画面 | 锁定鼠标并开始视角控制 |
| WASD | 移动 |
| 鼠标 | 观察 |
| 空格 | 跳跃 |
| 左键 | 破坏准星指向的体素 |
| 右键 | 放置选中的体素 |
| 1–4 | 选择泥土、石头、原木、沙砾 |
| Esc | 解除鼠标锁定 |

## 当前能力

- Seed 驱动、坐标确定性的高度、地表、biome 与树木生成；同一 `seed + generatorVersion` 与加载顺序无关。
- `32³` 的 `Uint16Array` Chunk 数据；基础材料包括 Grass、Dirt、Stone、Wood、Leaves、Sand、Snow 与 Air。
- 以玩家为中心的双层 Chunk streaming；超出缓存半径的 GPU Mesh/Chunk 会卸载，不会把探索历史永久留在内存中。
- Worker 承担 Chunk worldgen 和 CPU greedy meshing；主线程负责 PlayCanvas GPU 上传、渲染、输入和玩家控制。
- Mesh 以 Chunk + 材质为单位，进行不可见面剔除与贪心四边形合并，不产生逐体素 Entity / draw call。
- 第一人称移动、重力、跳跃、直接基于 voxel occupancy 的碰撞，以及基于体素 raymarch 的破坏/放置。
- 中央 `World.edit()` 管理所有改动，边界编辑会同时使邻居 Chunk 失效并重新网格化。
- `localStorage` 存储 Seed、玩家位置与世界改动（procedural base + mutation delta），刷新后可继续。
- 屏幕调试面板显示 FPS、backend、Seed、坐标、Chunk、加载数量、任务队列与 mutation 数。

## 结构

```text
src/voxel.ts         Voxel registry、坐标转换、确定性生成函数
src/world-worker.ts  Chunk 填充、跨 Chunk 采样、greedy meshing
src/main.ts          streaming、World Edit、PlayCanvas、玩家与交互、存档
changes/<change-id>/midscene/  与 change 一起归档的视觉驱动 YAML 自动验证脚本
```

## Midscene 视觉自动验证

本项目通过项目级 `@midscene/cli` 使用 YAML 脚本进行本地 smoke 验证。官方当前将 DeepSeek 的可用视觉模型配置为 `deepseek-v4-flash-vision-exp`，模型族为 `deepseek`。

1. 将 `.env.example` 复制为 `.env`，在本地填入 `MIDSCENE_MODEL_API_KEY`；不要提交该文件。
2. 在终端 A 启动游戏：`corepack pnpm dev -- --host 127.0.0.1`。
3. 在终端 B 先运行 `corepack pnpm test` 与 `corepack pnpm midscene:verify-model`，再运行 `corepack pnpm midscene:smoke`。后者会显式使用 `--dotenv-override`，避免开发机已有的模型环境变量覆盖项目配置。

`corepack pnpm test` 是无需浏览器的确定性基础世界校验。Midscene 脚本会创建固定 Seed 世界，并断言 HUD、渲染后端和已加载 Chunk；其 YAML 与所属 change 同目录存放。运行结果与视觉报告写入被忽略的 `midscene_run/`，因此它是本地浏览器验证证据，不会混入源码提交。

## Regression & Performance Harness

完整 Harness 使用固定 seed、坐标集和操作路径，分别报告 correctness、真实 Chromium 玩法、worldgen/meshing、Node memory proxy、存档体积和生产 bundle。运行：

```bash
corepack pnpm harness
```

它会执行确定性/synthetic Chunk 测试、生产构建，以及真实浏览器的 Pointer Lock、移动/跳跃、鼠标破坏/放置、跨 Chunk streaming 与刷新恢复。浏览器用例优先使用本机 Google Chrome；若机器路径不同，可设置 `SEEDLANDS_CHROME_PATH`。最终 JSON 和 Markdown 位于被忽略的 `harness/results/`，所以每次运行只提供本机证据，不污染提交。

首次或有意接受新的性能基线时运行：

```bash
corepack pnpm harness:baseline
```

该命令更新受版本控制的 `harness/baseline.json`。后续 `harness` 将以相对变化标记 5% warning、15% regression；吞吐量越高越好，其余当前指标越低越好。基准变化只报告，不自动掩盖或替代 correctness/E2E 失败。GPU 内存没有可移植的精确读数，因此报告 Node heap、voxel 与 mesh typed-array 载荷；GPU 资源是否释放仍以真实浏览器 streaming 链路和代码级 `destroy()` 生命周期为证据。

## 已知限制

- 这是 Foundation P0 原型，未实现洞穴、水、光照传播、纹理图集、移动端触摸操作、Floating Origin 或远景 LOD。
- 持久化使用易部署的 `localStorage` mutation delta；复杂存档和大批量编辑应升级至 IndexedDB/OPFS。
- 当前使用两个垂直 Chunk 层，适配本原型的地形高度；未来地下洞穴与高山应让垂直 streaming 跟随玩家扩展。
