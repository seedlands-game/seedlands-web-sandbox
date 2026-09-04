# Seedlands 开发约定

## 文档语言

- 方案、spec、设计评审和交付记录的正文强制使用简体中文；仅代码标识符、协议名、产品名、命令、文件路径及无法准确替代的通行技术术语可保留英文。标题、说明、验收标准和任务状态同样适用，不得以英文模板替代中文方案。

## 项目边界

- 这是 TypeScript / Vite / PlayCanvas 的 Web 3D voxel sandbox。`src/world/` 是坐标、体素注册、确定性基础世界、Chunk 网格与存档编解码的纯逻辑源头；`src/worker/world-worker.ts` 负责后台 Chunk 生成与网格传输；`src/app/main.ts` 负责 streaming、编辑、渲染和玩家。
- 维持核心不变量：同一 `seed + generatorVersion` 的基础世界与加载顺序无关；体素数据是紧凑数值；世界编辑只经 `World.edit()`；渲染单位是优化后的 Chunk Mesh，不是逐体素 Entity。
- `README.md` 是运行方式、操作和当前能力的唯一说明；`package.json` 是可执行命令的唯一来源。不要在此重复它们。
- `.env`、`node_modules/`、`dist/`、`midscene_run/` 不得纳入版本控制或交付证据。不得读取、输出或提交密钥。
- 新增或修改的 Midscene YAML 必须放在所属 `changes/<change-id>/midscene/` 下，与 spec 一起追溯；根目录现有 `midscene/` 仅为 SDD 建立前的历史 smoke，不作为新变更范式。

## 代码组织与静态质量

- `src/world/` 只能包含无 DOM、PlayCanvas 与 Worker global 依赖的纯逻辑；新 world 行为应在 `tests/world/` 以 Vitest 覆盖，并保持 `test:coverage` 的 `src/world/**` 行覆盖率不低于 80%。
- `src/world/` 的纯逻辑边界必须由自定义 ESLint 规则强制执行：禁止导入 `src/server/`、`src/client/` 或 `playcanvas`，并禁止使用 DOM 与 Worker 全局对象。架构决策不得只保留为文档说明；新增或调整边界时必须先补充规则的反例和正例测试。
- `src/app/` 保存浏览器启动、UI、输入、PlayCanvas 生命周期和样式；`src/worker/` 仅保存 Worker 入口与传输适配。app/worker 可依赖 world，world 不得反向依赖 app/worker。
- 新增 TypeScript、测试文件、脚本和目录使用 kebab-case；新的 change 目录必须为 `YYYY-MM-DD-kebab-name`。规则的唯一可执行来源为 `.ls-lint.yml`。
- 格式以 `.prettierrc.json` 为准；不要手动对抗 Prettier。ESLint 配置在 `eslint.config.mjs`：`src/` 与 `tests/` 有 browser/worker/node globals，`scripts/` 使用 Node globals。
- 实现后至少运行受影响的确定性检查和项目构建；静态基线的组合入口是 `pnpm verify:static`（Prettier check、ESLint、ls-lint、Vitest V8 coverage、TypeScript）。`pnpm build` 仍是独立生产构建证据。
- Node unit、V8 coverage、静态 lint、生产构建、Harness/Midscene 与手动游玩是不同证据类型；不得以其中任一项代替其他项。
- Husky 在依赖安装后启用：pre-commit 只对暂存的受支持文件执行 Prettier check 与 ESLint，并执行快速的 ls-lint；commit-msg 仅要求 `feat|fix|refactor|test|docs|chore|ci|build` 前缀、非空 subject 和不超过 100 字符的 header。hook 不得加入构建、coverage、Harness 或浏览器任务。

## E2E 分层与自动化调用

### 基线 E2E 与需求 E2E

- `tests/e2e/` 只保留每次迭代都执行的长期基线：核心用户旅程、高影响不变量和稳定的浏览器性能采样。基线不得无限膨胀；新增用例必须具有长期核心回归价值、未被已有用例覆盖且运行成本可控，重复用例应合并或删减。
- `tests/e2e/regression/**/*.spec.ts` 是 Playwright 确定性浏览器基线：固定 seed、隔离 Browser Context、面向用户可见的 locator 与可观察状态等待。只有 Canvas 无语义控件等边界，才能根据其 locator 计算交互坐标；不得以固定 sleep 作为正确性断言。
- `tests/e2e/benchmark/**/*.spec.ts` 只采集浏览器性能基线样本，不设置跨机器硬阈值。`tests/e2e/support/` 放 typed fixture、Harness 快照契约和 Chromium CDP 辅助；CDP 不得成为独立 runner，且不支持的指标必须标记 `UNSUPPORTED` 或 `NOT_COLLECTED`。
- 单次需求的 Playwright 用例必须放在 `changes/<change-id>/e2e/**/*.spec.ts`，Midscene 必须放在 `changes/<change-id>/midscene/**/*.yaml`，只在该 change 准出时按显式路径执行。`pnpm test:e2e`、`pnpm harness:e2e` 与 `pnpm harness` 只执行 `tests/e2e/` 基线，不扫描所有历史 change。
- 需求用例的生命周期是：**Active** 期由当前 change 维护并显式执行；**Delivered** 后随 spec 保留为当次历史准出证据，不承诺永久可执行；**Archived** 后与 spec 一起冻结，不得为追随 runner/API 变化而静默改写。复用历史用例时由新 change 重新定义当前预期。
- 需求用例只有在证明长期核心价值后才可候选提炼到 `tests/e2e/`，且必须先通过与作者/实施者独立的高智能模型独立评审（当前按项目路由使用 Sol/xhigh）。评审要覆盖核心价值、重复度、确定性/flakiness、运行成本与长期维护负担，并把结论与请求的模型/effort 证据写回 change spec。评审缺失或不通过时 fail closed，用例继续留在 change；准入后的目标、旅程或成本实质变更会使原评审失效。
- 提炼进基线时必须与现有用例去重，不在 change 与 `tests/e2e/` 保留同一高频旅程。Delivery Snapshot 必须说明哪些是当前基线、哪些只是历史准出证据。
- `playwright.config.ts` 是唯一 Playwright 配置，同时发现 `tests/e2e/**/*.spec.ts` 与 `changes/*/e2e/**/*.spec.ts`；默认基线用 `pnpm test:e2e`，当前需求用 `pnpm exec playwright test changes/<change-id>/e2e`。CI 需显式安装 Chromium，本机可用 `SEEDLANDS_CHROME_PATH` 指定浏览器。
- `?harness=1` 下的受控 Harness 入口仅可构造确定性世界编辑或跨 Chunk 位置状态，且必须调用生产的 `World.edit()`、Store 或 `updateStreaming()` 路径；真实 Pointer Lock / 键鼠输入仍需 Playwright 独立覆盖。
- `pnpm harness:e2e` 以单 worker 运行两类基线 Playwright 用例并产生关联 run id、source SHA 与环境元数据；`pnpm harness` 才会把同次运行的浏览器结果汇总进 Harness。单独执行 `pnpm harness:benchmark` 不得读取遗留浏览器结果作为当前证据。

### Vitest、Playwright 与 Midscene 证据边界

- Vitest 证明纯逻辑、数据结构、算法、编解码、坐标和确定性不变量；它不证明真实浏览器交互或视觉语义。
- Playwright 证明可程序化的浏览器行为：页面启动、DOM/可观测状态、真实输入、持久化、streaming 和可确定断言的渲染结果；它不替代对“自然、清晰、一致、美观”的视觉语义判断。
- Midscene 证明用户可见旅程和语义/视觉预期；它不替代精确算法断言、高频确定性回归或性能采样。可稳定程序化的规则可在通过基线准入门禁后提炼为 Playwright，但不因此删除必需的视觉语义验收。
- 一个需求可同时需要三类证据；必须从 spec 的每条准出标准反推工具，不允许根据个人偏好只选一种。手工检查仅作补充证据。
- spec 的每条 Acceptance 必须标明 `Vitest`、`Playwright-baseline`、`Playwright-change`、`Midscene`、`Static`、`Build` 或 `Manual supplement` 中一种或多种证据；确实不适用时写 `N/A` 和理由，不得留空。

## 轻量 SDD

### Spec-first 与 TDD 门禁

- 每一个会改变生产代码、产品行为、架构、配置或测试口径的需求，都必须先建立 `changes/<YYYY-MM-DD>-<kebab-name>/spec.md`、先写准出标准和用例，再修改生产代码。“不阻塞”表示敏捷需求不需要等待用户 review，不表示可以跳过 spec 或 TDD。
- 可执行用例应先记录预期 RED；无法自动化的语义项先在 spec/Midscene 中写成可观察的 Given/When/Then，不得以“实现后看看”代替。
- change 是可执行合同和交付记录。简单改动的 spec 可以很短，不要求额外 proposal、task ledger 或独立测试文档；但仍必须在实现前写完 spec 和用例。
- Breaking/Exploration 的 review 必须绑定 spec 路径与 SHA-256。`Scope`、`Decisions`、`Behaviour`、`Test Design` 或 `Acceptance` 发生实质变化后原批准失效，必须对新 hash 重新 review。
- spec 批准只允许开始其中定义的本地实现，不自动授权发布、push、外部写入、权限/线上配置或删除/覆盖等高影响动作；这些仍需独立的明确授权。

`spec.md` 必须包含以下可恢复信息：

1. `Context & Goal`：问题、用户价值和完成态。
2. `Scope & Non-goals`：本次会做与明确不做的事项。
3. `Decisions`：关键取舍；小改动可写 `Direct implementation` 及原因。
4. `Behaviour`：用可验证的 Given / When / Then 描述规则、边界和失败路径。
5. `Test Design`：在实现前定义用例路径、覆盖规则、预期 RED 或无法自动化的可观察预期。
6. `Acceptance & Evidence`：每项准出条件、所需证据类型与实际结果。
7. `Tasks & Current State`：最小可执行拆分、当前阶段、阻塞项。
8. `Delivery Snapshot`：交付时补充变更路径、验证命令/结果、已知限制和相关 SHA（如有）。

### 三种 SDD 流程

1. **Agile flow**：需求简单、已澄清、未触发审核边界。智能体从一句话先生成短 spec 和用例，立即按 RED → 实现 → GREEN → 准出自动完成，不请求额外 review。
2. **Breaking flow**：方案清晰，但触发安全/权限/持久化格式/世界生成与 Chunk/渲染管线/公开契约/跨模块重构/不可逆数据等 review 边界。先写 spec 和用例，等待用户审核当时的 spec SHA-256，确认后再自动实现与验收。
3. **Exploration flow**：用户目标或方案未澄清。先讨论并在 `/tmp` 或独立非生产 workspace 做可丢弃 MVP/原型；原型不得位于或导入 `src`、`tests`、生产 `public` 或包脚本/构建入口，不能合入、发布或作为正式准出。方向稳定后只将结论/截图等证据带入 spec，原型必须丢弃或在 review 后按正式合同重新实现。随后生成 spec 与用例，进行一次绑定 SHA-256 的 review，再自动正式实现和验收。

## 开发与准出

1. 先读取当前代码、已有 active change 和用户需求，选择 Agile / Breaking / Exploration 流程；新实现不得绕开已有 world / edit / worker 边界。
2. 除 Exploration 的隔离原型阶段外，修改生产代码前必须先完成 spec、准出标准和用例，并获得可执行用例的预期 RED 或记录无法自动化项的可观察预期。Breaking / Exploration 还必须先通过用户对精确 spec hash 的 review。
3. 实现完成后将预置用例跑至 GREEN，并至少运行受影响的确定性检查和项目构建。可见 UI、输入或渲染行为按证据边界分别补充 Playwright 与 Midscene；数据与算法正确性仍使用 Vitest。
4. 将真实通过、失败或环境阻塞的证据写回 spec；Vitest、Playwright 基线、Playwright change、Midscene、静态检查、生产构建、手动游玩和设备验证必须按 Acceptance 分别陈述，不能互相替代。
5. 交付前更新 `Delivery Snapshot`。未满足的准出条件保持未完成并说明最小下一步；不伪造通过。每个已完成的 change 在准出后自动执行：确认当前 worktree 已位于明确的功能分支（detached HEAD 时创建/切换 `codex/<change>` 分支，不改写既有分支），仅暂存该 change 的文件，并创建语义化本地 Git commit。默认不执行 `git push`；只有用户在当轮明确要求推送到指定远端/分支时才可外发。不得自行创建远端、改写历史或强推。

## 新会话恢复

恢复时先读 `AGENTS.md`、`README.md`、最近相关的 `changes/*/spec.md`、当前 Git 状态和实际源码；spec 是需求意图与进度的权威记录，代码与测试输出是实现和验证的权威记录。
