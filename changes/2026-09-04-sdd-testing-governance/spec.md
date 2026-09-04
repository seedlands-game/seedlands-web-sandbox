# SDD and Testing Governance

**Status:** Delivered locally (Breaking flow)

## Context & Goal

当前规则已经区分 Vitest、Playwright 与 Midscene 的部分用途，但仍允许“先实现，后补 spec/测试”，并且没有把长期回归基线与单次需求准出用例分开。这会使基线套件持续膨胀，也容易让某一种测试被误当作其他证据的替代品。

本 change 将项目研发合同改为“先定义准出，再实现”，并建立可维护的基线/需求 E2E 分层。完成态是：后续智能体能在不阻塞已澄清小需求的前提下，始终先写 spec 和用例；只有触发审核边界的 Breaking 流程与探索流程需要人工 review。

## Scope & Non-goals

- In scope: 更新 `AGENTS.md` 中的测试分层、TDD 顺序门禁、三种 SDD 流程和测试工具职责；让 Playwright 同时可发现基线与 change 内用例，但默认 `pnpm test:e2e` 只运行核心基线；将现有 visual-upgrade 需求用例迁回对应 change 作为首个范例。
- In scope: 先于规则实现创建治理验收用例，并记录 RED 与最终 GREEN 证据。
- Non-goals: 不将所有历史 E2E 重写或迁移；不引入新 runner；不把 Midscene 改成高频基线；不将 MVP 原型自动晋级为生产代码。

## Decisions

### E2E lifecycle

- `tests/e2e/` 只保留长期基线：核心用户旅程、高影响不变量和稳定的浏览器性能采样。新增基线必须证明它能长期防止核心回归、未被现有用例覆盖且运行成本可控；重复用例应合并或删减。
- 单次需求的 Playwright 用例位于 `changes/<change-id>/e2e/**/*.spec.ts`，Midscene 位于 `changes/<change-id>/midscene/**/*.yaml`，只在该 change 准出时按路径运行。
- 需求用例只有在证明了长期价值后才可候选提炼到 `tests/e2e/`；提炼时要与已有基线去重，不在两处保留同一高频旅程。
- 任何新增或从 change 提炼进入 `tests/e2e/` 的基线用例，都必须先由与作者/实施者独立的高智能只读模型评审（当前按项目路由使用 Sol/xhigh）。评审必须覆盖核心回归价值、与已有基线的重复度、确定性/flakiness、运行成本与长期维护负担，结论和请求的模型/effort 证据写回 change spec。
- 高智能独立评审未完成或未通过时 fail closed：用例继续作为 change 需求证据，不得进入基线。准入后若用例目标、覆盖旅程或运行成本发生实质变化，原评审失效并必须重新评审。
- `pnpm test:e2e` 仍是每次迭代执行的基线入口，不自动扫描所有历史 change；当前需求用 `pnpm exec playwright test changes/<change-id>/e2e` 显式执行。
- `pnpm harness:e2e` 与 `pnpm harness` 同样只执行 `tests/e2e/` 基线；`playwright.config.ts` 允许通过显式路径发现 change 用例，`tsconfig.test.json` 必须对其做类型检查。

#### Requirement-case lifecycle

- **Active**：spec 处于 Awaiting review / Approved / Implementing 时，change 用例是当前准出合同，修改该 change 的智能体负责维护并显式执行。
- **Delivered**：准出后，change 用例随 spec 保留为当次交付证据，不进入日常基线。其中具有长期核心价值的规则必须去重后提炼到 `tests/e2e/`；其余用例明确视为历史准出证据，不承诺永久可执行。
- **Archived**：change 被归档后，用例与 spec 一起冻结。后续不得为追随 runner/API 变化而静默改写历史用例；需复用时由新 change 重新定义当前预期。
- 基线防回归由 `tests/e2e/` 承担，Delivered/Archived 用例只承担历史可追溯性；这一状态差异必须写在 spec 的 Delivery Snapshot，避免把未运行的历史用例误报为当前保护。

### Evidence responsibilities

- Vitest 证明纯逻辑、数据结构、算法、编解码、坐标与确定性不变量；它不证明真实浏览器交互或视觉语义。
- Playwright 证明可程序化的浏览器行为：页面启动、DOM/可观测状态、真实输入、持久化、streaming 和可确定断言的渲染结果；它不替代对“自然、清晰、一致、美观”的视觉语义判断。
- Midscene 证明用户可见旅程和语义/视觉预期；它不替代精确算法断言、高频确定性回归或性能采样。
- 一个需求可同时需要三类证据；必须从 spec 的每条准出标准反推工具，不允许根据个人偏好只选一种。手工检查仅作补充证据。
- spec 的每条 Acceptance 必须标明 `Vitest` / `Playwright-baseline` / `Playwright-change` / `Midscene` / `Static` / `Build` / `Manual supplement` 中一种或多种证据；确实不适用时写 `N/A` 和理由，不得留空。

### Spec-first and TDD gate

- 除探索期原型外，任何生产代码、产品行为、架构、配置或测试口径变更，都必须先建立 `spec.md`、先写准出标准和用例，再修改生产代码。
- 可执行用例应先记录预期 RED；无法自动化的语义项先在 spec/Midscene 中写成可观察的 Given/When/Then，不得以“实现后看看”代替。
- “不阻塞”表示敏捷需求不需要等待用户 review，不表示可以跳过 spec 或 TDD。
- Breaking/Exploration 的 review 必须绑定当时的 spec 路径与 SHA-256；`Scope`、`Decisions`、`Behaviour`、`Test Design` 或 `Acceptance` 发生实质变化后原批准失效，必须用新 hash 重新 review。
- spec 批准只允许开始其中定义的本地实现，不自动授权发布、push、外部写入、权限/线上配置或删除/覆盖等高影响动作；这些仍需独立的明确授权。

### Three SDD flows

1. **Agile flow**：需求简单、已澄清、未触发审核边界。智能体从一句话先生成短 spec 和用例，立即按 RED → 实现 → GREEN → 准出自动完成，不请求额外 review。
2. **Breaking flow**：方案清晰，但触发安全/权限/持久化格式/世界生成与 Chunk/渲染管线/公开契约/跨模块重构/不可逆数据等 review 边界。先写 spec 和用例，等待用户审核 spec，确认后再自动实现与验收。
3. **Exploration flow**：用户目标或方案未澄清。先通过讨论和可丢弃 MVP/原型验证方向；原型只能位于 `/tmp` 或独立的非生产 workspace，不得位于/导入 `src`、`tests`、生产 `public` 或包脚本/构建入口，不能合入、发布或作为正式准出。方向稳定后只将结论/截图等证据带入 spec，原型必须丢弃或在 review 后按正式合同重新实现。随后生成 spec 与用例，进行一次绑定 SHA-256 的 review，再自动正式实现和验收。

## Behaviour

- Given 一句话的清晰低风险需求, When 智能体开始开发, Then 先生成短 spec 和用例并直接进入实现，不等待 review。
- Given 清晰方案触发 review 边界, When spec 和用例已完成, Then 在用户审核前不修改生产代码。
- Given 需求尚未澄清, When 执行讨论或 MVP, Then 产物被标记为可丢弃非生产原型；只有 review 后的 spec 才能触发正式实现。
- Given 当前 change 的浏览器准出用例, When 存放文件, Then Playwright 位于该 change 的 `e2e/`，Midscene 位于该 change 的 `midscene/`，且默认基线命令不执行它们。
- Given 一条需求用例已多次证明核心价值, When 提炼为基线, Then 它与已有基线去重并且只在 `tests/e2e/` 保留一份长期用例。
- Given 一条 E2E 候选进入基线, When 独立高智能模型尚未完成或未通过准入评审, Then 它必须留在 change 中，不得写入 `tests/e2e/`。
- Given 一条准出标准, When 选择验证工具, Then 依据逻辑、确定性浏览器行为和视觉语义分别选择 Vitest、Playwright 与 Midscene，不相互替代。

## Test Design (written before implementation)

- `GOV-01A` E2E contract: `AGENTS.md` 定义基线/需求 E2E、Active/Delivered/Archived 生命周期，以及进入基线前的高智能模型独立评审与 fail-closed 门禁。
- `GOV-01B` Evidence contract: `AGENTS.md` 定义 Vitest/Playwright/Midscene 的独立职责与 Acceptance 证据标注。
- `GOV-01C` Sequence contract: `AGENTS.md` 定义 spec-first/TDD，且不再包含“实现后补 spec”或“实现后再测试”的冲突指令。
- `GOV-01D` Flow contract: `AGENTS.md` 定义 Agile/Breaking/Exploration，包括 hash 审批失效、独立操作授权和原型隔离。
- `GOV-02` Default baseline: `package.json#scripts.test:e2e` 只执行 `tests/e2e`，确保日常基线不扫描历史 change。
- `GOV-03` Dual discovery: `playwright.config.ts` 能发现 `tests/e2e/**/*.spec.ts` 与 `changes/*/e2e/**/*.spec.ts`；`pnpm exec playwright test --list tests/e2e` 只列出基线，显式 change 路径只列出当前需求用例。
- `GOV-04` Runner/typecheck boundary: Harness runner 显式限定 `tests/e2e`，`tsconfig.test.json` 包含 `changes/*/e2e`。
- `GOV-05` First migration: visual-upgrade Playwright 用例仅存在于 `changes/2026-09-04-visual-upgrade/e2e/visual-upgrade.spec.ts`，使用正确的 support 相对导入，且全库只有一个 `Seedlands visual upgrade` suite。
- `GOV-06` Runtime proof: 治理 Vitest 先 RED 后 GREEN；`pnpm test:e2e` 基线、显式 visual-upgrade change Playwright、`pnpm verify:static` 和 `pnpm build` 均通过。本次纯治理变更不产生用户可见语义，Midscene 标记 `N/A`。

## Acceptance & Evidence

- [x] 治理验收用例在规则/配置修改前已写入，并记录预期 RED。
- [x] 用户已 review 并批准本 Breaking-flow spec；批准绑定 SHA-256 `f97a1738944deea4fb68177320122e5f775e58903a1ae7b4fb63d8ad494d8d3e`。
- [x] `AGENTS.md` 精确表达两层 E2E、三种证据、TDD 门禁与三条 SDD 流程，不再保留“先实现后补 spec/测试”的冲突文字。
- [x] Playwright 配置与脚本同时支持有界的日常基线和显式的 change 准出用例。
- [x] visual-upgrade 需求用例已迁移到 change，无重复高频副本。
- [x] 新增/提炼基线用例只能在高智能模型独立评审通过后准入，缺少评审时 fail closed。
- [x] `GOV-01A` 至 `GOV-06` 全部 GREEN，真实证据已写回本 spec。
- [x] Midscene: `N/A`，本 change 只改研发治理文本、runner 发现范围与测试归属，无新的用户可见界面或视觉语义。

## Tasks & Current State

1. [done] 读取现有测试、SDD 和准出规则，确定冲突文字与目录差距。
2. [done] 在不修改生产规则的前提下先创建 spec 和治理用例，并获取 RED 证据。
3. [done] 完成 Sol/xhigh 只读流程架构复核；审批 hash/授权边界、原型隔离、用例生命周期、Harness/typecheck 范围与可执行 discovery 建议已由父级纳入本稿。
4. [done] 用户批准后，修改 `AGENTS.md`、Playwright 配置/脚本并迁移范例用例。
5. [done] 运行定向、静态、构建、基线 E2E 与 change E2E，写回 Delivery Snapshot 并创建本地语义化 commit。

## Delivery Snapshot

Pre-implementation RED: after the read-only review strengthened the cases, `CI=true pnpm exec vitest run tests/governance/sdd-testing-governance.test.ts` completed with 8/8 expected failures. The independent tests show that the old `AGENTS.md` lacks the new lifecycle/evidence/sequence/flow contracts, `test:e2e` still scans the config default, Playwright only discovers `tests/e2e`, Harness would inherit broad discovery, change E2E is not type-checked, and visual-upgrade still lives in the baseline directory.

Review evidence: one policy-validated, read-only Sol/xhigh review completed. Its required gates are incorporated above; runtime did not expose independent effective-model telemetry, so the receipt proves the requested route rather than backend billing telemetry.

Changed paths: `AGENTS.md`, `.ls-lint.yml`, `package.json`, `playwright.config.ts`, `scripts/run-playwright-harness.mjs`, `tsconfig.test.json`, `tests/governance/sdd-testing-governance.test.ts`, `changes/2026-09-04-visual-upgrade/e2e/visual-upgrade.spec.ts`, the deleted baseline copy, and this change's review receipts/spec.

TDD evidence: the governance suite first failed 8/8 against the old contract, then passed 8/8 after the approved implementation. When static verification exposed the missing change-level `e2e/` ls-lint override, a ninth case was added first and failed 1/9 before `.ls-lint.yml` changed; the final governance suite passed 9/9.

Discovery and runtime evidence: `playwright test --list tests/e2e` listed 9 baseline tests in 3 files, while the explicit visual-upgrade change path listed 2 tests in 1 file. `CI=true pnpm test:e2e` passed 9/9 baseline tests; explicit `CI=true pnpm exec playwright test changes/2026-09-04-visual-upgrade/e2e` passed 2/2 requirement tests; `CI=true pnpm harness:e2e` independently passed only the same 9 baseline tests.

Static/build evidence: `CI=true pnpm verify:static` passed Prettier, ESLint, ls-lint, 44 Vitest tests, 95.46% `src/world/**` line coverage and both TypeScript projects. `CI=true pnpm build` passed; the pre-existing Vite warning for a JavaScript chunk over 500 kB remains informational.

Lifecycle snapshot: the 9 tests under `tests/e2e/` are the current executable baseline. The 2 visual-upgrade tests are Delivered requirement evidence and are not part of the default baseline. No new E2E case was promoted into the baseline in this change, so the new high-intelligence admission gate was codified but did not need to admit a candidate.

Git: implementation is on `codex/sdd-testing-governance`, based on visual-upgrade commit `08bbb84`. No push, release, external write or baseline performance rewrite was performed.
