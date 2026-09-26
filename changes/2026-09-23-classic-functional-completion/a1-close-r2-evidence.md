# A1-CLOSE-R2 原子边界修复证据

状态：实现与定向验证完成，等待独立窄 closing review 和 root 准出；本文件不自行宣称 A1 冻结、可提交或可合并。

范围：只关闭 `a1-closure-review.md` 的 P1/P2。未进入 A2、A3、Browser、build、CI 或发布。上一 candidate 的 stdlib `65` tests / Web `16` tests 是历史证据，本轮以最终源码重新验证。

## 首轮 RED

命令通过默认 `benchmark-window` 全机锁串行执行，Vitest 使用 `--maxWorkers=1`：

```text
pnpm exec vitest run --config packages/stdlib/vitest.config.ts
  packages/stdlib/tests/server/fluid-transaction.test.ts
  packages/stdlib/tests/server/world-transaction-atomicity.test.ts
  --maxWorkers=1
```

结果：`2 files / 40 tests`，`5 failed / 35 passed`。

- 真实 `GameServer.commitFluidCandidate` 在合法 `nextFrontier` 自有 `forEach` 抛错、或 `nextCleanupFrontier.forEach` 非函数时，先完成 canonical world commit，随后抛错。
- Authority apply 成功后把外部 candidate 的 `needsRescan` 改成抛错 getter，旧实现会再次读取并抛错。
- `writes` getter 的异常直接逃逸；sparse 或带额外 enumerable 属性的数组未按 plain dense 合同拒绝。
- false-unique buffer 在公开 facade 拒绝前触发 `2` 次权威 Chunk 读取；期望为 `0`。

## 最小修复

### P1：candidate 输入脱离与无失败 settlement

- `fluid-candidate-validator.ts` 使用 property descriptor 读取 bounded plain record，拒绝 accessor、Proxy 异常、未知键、sparse/额外键数组、非三元坐标和不合法 scalar。未使用 JSON clone，不调用输入的 `toJSON`、iterator 或数组方法。
- 完整 candidate 在任何 read-set/cell/world 写之前复制成 authority-owned dense arrays 和 plain records；后续 validation、canonical apply 与 receipt 都只消费该副本。
- `fluid-candidate-settlement.ts` 在 canonical apply 前克隆 frontier/cleanup/rescan 状态，先扣除本次 lease 占用，再有界加入 next frontier/cleanup；容量溢出转换为 bounded rescan。
- canonical apply 返回后只同步交换内部 queue state、删除 lease、更新计数并返回预取的 commit sequence；不再调用外部 candidate 的 method/getter/iterator，也不再做可能失败的调度准备。
- `fluid-candidate-commit.ts` 在 metadata apply 前构造完整 receipt；canonical 写后不再读取 candidate、分配回执或执行可能失败的回执准备。

行为裁决采用 fail-closed：畸形输入返回 `{ accepted:false, reason:'invalid-result' }`，世界/revision/mutation count 不变，lease 被正常退回 frontier；合法、已脱离的 candidate 仍返回 accepted 和可读取 commit receipt。

### P2：false-unique 读前拒绝

- `assertUniqueMutationBufferCoordinates` 仅在声明 unique 的 buffer 上运行，按既有 `chunkRuns` 分组，每 Chunk 使用固定 `32^3` bitmap，以 local index 判重并验证 run 覆盖/坐标归属。
- 公开 `GameServer` facade 在 `assertWorldMutationBatch` 阶段先执行该预检，因此 false-unique 在 Station `getVoxel` 和 Chunk `getChunk` 前拒绝。
- `commitUniqueBuffer` 保留防御性复检；没有给每次 `WorldMutationBuffer.write()` 增加全局 Set。普通 buffer 与 object edits 不走该 helper。
- 既有 100,000 mutation unique-buffer control 随完整 stdlib 范围通过；新增纯 preflight control 以 1,000,000 个唯一坐标验证 Fill 上限合同仍可接受，不执行 1M 世界写入。

## 五项闭包状态

1. metadata/capacity：上一 candidate 的写前 capacity 检查保持；本轮补齐 accepted fluid 的输入脱离、预备 settlement 和写后无外部读取。P1 回归为 GREEN。
2. Water/Lava overflow rescan：上一 candidate 的通用 `isFluidVoxel` 行为与参数化回归保持 GREEN；本轮 settlement 容量溢出仍进入 rescan map。
3. Station gate：现有 public facade / server-owned gameplay port 边界保持 GREEN；本轮 false-unique 在 Station 读取前拒绝。
4. object/prepared cardinality 与 bounds：现有 `65,536` object 上限、迭代 bounds 和 prepared dense 校验保持 GREEN。
5. sparse metrics/unique trust boundary：sparse immediate 兼容与 metrics 保持；false-unique 现在在任何 Station/Chunk 读取前拒绝，P2 回归为 GREEN。

以上是 R2 的实现与测试结论，不替代独立 closing review，也不外推为完整 A1、Classic 产品或 PR 准出。

## 最终验证

所有重负载命令均通过 `node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- ...` 串行执行。

- stdlib：`world-transaction-atomicity`、`world-mutation-transaction`、`prepared-world-edit-batch`、`fluid-transaction`、`fluid-candidate-settlement`、`world-collision-delta`、`fluid-edit-effect-plan`，`7 files / 71 tests passed`。
- Web：`gameplay-block-stations`、`prepared-world-edit`，`2 files / 16 tests passed`。
- `pnpm --filter @seedlands/stdlib typecheck`：PASS。
- A1-CLOSE-R2 targeted ESLint：PASS。
- A1-CLOSE-R2 targeted Prettier：PASS。
- `git diff --check`：PASS。
- 禁止项：未新增 `any`；未删除、skip 或放宽测试；未运行 build、browser/dev server、全仓 suite、CI 或部署。

## 剩余风险

- 本轮只证明 closing review 的两个问题在当前定向链路关闭；仍需独立审阅者核对 candidate normalization、queue replacement 和 public facade 的最终 diff。
- `WorldMutationBuffer` 是进程内受信对象；commit 内保留防御性复检，但本轮不把它改造成跨 Worker wire format，也不扩展公开协议。
- 100k control 证明合同兼容，不是性能收益结论；本轮未做性能 A/B。

## 最终 SHA-256

```text
fluid-candidate-validator.ts       bbd4803a1a844f77bf475e872ebbbffd6bc7f5ce6916d2d2ae7f242ac58ca229
fluid-candidate-settlement.ts      f45105b53c07663a570d6588ebe871ebc305fd4ab0c32f3f5cc0cbec8d8836b4
fluid-transaction.ts               27a9a2b9a7b721c0f336b78f97bc682f26cfbe15e2b644275197b261a0a7cd94
fluid-candidate-commit.ts          4d548a12e8fa96524531ab9898806a4959857aeaa193f3387f3c176c259a8046
world-mutation.ts                  e62ba49cb610e48910643b883756c2959d846c130c30c7933bc2a3a2c5935188
world-transaction-commit.ts        de4eed26479a388d247ce039caaf8dab3d7226049a844bc3b09c993a397ee17d
game-server-world-commit-adapter.ts c7cda558024dcf7d7e50d7fe1dac2cea039993e45874b6bffbb434eb5c3e0936
fluid-candidate-settlement.test.ts  ddf324339aeb086655a3e9ba8a75fe2f65db7eafa00ecb296acc22d51696502a
fluid-transaction.test.ts          24b97c067bb8e00057b1baba38ec11f675839027ce6bff31d709fa5896424a6a
world-transaction-atomicity.test.ts dba6afcad5bbf6cabc010cbbf447db99c1a7668c6660233fc068386240916198
```
