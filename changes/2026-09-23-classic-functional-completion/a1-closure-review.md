# A1 原子事务 Closing Review

结论：发现 1 个 P1、1 个 P2。P1 表明 accepted fluid candidate 的原子提交闭包尚未完全成立，A1 暂不应按本次 closing review 准出；P2 由总负责人决定是否随 A1 收口。本文不作可合并、CI 或浏览器验收结论。

## 审阅身份

- 规则基线：Git `75b13d40f9c97357929d05fba1d647a3962b8b04` 的 `AGENTS.md`、Seedlands code-review skill/workflow/semantic rules。
- 实现身份：未提交 A1 文件冻结于 `/tmp/seedlands-a1-closure-review-4decc58b`；`MANIFEST.sha256` 自身 SHA-256 为 `a73af924b7c4f1ece1d2762d0e438f937d6686fb3df6c6239da8f75acf872b3f`。补充纳入 sidecar 所需相邻实现：`fluid-active-window.ts=e2da52...3878`、`fluid-edit-effect-plan.ts=0f27ab...0aaf`、`fluid-candidate-validator.ts=a8a6b9...1d53`。
- `a1-closure-evidence.md` SHA-256 为 `bfc812726dc19316e96957162371c48b93f036b28cce751940c166f37282d146`。审阅结束前复核的 A1 核心源码与测试 hash 仍和 manifest/evidence 一致；未混入 A2/A3 或其他 dirty。
- 已登记证据为 stdlib `65/65`、Web `16/16`、stdlib typecheck、targeted lint/format 与 diff check 通过；本轮按约束未重跑测试、构建、类型检查或浏览器。

## Findings

### P1：accepted fluid 在 canonical commit 后仍调用候选对象的方法，异常会留下“世界已写、调用失败、commit 未发布”的状态

- 触发：取得真实 lease 和合法 candidate 后，为仍满足 `Array.isArray`、长度与位置校验的 `candidate.nextFrontier` 添加自有 `forEach`（例如非函数，或一个会抛错的函数），再调用公开 `GameServer.commitFluidCandidate(candidate)`。validator 在 `packages/stdlib/src/server/fluid/fluid-candidate-validator.ts:33-45,65-83` 使用 `for...of` 校验内容，不拒绝数组的额外属性，也不生成 authority-owned 规范化副本。
- 路径：`packages/stdlib/src/server/fluid/fluid-transaction.ts:451` 先调用 `options.apply(candidate)`；生产链路经 `fluid-transaction-runtime.ts:20-23`、`game-server.ts:124-131`、`server-world-commit-host.ts:44-50` 到 `fluid-candidate-commit.ts:62-94`，已经提交 Kernel metadata、voxel/fluid bytes 和 Chunk revision。随后 authority 在 `fluid-transaction.ts:452-453` 删除 lease，却在 `:454-459` 直接调用候选数组的 `forEach`；该处抛错会跳过 accepted counter 与 `commitSequence` 回执（`:460-461`）。`game-server.ts:384-389` 因异常也不会 `takeLastCommit()`，调用方无法发布已发生的 canonical commit。
- 影响：一次输入可观察为异常/未 accepted，但权威世界与 world revision 已改变，lease 又已丢失；对应 collision/commit receipt 不会按本次调用发布，客户端镜像可能停留在旧状态。这正落在 candidate apply 边界和 lease 结算的原子性范围。现有 capacity RED 只覆盖 `options.apply` 在写前抛错且 lease 保留，没有覆盖 apply 成功后 settlement 抛错。
- 最小修复：在 canonical apply 前将已验证 candidate 规范化为 authority-owned dense plain arrays，并预构造 next frontier/cleanup/rescan 的 replacement state；apply 成功后只做内部 Map/字段的同步 no-fail 交换和计数。至少补一条真实 `GameServer`/Authority 回归，给合法形状数组注入自有 `forEach`，要求要么写前 fail-closed 且 lease/世界不变，要么正常 accepted 且 commit 可取，禁止世界已变后抛错。

### P2：unique 声明的重复坐标仍在读取/物化权威 Chunk 后才验证

- 触发：公开 `WorldMutationBuffer.forUniqueCoordinates()` 写入重复坐标后提交。`world-transaction-commit.ts:287-304` 先按声明的 `chunkRuns` 调用 `state.getChunk` 并分配每 Chunk 数组；直到 `:319-327` 第二次遍历 payload 才发现重复。真实 `GameServer.editBatch` 还会先经 `game-server-world-commit-adapter.ts:47-49` 的 Station 扫描读取目标 voxel。
- 影响：无效 unique 输入虽已能在 metadata/canonical write 前拒绝，因而旧有“重复计数/写入”风险已关闭；但它仍可在失败前触发 Chunk 加载、生成、持久化读取和 residency 变化，且较早的 Chunk 读取失败会掩盖真正的 duplicate 输入错误。`world-transaction-atomicity.test.ts:151-159` 只断言 cell/revision 不变，没有断言 duplicate 在零 Chunk read 时拒绝。
- 最小修复：在任何 Station/Chunk 查询前对 unique buffer 做有界的按 Chunk/local-index 预检，再进入现有 planner；增加计数型 `getChunk/getVoxel` port 测试，断言 duplicate 的读取次数为 0。若 A1 合同只要求“canonical 写前拒绝”而不要求“权威读取前拒绝”，应由总负责人明确接受该残余，而不是把它表述为完整的 read-before-validation。

## 五项闭包判定

1. **metadata/capacity：主体关闭，accepted fluid 被上述 P1 阻断。** `prepared-world-commit-metadata.ts:10-35` 在 apply 前验证 epoch、world revision、commit sequence 和 mutation count；single、prepared、general、unique、fluid 均先验证 revision/Chunk capacity。生产 adapter 的 mutation setter是 `game-server.ts:138` 的普通字段赋值；canonical apply 后没有查询式 world callback。prepared sidecar 在 `world-edit-runtime.ts:147-170` 预构造 active-window/frontier replacement，apply 仅做内部状态交换。general/unique 在提交后仍读取 `state.getRevision()`（`world-transaction-commit.ts:250,421`），但生产绑定是纯 Kernel getter，未找到无需篡改私有宿主即可触发的产品异常；不另列 P1。
2. **Lava rescan：关闭。** `fluid-transaction.ts:518-537` 的 bounded rescan 使用同时识别 Water/Lava 的 `isFluidVoxel`（`:97`），`fluid-transaction.test.ts:213-234` 以同一 overflow 条件参数化覆盖两者。普通 edit/prepared edit 的 sidecar 也使用 `fluid-cell-state.ts:8,22-35` 的通用 fluid 判断。
3. **Station 公共 gate/受控 bypass：按当前宿主信任边界关闭。** public facade 的 `editBatch`、`prepareVoxelEdit`、`prepareVoxelEdits` 都在 `game-server-world-commit-adapter.ts:45-63` 经过 Station gate；公开类型在 `:68` 排除 `commits`，安装器在 `:70-72` 仅安装三个受检方法。合法 Block 路径仅由 `game-server.ts:87-104` 注入的 Gameplay world port 闭包调用私有 host，并在 `block-host-commit.ts:272-320` 联合 Station entity/drop、world 和 receipt participant。Web 集成 `gameplay-block-stations.test.ts:161-184` 覆盖三个公共 raw 入口拒绝并保留正式 place/break。残余是这里依赖 TypeScript `private` 而非 ECMAScript `#private`；但 GameServer/Chunk host 本身属于同 Worker 的受信基础设施，未发现该 bypass 被 package export、installed API、mod operation context 或客户端协议暴露，故不按当前威胁模型列 finding。
4. **object/prepared cardinality 与 bounds：关闭。** public adapter 和 runtime 在 fluid/Station/Chunk 读取前调用共享 `MAX_WORLD_EDIT_BATCH_EDITS=65_536`；prepared planner 在 `world-edit-batch-plan.ts:159-165` 先做 cardinality 与 dense/extra-key 校验，测试 `prepared-world-edit-batch.test.ts:129-165` 明确断言 oversized 为零 Chunk read。bounds 在 `world-edit-batch-plan.ts:283-293` 与 buffer planner中迭代归约，不再使用 variadic spread；buffer/Fill 合同未被 object 上限截断。
5. **sparse metrics/unique canonical 安全：写入风险关闭，读前边界留 P2。** immediate sparse 数量由 `world-edit-batch-plan.ts:171-175` 的实际枚举累计，`world-transaction-atomicity.test.ts:144-149` 覆盖 hole/no-op 的零 metrics。unique planner 在任何 metadata/canonical 写前以 per-Chunk bitmap 拒绝重复（`world-transaction-commit.ts:319-327,402-414`），但判重时序仍晚于权威读取，见 P2。

## 覆盖边界

- 未发现 P0。P1 未关闭前，本报告不支持 A1 closing GREEN。
- 已有测试能证明容量耗尽零写、prepared stale/adjacent-fluid 屏障、Water/Lava rescan、公共 Station gate、object 上限、sparse metrics 与 duplicate 的 canonical 零写；没有覆盖 candidate apply 成功后的 settlement 故障，也没有覆盖 unique duplicate 的零权威读取。
- 未审阅 A2/A3 consumer、完整 Classic、CI、build 或 Browser 产品旅程；这些结果不能由本报告外推。
