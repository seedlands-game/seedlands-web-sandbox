# A1-R2 Closing Review

结论：原 P1、P2 均为 **CLOSED**。在本次窄范围内未发现修复直接引入的 P0/P1/P2；该结论只关闭 `a1-closure-review.md` 的两项 finding，不外推为完整 change、CI、构建或浏览器验收。

## Review Identity

- 冻结 HEAD：`800c13c4`（按 root 提供的 capsule identity；本轮未执行 Git 命令）。
- 审阅对象：`/tmp/seedlands-a1-r2-review-4decc58b` 的 10 个 R2 实现/测试文件；`manifest.json` SHA-256 为 `dee1ace4a08e46df71a7ad1d913154942391b386361d81a40d03521359071b51`。逐文件复算 SHA-256 全部与 manifest 匹配。
- R2 证据：`a1-close-r2-evidence.md` SHA-256 为 `832645f6f137c632cbb5b12c958f2a2eff08ebbb446753b8820864f7d17938c8`。原 review 保持未修改。
- 必要相邻依赖从当前树只读，并在读取前记录 SHA-256：`fluid-edit-effect-plan.ts=0f27ab...0aaf`、`fluid-priority-frontier.ts=ea4208...f04`、`fluid-transaction-runtime.ts=a874f5...b04`、`server-world-commit-host.ts=b9367a...4fe6`、`game-server.ts=e2ef72...8d0c2`、`prepared-world-commit-metadata.ts=7b0124...b9b6`。这些值与原 A1 冻结快照/证据中对应文件一致，未观察到相邻依赖漂移。

## Closing 判定

### 原 P1：CLOSED

1. **Normalization 前 fail-closed。** `fluid-candidate-validator.ts:48-82` 只接受原型为 `Object.prototype/null` 的 data record 和原型为 `Array.prototype` 的精确 dense array，通过 `Reflect.ownKeys` 与 data descriptor 读取拒绝 accessor、未知键、sparse/额外属性和自有 `forEach`；整个 normalization 位于 `try/catch`（`:149-220`）。`fluidCandidateWorkId` 也只读 data descriptor（`:137-147`）。因此原报告的自有 `forEach`/getter 触发不会进入 world read 或 canonical apply。
2. **Normalization 后不再持有外部 candidate。** `normalizeFluidCandidateResult` 重建并冻结 position、read-set entry、cell write、各数组和顶层 record（`:84-121,163-217`）。`FluidTransactionAuthority.commitFluidCandidate` 从 `fluid-transaction.ts:422` 起只使用该 authority-owned 副本；外部对象在 canonical apply 期间被改写也不影响后续逻辑。
3. **所有可能失败的 settlement/receipt 准备均在 apply 前。** queue/frontier/cleanup/rescan 的克隆、容量处理与 rescan 构造在 `fluid-candidate-settlement.ts:14-32` 完成；accepted receipt 在 `fluid-transaction.ts:453-455` 预先冻结。canonical receipt、collision delta、bounds 和 metadata validation 在 `fluid-candidate-commit.ts:35-116` 完成，之后才执行 metadata/canonical bytes apply（`:117-127`）。
4. **Canonical apply 后没有外部 candidate 读取或调度构造。** authority 在 `fluid-transaction.ts:456-465` 的 post-apply 段只交换已准备的内部 queue 引用、删除内部 lease、更新内部计数并返回预构造 receipt；没有 candidate getter、iterator、array method、world read 或分配式 receipt 构造。生产 `FluidTransactionRuntime` 只在 apply 返回后赋值 `lastCommit`，没有外部回调。
5. **证据针对原触发而非仅依赖总通过数。** `world-transaction-atomicity.test.ts:223-280` 分别覆盖 `nextFrontier` 自有 throwing `forEach`、`nextCleanupFrontier.forEach=null`、candidate accessor、sparse array 和额外属性，断言 fail-closed、world/revision/mutation 不变且 lease 返回；`fluid-candidate-settlement.test.ts:15-66` 在 apply 内把外部 `needsRescan` 改为 throwing getter，仍 accepted、结算 lease 并保留 rescan，直接证明 apply 后不回读外部对象。

### 原 P2：CLOSED

1. `assertUniqueMutationBufferCoordinates` 在 `world-mutation.ts:54-94` 先验证 run 连续覆盖和坐标所属 Chunk，再用复用的 `Uint32Array(32^3)` generation bitmap 对同 Chunk/local index 判重。它不读取 world、Station 或 Chunk。
2. public `editBatch` 仍按 `game-server-world-commit-adapter.ts:45-49` 先执行 `assertWorldMutationBatch`，后执行 Station gate，再进入 commit host；而 `assertWorldMutationBatch` 在 `world-mutation.ts:37-51` 对 unique buffer 调用上述 preflight。因此 false-unique 现在确定在 Station `getVoxel` 和 `state.getChunk` 前拒绝。
3. `commitUniqueBuffer` 在 `world-transaction-commit.ts:281-305` 又于 `state.getChunk` 前执行同一 helper，保留绕过 public facade 时的防御性复检；原 planner bitmap 检查也仍保留（`:316-349`）。
4. `world-transaction-atomicity.test.ts:176-210` 用计数/throwing `getChunk`、`getVoxel`、`getLoadedVoxel` 证明 duplicate 的权威读取次数均为 0。`:212-221` 对 1,000,000 个合法 unique 坐标执行新增 preflight，证明该修复没有降低既有 Fill 最大输入合同；既有真实 100k Fill world commit 回归属于登记的 71-test 结果。

## 证据与边界

- 已登记 R2 首轮 RED：`2 files / 40 tests` 中 `5 failed / 35 passed`，具体命中 post-commit candidate method/getter 与 false-unique 读前边界。最终登记：stdlib `7 files / 71 tests`、Web `2 files / 16 tests`、stdlib typecheck、targeted ESLint/Prettier、diff check 均通过。上述结果用于佐证，但 CLOSED 判定来自冻结代码路径审阅。
- 本轮未重跑测试、typecheck、build、browser、CI，也未审阅 A2/A3、完整 Classic 或生产部署。`GameServer.commitFluidCandidate` 返回后的 residency/persistence maintenance 不读取外部 candidate，且不是 R2 修改；其通用平台失败策略不在本次两项 closing 范围。
- normalization 无法从完全不可读的 Proxy 找回 workId 时只返回 `work-id` 且保留未知 lease；不会写 canonical state，调用方仍可用原 workId abort。这不是原 P1 的“已写却失败”状态。

## 独立审阅 Findings

未发现可证实的 P0/P1/P2 问题。原 P1、P2 均 CLOSED。
