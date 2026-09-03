# Sync Main Macro Worldgen with Quality Architecture

**Status:** Ready to merge locally

## Context & Goal

本地 `main` 已包含 Macro Worldgen、Macro map 与输入/物理稳定性修复；测试质量架构分支已将源码拆分为 app/world/worker，并建立 Vitest、Playwright 与静态检查。目标是在保留两边行为的前提下，将最新 main 整合进该架构并快进本地主分支。

## Scope & Non-goals

- In scope: 合并 `0da6391..8c8af8d` 的 Macro Worldgen 与物理修复，迁移其源码到 app/world/worker 边界，保留 Harness、Vitest 和 Playwright 配置，并记录真实合并证据。
- Non-goals: 改变 Macro Worldgen 产品规则、重设性能基线、配置远端推送/CI，或修改 Midscene YAML。

## Decisions

- `src/world/` 保留所有可在 Node 中确定性查询的 Macro、voxel、mesh 与 storage 逻辑；Macro map UI、输入、PlayCanvas 与 Worker 生命周期留在 `src/app/`，Worker 入口留在 `src/worker/`。
- 合并冲突按功能行为而非旧文件路径处理：保留 main 的 Macro Worldgen 与输入/物理修复，同时使 imports、Harness、测试和基准脚本指向重组后的模块。
- 本变更先在 `codex/sync-main-quality-e2e` 创建本地提交，验证通过后合并到已检出的本地 `main`；不执行 push。

## Behaviour

- Given 同一 seed 与 generator version, When Macro 或 Chunk 查询以任意顺序运行, Then main 的确定性 Macro 结果在新 world 模块边界下保持一致。
- Given 玩家打开 Macro map、进行输入/编辑或跨 Chunk streaming, When 运行 Playwright/Harness, Then main 的 UI、物理及编辑修复仍可用，且结果与本次运行关联。
- Given 执行静态/单元检查, When app、world 与 worker 模块被分析, Then world 不反向依赖浏览器或 Worker globals，覆盖率范围保持 world 模块。

## Acceptance & Evidence

- [x] 最新 main 的 Macro Worldgen 与物理修复已合并且路径边界一致。
- [x] Vitest、static verification、生产构建与 Playwright/Harness 分别通过。
- [ ] 本地 `main` 已包含整合提交；未执行远端 push。

## Tasks & Current State

1. [x] 读取并确认 main 的功能/修复提交与当前架构差异。
2. [x] 在本地整合分支提交当前质量架构：`36821fe`。
3. [x] 合并 main、解决重组路径冲突并验证。
4. [in progress] 提交本 change 并合入本地 main。

## Delivery Snapshot

- 整合内容：`src/world/macro-world.ts` 保持纯逻辑；`src/app/main.ts` 保留 Macro map、输入/物理修复和批量重网格；Worker 继续仅适配 world 逻辑。Harness 同时兼容旧的受控移动/批量编辑和新架构的受控编辑/streaming API。
- `corepack pnpm verify:static`：通过。Vitest 30 项通过，`src/world/**` V8 行覆盖率 94.56%（门槛 80%）。
- `corepack pnpm build`：通过。仅有 Vite 的主 bundle 大小警告（1.95 MB，非失败）。
- `corepack pnpm test:e2e`：Chromium 6 项通过，包括 Macro 地图、真实 Pointer Lock 输入、持久化与 streaming。
- `corepack pnpm harness`：通过，相关浏览器回归和 benchmark 都为 `PASS`。
- 本地整合提交与合入 main 尚待执行；没有执行远端 push。
