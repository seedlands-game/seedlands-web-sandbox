# Harness Foundation

**Status:** Delivered

## Context & Goal

为 Seedlands 建立可重复的回归与性能 Harness，让后续变更可分别检查确定性、浏览器玩法、性能、内存/载荷、存档增长和构建产物，并与受版本控制的初始 baseline 比较。

## Scope & Non-goals

- In scope: 确定性与 synthetic meshing 测试、生产 mesher 的可测试导出、浏览器 E2E 测试入口、基准采集/比较/JSON+Markdown 报告、初始 baseline、HUD telemetry 与运行文档。
- Non-goals: 改变世界生成、体素规则、玩法、渲染效果、存档后端、bundle 优化或增加游戏内容。

## Decisions

- **Instrumentation only:** 将现有 Chunk 填充与 greedy mesh 提取为无状态模块，Worker 仍以相同输入、同一函数和同一传输格式执行；这只让 Harness 调用生产路径，不改变生产 timing 或结果。
- 基线记录结构与相对阈值（warning 5%，regression 15%）；波动较大的时间指标默认报告而非阻止提交，确定性测试仍是硬失败。
- 浏览器 E2E 在 `?harness=1` 下暴露只读快照和受控交互入口，正常游戏不会安装该接口；测试仍通过真实 Chromium 页面、Pointer Lock、键盘与同一个 `World.edit()`/存档路径运行。
- 初始 baseline 只包含可重复的 Node/构建/存档指标；浏览器 E2E 是每次完整 Harness 的独立结果，避免将设备相关帧时间伪装为跨机器硬阈值。

## Behaviour

- Given 固定 seed、generator version 与坐标集, When 任意顺序生成或 Worker 等价路径采样, Then 每个体素结果一致，且负坐标/Chunk 边界可逆。
- Given synthetic Chunk cases, When 使用生产 greedy mesher, Then 空、单体素、相邻体素、实心、边缘和异材质的面剔除与合并结果满足断言。
- Given 正常或边界 `World.edit()` 修改, When 重新请求已加载 Chunk, Then 当前 Chunk 和受影响邻居走同一 remesh 路径；持久化编码可 roundtrip seed、generator version、player 与 mutations。
- Given `pnpm harness`, When 执行完成, Then 输出机器可读 JSON 和人类可读 Markdown，分别报告 correctness、browser、worldgen、meshing、memory proxy、storage 和 bundle，并标识 relative baseline changes。
- Given `pnpm harness:baseline`, When 当前硬性正确性与构建检查通过, Then 更新版本控制中的基线；临时运行结果不提交。

## Acceptance & Evidence

- [x] Production mesher 的 deterministic synthetic coverage 与 persistence roundtrip 通过。
- [x] 浏览器 E2E 覆盖 load、Pointer Lock/input、movement/jump、鼠标 break/place、streaming、reload persistence，并按阶段报告。
- [x] 基准、baseline comparison、storage sizes、build sizes 和可读报告可运行。
- [x] HUD 显示帧时间、已加载/已渲染 Chunk、队列及 mutation telemetry。
- [x] `corepack pnpm test`、`corepack pnpm build`、`corepack pnpm harness:baseline`、`corepack pnpm harness` 结果已真实回填。

## Tasks & Current State

1. [done] 提取可复用的生产 Chunk geometry 与 persistence codec。
2. [done] 扩展确定性测试和新增浏览器 E2E。
3. [done] 实现基准、baseline 和报告。
4. [done] 更新 HUD/README，执行准出、提交并推送。

## Delivery Snapshot

Changed paths: `src/world-mesh.ts`, `src/world-storage.ts`, `src/world-worker.ts`, `src/main.ts`, `scripts/verify-voxel.mjs`, `scripts/browser-harness.mjs`, `scripts/run-harness.mjs`, `harness/baseline.json`, `package.json`, `README.md`, `.gitignore` and this change record.

Validation: `CI=true corepack pnpm test` passed; `CI=true corepack pnpm harness:baseline` passed; `CI=true corepack pnpm harness` passed. The Chromium E2E stages Load, Input, Player, Interaction, Streaming and Persistence all passed. The baseline records 1,940,135 B production JavaScript / 501,844 B gzip and 182,912 B for 10,000 mutations.

Known limitation: browser GPU memory does not have a portable exact query, so the Harness reports Node heap plus deterministic voxel/mesh typed-array payloads. Timing comparisons report (rather than automatically block) regressions because machine load varies; correctness and browser stages remain independent hard checks.
