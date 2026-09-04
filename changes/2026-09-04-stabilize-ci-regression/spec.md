# 稳定 Linux Chromium 移动回归

**状态：** 本地主干整合与验收完成，等待远端读回（Agile flow）

## Context & Goal

开源 PR 的 GitHub Actions run `33863561275` 已两次在同一长期浏览器基线失败：无 GPU Linux Chromium 能完成真实 Pointer Lock 输入，但在平面夹具同步写入体素后，下一渲染帧的 `dt` 包含了这段主线程阻塞，垂直移动一步跨过了地面。本地 `main` 随应用模块拆分已将传入玩家物理的 `dt` 上限收敛为 0.05 秒，因此整合主干时应保留该通用低帧保护、丢弃旧单体实现上的临时 Harness 等帧方案，并让测试保留原有 3 米真实移动合同和更完整的失败证据。

## Scope & Non-goals

- 范围内：整合本地 `main` 已有的物理 `dt` 上限，让夹具构造或低帧渲染不会产生跨地面的单步移动。
- 范围内：为玩家移动等待增加失败时 Harness 快照，使远端失败可诊断。
- 范围外：不在重构后的模块上叠加专用等帧方案，不修改移动速度、碰撞算法、世界生成、测试重试次数或 CI 超时。
- 范围外：不跳过、降级或改为固定时间等待。

## Decisions

- 保留原有 3 米最小位移；继续通过真实 Pointer Lock 和 `KeyW` 输入驱动生产移动路径，并显式断言高度、`onGround` 与 `colliding`。
- 使用本地 `main` 在 `Game.start()` 注册更新回调时已有的 `Math.min(dt, 0.05)`，它同时保护普通低帧与 Harness 写入场景；不保留旧单体分支的 `requestAnimationFrame` 特判。
- 等待仍以可观察状态结束；超时时包装原始错误并输出当前 Harness 快照。

## Behaviour

- Given 主线程因夹具构造或低帧渲染产生较长帧间隔, When 更新玩家物理, Then 使用不超过 0.05 秒的步长，玩家不会单步跨过地面。
- Given 玩家位于 Harness 构造的平整体素平台, When 通过真实 Pointer Lock 持续按下 `KeyW`, Then 玩家移动至少 3 米，保持相同高度、贴地且不与体素重叠。
- Given 移动条件在超时内未满足, When Playwright 报告失败, Then 日志包含失败时的 Harness 快照，而不是只有无上下文的 timeout。

## Test Design

- 既有远端 RED：GitHub Actions run `33863561275` 的原始执行和 failed-job rerun 均在 `moves across a flat voxel platform without overlapping its floor` 的 3 米等待处超时；相邻真实输入用例通过。
- 诊断 RED：新 SHA 的 run `33864308334` 将距离暂时收敛到 1 米后，等待能够结束，但三次均读到玩家从 `y=58.6` 跌至约 `y=44–45`，证明失败来自夹具写入后的过大物理步长，而非水平输入未生效；最终实现恢复 3 米合同。
- GREEN：本机使用 Pages 子路径运行目标用例与完整 `tests/e2e/regression`；推送后读取同一 PR 新 SHA 的三个质量 job。

## Acceptance & Evidence

- [x] 远端相同失败在原始执行和一次 failed-job rerun 中复现，均为 `tests/e2e/support/harness.ts:119` 的 15 秒状态等待超时。（Playwright-baseline）
- [x] 目标平面移动用例随完整基线本机通过，且仍覆盖真实 Pointer Lock、键盘输入、3 米移动、贴地和无重叠。（Playwright-baseline）
- [x] 完整 Pages 子路径浏览器基线 8/8 通过。（Playwright-baseline）
- [x] 合并本地 `main` 后静态基线通过：Vitest 15 个文件通过、1 个跳过，97 个用例通过、3 个跳过，world 行覆盖率 97.27%；生产构建通过，保留主 chunk 约 2.00 MB 的既有 warning。（Static；Build）
- [ ] PR 新 SHA 的三个质量 job 全部通过。（Static；Build；Playwright-baseline）

## Tasks & Current State

1. [done] 读取两次远端失败日志并确认相同失败指纹。
2. [done] 在旧单体分支验证等帧方案与失败快照；整合本地 `main` 时发现其通用 `dt` 上限已覆盖根因，丢弃冗余特判并保留诊断增强。
3. [done] 在合并后的新模块边界重新运行目标用例、完整基线、静态和构建验证。
4. [pending] 提交、推送并读取 PR 新 SHA 的远端终态。

## Delivery Snapshot

冲突裁决以本地 `main` 的模块化架构为准：玩家控制保留在 `player-controller.ts`，`game.ts` 以 0.05 秒上限向其传递 `dt`，因此旧单体分支上的 Harness 等帧实现不再迁移。平面移动用例保留 3 米真实输入要求并增加 `colliding=false` 断言，移动等待超时时会输出完整 Harness 快照。

合并后的本机证据：Pages 子路径长期浏览器基线 8/8；`CI=true pnpm verify:static` 全部通过（Vitest 97 个通过、3 个跳过，world 行覆盖率 97.27%）；注入固定 SHA 的 Pages 生产构建通过。app-module 历史 change 的 2 条用例在其原始根路径合同下 2/2 通过；将其与 Pages base path 强行组合时，旧用例按预期拒绝子路径样式 URL，因此未篡改已交付历史用例，Pages 子路径继续由本 change 的专属用例验证并通过。
