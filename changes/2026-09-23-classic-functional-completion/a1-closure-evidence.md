# A1 原子事务收口证据

状态：GREEN，可作为 A1 冻结候选。
范围：仅 A1 world commit、fluid 派生队列、Station gate 与对应定向测试；不进入 A2/A3。

## 风险与最小 RED

### 1. revision / commit sequence 耗尽不得半提交

当前 `GameServer.edit`、general mutation buffer、`forUniqueCoordinates` buffer 与 accepted fluid candidate 都会先写 Chunk，再调用 `commitWorldRevision`。若 Kernel commit sequence 或 world/Chunk revision 已耗尽，后置调用可能抛错并留下 canonical 半提交。

RED：分别通过四个真实 `GameServer` 入口把 Kernel commit sequence 置为 `Number.MAX_SAFE_INTEGER`，提交一个确定会改变的 cell；期望抛出 capacity 错误，且 voxel/fluid bytes、Chunk revision/dirty、world revision、mutation count 全部不变。fluid case 还必须保留未完成 lease/work，不把异常冒充 accepted。

修复预期：所有入口先构造并验证同一 Kernel metadata participant，再在无外部 callback 的同步 apply 阶段发布 metadata 与 typed-array/Chunk 字段；capacity、Chunk revision 与 mutation count 在任何写入前验证完。

### 2. Lava overflow rescan

当前 `pumpRescans` 只把 `Voxel.Water` 放回 frontier；queue overflow 后的 Lava source 可能在 rescan 完成时被永久遗漏。

RED：`maxQueue=1` 制造真实 overflow/rescan，分别在同一 Chunk 的 index 0 放置 Water/Lava source，消费首个 lease 后请求下一 work；两种 fluid 都必须重新进入 frontier。

修复预期：rescan 复用通用 `isFluidVoxel`，不改变 bounded scan budget、queue capacity 或 Water 行为。

### 3. public single prepared Station gate

当前公开 `GameServer.prepareVoxelEdit` 直接透传 commit host，能绕过 `assertNoRawStationEdits`。但 Gameplay Block host 的 Station transaction 会先准备 Station entity/drop participant，再准备 world cell，不能被公共 gate 粗暴阻断。

RED：在真实 Classic Station fixture 中，公开 `prepareVoxelEdit` 删除已配对 station voxel 必须在 prepare 阶段拒绝且不写；既有正式 station-aware break/place transaction 仍成功并保持 entity/voxel 一致。

修复预期：公开 facade 使用 loaded-only Station gate；server-owned Gameplay world port 使用单独的受控 prepare port，继续由 Block host 的 Station participant 做联合 validate/apply。客户端或普通 public caller 不获得 bypass token。

### 4. object/prepared cardinality 与 bounds

object/prepared batch 当前无数量上限，且 receipt bounds 用 `Math.min(...array)` / `Math.max(...array)`，可在大数组上先耗尽参数栈或内存。Fill 已通过 mutation buffer 有独立 `MAX_FILL_VOXELS=1_000_000` 合同，不应被 object 限额破坏。

RED：immediate object batch 与 prepared expected batch 均在 `MAX_WORLD_EDIT_BATCH_EDITS + 1` 时于读取 Chunk 前稳定拒绝；上限内跨坐标 batch 仍生成正确 bounds；现有 100k/1M Fill buffer 路径保持原合同。

修复预期：object/prepared 共享显式有界常量并在分配 planner maps 前检查；bounds 改为迭代归约，不使用 variadic spread。buffer 路径保留自己的 Fill 上限和热路径。

### 5. sparse metrics 与 unique buffer 信任边界

immediate sparse edit array 为既有兼容输入，`forEach` 会跳过 hole，但当前 metrics 使用数组 `length`，会报告并未处理的 mutation。`WorldMutationBuffer.forUniqueCoordinates` 又是公开 stdlib export，当前只声明 uniqueness 而不验证，错误 caller 可让 unique fast path 重复计数同一 cell。

RED：长度 1 的全 hole immediate batch 保持 no-op，但 `inputMutationCount`、payload/capacity bytes 必须为 0；公开 unique buffer 对同一 coordinate 写两次必须在 canonical 写入前拒绝，世界与 revision 不变。

裁决：保留 sparse immediate 的既有 no-op 兼容，只修 metrics 为实际枚举输入数。unique factory 属于公共信任边界，不能仅信任命名；在 commit planning 阶段按 Chunk/local index 验证唯一性，避免给 1M Fill 的每次 `write()` 增加全局 Set。

## 验证计划

- 新 RED：world capacity 四入口、Lava overflow rescan、public Station prepared gate、object/prepared cardinality、sparse metrics、伪 unique buffer。
- 回归：A1 stdlib suites、相关 Station Web integration、Web prepared-world-edit。
- 静态：`@seedlands/stdlib` typecheck、A1 targeted ESLint/Prettier、`git diff --check`。
- 所有重负载命令经 `node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- ...` 串行执行，Vitest `maxWorkers=1`。

## 首轮 RED

命令均通过 `node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- ...` 串行执行。

- stdlib 三文件首轮：`3 failed / 54 tests，10 failed / 44 passed`。
- single/general/unique 在 Kernel capacity 抛错后均已改变目标 voxel；accepted fluid candidate 也先写了 voxel/fluid。
- Chunk revision exhaustion 未被 single/general/unique 拒绝。
- Lava overflow rescan 的下一次 `requestFluidWork()` 返回 `undefined`，Water control 正常。
- oversized immediate object batch 未拒绝；prepared oversized 在读取/规划后才因测试 stub 缺口失败。
- sparse empty array metrics 错报 `inputMutationCount=1`、payload/capacity `14`。
- false unique-coordinate buffer 未拒绝。
- Station 首轮 8 个用例在 fixture 缺少 Air/普通 voxel semantics 时提前被注册校验阻断；补齐 fixture 自有 `0/3/10` semantics 后，public prepared gate 得以真实执行。

## GREEN 与裁决

1. `PreparedWorldCommitMetadata` 现在被 single、prepared single、general buffer、unique buffer、accepted fluid candidate 共用。world/Chunk/mutation/commit capacity 在写前检查；metadata 先同步发布，之后仅执行已验证的 typed-array 与 Chunk 字段赋值。Kernel commit sequence、world revision、Chunk revision 三类 exhaustion 均覆盖真实入口并保持零写；fluid lease 在拒绝后仍在途，可 abort 后返回 frontier。
2. overflow rescan 改用 `isFluidVoxel`，Water/Lava source 对称恢复，扫描预算与 queue 上限不变。
3. public `GameServer.prepareVoxelEdit` 通过 loaded-only Station gate；Gameplay host 的 server-owned closure 直接使用私有 commit host，合法 Block Station participant 继续联合提交。Station integration 8/8 证明 place/break、entity/voxel 与存档行为未回归。
4. object/prepared batch 共享 `MAX_WORLD_EDIT_BATCH_EDITS=65_536`，并在 Station/fluid/Chunk 读取和 planner 分配前拒绝；bounds 改为迭代归约。1,000,000 voxel Fill 继续走 mutation buffer 专用路径且 control 通过。
5. sparse immediate 输入继续兼容 hole/no-op，metrics 改按实际枚举 edit 数；公开 `forUniqueCoordinates` 声明在 unique planner 中按每 Chunk local index 验证，重复 coordinate 在任何写入前拒绝。

buffer object/general/unique 与 single prepared 都直接提交 canonical fluid byte；fluid active-window/frontier/rescan 使用预规划状态，提交后不再依赖可能抛错的查询式 sidecar 回调。计时 `now()` 在 commit 后失败只降级为已捕获时间，不把成功提交报告成失败。

## 最终验证

- stdlib：`world-transaction-atomicity`、`world-mutation-transaction`、`prepared-world-edit-batch`、`fluid-transaction`、`world-collision-delta`、`fluid-edit-effect-plan`，`6 files / 65 tests passed`，`maxWorkers=1`。
- Web：`gameplay-block-stations`、`prepared-world-edit`，`2 files / 16 tests passed`，`maxWorkers=1`。
- `pnpm --filter @seedlands/stdlib typecheck`：通过。
- A1 targeted ESLint：通过。
- A1 targeted Prettier：通过。
- `git diff --check`：通过。
- 未执行：build、browser/dev server、全仓测试、CI、部署。

最终命令：

```text
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec vitest run --config packages/stdlib/vitest.config.ts packages/stdlib/tests/server/world-transaction-atomicity.test.ts packages/stdlib/tests/server/world-mutation-transaction.test.ts packages/stdlib/tests/server/prepared-world-edit-batch.test.ts packages/stdlib/tests/server/fluid-transaction.test.ts packages/stdlib/tests/server/world-collision-delta.test.ts packages/stdlib/tests/server/fluid-edit-effect-plan.test.ts --maxWorkers=1
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/tests/integration/runtime/server/composition/gameplay-block-stations.test.ts apps/web/tests/integration/runtime/server/prepared-world-edit.test.ts --maxWorkers=1
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm --filter @seedlands/stdlib typecheck
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec eslint <A1 targeted files>
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec prettier --check <A1 targeted files and this evidence>
git diff --check
```

关键 SHA-256：

```text
world-edit-batch-plan.ts             440df944ea525cea42d1f83d2c06a87441856a2fb560dd1292035cf6f5d8ab3c
world-transaction-commit.ts          8eeb7d6c6e030c4596a6b034d5c019695c616112e13ab798704a9f1ab830a407
world-edit-runtime.ts                6b0773c2f66d1490d8e703728ec65773dbc69f8fd928c0532604e06029d49291
single-world-edit.ts                 9c68ea8292c980941de19222493ff79b689e1be8ea12e2cee3d9b889a41b07f7
prepared-world-edit.ts               680a2abe2d20d2595e60f9a6c8ab4f42c4d33f6ed55d4e99c34b153da2a762c3
fluid-edit-sidecars.ts               bc9571017db4f34e9ed95737f4749788db3aa79e4184f0ed8ff0a9f6bfba7be9
fluid-transaction.ts                 1e08e8c75163c41843e17db5dd053ecf88498478841a8cdd560bd93e4a0946ba
fluid-candidate-commit.ts            fa90342bf1677ca1e85fe85ab16eaf7b2aee61de01c23e8a5b7a3e4d0893bcba
server-world-commit-host.ts          b9367a30d43ef5c866f780aca8bd13bd39f4b105ff453d33b3146aaff9ed4fe6
game-server-world-commit-adapter.ts  c7cda558024dcf7d7e50d7fe1dac2cea039993e45874b6bffbb434eb5c3e0936
game-server.ts                       e2ef7249cc9166a3bcc1f5ee750d4c762464fa8ed754abf0c95014b980d8d0c2
world-transaction-atomicity.test.ts  bffc3a0de2c70c8601560bc8edb271bbd66f65923e93db1d7996a1fa087b9866
prepared-world-edit-batch.test.ts    04baf3bd427894f4b87864fe8f2921479a1d38207ee63f7a909a868d82a58a5e
fluid-transaction.test.ts            24b97c067bb8e00057b1baba38ec11f675839027ce6bff31d709fa5896424a6a
gameplay-block-stations.test.ts      95997f1d9e2f6bf90cde7c5cbd5936ce8f466b2292c7183d7d2ff232eac42b14
```

进程审计：最终 `ps` 只匹配审计命令自身及 `rg`，无遗留 benchmark-window、Vitest 或 TypeScript 进程；每个 benchmark-window 命令均已正常退出，未留下本 worker 持有的锁。阶段墙钟约 25 分钟；token/credits/API 费用不可从当前工具可靠读取。

残余风险：`MAX_WORLD_EDIT_BATCH_EDITS=65_536` 是控制平面 object-edit 的安全上限，不是性能收益声明；未来若真实 consumer 需要更大 object batch，应迁移至已有 mutation buffer，而不是放宽 AoS planner。
