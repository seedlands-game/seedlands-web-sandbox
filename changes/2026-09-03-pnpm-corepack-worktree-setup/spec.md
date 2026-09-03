# pnpm, Corepack, and Codex Worktree Setup

**Status:** Delivered

## Context & Goal

将项目从 npm 迁移至由 Corepack 精确锁定的 pnpm，并让 Codex 新建 worktree 时自动以冻结锁文件安装依赖，以减少重复下载和磁盘占用。

## Scope & Non-goals

- In scope: 包管理器声明、pnpm 锁文件、重复安装优化、运行文档与 Codex 环境初始化脚本。
- Non-goals: 升级业务或工具依赖、修改 npm registry、清理用户现有的全局 pnpm store 或 `node_modules`。

## Decisions

**Direct implementation:** 当前依赖树与构建入口明确；pnpm 的共享 content-addressable store 天然复用包内容，`.npmrc` 启用离线优先以加速已缓存依赖的 worktree 初始化。`packageManager` 固定 Corepack 获取的 pnpm 版本及完整校验哈希，避免依赖机器全局 pnpm。pnpm 11 对依赖构建脚本采用显式 allowlist，因此只保留当前依赖树实际声明的构建项。

## Behaviour

- Given 一个克隆或 Codex worktree, When 执行环境 setup, Then `CI=true corepack pnpm install --frozen-lockfile` 使用项目锁定的 pnpm 与 `pnpm-lock.yaml` 安装依赖，且无需交互确认。
- Given pnpm store 已含某个依赖, When 初始化另一个 worktree, Then pnpm 复用该内容且优先使用本地缓存，而非重复下载完整包。
- Given 锁文件与 `package.json` 不一致, When 环境 setup, Then 冻结安装失败而不会静默修改锁文件。

## Acceptance & Evidence

- [x] npm 的 `package-lock.json` 已迁移为 `pnpm-lock.yaml`。
- [x] `packageManager` 已锁定 pnpm 11.25.0 与 Corepack 完整性哈希。
- [x] Codex 环境 setup 使用 `corepack pnpm install --frozen-lockfile`。
- [x] `CI=true corepack pnpm install --frozen-lockfile`、测试和构建通过。

## Tasks & Current State

1. [done] 查询 pnpm 当前最新版并由 Corepack 写入项目锁定版本。
2. [done] 生成 pnpm 锁文件，更新文档与 Codex setup。
3. [done] 运行冻结安装、确定性测试与生产构建并回填证据。

## Delivery Snapshot

Changed paths: `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `.npmrc`, `.codex/environments/environment.toml`, `.gitignore`, `README.md`，并删除 `package-lock.json`。

Validation: `CI=true corepack pnpm install --frozen-lockfile` passed with pnpm 11.25.0; `corepack pnpm test` passed; `corepack pnpm build` passed.

Known limitation: Vite 仍报告原有入口包压缩后超过 500 kB；本 change 未改动代码分包。Puppeteer 的首次完整安装会下载浏览器缓存，后续 worktree 复用 pnpm store，但浏览器缓存由 Puppeteer 单独管理。
