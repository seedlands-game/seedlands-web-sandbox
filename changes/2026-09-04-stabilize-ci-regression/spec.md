# 稳定 Linux Chromium 移动回归

**状态：** 已完成（Agile flow）

## Context & Goal

开源 PR 的 GitHub Actions run `33863561275` 已两次在同一长期浏览器基线失败。初始日志只有 3 米等待超时；加入失败快照并整合本地 `main` 后，run `33865323428` 显示玩家的 `z` 只变化约 1.5 米，却沿 `x` 轴移动约 12 米并离开仅宽 5 格的平台。根因是 Linux Chromium 取得 Pointer Lock 时的鼠标 delta 改变了 yaw，而测试隐含假设锁定后仍朝固定 z 方向。目标是在成功锁定真实指针后显式恢复受控视角，再保留原有 3 米移动、贴地与无穿模合同。

## Scope & Non-goals

- 范围内：在依赖固定方向的移动用例取得 Pointer Lock 后，通过现有 Harness 显式设置 yaw/pitch，再发送真实键盘输入。
- 范围内：为玩家移动等待增加失败时 Harness 快照，使远端失败可诊断。
- 范围外：不修改移动速度、碰撞算法、世界生成、平台尺寸、测试重试次数或 CI 超时。
- 范围外：不跳过、降级或改为固定时间等待。

## Decisions

- 保留原有 3 米最小位移；继续通过真实 Pointer Lock 和 `KeyW` 输入驱动生产移动路径，并显式断言高度、`onGround` 与 `colliding`。
- Pointer Lock 本身仍由真实 canvas click 取得；只有锁定成功后才调用现有 `setView(0, 0)` 恢复测试定义的移动方向，不绕过键盘输入或玩家控制器。
- 等待仍以可观察状态结束；超时时包装原始错误并输出当前 Harness 快照。

## Behaviour

- Given Linux Chromium 在取得 Pointer Lock 时产生了鼠标 delta, When 测试即将发送方向键, Then 先把受控视角恢复为 yaw 0、pitch 0，使 `KeyW/KeyS` 沿夹具定义的 z 轴运动。
- Given 玩家位于 Harness 构造的平整体素平台, When 通过真实 Pointer Lock 持续按下 `KeyW`, Then 玩家移动至少 3 米，保持相同高度、贴地且不与体素重叠。
- Given 移动条件在超时内未满足, When Playwright 报告失败, Then 日志包含失败时的 Harness 快照，而不是只有无上下文的 timeout。

## Test Design

- 既有远端 RED：GitHub Actions run `33863561275` 的原始执行和 failed-job rerun 均在 `moves across a flat voxel platform without overlapping its floor` 的 3 米等待处超时；相邻真实输入用例通过。
- 诊断 RED：run `33864308334` 将距离暂时收敛到 1 米后，三次均读到玩家跌落；最终恢复 3 米合同并加入快照后，run `33865323428` 三次分别显示玩家沿 `x` 到达约 `-12`、沿 `z` 只到约 `-1`，证明是锁指针时视角偏转后离开平台，而非水平输入未生效。
- GREEN：本机使用 Pages 子路径运行目标用例与完整 `tests/e2e/regression`；推送后读取同一 PR 新 SHA 的三个质量 job。

## Acceptance & Evidence

- [x] 远端相同失败在原始执行和一次 failed-job rerun 中复现，均为 `tests/e2e/support/harness.ts:119` 的 15 秒状态等待超时。（Playwright-baseline）
- [x] 目标平面移动用例随完整基线本机通过，且仍覆盖真实 Pointer Lock、键盘输入、3 米移动、贴地和无重叠。（Playwright-baseline）
- [x] 完整 Pages 子路径浏览器基线 8/8 通过。（Playwright-baseline）
- [x] 合并本地 `main` 后静态基线通过：Vitest 15 个文件通过、1 个跳过，97 个用例通过、3 个跳过，world 行覆盖率 97.27%；生产构建通过，保留主 chunk 约 2.00 MB 的既有 warning。（Static；Build）
- [x] PR head `2d572420c7386995c253073f29b4bb21b76b488b` 的 GitHub Actions run `33865718194` 三个质量 job 全部通过：Static verification 38 秒、Production build 32 秒、Chromium regression 1 分 52 秒。（Static；Build；Playwright-baseline）

## Tasks & Current State

1. [done] 读取两次远端失败日志并确认相同失败指纹。
2. [done] 增加失败快照，依次排除依赖安装、输入未生效与物理步长假设，定位为 Pointer Lock 后 yaw 偏转。
3. [done] 在依赖固定方向的真实输入用例中于锁定后恢复受控视角，并重新运行本地验收。
4. [done] 提交、推送并读取 PR 新 SHA 的远端终态。

## Delivery Snapshot

冲突裁决以本地 `main` 的模块化架构为准，旧单体分支上的 Harness 等帧实现未迁移。失败快照最终证明根因是 Pointer Lock 后的 yaw 偏转；最终实现会在锁定成功后使用既有 Harness 恢复受控视角，同时保留真实 `KeyW/KeyS`、3 米位移、贴地与 `colliding=false` 断言。

最终本机证据：Pages 子路径长期浏览器基线 8/8；`CI=true pnpm verify:static` 全部通过（Vitest 97 个通过、3 个跳过，world 行覆盖率 97.27%）；注入固定 SHA 的 Pages 生产构建通过。app-module 历史 change 的 2 条用例在其原始根路径合同下 2/2 通过；将其与 Pages base path 强行组合时，旧用例按预期拒绝子路径样式 URL，因此未篡改已交付历史用例，Pages 子路径继续由本 change 的专属用例验证并通过。

远端证据：PR head `2d572420c7386995c253073f29b4bb21b76b488b` 的 run `33865718194` 在 GitHub-hosted Ubuntu/Chromium 环境中三个质量 job 全绿，证明视角归一化修复覆盖了此前连续复现的 Linux 失败。
