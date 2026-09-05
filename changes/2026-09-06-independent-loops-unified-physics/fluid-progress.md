# 流体事务实现记录

## 已冻结接口

`FluidAuthoritySnapshot` 与 `FluidCandidate` 都携带 `protocolVersion: 1`、`epoch` 和 `workId`。候选还必须携带 `consumedFrontier`、逐 Chunk `readSet`、逐 cell 的预期旧值/新值、`nextFrontier` 与 `needsRescan`。

Authority 入口固定为 `requestFluidWork()`、`commitFluidCandidate(candidate)` 和 `abortLease(workId, reason)`；接纳结果只会是 `epoch`、`work-id`、`read-set` 或 `cell-conflict` 拒绝，或带 `commitSequence` 的成功。Worker 传输外壳固定为 `fluid-compute` / `fluid-result`，由运行时整合模块维护，不在本模块实现。

## RED 证据

- 2026-09-06：`pnpm exec vitest run tests/server/fluid-transaction.test.ts`，失败：`Cannot find module '../../src/server/fluid/fluid-transaction'`。这是新增候选/租赁事务用例在实现前的预期 RED。

## 当前状态

- 已完成纯快照候选、单在途租赁、逐 Chunk 完整读集、逐 cell 冲突验证和有界重扫。队列满、缺失快照、过期结果与 Worker 中断都会归还租赁或建立带游标的重扫任务；每个候选最多处理 128 项，清理最多占其中 64 项，为常规 frontier 保留容量。
- 已将 `GameServer.advanceFluid()` 的兼容入口接到候选原子接纳：每个受影响 Chunk 每个候选只推进一次 revision。单格、批量与 `WorldMutationBuffer` 的水位侧车和撤源路径共用同一激活/清理逻辑。
- 旧的同步 `advanceFluid()` 仅是旧 API 兼容适配，最终独立时钟与 Worker Pool 必须使用已冻结的 `requestFluidWork()` / `commitFluidCandidate()` / `abortLease()` 协议。

## GREEN 与准出证据

- 2026-09-06：`pnpm exec vitest run tests/server/fluid-transaction.test.ts tests/server/voxel-fluid-runtime.test.ts` 通过，23 个用例。覆盖快照纯计算、逐 Chunk/逐 cell 拒绝、租赁归还、队满有界重扫、清理配额、批量/缓冲区侧车、跨 Chunk 单次 revision 及双源撤一源后的稳定供水。
- 2026-09-06：`pnpm test` 通过，73 个测试文件通过、2 个跳过；328 个测试通过、4 个跳过。
- 2026-09-06：`pnpm verify:static` 通过；包含格式、ESLint、路径规则、V8 coverage 与 TypeScript。
- 2026-09-06：`pnpm build` 通过。Vite 仍报告既有主 bundle 大于 500 kB 的提示，未作为失败。
- 2026-09-06：`git diff --check` 通过。
