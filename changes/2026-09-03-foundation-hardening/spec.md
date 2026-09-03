# Foundation Hardening

**Status:** Delivered

## Context & Goal

P0 原型已经可玩；本 change 收紧后台 Chunk 工作、世界编辑增量、存档边界和可重复验证，使其适合作为下一阶段功能的稳定基线。

## Scope & Non-goals

- In scope: 有界且可失效的 Worker 调度、按 Chunk 索引的 mutation 传输、存档输入校验、资源释放、确定性逻辑验证，以及历史 Midscene smoke 迁入本 change。
- Non-goals: 新世界内容、移动端、光照、LOD、纹理图集或存档后端迁移。

## Decisions

- Worker 至多保留两个在途任务；同 Chunk 的新请求使旧结果失效，过期或远离玩家的排队任务可被丢弃。
- 主线程保留全局 mutation Map 用于持久化，并建立 Chunk 索引；只发送影响目标 Chunk 及一格边界的 mutation 给 Worker。
- 保持无新增 runtime 依赖；用 Vite 的 ESBuild 转换加载 TypeScript 源码执行确定性测试。
- 历史根目录 smoke 迁入 `changes/2026-09-03-foundation-hardening/midscene/`，`npm run midscene:smoke` 成为唯一入口。

## Behaviour

- Given 玩家快速跨越 Chunk, When streaming 发出大量请求, Then Worker 在途任务数有上限，远离玩家的排队工作不会继续占用队列。
- Given 世界有大量历史编辑, When 重网格化一个 Chunk, Then Worker 仅接收该 Chunk 与相邻边界所需的编辑，而不是全量 mutation。
- Given 存档损坏或字段形状错误, When 加载页面, Then 忽略该存档并显示创建世界入口。
- Given 一个世界被重新开始, When 创建新运行时, Then 原 Worker、Chunk GPU 资源和旧输入状态被释放或重置。
- Given 执行 `npm run test`, When 校验基础世界, Then Seed、坐标、体素索引与采样顺序确定性得到验证。

## Acceptance & Evidence

- [x] 历史 Midscene YAML 已迁入本 change，命令入口已更新。
- [x] 调度、mutation 传输和运行时清理已实现。
- [x] 确定性逻辑测试已添加。
- [x] `npm run test` 通过。
- [x] `npm run build` 通过。
- [x] `VOXEL_SANDBOX_URL=http://127.0.0.1:5174 npm run midscene:smoke` 通过（1/1）。

## Tasks & Current State

1. [done] 记录 hardening 决策并迁移测试资产。
2. [done] 实现调度、mutation、存档和生命周期加固。
3. [done] 执行静态与视觉验证。

## Delivery Snapshot

Changed paths: `src/main.ts`, `scripts/verify-voxel.mjs`, `package.json`, `README.md`, `changes/2026-09-03-foundation-hardening/`；历史 `midscene/voxel-sandbox.smoke.yaml` 已迁入 change。

Validation: `npm run test` passed; `npm run build` passed; Midscene smoke passed 1/1 against a local Vite server.

Known limitation: 当前 Midscene 用例覆盖创建世界和渲染 HUD 入口；Pointer Lock 下的破坏、放置与移动仍需在后续交互 change 中扩展为专门的浏览器验证。
