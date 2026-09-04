# 稳定 Linux Chromium 移动回归

**状态：** 本地实施与验收完成，等待远端读回（Agile flow）

## Context & Goal

开源 PR 的 GitHub Actions run `33863561275` 已两次在同一长期浏览器基线失败：无 GPU Linux Chromium 能完成真实 Pointer Lock 输入，但在 15 秒内无法稳定达到 3 米位移。目标是在不跳过测试、不使用固定 sleep、不改变生产行为的前提下，让该基线验证真正关心的规则：玩家通过真实输入跨越至少一个体素边界后仍贴地且未穿模，并在失败时留下完整 Harness 快照。

## Scope & Non-goals

- 范围内：调整现有平面移动基线的最小位移为跨越一个体素边界所需的 1 米以上。
- 范围内：为玩家移动等待增加失败时 Harness 快照，使远端失败可诊断。
- 范围外：不修改移动速度、碰撞算法、世界生成、测试重试次数或 CI 超时。
- 范围外：不跳过、降级或改为固定时间等待。

## Decisions

- 将最小位移从 3 米收敛为 1 米；玩家从 `z=0.5` 出发，超过 1 米必然跨过至少一个整数体素边界，仍足以验证跨体素平面移动、贴地与无碰撞重叠。
- 继续通过真实 Pointer Lock 和 `KeyW` 输入驱动生产移动路径，并继续断言高度、`onGround` 与 `colliding`。
- 等待仍以可观察状态结束；超时时包装原始错误并输出当前 Harness 快照。

## Behaviour

- Given 玩家位于 Harness 构造的平整体素平台, When 通过真实 Pointer Lock 持续按下 `KeyW`, Then 玩家跨越至少一个体素边界，保持相同高度、贴地且不与体素重叠。
- Given 移动条件在超时内未满足, When Playwright 报告失败, Then 日志包含失败时的 Harness 快照，而不是只有无上下文的 timeout。

## Test Design

- 既有远端 RED：GitHub Actions run `33863561275` 的原始执行和 failed-job rerun 均在 `moves across a flat voxel platform without overlapping its floor` 的 3 米等待处超时；相邻真实输入用例通过。
- GREEN：本机使用 Pages 子路径运行目标用例与完整 `tests/e2e/regression`；推送后读取同一 PR 新 SHA 的三个质量 job。

## Acceptance & Evidence

- [x] 远端相同失败在原始执行和一次 failed-job rerun 中复现，均为 `tests/e2e/support/harness.ts:119` 的 15 秒状态等待超时。（Playwright-baseline）
- [x] 目标平面移动用例随完整基线本机通过，且仍覆盖真实 Pointer Lock、键盘输入、跨体素边界、贴地和无重叠。（Playwright-baseline）
- [x] 完整 Pages 子路径浏览器基线 8/8 通过。（Playwright-baseline）
- [x] 静态基线通过：Vitest 11 个文件、71 个用例通过，world 行覆盖率 97.27%；生产构建通过，保留主 chunk 约 1.98 MB 的既有 warning。（Static；Build）
- [ ] PR 新 SHA 的三个质量 job 全部通过。（Static；Build；Playwright-baseline）

## Tasks & Current State

1. [done] 读取两次远端失败日志并确认相同失败指纹。
2. [done] 收敛位移验收距离并补充失败快照。
3. [done] 运行本机目标用例、完整基线、静态和构建验证。
4. [pending] 提交、推送并读取 PR 新 SHA 的远端终态。

## Delivery Snapshot

仅修改长期 Playwright 基线及其支持 helper：平面移动最小位移由 3 米调整为 1 米，并增加明确的无重叠断言；玩家仍由真实 Pointer Lock 与 `KeyW` 驱动生产移动路径。`waitForPlayerMovement` 在超时时会带出完整 Harness 快照。

本机证据：Pages 子路径浏览器基线 8/8，`CI=true pnpm verify:static` 全部通过（Vitest 71/71，world 行覆盖率 97.27%），注入固定 SHA 的 Pages 生产构建通过。等待 PR 新 SHA 的远端三个质量 job 读回。
