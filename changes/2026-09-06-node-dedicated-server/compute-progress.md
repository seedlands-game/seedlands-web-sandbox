# Node 计算执行器进度

## 本次完成

- 新增平台无关的 `DedicatedComputeTask` 与 `DedicatedComputeResult` 合同。任务携带调用方给出的 `taskId`、`epoch`、`generation` 与 `estimatedBytes`，覆盖 canonical 生成、安全出生点、Fluid 快照候选和 Logic 观察意图。
- `runDedicatedComputeTask()` 只组合既有 `runWorldComputeTask()`、`computeFluidCandidate()` 与 `decideLogicIntents()`；不生成 mesh，不复制算法，也不导入或持有 `GameServer`。
- Node 工厂保持 `execute(task, options)`、`close()`、`diagnostics()` 单槽默认接口，新增 `poolSize`（范围为 `1..maxTasks`）和 `expectedEpoch`。`inline`、`worker-thread`、`child-process` 三种模式互斥；后两种模式每个真实槽位各持有一个常驻 Worker 或 child。
- 池按实际序列化对象大小计入排队与在途预算，拒绝 `estimatedBytes` 低报的任务；Worker/child 也在发送前测量候选结果并遵守 `maxResultBytes`。child IPC 返回 `false` 只作为已发送的背压计账，不会错误地把任务判为未发送。
- 每个进程边界 request/response 都回显并运行时校验 `epoch`、`taskId`、`generation`、`resourceGeneration` 和结果 kind 的基本结构。错误 epoch、错误代次、畸形响应不会 resolve 给调用方，而是隔离该资源；本合同内所有任务都是只读候选，资源崩溃只会对同一已接纳任务重试一次。
- supervisor 在滚动一分钟内最多允许三次重启。第四次需要重启时标记 `degraded`，拒绝当前及排队 Promise；关闭、取消、资源失败、异常响应和健康降级路径都显式结算已接纳任务。诊断新增池大小、存活槽位、最近一分钟重启数、健康状态、IPC 背压字节、每槽完成数和所有真实 PID/thread id。
- 正常退出但未回包的 Worker/child 与异常退出走同一恢复路径；cancel 触发的资源终止也由 `close()` 等待。任务身份历史由常数空间的严格递增 `taskIdHighWatermark` 表示，不再保留永久 `Set`。后续 scheduler 会将优先级队列 job id 与 executor execution id 分离，避免重排破坏该门禁。
- 新增 `DedicatedComputeScheduler` 复用 `ComputeTaskQueue` 的优先级老化、合并和依赖传播。候选交给 Host mailbox 后仍须 `acknowledge()` 才完成 queue；`fail()` 会级联拒绝依赖。scheduler 对每个派发任务预留最坏 `maxResultBytes` 到 acknowledge/fail，防止小结果提前释放预算造成后续队列永久无法派发。
- `ComputeTaskQueue` 新增 `logic` lane、可选 `maxRunning` 和 `includeRunningBytes`。默认 `includeRunningBytes: false` 保持浏览器原有仅排队字节限流；Dedicated scheduler 明确启用在途字节计账，并计入未确认候选的结果预留。
- 后续只读复审又补充三项源码修复，**尚未进入本记录的 GREEN 证据**：取消时旧 Node 资源保留为 `terminatingSlots`，其真实终止完成前不复用物理槽；scheduler 的 `maxTasks` 覆盖 queued、running 和 delivered 未确认 job；满字节预算下，同 merge key 且无依赖阻塞的 queued job 会先扣除被替换输入再进行 admission。相应 worker/child 延迟终止、已交 mailbox 任务数、满预算合并回归已写入，等待串行验证窗口。
- 为满足模块规模门禁，任务 identity/epoch 输入校验已从 `node-compute-executor.ts` 提取到 `node-compute-task-validation.ts`。这是职责拆分，不改变校验规则；本记录所列 38/38 证据早于该重排与上述未验证修复，须在下个串行窗口复验。

## 已执行证据

- RED：低报 Fluid 快照与错误 outer epoch 的新用例在实现前都错误 resolve，证明旧实现只信任声明字节并且没有绑定 executor epoch。
- GREEN：`PATH=/tmp/seedlands-node-22/node-v22.23.2-darwin-arm64/bin:$PATH pnpm exec vitest run tests/node/compute-executors.test.ts tests/server/dedicated-compute-scheduler.test.ts tests/client/compute-task-queue.test.ts`，Node `v22.23.2` 下 38/38 通过。覆盖四类候选、双槽真实 worker thread/PID、低报输入、outer epoch、单次 crash 重试、三次后第四次崩溃降级、畸形和错误 epoch 响应、结果预算、正常退出无回包、cancel-close 资源回收、任务高水位、scheduler 的 ack/依赖、显式合并结算、优先级重排 execution id、未确认结果预留和永远不可装入任务拒绝，以及浏览器 Queue 默认语义回归。
- Static：`pnpm exec prettier --check` 覆盖本 lane 文件通过；`pnpm exec eslint` 覆盖本 lane 文件通过；`pnpm exec tsc -p tsconfig.test.json --noEmit` 中本实现路径无诊断；`git diff --check` 通过。

## 当前限制与后续接线

- F1--F4 正式性能采样尚未执行，吞吐、延迟、RSS 和池规模推荐值均为 `unknown`。本轮只提供真实 PID/thread、槽位、重启和字节诊断事实。
- 正式 Node 22 产品构建/启动由主线 Node 入口负责。本轮以临时 ESM bundle 验证 Worker/child，不可替代产品产物闭包验收。
- `DedicatedServerHost` 接线由主线实施：它必须只通过 scheduler job/candidate 公共接口把候选送入 mailbox，并在权威 apply 后 acknowledge 或 fail；未经接线，scheduler 不能替代现有直发执行路径。
- `DedicatedServerHost` 仍需维护 world 任务序号和 world generation，给各 lane 注入同一 runtime epoch，并在 mailbox 回收候选后按 epoch、generation、Fluid read set 与 Logic/canonical 现有校验提交。执行器不拥有权威世界，也不会重试玩家写操作。
