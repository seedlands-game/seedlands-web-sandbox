# Seedlands 开发约定

## 项目边界

- 这是 TypeScript / Vite / PlayCanvas 的 Web 3D voxel sandbox。`src/world/` 是坐标、体素注册、确定性基础世界、Chunk 网格与存档编解码的纯逻辑源头；`src/worker/world-worker.ts` 负责后台 Chunk 生成与网格传输；`src/app/main.ts` 负责 streaming、编辑、渲染和玩家。
- 维持核心不变量：同一 `seed + generatorVersion` 的基础世界与加载顺序无关；体素数据是紧凑数值；世界编辑只经 `World.edit()`；渲染单位是优化后的 Chunk Mesh，不是逐体素 Entity。
- `README.md` 是运行方式、操作和当前能力的唯一说明；`package.json` 是可执行命令的唯一来源。不要在此重复它们。
- `.env`、`node_modules/`、`dist/`、`midscene_run/` 不得纳入版本控制或交付证据。不得读取、输出或提交密钥。
- 新增或修改的 Midscene YAML 必须放在所属 `changes/<change-id>/midscene/` 下，与 spec 一起追溯；根目录现有 `midscene/` 仅为 SDD 建立前的历史 smoke，不作为新变更范式。

## 代码组织与静态质量

- `src/world/` 只能包含无 DOM、PlayCanvas 与 Worker global 依赖的纯逻辑；新 world 行为应在 `tests/world/` 以 Vitest 覆盖，并保持 `test:coverage` 的 `src/world/**` 行覆盖率不低于 80%。
- `src/app/` 保存浏览器启动、UI、输入、PlayCanvas 生命周期和样式；`src/worker/` 仅保存 Worker 入口与传输适配。app/worker 可依赖 world，world 不得反向依赖 app/worker。
- 新增 TypeScript、测试文件、脚本和目录使用 kebab-case；新的 change 目录必须为 `YYYY-MM-DD-kebab-name`。规则的唯一可执行来源为 `.ls-lint.yml`。
- 格式以 `.prettierrc.json` 为准；不要手动对抗 Prettier。ESLint 配置在 `eslint.config.mjs`：`src/` 与 `tests/` 有 browser/worker/node globals，`scripts/` 使用 Node globals。
- 实现后至少运行受影响的确定性检查和项目构建；静态基线的组合入口是 `pnpm verify:static`（Prettier check、ESLint、ls-lint、Vitest V8 coverage、TypeScript）。`pnpm build` 仍是独立生产构建证据。
- Node unit、V8 coverage、静态 lint、生产构建、Harness/Midscene 与手动游玩是不同证据类型；不得以其中任一项代替其他项。
- Husky 在依赖安装后启用：pre-commit 只对暂存的受支持文件执行 Prettier check 与 ESLint，并执行快速的 ls-lint；commit-msg 仅要求 `feat|fix|refactor|test|docs|chore|ci|build` 前缀、非空 subject 和不超过 100 字符的 header。hook 不得加入构建、coverage、Harness 或浏览器任务。

## E2E 分层与自动化调用

- `tests/e2e/regression/**/*.spec.ts` 是 Playwright 确定性浏览器回归：固定 seed、隔离 Browser Context、面向用户可见的 locator 与可观察状态等待。只有 Canvas 无语义控件等边界，才能根据其 locator 计算交互坐标；不得以固定 sleep 作为正确性断言。
- `tests/e2e/benchmark/**/*.spec.ts` 只采集浏览器性能样本，不设置跨机器硬阈值。`tests/e2e/support/` 放 typed fixture、Harness 快照契约和 Chromium CDP 辅助；CDP 不得成为独立 runner，且不支持的指标必须标记 `UNSUPPORTED` 或 `NOT_COLLECTED`。
- `?harness=1` 下的受控 Harness 入口仅可用于构造确定性的世界编辑或跨 Chunk 位置状态，且必须调用生产的 `World.edit()`、Store 或 `updateStreaming()` 路径；真实 Pointer Lock / 键鼠输入仍需由 Playwright 独立覆盖。受控入口不替代 Midscene 的用户可见语义验收。
- `playwright.config.ts` 是 Playwright 的唯一运行配置；默认 Chromium。执行确定性回归用 `pnpm test:e2e`，按需分别用 `pnpm test:e2e:regression`、`pnpm test:e2e:benchmark`。CI 需显式安装 Chromium；本机可通过 `SEEDLANDS_CHROME_PATH` 指定浏览器。
- Midscene 用于 change 级用户旅程与语义/视觉预期，YAML 必须留在 `changes/<change-id>/midscene/`。可稳定、程序化地证明的 Midscene 规则应提升为一个 Playwright 回归；Midscene 不替代高频确定性回归，Playwright 也不替代视觉语义验收。
- `pnpm harness:e2e` 以单 worker 运行两类 Playwright 用例并产生关联 run id、source SHA 与环境元数据；`pnpm harness` 才会把同次运行的浏览器结果汇总进 Harness。单独执行 `pnpm harness:benchmark` 不得读取遗留浏览器结果作为当前证据。

## 轻量 SDD

每一个会改变产品行为、架构、配置或测试口径的需求，都必须有 `changes/<YYYY-MM-DD>-<kebab-name>/spec.md`。change 是交付记录而非默认的前置审批：对范围清晰、风险低的小改动，智能体应根据用户输入直接判断、实现、测试和准出，再在同一交付中补齐短 spec；无需先向用户展示 SDD 流程、索取澄清或等待 review。只有范围不清、授权不足，或涉及持久化格式、世界生成/Chunk/渲染管线、公开契约、跨模块重构、不可逆数据风险的变更，才先形成设计并等待用户 review 后实现。即使是小改动，spec 也要存在，但可以很短；不要求额外的 proposal、task ledger 或独立测试文档。

`spec.md` 必须包含以下可恢复信息：

1. `Context & Goal`：问题、用户价值和完成态。
2. `Scope & Non-goals`：本次会做与明确不做的事项。
3. `Decisions`：关键取舍；小改动可写 `Direct implementation` 及原因。
4. `Behaviour`：用可验证的 Given / When / Then 描述规则、边界和失败路径。
5. `Acceptance & Evidence`：每项准出条件、所需证据类型与实际结果。
6. `Tasks & Current State`：最小可执行拆分、当前阶段、阻塞项。
7. `Delivery Snapshot`：交付时补充变更路径、验证命令/结果、已知限制和相关 SHA（如有）。

## 开发与准出

1. 先读取当前代码、已有 active change 和用户需求；新实现不得绕开已有 world / edit / worker 边界。范围清晰的小改动不阻塞于 spec：直接完成“判断 → 实现 → 测试 → 准出 → 记录”。
2. 设计默认可选。仅当范围不清、授权不足，或涉及持久化格式、世界生成/Chunk/渲染管线、公开契约、跨模块重构、不可逆数据风险时，先完成 `Decisions` 和必要设计，等待用户 review 后实现。
3. 实现后测试是必需门槛。至少运行受影响的确定性检查和项目构建；可见 UI、输入或渲染行为按 E2E 分层补充 Playwright 或 Midscene。数据与算法正确性仍应使用确定性测试，不能只以视觉 smoke 代替。
4. 将真实通过、失败或环境阻塞的证据写回 spec；静态构建、Midscene smoke、手动游玩和设备验证必须分别陈述，不能互相替代。
5. 交付前更新 `Delivery Snapshot`。未满足的准出条件保持未完成并说明最小下一步；不伪造通过。每个已完成的 change 在准出后自动执行：仅暂存该 change 的文件、创建语义化 Git commit，并推送当前分支的已配置 upstream。若无远端/upstream 或推送被拒绝，必须在 spec 中记录阻塞和最小下一步；不得自行创建远端、改写历史或强推。

## 新会话恢复

恢复时先读 `AGENTS.md`、`README.md`、最近相关的 `changes/*/spec.md`、当前 Git 状态和实际源码；spec 是需求意图与进度的权威记录，代码与测试输出是实现和验证的权威记录。
