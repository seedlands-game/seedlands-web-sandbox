# 实施分流、授权与阶段记录

2026-09-07 用户明确要求按指引使用 subagent/不同模型降低消费并提高并行，随后指令「开始执行」。本轮按该指令开始当前已交付合同的本地实施，不重复申请许可。

## 审核基线与边界

起点 commit `485de57`，批准时 spec SHA-256 为 `0181d7a49487a9a88de98e572e0ea2ec82b8f2cc6b43921f97dc32c214475274`，联合审核值 `da9a569e0b5fafba2cd0ab3c0e705cf5ef044c8faceb644b4454dd0d5690aa34`，文件明细保留在 [review-binding](review-binding.md)。冻结的设计正文描述设计时状态；实施状态以本记录和实际源码/测试为准。

授权覆盖既有 Node/存储/计算/网络选型/GUI/性能合同的本地实现。实质改动业务合同仍需形成可复核的新版本；角色路由和进度变化不改写原批准对象。本轮不创建 goal、不购买额度或自动兑换 reset，不创建用户未明确要求的新独立任务；使用当前任务的 subagent。远端首次写入必须按已定目标准备/备份/恢复流程落实，不能因实现开工跳过。

## 第一批文件所有权

| 执行者           | 模型 / effort        | 文件范围                                                    | 验证闭环                                       |
| ---------------- | -------------------- | ----------------------------------------------------------- | ---------------------------------------------- |
| 主线             | Astra，沿用当前设置  | Node 静态边界/构建、`src/server/dedicated/`、宿主接线与集成 | 先规则反例 RED、宿主行为 RED，再实现及集成检查 |
| node_persistence | GPT-5.6 Sol / high   | `src/node/persistence/`、文件存储测试                       | 增量完整索引、锁、损坏/故障注入、恢复          |
| node_compute     | GPT-5.6 Terra / high | `src/server/compute/`、`src/node/compute/`、executor 测试   | inline/真实线程/子进程候选等价、取消/队列/代次 |
| network_probe    | GPT-5.6 Terra / high | 网络语料/能力文档；原型仅 `/tmp`                            | 公共投影、可靠性/因果清单、N1 真实能力与缺口   |

第一批接口按消息确认后接线；package/lock/config/公共 spec 只由主线维护。子任务不自行 commit、push 或改其他人的文件。独立单元测试可并行，正式性能采样与完整构建/coverage 串行，避免争用污染结果。后续机械整理/数据汇总可路由 Luna，集成与独立评审路由 Sol；不是为用满模型而制造任务。

## 路由后的预算情景

保留[原单 agent/全 Astra 估算](estimates.md)作为未校准基线和保守上限建议，不把降级模型的低单价等同少返工。新增示例分布为按计费 token：Astra 25%、Sol 25%、Terra 45%、Luna 5%；同一正常语料按官方已核验费率约 1720.95 credits / USD 68.84，再假设分流协调使 token 增加 10%，约 1893.05 credits / USD 75.72。该分布是敏感性情景，实际按任务模型分别登记，不能用它承诺节省比例。

并行后初步关键路径估计 82–122 h；原机器采样串行、网络选型 → 正式 wire/GUI 的依赖保留。未知返工/资源争用不作确定节省，整体保守预算不因初次分派自动降低或扩大。先以首批实际 elapsed/任务规模/可得 usage 校准；当前 subagent 接口不提供完整计费 token/credits 时记 unknown，不从模型运行时间伪造账单。

## 当前证据

- 初始工作树干净，未创建 goal。
- 本机默认 Node 为 26.0.0；正式目标仍为 Node 22，构建/运行记录需明确版本，不把默认本机版本当 Node 22 证据。
- 已以锁文件安装工作树独立依赖；正式 Node 22.23.2 macOS arm64 已从官方产物下载并校验 SHA-256。默认 Node 26 不作为兼容性依据。
- Node 平台静态边界先取得反例 RED，再连同现有纯逻辑边界通过 18 项测试。新宿主 6 项生命周期/输入/异步保存/存档优先恢复测试通过；服务端活动窗口另 2 项测试通过。上述为聚焦确定性测试，不是性能或完整准出。
- 新的离线产物测试已取得缺失正式入口的 RED；实现中的构建把服务入口、Worker 和 child 作为独立 Node 22 ESM bundle，正式 GREEN 与 Linux 验证待补。
- N0 首轮遗漏玩家校正运行时分支，主线以新增 RED 修正；同时限制嵌套 ref/action 的公开字段，7 项消息/codec 测试通过。C0 仍为参考格式，未冻结 wire。

## 第二批与交叉评审

- Sol 完成文件存储后独立评审 Terra 计算执行器，发现取消/崩溃切代后已接纳 queued Promise 永久悬挂；Terra 已补复现测试并修复，随后继续真多槽池、崩溃重试/限频与字节预算。
- Terra 网络执行者独立评审 Sol 存储，发现启动后懒加载的 symlink/无界读取缺口和同序号保存身份语义问题；Sol 修复后由主线结合真实宿主保存路径核对，避免拒绝合法自动保存。
- Sol 承担 `src/node/runtime/` 的平台时钟、持久化/计算组合及关停生命周期；主线继续宿主、CLI/构建和整体集成，公共 package/config 维持单一所有者。
- N1 实测 Node 22 QUIC loopback 的 ready、stream/datagram echo 成功；独立 Chrome 152 的握手失败，不将该候选列为已支持浏览器传输。详情见 [网络能力记录](network-progress.md)。
- 网络执行者继续 N2：同一确定性候选语义语料比较 C0、MessagePack 与 Protobuf 的体积及编解码分位数；这是微基准，后续仍需实际游戏流量、受控传输及完整配对 A/B。

目前 A01–A13 完整准出仍未完成；本地/远端 GUI、正式 wire、整体与分项性能、Linux 故障恢复、CI/CT105 部署和真实网络旅程均不得由以上单元结果替代。

## 跨任务资源竞争修正

用户在 2026-09-07 提醒 WASM 任务「调研并设计 WASM 迁移方案」同时运行。主线读取其活跃进度并发送跨任务采样协调请求；本任务继续暂停全部测试、构建和高 CPU 探针，等待对方确认采样窗口，仅做源码/文档工作。

N2 首轮约 UTC 2026-09-06 17:30:22–17:32:02 的时间测量统一标为 `CONTENDED_OR_UNVERIFIED`，不能用于 codec 优劣或采用决策。第二轮改进计时精度的采样约 17:33–17:35:19 UTC 中止，未保留计时结论。28 条确定性语料的等价结果和编码字节数不受调度争用影响，仍可保留。后续重跑必须登记双方确认、互斥预留、开始/结束 UTC、source/corpus/环境与干扰情况；均值、分位数和端到端结果只使用隔离条件已核验的同批样本。

新增 `scripts/run-exclusive-benchmark.mjs` 以跨 worktree 的同机原子目录预留来包装采样命令；默认 `/tmp/seedlands-benchmark-reservation`。发生竞争立即拒绝启动，不自动抢锁；崩溃遗留先由操作员核验 PID/任务状态。该互斥是协作门禁，不能阻止不遵守它的其他任务或用户应用，因此还必须取得跨任务确认并记录环境；不可把“持锁”单独当作整台机器绝对空闲的证据。互斥回归已通过：竞争者在执行目标命令前返回 75、保留现有 owner，原持有者正常退出后释放。

### 已协商窗口与证据修正（UTC 2026-09-06）

| 窗口                 | 使用情况与边界                                                                                                                                                                                                                       |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 约 17:38:31–17:40:38 | N2 隔离采样完成，但复审发现 decode 计时包含 deep-equality oracle；只能记录 decode+oracle，撤回纯解码速度和 codec 采用结论。                                                                                                          |
| 17:48:02–17:54:56    | 本任务获准进行功能验证。Node 22 单元、类型检查、浏览器构建和离线产物验证不作为性能样本。                                                                                                                                             |
| 17:54:56 起          | 本任务释放预留并通知 WASM 任务；对方确认接续持锁进行预检、分项和统一采样。root 与全部子任务暂停测试、构建、浏览器和 benchmark，仅继续源码、测试设计和文档。结束时间等待对方明确通知，不按估计时长自行抢跑。                          |
| 18:30:38–18:30:40    | WASM 明确暂交约 3 分钟窗口后，N2 修订原型在本方预留内运行并正常退出，立即释放并明确交还。只有 5 个整语料 pass、1 次预热；浏览器计时存在 0.1 ms 量化，部分阶段测得 0。该批只作为小样本计时流程检查，不能支撑稳定排名或 P95/P99 结论。 |

网络原型已保留在 `/tmp/seedlands-network-probe-codec/`；修订版将 encode、decode、schema validation、normalization 分开，等价 oracle 移出编解码计时。Node 22 与 Chrome 的 28 条双向语料、每 codec 7 类畸形输入已有功能证据；符合正式样本要求的性能重测尚未执行。语料仍是确定性候选 DTO，不能代替真实游戏 trace 或端到端选型。

18:30 小样本后的进一步复审：原型 `normalize()` 为等价 oracle 进行排序和 base64 投影，并非生产 DTO 规范化，不得归入生产编解码总成本。其独立计时只能标为 oracle 诊断。正式重测仍待下一次资源交接：各阶段以批量循环累计至少 100 ms、独立重复批次至少 30 次、记录预热及轮换次序，并明确批次/单包统计单位；不从 5 个样本声称尾延迟。当前已再次暂停全部高 CPU 操作，完整 coverage 也未启动。

### 最新功能验证与待补项

- 纯只读快照接口修复了 `ready()` 查询意外回拨宿主时钟的问题。宿主与 Node 离线产物聚焦 9/9 通过；随后水平输入中性化 helper 与宿主聚焦 7/7 通过。
- FileStore 聚焦 19/19、Node runtime 聚焦 8/8、compute executor/scheduler/原任务队列聚焦 38/38 通过。之后新增取消期间物理槽预算修复及 Host 调度接线回归源码，尚未运行，不沿用之前结果覆盖新修改。
- 全项目类型检查通过；浏览器生产构建与三个 Node ESM bundle 构建通过，但发生在最近 helper 提取和执行器修改之前，最终版本需重跑。
- 全仓 coverage 本轮未通过：runtime 用例碰到原 5 秒超时、headless 子命令超时，且主线与子任务错误共用了 `coverage/.tmp` 导致报告竞争。此次不能作为完整测试或覆盖率证据；后续全仓 coverage 由主线独占、串行运行。runtime 已将 suite 预算设为 30 秒并在聚焦模式下通过，未因此宣称全仓通过。
- 最新全仓 ESLint 通过；Prettier 曾仅剩网络进度文档格式问题，交回文件所有者修正，最终静态组合仍待复验。
- `DedicatedComputeScheduler` 已有优先级、合并、依赖和候选确认预算实现，但尚未接入 Host。新增 Host 用例要求单槽、提交前保留结果预算、关停持续收回 mailbox 以排空队列；预期 RED 尚待可执行窗口，正式接线随后进行。
- 默认产品资源合同中的独立 Authority 与 persistence lane 尚未完成。Linux 产物、硬故障恢复、正式 wire、GUI、远端部署与全部性能准出仍待实施/验收。

额度快照于 17:46:23 UTC 读取：账户周额度已用 48%、剩余 52%，为跨任务共享窗口；不能将相对早先快照的变化归因本任务。当前工具未提供本任务分模型实耗明细，实际 credits/API 等价成本保持 unknown；未兑换 reset。

### 19:16 阶段更新

以下为对前述历史待补项的最新覆盖，不删除先前失败记录。WASM 明确交还约 5 分钟功能窗口，本方约 19:11:25 UTC 取得预留，仅 root 串行执行，19:16:26 UTC 完成释放并明确交还；本轮未运行 benchmark。

- `DedicatedServerHost` 已实际接入 `DedicatedComputeScheduler`。候选到达 mailbox 后继续持有结果预留，权威 apply 成功才 acknowledge，失败则 fail；`waitForIdle` 与关停通过事件驱动逐步收回候选、推进排队任务，避免等待全部 Promise 才提交造成死锁。配置单槽的新增用例先 RED（实际 dispatch 3 次），修复后 Host 7/7。
- 取消资源终止槽、scheduler 满预算合并和全生命周期任务数的新增回归已通过。compute/scheduler/queue 与 Host 首轮合计 48 项仅上述 Host 预置 RED 失败，其余 47 项通过。
- Node 22.23.2 全仓串行 coverage 通过：162 个测试文件通过、2 个跳过，853 项通过、4 项跳过；耗时 153.01 秒，`src/world/**` 行覆盖率 96.37%。命令为 Node 22 执行 `vitest run --coverage --maxWorkers=1 --no-file-parallelism`。这轮没有并发 coverage，也未复现先前超时/报告目录竞争。
- 全项目类型检查通过，当前三个 Node ESM 入口重新构建通过（`sourceSha=485de57`，dirty source，非已提交交付版）。此次未重新运行浏览器生产构建，不沿用旧构建证明后续源码。
- 修改文件已由 Prettier 格式化。全仓 ESLint 有一个失败：`node-compute-executor.ts` 有效 503 行，超过 500 行规则；计算子任务随后将输入校验按职责提取到 `node-compute-task-validation.ts`，没有压行规避。该重排未复验，最终静态准出仍待补。
- 独立复审发现显式 `computeResultBytes` 可以大于总 `mailboxBytes`，会使任务因预算永久拒绝；已补配置不变量用例，RED 尚未运行，修复待下一窗口。独立 Authority/persistence lane 的接线设计已完成，尚未实现。完整 migration、正式网络/GUI、Linux/远端和性能准出均保持未完成。

本窗口释放后，root 与全部子任务再次暂停测试、构建、Chrome 和 benchmark，等待 WASM 构建及最终复测后的明确交接。

### 资源交还后的第三批接线

WASM 任务最终明确交还全部资源，并报告本地提交 `1580dcd`；本任务恢复功能开发，未自动合入其代码。后续正式性能采样继续走共享预留并暂停全部功能验证。

- 19:47:41–19:48:57 UTC 完成一轮有预留的 C0/MP/C2 合成探索采样，30 batch、每阶段累计至少 100 ms。MP 是补充 MessagePack 探针，不能替代批准合同中的 schema binary C1。真实 C1 仅完成合成功能验证。
- 进一步复审确认合成语料与生产的 string epoch、`-1` 初始 ack、输入字段及实际 archetype 不一致；大多数所谓畸形用例只调用共享 DTO validator，没有经过各 codec parser。已纠正证据并取消计划中的下一轮计时，四组探索均不能作为 N2 准出。网络子任务转向真实 Host 公共投影与采集；参考 [真实语料计划](network-real-corpus-plan.md)。
- 预算配置预置用例取得 RED 后，`computeResultBytes >= mailboxBytes` 现在启动即拒绝；Host 与 executor 聚焦 29/29 通过。文件行数拆分后的 executor 同批通过，完整静态复验仍待最终接线稳定。
- Sol 负责持久化 Worker、同步缓存 proxy、文件锁与关停；Terra 接手 Authority Worker、共享有界 RPC 和异步 façade；root 负责产品组合 `node-server-runtime.ts`、CLI、五入口构建和离线验证。文件所有权已重新明确，原 inline runtime 保留为参考。
- 产品组合的顺序关停、启动失败反向清理、存储线程故障、关停 deadline 不提前释放写者四项隔离生命周期测试通过；五入口真实 artifact 用例已取得缺失独立 lane 的 RED，实际 GREEN 等两 lane 接线完成，不能以 mock 结果代替。
- 交叉审查覆盖 queued cancel 后不得发送写、inflight 超时释放 peer 预算、duplicate id/bad ACK 的 fail-closed、重叠 prepare 不得误报 missing、close 期间新写准入及 Authority fatal 的资源清理。各实现者先补回归再修复，整个 Node 迁移仍未准出。

### 五入口离线闭环与最新检查

- Node 22.23.2/macOS arm64 的五入口产物真实启动、SIGTERM 关停、重启恢复通过（artifact 3/3）；Authority 与 Persistence thread id 均大于 0 且不同。产品主上下文只持异步 façade，不再持 Host/GameServer。顺序关停/启动清理/存储故障/deadline 的隔离测试 4/4。
- 真实主进程 SIGKILL 回归 1/1：先保存 hotbar slot 2，再执行未保存 slot 3，强制退出后恢复 slot 2 与同一 durable C、新 epoch。该用例使用实际五个 ESM 入口和测试临时控制入口，证明进程故障恢复，不是设备断电。另有实际 compute child 的父进程 SIGKILL/IPC 断开退出用例；现有 Node 行为通过，无需额外 handler。
- Node RPC 集成暴露 V8 serialize 字节数在不同 isolate 间变化，导致相同 DTO 被误判。改为稳定的 DTO 内容预算，已补 structuredClone 等价和循环/共享引用拒绝回归。此数值不是 opaque MessagePort 的真实 wire 字节，不用于 codec/网络体积比较。
- 20:19:02 UTC 开始的 `pnpm verify:static` 中，格式、ESLint、路径与完整 coverage 通过：169 文件通过/2 跳过，886 项通过/4 跳过，world 行覆盖 96.37%。仅 test TypeScript 三处诊断失败，已交原作者修正；随后完整类型检查与浏览器生产构建、`build:server` 通过。该次 coverage 只有 root 一个 runner，但 Vitest 内部采用默认并行；属于功能证据，不是计时样本。后续新增遥测/IPC 回归仍需最终静态复验。
- 禁网、非 root、只读容器根文件系统、临时数据目录下，官方校验的 Linux arm64 Node 22.23.2 对 thread/process 两种模式各完成启动、关停、同目录恢复；全部产物 hash 核验通过。见 [Linux 离线记录](linux-offline-evidence.json)。容器预装的 Node 22.2 不满足最低版本，首个临时测试还误发二次 SIGTERM，已排除该无效尝试并修正单次信号；正式记录来自单次信号和挂载的官方 Node 22.23.2。尚未验证目标 x64/CT105 或设备掉电。
- 持久化补充可选 measurementStatus，记录实际读/校验、decode、worker wall、RPC round trip，queue 标 not-collected、database 标 unsupported；缺省 status 不能当作已测量。文件与 proxy 聚焦 36/36、旧浏览器兼容 18/18；新 Node 报告尚未接线，不能宣称 A13 完成。
- README 与代码地图按已运行事实补充实验性宿主入口和五 lane 所有权，明确网络/GUI 尚不可用。冻结审核文档不改写，当前 change 仍 Active。

### 故障传播与参考消息补全

- 浏览器 headless 长期回归 8/8（22.7 秒）通过，仅功能断言，不采纳其运行耗时为性能收益。
- 独立审阅后，CLI 信号监听覆盖异步创建与诊断窗口；关停意图优先于 ready。4 项可控生命周期回归和真实启动屏障用例证明 ready 前 SIGTERM 被接管、不发布迟到 ready、最终 stopped 后目录可立即重开。
- 共享 RPC 新增 client.whenClosed 的一次性带原因终态；server.whenIdle 和 activeHandlers 保留已开始 handler 的真实状态，close/abort 不等于业务取消。Authority 则区分即时 whenFailed 与实际 whenExited/cleanup-complete，Runtime.whenFailed 及时可见，whenStopped 仍跟踪物理清理；CLI 失败后启用外层关停期限。控制回复逐 kind 校验，publication ACK 使用 5 秒内部健康期限（不是网络 SLO）。跨 port 的关闭/故障顺序仍在按独立审阅收口，最终准出待复验。
- 真实 publication 复验发现 snapshot.player 与 entities 中玩家共享对象，通用 RPC DTO 计量拒绝该图导致首次发布失败；修复为 publication 专用别名计量，循环明确拒绝，控制 RPC 仍用严格 DTO 合同。实际 artifact/crash-recovery 4/4 随后通过，不能用此前只有空 snapshot 的 mock 代替该证据。
- Persistence.close 不再内置 30 秒提前终结物理清理；外层期限超时而内部继续等待 store-closed。显式 close 失败也会在已接纳写入结束后排空 RPC 并关闭端口/退出 Worker，保留异常 LOCK 供核验，绝不伪报 durable。真实 LOCK token 不符回归先 RED 再 GREEN，Persistence 4 文件38项、连共享 RPC 聚焦46项通过。
- 公共 reference 已覆盖真实 welcome、player correction（含 worldTime）、Gameplay 的 epoch/快照锚点、非精确 WorldCommit 上界和真实完整 baseline。Hash 使用注入的 SHA-256 适配，未手写算法；原始 uint16 buffer 还不是正式网络 LE 编码。真实受控 seed/Host/World.edit/生成数据的 change 专用 corpus runner 通过，长期 unit 不反向依赖历史 change recorder。
- 动作 reference 将业务成功与事务执行成功分开；Authority 准入时冻结 submittedAction 并进入原幂等回执，拒绝同一 key 用新 payload 重标原结果。非执行回执不携带无法绑定的 action，执行 C 与观察 C 分开，durable C 仍明确 null（未查询）。按动作约束失败原因并交叉校验 place revision；这是参考投影，不证明公开网络、回执保留/重连或持久化成功。
- 剩余 PD、24h 连续关键路径、分模型费用情景与共享额度快照见 [阶段滚动估算](stage-estimate.md)。实际 task credits/工时仍 unknown，未以账户变化伪造实耗。

### 阶段检查点

最终完整 `verify:static` 通过：174文件通过/2跳过、910项通过/4跳过，world行覆盖96.37%；浏览器/Node构建、headless基线8/8、change corpus1/1、最新Linux离线两模式复验均通过。Authority的跨port故障现在通过parentPort请求cleanup，不再抢先terminate；已在途stop和迟到stopped也不能覆盖failed。全部源码冻结后的统一证据与A1–A14剩余状态见 [阶段验证快照](validation-summary.md)。保存本地语义检查点，整个change继续Active，不push、不自动采用codec/transport。
