# Static Quality Baseline

**Status:** Delivered locally; Git commit/push blocked by detached HEAD

## Context & Goal

Seedlands 已有 TypeScript/Vite/Vitest 基础，但尚无统一的静态质量检查、格式化、目录命名约束、提交信息校验或仓库级 Git hooks。目标是在不把浏览器运行时行为伪装成静态验证的前提下，建立适合小型 PlayCanvas/Worker 项目和 agent 协作的快速、可恢复质量门槛。

## Scope & Non-goals

- In scope: ESLint flat config、Prettier、目录结构整理、pure-world 模块的 Vitest V8 行覆盖率、ls-lint、简化 commitlint、与现有企业安全 hook 共存的版本化 Git hook 安装方案、脚本/文档/忽略规则。
- Non-goals: 替换现有企业安全 hook、执行浏览器/PlayCanvas/Worker E2E 作为 Git hook、引入严格 Conventional Commits、设置整个仓库的覆盖率总阈值、改动体素生成或渲染行为。

## Decisions

### Proposed toolchain

- ESLint 9 flat config: `eslint`、`@eslint/js`、`typescript-eslint` 与 `globals`。对 `src/**/*.ts` 使用推荐 TypeScript 规则；对 `scripts/**/*.mjs` 使用 Node 规则；显式声明 browser/Web Worker/Node globals，并忽略构建和运行产物。
- Prettier: 单一仓库配置与 ignore 文件，提供 `format`（写入）和 `format:check`（只读）命令。初始格式化作为独立、可审阅的机械改动。
- Vitest coverage: 使用 V8 provider，仅纳入重组后的纯逻辑目录；提供 text/json/lcov 报告并忽略 `coverage/`。先采集真实基线，再决定保守的行覆盖率下限；不对 UI、PlayCanvas 或 Worker entry 设虚假的 Node 覆盖率门槛。
- ls-lint: 根目录 `.ls-lint.yml` 只约束受控目录：源码、测试、脚本和 change 目录使用 kebab-case；`changes/` 目录额外要求 `YYYY-MM-DD-kebab-name`。不对依赖、构建产物或历史文档做回溯重命名。
- commitlint: 不继承 `@commitlint/config-conventional`。仅要求小写 type 属于 `feat|fix|refactor|test|docs|chore|ci|build`、存在 subject、header 不超过 100 字符；scope、body、footer、breaking-change 均不强制。
- Git hooks: 用户明确授权 Husky 覆盖当前 worktree 的 `core.hooksPath`，并接受既有企业安全 hook 可能不执行的风险。`lint-staged` 对暂存的受支持文件运行 Prettier check 与 ESLint，pre-commit 额外运行快速的 ls-lint；commit-msg 运行简化 commitlint；不在 hook 中启动浏览器、重建生产 bundle 或改写文件。

### Proposed structure

```text
src/
  app/            browser bootstrap, UI, PlayCanvas lifecycle and styles
  world/          deterministic voxel, chunk meshing and storage logic
  worker/         Worker entrypoints and transport adapters
tests/
  world/          pure-world Vitest unit tests
scripts/
  hooks/          versioned hook implementations
```

`index.html` 将指向 `src/app/main.ts`；app 与 worker 通过明确 import 边界依赖 `src/world/`，而 world 不导入 DOM、PlayCanvas 或 Worker globals。测试移动至 `tests/world/`，Vitest coverage 只统计 `src/world/**/*.ts`。

## Behaviour

- Given `pnpm lint`, `pnpm format:check`, `pnpm lint:paths` 或 `pnpm test:coverage`, When 任一受控文件违反规则, Then 命令以非零退出并报告具体文件/规则；它们不修改生产行为。
- Given world 纯逻辑发生变更, When 运行 `pnpm test:coverage`, Then V8 行覆盖率仅报告 `src/world/`，并在确认的最低行覆盖率下限未满足时失败。
- Given 浏览器 UI、PlayCanvas 或 Worker runtime 行为, When 需要验证, Then 保留 Harness/Midscene 作为独立证据，静态检查和 Node coverage 不替代它们。
- Given agent 或开发者安装依赖, When Husky 的 `prepare` 执行, Then Git 提交走 `.husky/` 的快速 pre-commit 与 commit-msg hook。
- Given 未来新建源码、测试、脚本或 change, When 运行 `pnpm lint:paths`, Then 名称及 change 目录格式受 ls-lint 约束；已有非受控文件不被追溯性阻断。

## Acceptance & Evidence

- [x] ESLint、Prettier、官方 `@ls-lint/ls-lint` 和简化 commitlint 均为锁定开发依赖，配置与脚本可运行。
- [x] 当前受控 TypeScript/Node 文件经 ESLint、Prettier check 和 ls-lint 验证通过；机械格式化改动可审阅。
- [x] world 纯逻辑位于无 UI/Worker 依赖的目录，Vitest 单测与 V8 行覆盖率通过：3 files / 27 tests，`src/world/` 行覆盖率 100%，高于 80% 门槛。
- [x] `AGENTS.md` 已记录目录依赖方向、命名约束、覆盖率范围、静态命令和证据边界，供新会话在实现前遵守。
- [x] 用户已明确授权 Husky 覆盖当前 worktree 的 `core.hooksPath`；快速 pre-commit/commit-msg hook 已配置，并通过 Git hook runner 读回验证。
- [x] `pnpm verify:static` 与 `pnpm build` 通过；浏览器/Harness 结果未作为本变更的静态验证证据。

## Tasks & Current State

1. [done] 审计现有代码、测试入口、Git hook 拓扑和未提交依赖关系。
2. [done] 形成工具选型与目录边界提案。
3. [done] 用户确认目录迁移、80% world 行覆盖率门槛及快速 hook 策略。
4. [done] 安装依赖、实现配置与最小脚本，运行静态基线。
5. [done] 完成规则、格式化、静态验证和 Husky hook 读回。
6. [blocked] 仅暂存本 change 的文件并创建语义化提交；当前 checkout 为 detached HEAD，无可推送的当前分支或 upstream。

## Delivery Snapshot

Implemented so far: ESLint/Prettier/ls-lint/commitlint/V8 coverage dependencies and configuration; app/world/worker/tests directory split; test, lint, format, typecheck and static verification scripts; initial Prettier formatting; `AGENTS.md` recovery guidance for the new architecture and checks. No production logic was changed.

Husky is active after the user's explicit override authorization. `prepare: husky` installs `.husky/_`; pre-commit runs `lint-staged` plus `lint:paths`, and commit-msg runs `commitlint --edit "$1"`. These hooks intentionally omit build, coverage, Harness and browser work.

Validation: `corepack pnpm verify:static` passed: Prettier, ESLint, ls-lint, Vitest V8 coverage and two TypeScript passes. `corepack pnpm build` passed. V8 JSON/Lcov covers `src/world/voxel.ts`, `src/world/mesh.ts` and `src/world/storage.ts`; the generated text table omits the fully covered voxel row but `coverage-summary.json` includes it. A positive commitlint example (`test: verify pure world coverage`) passed and a prefix-less example (`update world tests`) was rejected as intended.

Husky readback: local `core.hooksPath` is `.husky/_`. `git hook run pre-commit` passed with no staged files (lint-staged correctly did no work, then ls-lint passed). `git hook run commit-msg -- <message-file>` accepted `test: verify husky commit message hook` and rejected `update world tests` with `type-empty` and `subject-empty` errors. The temporary message files were removed.

Current workspace dependency: the preceding `2026-09-03-vitest-test-environment` change is still uncommitted because this checkout is detached HEAD. This proposal does not stage, amend, or overwrite those files.
