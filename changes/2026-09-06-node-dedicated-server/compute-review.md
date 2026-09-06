# Node Compute 独立实施评审

## 结论

当前实现完成了共享候选 runner、单个常驻 Worker/子进程、基本任务数/声明字节限制和单任务取消，但**未通过 N05、3.3、F1/F2 的完整准出**。现有 `tests/node/compute-executors.test.ts` 在本轮聚焦复跑为 `5/5` 通过，只证明三类候选的基本执行、单个资源身份、简单背压和没有排队任务时的取消；它没有证明不同完成顺序、真实池槽位、池崩溃恢复、一次只读重试、重启限频、完整内存计账或产品 ESM 产物。

评审范围为 `src/server/compute/**`、`src/node/compute/**` 与 `tests/node/compute-executors.test.ts`，对照 `spec.md` 3.3、测试设计 N05 及 `experiments.md` F1/F2。评审者未参与 compute 实现；本文件不修改被评审代码。

## 第二批只读复审

第二批已加入多槽 pool、实际输入字节核算、outer epoch、response runtime guard、单次只读重试、每分钟三次重启上限和旧代 Promise 结算。CR-01 的已知 generation 悬挂、CR-02 的无真实池、CR-03 的非零崩溃重试主体和 CR-05 的 outer identity 主体已有对应实现与新增测试；实施者记录 Node 22 聚焦 `16/16` 通过。本次复审发生在同机网络微基准隔离窗口，只读检查源码和测试，没有执行复现或复跑，以下新增项仍使 3.3/N05/F1/F2 完整准出保持未通过。

### CR-07 P0：资源以 code 0 退出且没有响应时，已接纳 Promise 永久悬挂

- 证据：`src/node/compute/node-compute-executor.ts:304-307` 的 Worker `exit` 和 `328-331` 的 child `exit` 只在非零 code 或 signal 时调用 `handleResourceFailure()`。如果仍绑定的常驻资源正常退出但没有先发送 response，`slot.running`、`runningBytes` 和原 Promise 都没有其他终结路径。
- 触发：受控入口接到任务后执行 `process.exit(0)`；Worker 入口处理任务前正常结束；或未来入口因正常关闭分支提前退出但漏回 response。
- 后果：accepted 只读任务无终态，宿主 drain 可永久等待。退出是否属于“崩溃”不能只由 code 判断，租约仍在途但资源消失已经是失败事实。
- 最小修复与测试：只要当前绑定 resource 发生 exit，就清除或恢复槽；有 pending 时进入现有有界 terminate/retry 流程，idle 时也清掉死亡 resource。为 Worker 和 child 各加入 code 0 无响应入口，断言原 Promise 有界终结、一次重试上限和全部字节归零。

### CR-08 P1：取消后旧资源退出未纳入 close，历史 taskId 集合无界增长

- 证据：`cancel()` 对各槽调用 `void resource.terminate()`，没有加入 `recoveryTerminations`；新 generation 可立即接纳任务并创建新资源，随后 `close()` 只等待当前槽资源和已登记的 failure recovery。因此短时间内真实活跃资源可超过 `poolSize`，close 也可能早于被取消的旧进程退出。另 `submittedTaskIds` 在每次接纳时加入，但成功、失败、取消、换代和 close 都不删除。
- 后果：取消/重启压力下的物理槽位与诊断不一致；永久宿主内存随历史任务总数增长，违反有界资源基线。
- 最小修复与测试：把 cancel termination 纳入同一 tracked termination 集合，并在新代派发或 close 语义要求的位置等待；taskId 去重限定在仍可能冲突的当前租约/代次内，settle 后回收，或实现有明确上限的窗口。测试应阻塞旧资源退出，确认 close 不先返回；大量顺序任务后去重结构不随历史总数增长。

### CR-09 P1：队列复用、聚合结果预算与乱序证据仍未完成

- 当前 `queued` 仍是 FIFO 数组，任务合同没有 `ComputeTaskQueue` 的 priority、merge key、dependency，DedicatedServerHost 也没有组合该队列；第二批实施记录明确把这些策略留给宿主，因此 spec 3.3 的“复用优先级、合并、依赖”尚无实现证据。
- `maxBytes` 只合计 queued/running 输入；`maxResultBytes` 是单结果上限。多个槽同时产生的父进程结果对象、结果 IPC backlog 和输入总量没有同一聚合上限，诊断也没有 result buffer bytes/总保留 bytes。child 请求 `send() === false` 已改为计账而非误判失败，但不能替代结果侧和总量约束。
- 双槽测试只在提交后立即断言两个 PID/thread id 并等待 `Promise.all`，没有 barrier 控制后提交任务先完成；崩溃测试仍为单槽。F1/N05 的不同完成顺序、F2 的池内单槽退出而同池其他槽继续，以及 F2 要求的每进程启动时间仍缺证据或诊断字段。

## 第三批最新状态覆盖

实施者随后继续修改，本节覆盖上面第二批中已经过时的描述；本轮仍只读源码和测试，没有在共享性能采样窗口执行验证。

- CR-07 已按源码修复：绑定资源无论 exit code 是否为零，只要仍有 running 租约都会进入 failure/retry；idle exit 会清掉死亡 resource。新增测试证据由实施者记录，本评审者未独立复跑。
- `submittedTaskIds` 无界集合已改为单个严格递增 `taskIdHighWatermark`；cancel termination 也已加入 tracked 集合，`close()` 会等待。但 cancel 仍把槽立刻设为 `recovering=false` 并清掉 resource，新代任务可在旧资源尚未 terminate 时创建替代资源。此时真实线程/进程可短时超过 `poolSize`，诊断只显示新资源。需让有旧 resource 的槽保持 recovering，待该次 termination settle 后再安全 pump，并以阻塞 terminate 的受控测试证明物理槽不超预算。
- 已新增独立 `DedicatedComputeScheduler`，在自身测试中复用 `ComputeTaskQueue`，实现 priority、merge、dependency，并把最坏结果预算保留到宿主 `acknowledge()`/`fail()`。因此 CR-09 的“完全没有 scheduler”已过时；但是当前 `DedicatedServerHost` 未导入或实例化该 scheduler，仍直接调用 executor，产品宿主尚未获得这些队列与结果保留语义。
- 宿主接线时，candidate 放入 mailbox 后必须继续持有 scheduler reservation；apply 成功才 `acknowledge()`，identity/read-set/容量/代次失败走 `fail()`。关停 drain 也必须覆盖 scheduler jobs。接线前，独立 scheduler 的通过数不能作为 Host 3.3 闭环证据。

## 阻塞发现

### CR-01 P0：运行中取消或超时会让已接纳的排队任务永久悬挂

- 证据：`src/node/compute/node-compute-executor.ts:292-309` 取消运行任务时递增整个 executor 的 `generation`，随后立即调用 `pump()`。`pump()` 在 `161-198` 直接调度队列中的旧代任务，没有重写或拒绝其 identity；结果在 `267-277` 因 response generation 不等于当前 generation 被计为 stale 后直接返回，既不清除 `running`，也不 settle Promise。资源失败路径 `312-320` 使用同样的 generation 切换与立即 pump 结构。
- 触发：`maxTasks >= 2`，任务 A 正在运行、任务 B 已排队；取消 A、让 A 超时，或让执行资源失败后由新资源成功完成 B。
- 实际复现：在 `/tmp` 使用 inline executor，A/B 都为 `find-safe-spawn`，提交后取消 A。750 ms 后 A 返回 `DedicatedComputeCancelledError`，B 仍为 `pending`；诊断为 `generation: 2`、`queued: 0`、`running: 1`、`staleResults: 2`。
- 后果：已接纳请求没有终态，`runningBytes` 永不归零，宿主 `waitForIdle()`/drain 可永久等待；一次取消可使 lane 失去进展。
- 最小修复：generation 切换时必须明确 settle 全部旧代排队任务，或为允许重算的只读任务创建新 generation 的新租约并保留原 Promise；收到当前 `running` 的旧代结果时也必须终结该租约，不能只计数后返回。
- 最小测试：加入“一个 running + 至少一个 queued 后取消/timeout”以及“资源崩溃后队列继续”两项；对每个已接纳 Promise 设置有界终态断言，并检查最后 `queued/running/queuedBytes/runningBytes` 全为零且 lane 可继续执行新任务。

### CR-02 P1：实现是单槽 executor，不是 F1/F2 所需的真实池

- 证据：executor options 在 `src/node/compute/node-compute-executor.ts:17-24` 没有池大小；实例只有一个 `running` 和一个 `resource`（`73-80`），`pump()` 在已有运行任务时直接返回（`161-163`）。诊断虽用数组表示 PID/thread id，但只可能报告当前单个资源（`144-158`）。测试 `130-146` 仅断言一个 thread id 或一个 child PID。
- 触发：配置 F1 的 general=2/4，或 F2 的多个等工作槽位时，没有可表达的配置，也无法同时运行两个候选。
- 后果：不同完成顺序无法发生；F1 扩池与 F2 真多进程池实验无法运行，`maxTasks` 只是队列容量，不能作为活跃槽位证据。当前 5 项测试不满足 spec N05 的“不同完成顺序、池崩溃恢复”。
- 最小修复：显式加入 `poolSize`，维护每槽 resource/running lease/generation；诊断报告配置槽位、存活槽位、每个真实 thread id/PID、启动时间和完成数。F2 仍只运行只读候选，Authority 不进入池。
- 最小测试：用 barrier 控制两个或四个任务同时在途，断言 `running` 与实际不同 thread id/PID 等于配置槽位，并让后提交任务先完成以验证乱序回收仍按 identity 正确交付。

### CR-03 P1：F2 崩溃恢复、只读重试和重启限频尚未实现，部分发送故障会留下未跟踪资源

- 证据：`failRunning()` 在 `src/node/compute/node-compute-executor.ts:312-320` 立即拒绝当前任务、清空 `resource` 并递增 generation，没有“只读最多重算一次”、每分钟最多三次恢复或健康降级状态。`sendChildRequest()` 在 `256-259` 把 `child.send() === false` 当作抛错，但 false 表示 IPC 已进入背压；随后 `failRunning()` 不终止仍可能存活的旧 child。Worker `postMessage` 同步失败也走同一路径。`close()` 在 `127-142` 只终止当前可见 resource，无法回收已从字段中移除的存活资源。
- 触发：kill 一个计算子进程；连续 crash；IPC 高水位使 `child.send()` 返回 false；或发送不可克隆 payload 使 `postMessage()` 抛错。
- 后果：F2 要求的工作租约失效、一次重排、旧代结果丢弃、最多三次/分钟恢复与健康降级均无证据。发送故障可能同时留下旧进程并创建新进程，真实活跃槽位超过诊断值，close 后仍可能残留资源。
- 最小修复：用 supervisor 持有所有槽和退出状态；将 read-only 租约的 retry count 与 restart 时间窗显式建模；资源退出/发送失败先隔离并有界 await terminate，再决定重试或降级。IPC false 应进入有界 drain/backpressure 流程，不能按“消息未发送”处理。
- 最小测试：受控入口让第一代 child 在收到任务后退出，第二代成功，断言同一逻辑任务最多重算一次、旧代回复无效且 Promise settle；连续注入四次崩溃，断言第四次不再拉起并报告 degraded；制造 IPC/postMessage 发送失败后核对所有历史 PID/thread 都已退出，close 不遗留资源。

### CR-04 P1：没有复用队列语义，字节背压也未覆盖真实输入、IPC 和结果缓冲

- 证据：`DedicatedComputeTask` 在 `src/server/compute/dedicated-compute-contract.ts:6-40` 没有 priority、merge key 或 dependencies；Node executor 在 `73-75` 使用普通 FIFO 数组。因此 3.3 要求复用的优先级、合并、依赖语义在此接口上无法表达。接纳检查 `src/node/compute/node-compute-executor.ts:104-107` 完全信任调用方的 `estimatedBytes`，不核对 Fluid/Logic/Chunk 实际 TypedArray 大小。结果只在完整对象已经到达父上下文后才于 `282-283` 估算并拒绝；诊断合同 `src/server/compute/dedicated-compute-contract.ts:48-61` 没有 IPC backlog、result-buffer bytes 或总占用。`child.send() === false` 也没有进入字节计账。
- 触发：把大 Fluid snapshot 的 `estimatedBytes` 声明为很小；子进程 IPC 排队；或 worker 返回超过预算的大候选。
- 后果：任务可绕过 `maxBytes` 并在子进程、IPC 队列和父上下文中完成大分配；拒绝超大结果只能阻止提交，不能约束峰值内存。FIFO 也不能证明交互优先级、合并和依赖不回退。
- 最小修复：接入现有 `ComputeTaskQueue` 或等价且可验证的队列合同；由 adapter 对结构化输入独立计算实际字节并与声明值交叉校验。对每槽预留有界 result budget，记录 IPC backlog/result bytes/总占用，在分配或发送前拒绝已知越界。
- 最小测试：低报大 Fluid 输入必须在 dispatch 前拒绝；构造结果/IPC 高水位，断言总计账不超过上限且所有 Promise settle；加入优先级、同 key 合并、依赖成功/失败传播及队列+在途+结果三部分合计测试。

### CR-05 P1：outer epoch 没有端到端校验，进程边界响应只靠 TypeScript 注解

- 证据：任务带 `epoch`，但 executor 的 `validateTask()` 在 `src/node/compute/node-compute-executor.ts:58-69` 只检查它非空，executor 本身没有 expected epoch。`NodeComputeResponse` 在 `src/node/compute/node-compute-messages.ts:8-22` 不回显 epoch；`receive()` 只比较 task id 与 generation。Worker/child 消息监听在 executor `218-245` 把运行时 `unknown` 直接注解成 `NodeComputeResponse`，没有 response type guard。现有 request guard `src/node/compute/node-compute-messages.ts:24-28` 也只检查 kind 和 task truthy。
- 触发：复用 executor 时提交另一个 world epoch；或受控故障子进程发回同 task id/generation、但缺少/伪造 result 的消息。
- 后果：executor 不能独立证明 candidate 属于期望 world epoch；畸形 IPC 可通过 identity 分支并以 `undefined` 或结构错误的结果 resolve，字节估算还可能把它算作零。后续宿主校验能拒绝部分 kind/领域字段，但不能替代进程边界的 outer identity 与 schema 校验。
- 最小修复：executor 配置绑定 expected epoch，response 回显 epoch 并与 pending identity 同时验证；为 request/response 建立完整 runtime validator，对 kind 对应 payload、有限数字、长度和 TypedArray 类型做有界检查，畸形资源应隔离。
- 最小测试：wrong epoch 请求在发送前拒绝；旧 epoch、错误 generation、同 id 畸形 response 都不能 resolve 成候选，且对应 Promise 明确 reject、资源/计账回收完成。

### CR-06 P1 证据缺口：Node 22 临时入口通过，但没有验证产品默认 ESM 产物及其相对依赖

- 证据：默认入口 URL 为 `./node-compute-worker.js` 与 `./node-compute-child.js`（`src/node/compute/node-compute-executor.ts:42-45`）。测试在 `tests/node/compute-executors.test.ts:85-105` 只把 worker/child 分别临时打成 `.mjs`，并通过 `entries` 注入绝对 URL；没有构建 executor 产品入口，也没有走默认相对 URL。实施记录提供 Node `v22.23.2` 对这两个临时 bundle 的实际 `5/5` 证据，因此 Node 22 语法/基本 Worker 与 child 能力已证明，但不等于产品产物闭包可启动。
- 触发：从正式 dist 启动 executor 且不传测试专用 `entries`。
- 后果：构建若没有同时生成预期文件名、保持相对目录或打包其全部依赖，运行时才会报入口不存在；源码/临时 Vite 测试无法提前发现。当前 package 也尚无可作为该结论依据的 Node 产品 build/start 命令。
- 最小修复：正式构建把 executor、worker、child 与共享依赖作为同一版本化产物生成，并让默认 URL 与实际文件名由一处配置决定。
- 最小测试：用正式产品命令构建到空目录，在 Node 22 中从该目录、无 TS loader 且不注入 `entries` 启动 inline/worker/child，执行代表任务并关闭；校验产物清单/hash 与不存在源树依赖。

## 已确认的正向边界

- `runDedicatedComputeTask()` 组合现有 canonical、安全出生点、Fluid 与 Logic 算法，没有复制第二套算法。
- 被评审的 compute 源码没有导入或实例化 `GameServer`、`AuthorityRuntime`，Worker 与子进程只持有只读候选 runner；源码层面没有发现第二 Authority。
- Worker thread 与 child process 都是常驻单资源，并且 child 测试确实报告了真实 PID；实施记录另有 Node `v22.23.2` 对临时 ESM bundle 的聚焦通过证据。
- 超大结果在父上下文提交前会被拒绝，活动任务取消后旧资源结果不会 resolve 给该任务；这些是有用的局部门禁，但不能覆盖上述队列、池、supervisor 和内存合同。

## 准出建议

先修 CR-01，避免任何取消/超时/崩溃导致 accepted Promise 永久不终结。随后把 N05 拆成三组可独立判断的测试：多槽乱序与 identity、进程崩溃/一次重试/限频、完整内存与 IPC 背压。CR-02 至 CR-05 通过前，compute 只能标记为“单槽候选执行接缝已跑通”，不能标记为 3.3 或 F1/F2 计算池闭环。CR-06 要在主线产品 Node 构建入口形成后用真实 Node 22 产物补证。
