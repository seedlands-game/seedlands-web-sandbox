# 完整基线进入真实网格调度器的计划

## 目标与范围

本切片衔接 [客户端接线审阅](network-client-baseline-integration-review.md) 中的真实生产调度与所有权结算。依赖完整输入 worker 切片和客户端 consumer，不实现 socket、动作或 GUI，不把本地模式切成远端。已有批准合同中的完整计算上移仍由后续会话组合验收。

当前 `MeshTaskScheduler` 的 worker-first 成功路径固定调用 `acceptWorkerCanonical()`，其本地实现可能向 Authority 提交客户端生成的 canonical。完整权威输入必须拥有单独的、纯客户端结果核对入口，不能以空函数或调用旧 Authority 方法代替。

## 生产行为

`MeshTaskSource` 拆为判别联合，保留旧字段缺省的 integrated 分支，现有本地调用无需更改。新 `authority-complete` 分支只提供 `prepareCompleteWorkerInput()` 和 `acceptDerivedMesh()`，类型中禁止 `acceptWorkerCanonical()`。完整分支只允许 worker-first，构造或切换到 main-snapshot 时明确拒绝；不能悄悄走另一条有生成能力的路径。

完整准备方法返回 `{ input, settle }`，其中 `input` 是已预留预算的独立 transfer 副本，并带显式完整版本身份和 `inputStrategy: 'authority-complete'`。这里是 app 调度合同；consumer 返回兼容的中性类型，不导入 app 类型。`acceptDerivedMesh()` 由组合适配器映射到真实 consumer 的连接/owner 代次、主 revision、完整版本身份、generatorVersion 和 canonical 逐值核对，绝不发送生成产物。

调度器在 dispatch 前验证策略，将该快照的幂等结算函数绑定到具体 task id，不以 key 的“当前准备”替代旧任务 lease。完整路径的失败规则：

- 创建 dispatch 或 postMessage 失败且任务未被接纳时释放本次副本；已登记 active 的失败经同一 finish 路径释放一次。
- `cancel(key)`、替换请求、版本失效和关闭 owner 只使结果不能被接受，不能立刻释放仍在 worker 中的副本预算。
- 正常结果、实际取消完成和已终止 worker 的失败回调才结束该 task 的 lease。重复回包/失败不会二次释放；旧任务结束不释放新任务 lease。
- dispose 先终止 worker port，再释放所有活跃 task lease。准备 Promise 在 dispose 后完成时不创建新的快照或任务。
- 在等待 `acceptDerivedMesh()` 时发生取消或替换，返回后仍通过既有 `isCurrent()` 门禁；同一结果不能越过新代次再次安装。

保留 integrated 分支的 `releasePrepared()` 生命周期。完整分支的 immutable preparation 与 owner 引用由 consumer 自己管理，worker task 结束不自动删除仍有效的 owner cache。mesh/GPU 输出的资源仍由现有 repository 管理，不声称输入副本 ledger 覆盖全部浏览器内存。

## worker 失败通知的前置顺序

当前 `ComputeWorkerPool.recoverSlot()` 先通知 `onFailure` 再 terminate，`terminateSlots()` 先 `onDrop` 再 terminate。新 ledger 不能把这种回调视为已经结束 worker 所有权。因此本切片将对应路径调整为先摘除/终止 slot 的 worker，再通知相关任务失败/丢弃；回调内再入 enqueue 不能看到一个仍在执行旧任务的可用 slot。仅改变失败/关闭路径的顺序，不增加恢复次数、不改变成功计算或旧任务重试语义。

queued/merged/cancel-before-start 的任务从未转移到 worker，可在移除队列和 transfer 引用后通知结算；已运行取消仍等生产 compute-result。Browser Worker 的 `terminate()` 是此 port 的终止边界，本测试不把跨宿主 Node RPC 的逻辑 cancel ACK 当作等价物。

## 预置用例与证据

实现前在本 change 测试目录建立可执行用例，记录预期 RED；真实调用 `MeshTaskScheduler`、`BrowserComputeRuntime`/`ComputeWorkerPool` 和 worker 函数。可以用 typed worker port 传送生产消息，但不能自建 reducer 代替 consumer，也不能把一个立即 resolve 的假取消作为物理结算证据。

| 场景                                            | 预期结果                                                                                           | 证据          |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------- |
| 真实完整 bundle → consumer → scheduler → worker | 完整身份原样返回、两个生成回退计数均 0、consumer 真实核对后接纳，没有 Authority canonical 上行方法 | Vitest        |
| overlay 提交后旧结果、取消/替换时迟到结果       | 真实 consumer 拒绝旧向量；调度器不调用 accepted callback，最后结算对应旧 task 的副本               | Vitest        |
| 取消一个正在运行的 mesh                         | 取消消息发出时 worker 字节保持；实际 compute-result/已终止失败后才归零                             | Vitest        |
| post 失败、重复回包、同 key 先后两个 task       | 每个 lease 恰好结算一次，新任务预算不被旧结果释放                                                  | Vitest        |
| worker 崩溃/epoch-switch/dispose                | terminate 发生在 failure/drop 回调之前；回调再入不向旧 worker 投递；既有恢复上限和错误结果保持     | Vitest        |
| 本地旧 mesh source                              | 继续使用原 canonical 接纳流程，既有 scheduler、retry 和 compute pool 测试通过                      | Vitest        |
| 源码边界与生产产物                              | 受影响类型/规则与构建通过，无 client→app 或浏览器→Node 导入                                        | Static、Build |

本切片不单独声称可见远端地形、预测体验或性能收益。真实浏览器候选旅程与 Midscene 仍是后续组合的未完成准出项。

## 文件与当前状态

负责者拥有 `src/app/world/mesh-task-scheduler.ts`、必要的同目录 source/lease 辅助类型、`src/client/compute/compute-worker-pool.ts` 及本 change 的 scheduler integration 测试。完整 worker input/dispatch 由 Terra 负责；consumer 由 Sol 负责，按中性 shape 接线，集成前核对契约。超过静态行数上限时按职责提取，不关闭规则。

当前仅为实施计划，未改生产代码、未运行该计划的测试。计划先交独立审阅，随后按 RED → GREEN 执行。范围属于既有客户端迁移工作包，不增加 goal 或成本授权；大规模 UI/网络组合前仍按阶段记录重估。
