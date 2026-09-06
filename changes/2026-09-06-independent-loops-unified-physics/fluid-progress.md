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

## 跨 Chunk 撤源依赖闭包修订（2026-09-06）

### 复现与根因

- 只读审查夹具 `/tmp/seedlands-fluid-review.test.ts` 曾实际 RED：`x=29..33,y=5,z=5` 的流水由 `x=33` 源供给，撤除 `x=28` 的另一个源后，旧清理搜索越过租赁的一跳读集，把未知 Chunk 当作无源并错误删除 `[29,5,5]`。
- 旧实现还把同一水体组件的多跳搜索分别放在 Authority 与候选计算中，既重复计算，又让 Authority 承担了不应有的流体求解工作。
- 局部收敛试验定位到另一处实际根因：非源水位改变后未重新激活其相邻格。封闭沟槽内 `[6,5,5]` 从 7 级降到 5 级后，`[7,5,5]` 没有进入下一批，形成假稳定水位链；补齐相邻格激活后，有限批次会继续收敛至退水。

### 修订决策

- 删除撤源时的全连通备用源搜索。`removeSource()` 仅把相邻格放入普通 `frontier`；`cleanupFrontier` 保持既有协议兼容，但候选按相同的局部松弛规则处理，不再触发独立清理算法。
- 候选只读取本格、上/下格和四个水平邻格。一跳依赖缺失时，若计算结果会使非源水位降低或删水，则保留原水位并重新排队；未知绝不等同于无供水。已知局部供水可以使水位提高。
- 每次非源水位变化均激活相邻格，使有限批次继续传播真实变化，而不是依赖一次性清空组件的旧捷径。

### 本轮 GREEN 证据

- `pnpm exec vitest run tests/server/fluid-transaction.test.ts tests/server/voxel-fluid-runtime.test.ts`：通过，2 个测试文件、28 个用例。新增覆盖：跨 Chunk 一跳读集、未加载边界保留并在加载后恢复、未知更强邻居不降水、唯一撤源有限收敛、队列满后的分片重扫。
- `pnpm exec vitest run --config /tmp/seedlands-fluid-review.config.mjs`：通过。该夹具的候选读集仅为 `0,0,0`，且不会写入删除 `[29,5,5]` 的候选。
- `git diff --check`：通过。
- `pnpm verify:static`：通过；73 个测试文件通过、2 个跳过，333 个测试通过、4 个跳过；格式、ESLint、路径规则、V8 coverage 与 TypeScript 均通过。
- `pnpm build`：通过；保留既有主 bundle 大于 500 kB 的 Vite 提示，未作为失败。
