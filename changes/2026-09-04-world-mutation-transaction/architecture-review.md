# 架构复核记录

**结果：** 有条件通过；修订 spec 与 RED 用例后可提交精确 SHA-256 审核。

**路由证据：** 请求 `sol_escalation_reviewer` / `gpt-5.6-sol` / `xhigh` / `fork_turns=none`；运行时未暴露 effective model、effective effort 与 child-only usage，`telemetry_status: runtime_not_exposed`。

## 认可的方向

- 将事务明确拆成 validation、resolve、apply、publish，并采用 last-write-wins、commit 级 revision 以及结构 / 语义事件分离，方向正确。
- 现有 `GameServer.editBatch()` 边遍历边写，无法保证后置非法输入时的原子性，且聚合结果顺序受输入影响。
- 客户端已有聚合消费雏形，但仍绑定旧 `VoxelRegionChanged`，应收敛为统一 `applyCommit(result)`。

## 必须修订的边界

- `WorldMutationBuffer.write()` 必须在写入 TypedArray 前拒绝 `NaN`、小数、坐标越界和非法 voxel，避免静默截断后无法恢复原输入。
- 禁止一个 batch 同时提供 `edits` 与 `buffers`，或者必须定义固定优先级；本 change 选择禁止混用。
- 在首次 canonical 写入前完成所有 Chunk materialize、旧值读取、排序、bounds、事件与 revision 计划；补后续 Chunk 加载失败时前面 Chunk 不变的 RED。
- Chunk / mesh Chunk 按数值坐标稳定排序，不能使用 locale 或字符串字典序；补负坐标、多位坐标反例。
- Fill 体积以安全整数 / `BigInt` 在分配前检查上限；metrics 区分有效 payload 与实际 capacity。
- 明确 `worldRevision` / `mutationCount` 是进程期状态；当前 snapshot 只持久化 Chunk revision。
- 100k fixture 不能假定目标 voxel 与基础世界必然不同；应选择可证明的深层 Stone 区域或动态构造目标值。

## 修订结论

总体架构不变。审核版 spec 与 RED 已补充上述原子性、排序、校验、体积、计数生命周期和 fixture 约束；生产实现仍等待用户对精确 spec hash 的审核。

用户在本次复核完成后进一步要求机制引入不得造成性能劣化，且目标批处理必须明显优化。父级已在未修改生产代码的 `2b5d22b` 上采集同环境 pre-change 基线，并将 10k 单 voxel regression budget、100k sequential-vs-batch 2x 门槛及 overwrite-heavy coalescing 门禁写入 spec。固定意图 reviewer 的每任务一次复核额度已消费，因此新增数值门禁没有第二次 child 复核，最终以用户对新 spec hash 的审核和实施后的真实 Harness 数据为准。
