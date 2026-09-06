# Node 宿主平台接线进度

## 接口

- `createNodeDedicatedRuntime(options)` 异步返回 `NodeDedicatedRuntime`。必要参数为 `seedText` 与 `dataDirectory`；可配置 `generatorVersion`、`worldId`、`computeMode`、compute 产物 URL、持久化/宿主/compute 限制、单 lane `poolSize`、单调时钟、唤醒间隔和停止期限。
- runtime 公开唯一 `epoch`、`host`、`state`、`diagnostics()`、`stop()` 与 `whenStopped()`。`whenStopped()` 只等待终态，不会触发关停；`stop()` 返回同一个幂等 Promise。
- 三个 compute lane 分别创建执行器，全部绑定同一 `expectedEpoch`。默认 `inline`、每 lane 单槽；worker/child 模式由调用方传入显式产物 URL。
- Node timer 持续调用宿主 `wake`，世界时间与权威周期不依赖客户端连接或网络消息。
- 关停先停止 timer，再等待宿主收完已接纳工作并发布最终冻结检查点，最后关闭文件存储。停止期限只使调用方得到明确失败，不会提前释放仍可能写入的存储资源，也不会把超时工作宣称为 durable。

## RED / GREEN

### RED

- 命令：`pnpm exec vitest run tests/node/dedicated-runtime.test.ts --no-file-parallelism --maxWorkers=1`
- 初始结果：失败；测试文件因 `src/node/runtime/node-dedicated-runtime.ts` 尚不存在而无法导入，`0 test`，符合先写平台合同再实现的预期 RED。
- 同序列存储保护补强后的真实 Host+File 回归曾为 `7` 项中 `2` 项失败。重启实例在未推进物理 tick 时执行初始化 body 恢复/刷新，最终 Gameplay 已变化但宿主未增加 `commitSequence`，因此被存储正确识别为“同序号不同内容”。宿主随后让激活、清输入和暂停导致的可持久化权威变化登记新提交序号，并以纯 snapshot accessor 刷新公开快照。

### GREEN

- 首轮实现命令：`pnpm exec vitest run tests/node/dedicated-runtime.test.ts --no-file-parallelism --maxWorkers=1`
- 首轮结果：`1` 个测试文件、原有 `6` 项全部通过，覆盖无客户端时间推进与输入过期、真实目录重启恢复、新 epoch、同目录双开、幂等停止与最终保存、compute 启动异常清理以及存储启动异常隔离。
- 最终 Node 22 命令：`PATH=/tmp/seedlands-node-22/node-v22.23.2-darwin-arm64/bin:$PATH pnpm exec vitest run tests/node/dedicated-runtime.test.ts --no-file-parallelism --maxWorkers=1`。
- 最终结果：`1` 个测试文件、`8` 项全部通过。除首轮范围外，新增证明移动中玩家已保存后立即停止会以更高序号保存清输入后的零水平速度，以及真实文件自动保存失败会清输入、拒写、主动结束 runtime、明确拒绝 terminal/stop 并最终释放目录锁。
- Coverage 隔离复验：同一 Node 22 单 suite 加 `--coverage` 后 `8/8` 通过，测试耗时 `40.01s`；因此 suite 使用 `30s` 单项上限容纳真实启动在 V8 coverage 下的开销，不改变内部 wait、关停期限或负载。聚焦 coverage 命令最终仅因单文件无法满足全仓 `80%` 行阈值而非零（聚焦报告 `47.78%`），不能据此宣称全仓 coverage 通过。
- 静态局部检查：`src/node/persistence`、`src/node/runtime` 及两个聚焦测试的 ESLint 通过；相关路径 Prettier check 与 `git diff --check` 通过。

## 生命周期与失败语义

- 启动顺序为文件存储、三个 compute executor、权威宿主、timer；任一步失败都逆向关闭已创建执行器并释放存储锁，清理本身失败时以 `AggregateError` 保留全部原因。
- timer 的同步异常会停止后续唤醒并进入完整关停路径；诊断保留失败原因。
- timer 每次 wake 后也检查宿主失败态；异步自动保存失败、residency 保存错误或 compute executor 健康降级不会被 fire-and-forget 路径吞掉。宿主先清输入并拒绝新写入，runtime 随后主动关停并让 `whenStopped()` 明确失败。
- `stop()` 的 deadline race 不取消后台关停。若期限耗尽，runtime 保持 `stopping` 且存储锁仍在；实际宿主保存和存储关闭完成后，`whenStopped()` 才报告真实终态。
- 成功结果只返回宿主已确认的 `durableCommitSequence`；文件存储关闭发生在该最终保存完成之后。

## 已知边界

- 本批不包含 HTTP、WebSocket、CLI 或产品构建；这些由主线组合。
- 当前本机聚焦验证使用 Node `v22.23.2` 与 macOS Darwin `25.6.0 arm64`。Node 22 的真实离线产物启动、worker/child 三产物 URL 和信号退出由主线补证。
- runtime 支持 compute poolSize 配置，但本批聚焦验证使用 `inline` 单槽；多槽并发、进程崩溃恢复与资源诊断由 compute 子任务单独验证。
- Linux 设备断电未验证；runtime 的成功停止只证明应用层等待了当前平台返回的 durable 保存，不扩大文件存储的设备级保证。

## Authority lane P0/P1 收尾（2026-09-07）

### 完成内容

- `NodeAuthorityLane` 新增 `whenFailed(): Promise<Error>`。它在首个 Worker 逻辑 fatal、控制 RPC 的非本地主动终态、publication 合同错误或 publication 端口错误时立即结算；`whenExited()` 继续只表示实际 Worker 退出。这样主 runtime 可在物理清理尚未完成时立刻进入 failed，而不会把失败延迟到 Worker exit。
- Authority Worker 的 fatal 顺序改为：停止 timer/发布与新 RPC → 先向父线程发送 `fatal` → 后台执行 `host.stop()` 和 RPC `whenIdle()` → 发送 `cleanup-complete`。façade 在 failed 后的 `stop()` 等待该 cleanup-complete 才拒绝原失败，因此主 runtime 不会因已关闭 control RPC 立即失败后抢先关闭 Persistence writer。
- Authority 使用通用 RPC 的 `whenClosed()` 区分本地主动 close 与 peer/transport/protocol/request-cancel 故障；非本地终态立即反映为 `whenFailed()`。Authority Worker 同时等待通用 RPC server 的 `whenIdle()`，避免仅因 ledger 已清空就把仍在运行的 handler 当作已物理收尾。
- Authority 请求/回复合同改为逐 kind 运行时校验：输入回执必须是已知 `SequenceDecision`；动作回执、checkpoint、空回复、诊断和 stop 回执分别检查调用方实际消费的字段与整数边界。stop 不再接受空对象。
- publication 入站消息要求绑定当前 epoch、单调非负序号，以及 `snapshot`、`commits`、可选 gameplay/resync 的可消费外层 shape；畸形 publication 不进入 latest 缓存。每个已发送 publication 等待 ACK；默认 `5s` 是 Node Worker 内部健康门，专门防止 MessagePort 无确认永久占用，不是网络传输 SLO 或对客户端的时延承诺。ACK 端口 close/messageerror 与超时均进入失败路径。

### RED / GREEN 证据

- RED：`tests/node/authority-lane-protocol.test.ts` 初次执行 `3` 项中 `2` 项失败：旧回复校验接受无效 input/空 stop 等对象，且没有 publication validator 导出。这确认了逐 kind 回复与 publication 入站合同缺口。
- GREEN：`pnpm exec vitest run tests/node/authority-lane-rpc.test.ts tests/node/authority-lane-protocol.test.ts tests/node/authority-lane-failure.test.ts tests/node/node-server-lifecycle.test.ts tests/node/node-server-runtime.test.ts tests/node/node-server-artifact.test.ts`，`6` 文件 `26/26` 通过。覆盖通用 RPC 账本、逐 kind 回复、publication epoch/shape、Worker fatal 先可见后 cleanup、control transport close、畸形 publication 回收、主 runtime failure gate、CLI 生命周期以及 worker/child 真实产物启动关停。
- Static：`pnpm exec tsc --noEmit --pretty false` 通过；本次 Authority 源码与两个新测试的 Prettier、ESLint 定向检查通过。

### 当前状态与边界

- 本段源码已冻结，等待主线统一 final static/build/artifact/Linux 复验；本记录不把定向 Vitest 替代这些独立证据。
- Authority failure 只表示不能继续宣称健康或 durable 成功；文件 writer 的真实收尾仍由 Runtime 的停止顺序和 `whenStopped()` 跟踪。超时调用者只得到 timeout，不能据此推断 persistence 已释放。

### Publication 引用图修复（2026-09-07）

- 真实 `AuthorityRuntime.snapshot()` 规定 `snapshot.player` 与 `snapshot.entities` 中同一玩家项可以是同一对象。此前 publication 误复用 control RPC 的 `measureNodeRpcBytes()`，该计量按 control DTO 合同拒绝所有共享引用，导致真实 crash-recovery 首个 publication 被错误判为协议失败。
- publication 改用专用确定性引用图计量：对象第一次出现计内容，已见对象只计固定引用成本；循环引用无公开语义，明确拒绝。TypedArray/ArrayBuffer 仍按实际字节计入；总 publication 预算为 `16 MiB`。控制 RPC 保持原有“循环或共享对象引用均拒绝”的严格 DTO 规则，未被放宽。
- Worker 发送前和 façade 接收时都运行 publication 合同与该专用预算校验，避免发送侧先结构化克隆超预算/非法 graph 后才由接收侧失败。
- RED：Sol 复现 `tests/node/node-server-crash-recovery.test.ts` 真实失败，堆栈定位到 `validateAuthorityPublicationMessage → measured(message)`；原因是 snapshot.player 与 entities 的玩家条目别名。
- GREEN：`tests/node/authority-lane-protocol.test.ts` 新增真实 `AuthorityRuntime.snapshot()` 别名回归并通过；`pnpm exec vitest run tests/node/node-server-crash-recovery.test.ts tests/node/node-server-artifact.test.ts` 为 `2` 文件 `4/4` 通过。`pnpm exec tsc --noEmit --pretty false` 通过。

### 控制端口故障与迟到停止回执收口（2026-09-07）

- 控制 RPC 的 peer/transport/protocol 非本地终态不再由 façade 直接 `terminate()` Authority Worker。façade 先结算 `whenFailed()`，再经仍存活的 `parentPort` 发送 `{ type: 'fail', error }`；Worker 将它统一纳入停止 timer、拒绝新请求、`host.stop()`、RPC handler 排空和 `cleanup-complete` 的既有清理路径。只有显式 `close()`、启动失败或 Worker 自身的 error/exit 处理物理终结。
- `stop()` 已在途时若 control port 同轮关闭，RPC 请求 rejection 可能先于 `whenClosed()` 的 failure observer 抵达。façade 会等待终态原因，记录非本地失败并继续等待 `cleanup-complete`，不能把调用方提前结算为普通 RPC 关闭错误。
- 父线程收到迟到 `stopped` 成功回执时，已有 failure 保持 `failed`；已在途 `stop()` 在清理完成后拒绝该失败，不能覆盖为 stopped 或向 Runtime 暗示 writer 已安全释放。
- RED/GREEN：`tests/node/authority-lane-failure.test.ts` 的 control-close 屏障 fixture 先关闭 control port，再收到 parent `fail`，发送 `fatal` 和刻意迟到的 `stopped`，最后由 persistence-port barrier 放行 `cleanup-complete`。旧实现会让已在途 stop 立即结算并留下未处理 rejection；修复后确认 failure 即时可见、state 始终为 failed、stop/whenExited 均不早于 barrier。畸形 publication fixture 也改为模拟 Worker 收到 fail 后有序清理，避免测试错误依赖 façade 自动 terminate。
- 定向验证：`pnpm exec vitest run tests/node/authority-lane-failure.test.ts tests/node/authority-lane-protocol.test.ts`，`2` 文件 `7/7` 通过；`pnpm exec tsc --noEmit --pretty false` 通过；Authority lane/Worker 与两份测试的 ESLint 定向检查通过。未运行全仓 coverage、完整 static 或 build，等待主线最终复验。
