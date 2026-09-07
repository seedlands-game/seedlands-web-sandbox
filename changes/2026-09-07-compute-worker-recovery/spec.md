# 收口 Compute Worker 永久故障恢复

**状态：** Agile flow；本地 GREEN，等待 PR 最新 head 的 GitHub Actions、review thread 与 mergeability 读回

## Context & Goal

GitHub PR #9 的自动评审指出两个 Worker 池故障路径：需要 ready 握手的 slot 在重试耗尽前不会领取任务，因此永久失败时排队任务可能永不回调；重建 Worker 一发送 ready 就清零 `restartAttempts`，会让“ready 后首个任务持续崩溃”的 Worker 无限重启。目标是让 lane 永久不可用时所有等待方确定失败，并让重试上限覆盖连续的启动/运行崩溃，避免进入游戏永久停在加载态。

## Scope & Non-goals

### Scope

- 某个 slot 重试耗尽后，仅在同 lane 已无存活或仍可恢复的 slot 时，失败该 lane 的排队任务及其依赖。
- lane 永久不可用后，新任务立即返回拒绝，不再进入无人消费的队列。
- ready 握手只标记可派发，不清零连续重启计数；成功完成任务后才清零。
- 补充 ComputeWorkerPool 的握手耗尽与 ready 后持续崩溃回归测试。

### Non-goals

- 不改变 Worker 数、lane 调度优先级、任务合并、backpressure、Wasm 选择或浏览器启动协议。
- 不增加无限 retry、热降级或新的 UI fallback。
- 不修改 GitHub 规则集、required checks 或 review 要求。

## Decisions

- 队列提供按 lane 失败排队任务的原子操作，返回被移除的根任务与依赖任务；池仍是失败回调和统计的 owner。
- 一个 slot 永久失败但同 lane 还有存活或待重启 slot 时，不丢弃该 lane 队列；只有 lane 整体不可恢复才 fail closed。
- 保留成功任务回执处的 `restartAttempts = 0`，删除 ready 回执处的清零。这样短暂启动故障可在一次真实成功后恢复预算，持续“ready→崩溃”会命中上限。
- lane 永久不可用后的新任务复用既有 `rejected/invalid-task` 返回面，由 BrowserComputeRuntime 现有 enqueue 失败路径转换为 Promise rejection 或业务失败回调，不扩大公开协议。

## Behaviour

- **Given** general slot 需要 ready 握手且在领取任务前耗尽重试，**When**已有安全出生点任务排队，**Then**任务从队列移除并收到原始 Worker 错误，等待 Promise 可拒绝而非永久悬挂。
- **Given** 一个 lane 仍有其他存活或可恢复 slot，**When**其中一个 slot 耗尽重试，**Then**保留该 lane 排队任务供其余 slot 消费。
- **Given** Worker 每次 ready 后处理首个任务都崩溃，**When**连续崩溃超过 `maxWorkerRestarts`，**Then**停止重建并报告 pool failure。
- **Given** Worker 在重建后成功完成任务，**When**之后再次崩溃，**Then**新的连续故障周期从零计数。

## Test Design

- 在 `tests/client/compute-worker-pool.test.ts` 先新增：握手超时且 `maxWorkerRestarts=0` 时，已排队 general 任务必须触发 `onFailure`、队列归零、后续 general 入队被拒绝。当前实现预期 RED：任务仍在队列且未回调。
- 在同文件先新增：`maxWorkerRestarts=1` 时，两个 Worker 依次 ready 后处理首个任务崩溃，第二次必须触发 `onPoolFailure` 且不再创建第三轮 Worker。当前实现预期 RED：ready 清零计数导致再次安排重启。
- GREEN 后执行目标 Vitest、相关队列/Runtime 测试、`pnpm verify:static:ci`、`pnpm build`；浏览器与 Midscene 为 N/A，因为本变更通过可控 FakeWorker 精确覆盖无法稳定在真实浏览器制造的启动故障，且不改变可见 UI。

## Acceptance & Evidence

- [x] **Vitest：** 两个预置失败路径由 RED 转为 GREEN，ComputeWorkerPool、ComputeTaskQueue 与 BrowserComputeRuntime 共 29/29 通过。RED：目标池文件 15 个测试中新增 2 个失败，握手耗尽时 `onFailure` 为 0 次、第二次 ready 后崩溃时 `onPoolFailure` 为 0 次，其余 13 个通过。
- [x] **Static：** `pnpm verify:static:ci` 通过：182 个测试文件通过、2 个跳过，865 个用例通过、4 个跳过；coverage statements 95.37%、branches 90.42%、functions 96.93%、lines 96.89%，Svelte / TypeScript 0 error。
- [x] **Build：** `pnpm build` 通过，Rust artifact 指纹、Svelte / TypeScript 与 Vite 生产构建均通过。
- [ ] **GitHub Actions：** 最新 PR head 的三个 required checks 全绿。
- [ ] **Review：** 两条对应 review thread 在修复说明回复后已解决，PR 无其他未解决 thread。
- [ ] **Mergeability：** PR head/base 未漂移、无冲突，GitHub 读回可合入。
- **Playwright-baseline / Playwright-change / Midscene：N/A。** 变更只涉及低层 Worker 故障状态机，FakeWorker 可确定覆盖；不新增或调整正常用户旅程与视觉表现。

## Tasks & Current State

1. [已完成] 读取两条 GitHub review thread、源码和现有测试，确认问题成立及共同修复边界。
2. [已完成] 添加握手耗尽和 ready 后持续崩溃测试，目标文件取得预期 2 RED / 13 GREEN。
3. [已完成] lane fail closed 与稳定重试计数已实现，目标测试 29/29、完整静态与生产构建 GREEN。
4. [进行中] 提交推送、回复并解决 review thread，重新核验 required checks 与 mergeability。

## Delivery Snapshot

- 评审来源：PR #9 threads `PRRT_kwDOUNKo2c6f1TUw`（P1）与 `PRRT_kwDOUNKo2c6f1TU4`（P2）。
- 当前实现证据：`recoverSlot()` 在握手耗尽时只处理 `slot.task`，而握手前任务仍在队列；`receive()` 在 ready 分支直接清零 `restartAttempts`。
- RED：`pnpm exec vitest run tests/client/compute-worker-pool.test.ts` 为新增 2 个失败、既有 13 个通过；失败分别证明排队任务未传播错误、ready 错误清零重试计数。
- 实现：ComputeTaskQueue 新增按 lane 原子失败排队任务；ComputeWorkerPool 仅在 lane 无其他可服务 slot 时传播排队失败并拒绝后续入队，ready 不再重置重试计数。
- 目标 GREEN：`pnpm exec vitest run tests/client/compute-worker-pool.test.ts tests/client/compute-task-queue.test.ts tests/client/browser-compute-runtime.test.ts` 为 29/29 通过。
- 完整 GREEN：`pnpm verify:static:ci` 为 182 个测试文件通过、2 个跳过，865 个用例通过、4 个跳过，coverage 95.37% / 90.42% / 96.93% / 96.89%；`pnpm build` 通过。
- 变更路径：`src/runtime/compute-task-queue.ts`、`src/client/compute/compute-worker-pool.ts`、`tests/client/compute-worker-pool.test.ts`。
- 提交、最终 run、review thread 与 mergeability 待补充。
