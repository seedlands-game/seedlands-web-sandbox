# 稳定 Linux Chromium 移动回归

**状态：** 本地实施与验收完成，等待主干整合与远端读回（Agile flow）

## Context & Goal

开源 PR 的 GitHub Actions run `33863561275` 已两次在同一长期浏览器基线失败：无 GPU Linux Chromium 能完成真实 Pointer Lock 输入，但在平面夹具同步写入体素后，下一渲染帧的 `dt` 包含了这段主线程阻塞，垂直移动一步跨过了地面。目标是在不跳过测试、不使用固定 sleep、不改变正常游戏行为的前提下，让 Harness 在夹具写入后的稳定帧重置玩家，再按原有 3 米距离验证真实移动、贴地与无穿模，并在等待失败时留下完整快照。

## Scope & Non-goals

- 范围内：让三个受控地形夹具在同步体素写入后的下一浏览器帧重置玩家位置、速度与贴地状态，避免把夹具构造耗时计入玩家物理步长。
- 范围内：为玩家移动等待增加失败时 Harness 快照，使远端失败可诊断。
- 范围外：不修改正常游戏的移动速度、碰撞算法、世界生成、测试重试次数或 CI 超时。
- 范围外：不跳过、降级或改为固定时间等待。

## Decisions

- 保留原有 3 米最小位移；继续通过真实 Pointer Lock 和 `KeyW` 输入驱动生产移动路径，并显式断言高度、`onGround` 与 `colliding`。
- Harness 地形写入结束后等待一个 `requestAnimationFrame` 回调，再重置玩家状态；这是基于浏览器渲染边界的状态同步，不是固定 sleep，也不放宽生产物理规则。
- 等待仍以可观察状态结束；超时时包装原始错误并输出当前 Harness 快照。

## Behaviour

- Given Harness 同步构造受控地形, When 写入完成, Then 先越过一个浏览器帧边界再重置玩家状态，夹具构造耗时不会成为下一次玩家物理步长。
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
- [x] 静态基线通过：Vitest 11 个文件、71 个用例通过，world 行覆盖率 97.27%；生产构建通过，保留主 chunk 约 1.98 MB 的既有 warning。（Static；Build）
- [ ] PR 新 SHA 的三个质量 job 全部通过。（Static；Build；Playwright-baseline）

## Tasks & Current State

1. [done] 读取两次远端失败日志并确认相同失败指纹。
2. [done] 将 Harness 状态重置移至夹具写入后的浏览器帧，并补充失败快照。
3. [done] 运行本机目标用例、完整基线、静态和构建验证。
4. [pending] 提交、推送并读取 PR 新 SHA 的远端终态。

## Delivery Snapshot

在三个 Harness 地形夹具完成同步体素写入后等待下一次 `requestAnimationFrame`，再重置玩家位置、速度与贴地状态；正常游戏路径不受影响。平面移动用例保留 3 米真实输入要求并增加 `colliding=false` 断言，移动等待超时时会输出完整 Harness 快照。

旧基线本机证据：Pages 子路径浏览器基线 8/8，`CI=true pnpm verify:static` 全部通过（Vitest 71/71，world 行覆盖率 97.27%），注入固定 SHA 的 Pages 生产构建通过。检测到本地 `main` 已包含世界事务与应用模块拆分，后续必须先将本修复迁移到该新模块边界并重新验收，再作为 PR 新 SHA 的远端证据。
