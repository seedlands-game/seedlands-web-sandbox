# Establish Vitest Test Environment

**Status:** Delivered locally; Git commit/push blocked by detached HEAD

## Context & Goal

项目已有不依赖 UI 的体素生成、Chunk 网格和存档编解码逻辑，但测试入口是单个自定义 Node 断言脚本，缺少标准发现、用例组织和明确运行时边界。接入 Vitest，为纯逻辑提供可信、可扩展的单元测试基线。

## Scope & Non-goals

- In scope: 增加 Vitest、Node 单元测试配置、迁移既有确定性断言并补齐关键边界用例、更新测试命令和 README。
- Non-goals: 浏览器/UI/PlayCanvas 测试迁移、改动生产世界生成或网格算法、设置仓库级覆盖率阈值。

## Decisions

- **Direct implementation:** 需求明确，且仅改变开发测试配置和测试资产；生产代码不变。
- 测试仅发现 `src/**/*.test.ts`，使用 Node 环境，避免以模拟 DOM 替代真实浏览器验证。
- `pnpm test` 运行一次性 Vitest suite；`pnpm test:watch` 提供本地持续反馈。

## Behaviour

- Given 执行 `corepack pnpm test`, When 测试发现文件, Then 仅运行 `src/` 下的 Vitest 单元测试，并在无测试或遗留 `.only` 时失败。
- Given 对体素坐标、生成、Chunk 网格或存档编码的纯逻辑改动, When 新增回归用例, Then 使用 Vitest 的独立 `describe`/`it` 测试文件执行，不依赖浏览器或 UI。
- Given 浏览器交互、PlayCanvas 或 Worker 运行时行为, When 验证, Then 仍由现有 Harness/Midscene 等真实浏览器路径负责，不把 Node unit pass 视为其替代。

## Acceptance & Evidence

- [x] Vitest 4.1.11 已固定在开发依赖与 pnpm lockfile 中。
- [x] 现有确定性、网格和存档验证已迁移为 3 个可发现的 Vitest 测试文件（27 个用例）。
- [x] `corepack pnpm test` 与 `corepack pnpm build` 通过。
- [x] README 说明测试入口、范围和证据边界。

## Tasks & Current State

1. [done] 审计现有自定义断言入口和纯逻辑模块。
2. [done] 新增 Vitest 配置并迁移测试。
3. [done] 运行测试与构建，回填真实证据并交付。
4. [blocked] 仅暂存本 change 文件并创建语义化提交；当前 checkout 为 detached HEAD，无可推送的当前分支或 upstream。

## Delivery Snapshot

Changed paths: `package.json`, `pnpm-lock.yaml`, `vitest.config.ts`, `src/voxel.test.ts`, `src/world-mesh.test.ts`, `src/world-storage.test.ts`, `README.md`, and this change record. The obsolete custom `scripts/verify-voxel.mjs` runner was removed.

Validation: `corepack pnpm test` passed: 3 files / 27 tests. `corepack pnpm build` passed (`tsc --noEmit` and Vite production build). `git diff --check` passed.

Known limitations: these are Node-only unit tests and do not prove PlayCanvas rendering, Web Worker transport, Pointer Lock, or browser storage integration. Those remain covered by the separate Harness/Midscene paths. Vite emitted the pre-existing warning that the main production chunk exceeds 500 kB after minification; this change does not alter bundle code or chunking.

Git: automatic commit/push was not attempted because `git branch --show-current` is empty and Git reports `HEAD does not point to a branch`. The working tree retains all change files for a branch-attached follow-up.
