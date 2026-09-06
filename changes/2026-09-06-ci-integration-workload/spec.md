# CI 集成工作量预算

## 背景与目标

PR #7 的 GitHub Actions run `34027831088` 在 Ubuntu 24.04、Node.js 22.12.0 的完整 coverage 并发中出现 3 个测试超时。失败 run 的 head SHA 为 `89404aae380c1288b24cc50c6f92fef281c8dbc6`。这三项没有业务断言失败；问题是多个真实世界 fixture 或 61 秒批量仿真被放进单个 Vitest 默认时间预算。

目标是在不修改生产代码、不减少种子/入口/lane 断言、不提高全局超时的前提下，让每个测试声明的工作量和预算对应真实边界，并由下一轮远端 CI 完成 Ubuntu 最终验证。

## 范围与非目标

范围：

- 把流体 single edit 与 multi-edit 两套真实世界 fixture 拆为独立测试声明。
- 把 5 个初始生态种子改为 `it.each`，每个种子独立执行原有完整断言。
- 保留 `/tick 61` 跨 60 秒 Authority 内部分片和全部真实 lane 计数，为该单项批量仿真设置 30 秒预算。
- 记录原始 CI RED、定向本机结果和后续远端结果。

非目标：

- 不修改 Vitest 全局并发、全局 timeout、coverage 配置或 GitHub Actions runner。
- 不修改生产逻辑、世界生成、物理、流体、Headless 或性能门槛。
- 不删减种子、实体落点断言、交互流体优先级差异或真实 lane 计数。
- 本机 GREEN 不代替 Ubuntu coverage CI GREEN。

## 决策

采用 Agile flow 的测试组织与预算修正。CI 运行数据显示：流体失败项连续创建两套 `GameServer`，用时约 5.1 秒；同文件相邻的单套真实玩法 fixture 分别约 2.8 秒和 2.2 秒。五种子测试把五次同步世界生成放在一个 5 秒声明内。两者按独立行为案例拆分即可保留覆盖，同时消除一个测试计时器聚合多套 fixture 的偶然性。

`/tick 61` 有意跨越 `MAX_AUTHORITY_ADVANCE_MS=60_000`，实际执行 3660 个物理步、1220 个玩法周期和 1830 个流体周期；CI 用时约 15.9 秒。该用例不能缩短时间、降低 lane 频率或 mock 生产路径，因此只给这一项 30 秒有界预算。它是批量 Headless 集成测试预算，不是产品性能门槛。

## 行为

- Given single player edit 与 two-edit batch 各自从相同普通流体 backlog 开始，When 经真实 `GameServer.editBatch` 提交，Then single edit 的目标进入首批交互 frontier，two-edit batch 的目标保持普通优先级；两种行为由独立测试计时。
- Given 五个既有真实地形 seed，When 分别初始化 starter ecology，Then 每个 seed 都生成三名角色，且脚、头、支撑与 24 格半径断言全部保留。
- Given Headless `/tick 61`，When Authority 按最大 60 秒切片推进，Then 回执仍精确报告 61 秒、61000ms、3660 物理步、1220 玩法周期和 1830 流体周期；测试声明可使用 30 秒上限。
- Given 任一断言、异常或工作量失去有界性，When 测试执行，Then 仍失败；不得以 catch、skip 或全局放宽掩盖。

## 测试设计

预期 RED 已由 GitHub Actions run `34027831088` 取得：

- `tests/server/fluid-interactive-priority.test.ts:131`：默认 5000ms 超时。
- `tests/server/headless-session.test.ts:110`：显式 15000ms 超时。
- `tests/server/simulation-command-persistence.test.ts:152`：默认 5000ms 超时。
- 全轮结果：149 个文件中 3 个失败；752 项中 3 个失败、745 个通过、4 个跳过；Vitest 用时 104.33 秒。

实现后执行三个测试文件的定向 Vitest，并执行受影响文件的 Prettier、ESLint、TypeScript 与 diff check。最终远端 CI 必须重新执行完整 `pnpm verify:static`；本机不模拟或声称证明 Ubuntu runner 的最终调度结果。

## 验收与证据

| 编号 | 准出标准                                                              | 证据              |
| ---- | --------------------------------------------------------------------- | ----------------- |
| C1   | 流体 single/batch 仍走真实入口并保留相反优先级断言，每项独立有界      | Vitest            |
| C2   | 五个 seed 全部保留脚、头、支撑、半径和三角色断言                      | Vitest            |
| C3   | `/tick 61` 保留跨 60 秒分片及 3660/1220/1830 lane 精确计数            | Vitest            |
| C4   | 不改生产、全局 timeout、全局并发、coverage 或产品性能门槛             | Static、Git diff  |
| C5   | 本机定向检查通过；最终 Ubuntu coverage 完整静态检查不再发生这三项超时 | Static、GitHub CI |

C5 实际结果：提交 `68da9964a63c755776ec2c9d8f01872f0af720b7` 的 GitHub Actions run `34028250840` 中，`Static verification` job `101472989790` 为 SUCCESS；三项原超时均未复现。

## 任务与当前状态

- [x] 读取远端失败日志并定位三个同步工作量边界。
- [x] 在生产修改前记录真实 CI RED 与最小方案。
- [x] 拆分流体和多 seed 测试声明，调整 long tick 单项预算。
- [x] 执行定向测试与静态检查。
- [x] 推送后由 GitHub Actions 验证完整 coverage。

当前阶段：本机定向与 Ubuntu 完整静态检查均 GREEN；本 change 完成。

## 交付快照

变更路径：

- `tests/server/fluid-interactive-priority.test.ts`
- `tests/server/headless-session.test.ts`
- `tests/server/simulation-command-persistence.test.ts`
- `changes/2026-09-06-stable-sun-and-break-drop/ci-timeout-evidence.md`
- 本 spec。

定向 `pnpm exec vitest run` 结果为 3 个文件、28 项全部通过，退出码 0，用时 11.98 秒；日志 `/tmp/seedlands-ci-integration-workload-targeted.log`，SHA-256 为 `461eb891b6aec13c04eec2459e7db0e220b7f44f68a413d846bb7d383a98f977`。受影响文件的 Prettier、ESLint、完整 `pnpm typecheck` 和 diff check 均通过。

远端 GitHub Actions run `34028250840` 的 `Static verification` job `101472989790` 在 Ubuntu 24.04、Node.js 22.12.0 上完成完整 `pnpm verify:static`：147 个文件通过、2 个跳过；753 项测试通过、4 项跳过；Vitest 用时 101.14 秒；Svelte 0 error、0 warning，TypeScript、格式、ESLint 与 ls-lint 均通过。公开 job：<https://github.com/seedlands-game/seedlands-web-sandbox/actions/runs/34028250840/job/101472989790>。

远端原始日志保存在 `/tmp/seedlands-ci-workload-static-green.log`，SHA-256 为 `bbc6986f242bfb2e740c1c31c406b2c2abededc8bd93ee5482e19f5c6a1d13fe`。该日志仅证明 static job；随后同一 workflow 的 Production build 与 Chromium regression 也实际 SUCCESS，整个run成功，Pages部署按PR策略跳过。生产构建用时51秒，Chromium回归job用时3分22秒。

本轮没有修改生产代码、全局配置或性能门槛；生产源码与本 change 前一致。

原始失败日志保存在 `/tmp/seedlands-final-pr-ci-failure.log`；公开 run 为 <https://github.com/seedlands-game/seedlands-web-sandbox/actions/runs/34027831088>。
