# 稳定低配 GitHub Runner 的静态与浏览器门禁

**状态：** Agile flow；远端 RED 已修复，本地 GREEN，等待 PR 最新 head 的 GitHub Actions 与 mergeability 读回

## Context & Goal

GitHub PR #9 的首个最新 revision run `34098525614` 在 Production build 通过后，Static verification 与 Chromium regression 因低配 runner 上的资源敏感路径超时失败。本地相同提交的完整静态检查和 8 项 Chromium 回归均通过。目标是保持既有业务断言和必需门禁不变，只让 CI 使用受控并发，并让机器相关的 Macro 采样与低核心提示走确定性测试路径。

## Scope & Non-goals

### Scope

- 新增 CI 专用的 Vitest coverage / static 命令，将并发 Worker 固定为 2；本地默认命令不变。
- GitHub Static verification job 使用 CI 专用入口，job 名和分支保护 context 不变。
- Macro 地图基线仍等待 `data-status=ready`，但给低配 runner 足够的真实完成时间。
- 存档回归刷新后重新通过公共 `startHarnessWorld()` 进入，以复用生产低核心警告的明确确认路径。

### Non-goals

- 不跳过、隔离或放宽任何算法/字节/状态等价断言。
- 不增加盲目 retry，不禁用低核心性能警告，不改生产 Worker 数或运行算法。
- 不修改 GitHub required checks、规则集、权限或 reviewer 要求。

## Decisions

- 受控并发只用于 `verify:static:ci`，避免为了 GitHub runner 降低本地开发者的默认并行度。
- 选择 2 个 Vitest workers：本地 4 workers 已证明完整 suite 可通过，GitHub 首轮并行执行仍导致 6 个重型用例超时；2 workers 为当前 runner 保留更稳定的单用例 CPU 预算。
- Macro 地图仍以可观察 `ready` 为完成条件，单次测试上限改为 90 秒、每层等待 45 秒，不使用固定 sleep。
- 存档刷新测试不伪造核心数，而是继续允许生产警告出现并由公共 helper 明确点击“仍然进入”。

## Behaviour

- **Given** GitHub 低配 runner，**When**执行 Static verification，**Then**最多并发 2 个 Vitest workers，全部原断言必须通过。
- **Given** Macro 地图在较慢 CPU 上采样，**When**状态仍为 `sampling`，**Then**测试继续观察，直到 45 秒内进入 `ready`；未完成仍失败。
- **Given** runner 核心数低于 Worker 需求，**When**存档测试刷新后进入世界，**Then**公共 helper 明确确认警告并继续验证持久化，不绕过产品行为。

## Test Design

- 预期 RED：GitHub Actions run `34098525614` 的 Static verification 有 6 个不同重型用例超时；Chromium regression 的 Macro 地图在 `sampling` 超时，存档回归刷新后 `#debug` 隐藏且低核心提示未处理。
- GREEN：本地执行 `pnpm verify:static:ci`、`pnpm test:e2e:regression` 和 `pnpm build`；推送后只接受新 head SHA 对应的三个 required checks。

## Acceptance & Evidence

- [x] **Static：** `pnpm verify:static:ci` 全部通过：182 个文件通过、2 个跳过，863 个用例通过、4 个跳过；coverage statements 95.37%、branches 90.42%、functions 96.93%、lines 96.89%，Svelte / TypeScript 0 error。
- [x] **Playwright-baseline：** `pnpm test:e2e:regression` 为 8/8 通过；Macro 仍按 `ready` 判断，存档仍验证生产 Store 路径并通过公共 helper 确认低核心警告。
- [x] **Build：** `pnpm build` 通过，Rust artifact 指纹、Svelte / TypeScript 和 Vite 生产构建均通过。
- [ ] **GitHub Actions：** 最新 PR head 的 Static verification、Production build、Chromium regression 全绿。
- [ ] **Mergeability：** PR 无冲突、无未解决 review thread，GitHub 读回可合入。

## Tasks & Current State

1. [已完成] 读取 run `34098525614` 的 job 日志并区分资源超时、产品行为与依赖失败。
2. [已完成] 新增 CI 专用 Vitest 并发入口，修复 Macro 与存档回归的确定性等待/确认路径。
3. [进行中] 本地复验已完成；提交、推送并只跟踪新 head SHA。

## Delivery Snapshot

- RED：GitHub Actions run `34098525614`，Production build 通过；Static verification 因 6 个重型测试超时失败，Chromium regression 因 Macro 采样超时和刷新后的低核心提示未确认失败。
- 实现：`package.json` 新增 `test:coverage:ci` / `verify:static:ci`，`.github/workflows/ci.yml` 保持 `Static verification` job/context 名不变并切换到 CI 入口；Macro 只扩展可观察状态等待；存档测试复用 `startHarnessWorld()`。
- 本地 GREEN：`pnpm verify:static:ci`、`pnpm test:e2e:regression`、`pnpm build` 全部通过。
- 未改变必需检查、规则集、retry、业务算法、Worker 数或产品低核心警告；远端最终 run、head SHA 与 mergeability 待推送后补充。
