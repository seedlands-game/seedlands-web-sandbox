# E2E Test Layering and Asset Placement

**Status:** Delivered locally — Git delivery blocked by detached HEAD

## Context & Goal

项目已有 Playwright 驱动的确定性浏览器 Harness 与 change 内 Midscene YAML，但尚未将两者的职责、资产目录、运行层级和证据边界收敛为可扩展规则。目标是确认分层策略和 Playwright 代码的社区惯例落点，再由用户确认后实施。

## Scope & Non-goals

- In scope: 调研并设计 deterministic Playwright、benchmark/Harness、Midscene 需求用例和 CDP fallback 的职责与目录。
- Non-goals: 配置外部 CI/定时任务、改变 Midscene YAML 的 change 内归属，或把 CDP 发展为独立测试运行器。

## Decisions

- **Four evidence layers, not one aggregate E2E result:** Vitest proves pure world logic; Playwright proves deterministic browser behavior; Midscene proves change-level user journeys and semantic/visual expectations; the existing Harness aggregates deterministic algorithm, browser sample, bundle and storage evidence. A pass in one layer does not replace the others.
- **Playwright is the deterministic browser runner:** add `@playwright/test` as a direct development dependency and root `playwright.config.ts`; do not resolve `playwright` transitively from `@midscene/cli`. Tests use fixed seeds, isolated browser contexts, user-facing locators and observable application states rather than fixed sleeps or pixel coordinates.
- **Community-aligned placement:** use `tests/e2e/regression/*.spec.ts` for deterministic functional regressions, `tests/e2e/benchmark/*.spec.ts` for browser performance samples, and `tests/e2e/support/` for typed fixtures, harness contracts and narrowly scoped CDP helpers. `playwright.config.ts` owns test discovery, web server, retries, trace/report paths and CI behavior. This keeps unit tests under `tests/world/` while using the conventional `testDir` plus `*.spec.ts` Playwright contract.
- **Harness remains the benchmark authority:** Playwright benchmark cases collect a browser sample only. `scripts/run-harness.mjs` remains responsible for Node worldgen/mesh metrics, bundle/storage metrics, baseline comparison and the combined report. Browser time samples are environment-scoped observations, never portable hard thresholds.
- **Midscene remains change-local semantic acceptance:** each product change that needs visual/user-journey validation stores YAML under `changes/<change-id>/midscene/`. Stable, programmatically observable rules discovered in a Midscene case are promoted to one deterministic Playwright regression rather than retained as duplicated long-term assertions.
- **CDP is a helper, not a runner:** only `tests/e2e/support/cdp-*.ts` may open a CDP session, and only for Chromium-specific diagnostic/metric facts unavailable through Playwright's public API. Unsupported metrics must be reported as `UNSUPPORTED` or `NOT_COLLECTED`; they never make a functional case pass.
- **Harness state setup stays explicit:** `?harness=1` exposes typed controlled entries only for fixed world-edit and position setup. Each entry uses the production `World.edit()`, Store or `updateStreaming()` path; real Pointer Lock and keyboard/mouse delivery remain independent Playwright assertions. The single Playwright worker prevents the browser benchmark sample from competing with regression rendering work.
- **Evidence freshness:** every browser/Harness result must include a run id, source SHA and environment metadata. A stale `browser-e2e.json` cannot be read as evidence for a later benchmark or change.

## Behaviour

- Given a deterministic user interaction, persistence rule or reproducible browser regression, When it is automated, Then it is a Playwright `*.spec.ts` case with isolated state and observable waits.
- Given a browser performance sample, When it is collected, Then it is tagged with its environment and is aggregated by the Harness; machine-dependent timing is not a cross-machine hard gate.
- Given a change-level user journey whose success is primarily semantic or visual, When it is accepted, Then its Midscene YAML remains beside that change and produces a separate visual report.
- Given an assertion needs Chromium protocol internals, When Playwright's public API cannot express it, Then a typed CDP helper may be used within a Playwright case; no free-standing CDP suite is created.
- Given a stable Midscene assertion becomes precisely machine-checkable, When it protects a recurring regression, Then it is promoted to Playwright and the Midscene case retains only the user-visible semantic expectation.

## Acceptance & Evidence

- [x] 以官方/社区来源及现有仓库状态确认 Playwright asset placement。
- [x] 明确 Playwright、Midscene 与 CDP 的触发边界和证据级别。
- [x] 直接依赖 Playwright Test、迁移现有 deterministic Harness 场景并新增配置/测试资产。
- [x] 执行 Playwright、Harness/static/build 验证，保留各自证据边界。
- [x] Midscene YAML 未改动，因而未重新执行需要模型凭据的语义/视觉 smoke；该缺席不以 Playwright 结果替代。

## Tasks & Current State

1. [done] 读取现有 Harness、Midscene、脚本与 Git 状态。
2. [done] 完成一次只读架构复核和官方资料调研。
3. [done] 提交目录、运行与证据策略。
4. [done] 运行 Playwright、Harness/static/build，并将真实结果写回。

## Delivery Snapshot

Changed paths: direct `@playwright/test` and `@types/node` dependencies; `playwright.config.ts`; `tests/e2e/{regression,benchmark,support}/`; `scripts/run-playwright-harness.mjs`; adapted `scripts/run-harness.mjs`; `src/app/main.ts` Harness-only typed state entries; `.gitignore`, `.ls-lint.yml`, ESLint, README and AGENTS.md.

Validation: `corepack pnpm test:e2e:regression` passed 4 deterministic Chromium cases. `corepack pnpm harness` passed 27 Vitest tests, production TypeScript/Vite build, 5 single-worker Playwright cases and correlated Harness aggregation. The browser E2E result, browser benchmark sample and `latest.json` share run id `b3c831e3-9c2c-4419-9e49-80074b08c39b`, source SHA `f9cf9f6b38604fe45707ef6b821af28d28151a9a`, and darwin/arm64 Node v24.20.0 metadata. `corepack pnpm verify:static` passed Prettier, ESLint, ls-lint, 27 Vitest tests at 100% world line coverage, and TypeScript. `git diff --check` passed. The production build reports the existing >500 kB chunk-size warning but exits successfully. Midscene was not rerun because this change adds no YAML and it requires separate model-backed visual evidence.

Known limitation: browser performance is a tagged local sample, not a portable threshold or CI gate. No external CI, scheduler, pipeline or Midscene model configuration was changed.

Git: current checkout has detached HEAD and no configured upstream branch, so the required commit/push cannot be safely performed. All implementation files remain uncommitted locally; create or select a branch before delivery.

Independent review: preserve `scripts/run-harness.mjs` as baseline/report authority; move browser scenarios into `tests/e2e/regression` and `tests/e2e/benchmark`; use `tests/e2e/support` for fixtures and CDP metrics; keep Midscene change-local.
