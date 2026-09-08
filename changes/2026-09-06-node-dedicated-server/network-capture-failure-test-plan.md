# Node Authority capture 控制端口失败测试计划

## 目标

补足一条真实 `NodeAuthorityLane.captureBaseline()` 已进入异步 canonical 生成、但控制 RPC 端口断开的闭环证据。测试区分三个独立事实：

1. 通用 RPC 关闭会立即拒绝 main 侧 capture Promise；这是正确的调用方终态，不要求它继续 pending。
2. `whenFailed()` 必须在端口关闭后立即可见；随后调用的 `lane.stop()` 必须等待 Authority Worker 的 `host.stop()` 完成 capture 收尾并发出 `cleanup-complete`，再以失败终结。
3. Authority 不拥有独立 Persistence lane；只有测试夹具随后显式 `persistence.close()` 成功，才可把世界目录可重开作为 writer 锁已释放的证据。`whenExited()` 则仅在调用 `lane.close()` 后，随其 façade Worker 的实际退出结算。

这不是公开网络断链或吞吐测试，也不修改生产 API、Host、Worker 或 Persistence 的资源所有权。

## 最小真实 fixture

沿用 `authority-lane-baseline-capture.test.ts` 的真实 Vite 临时产物、真实 Authority Worker、真实 Persistence Worker 与真实 `node-compute-worker.mjs`。新增测试专用 outer bridge，仅解决 façade 私有 control port 不可由测试直接关闭的问题：

- façade 的 control port 接到 outer Worker；outer 以 `MessageChannel` 双向转发给 inner 的真实 `node-authority-worker.mjs`。publication 与 persistence port 仍直接转交 inner。
- outer 监听测试临时目录的 `close-control` 事件，关闭其收到的实际 control port。main RPC 因此收到真实对端 close；outer 不伪造 response、fatal、cleanup 或 stop 结果。
- main 随 failure 发送的 `{ type: 'fail' }` 由 outer 原样转给 inner。inner 的生产 `fail() → host.stop() → rpc.whenIdle()` 负责实际 Host 清理。
- outer 转发 inner 的 `fatal` 和 `cleanup-complete`，但不会因 cleanup-complete 自动 terminate inner 或自行退出。这样 bridge 不改变 Authority 的正常生命周期，也不会把夹具退出冒充为 production cleanup。

测试传入一个临时 worker-thread compute entry 作为 **受控转发器**：

- 未启用 gate 时，请求直接转交真实临时构建的 `node-compute-worker.mjs`，使 Authority 启动保持真实。
- fixture 在 lane ready 后、把 handle 交给测试前先启用 gate，再请求一个尚未驻留 chunk 的 mesh capture。转发器按目标 chunk key 过滤，收到该 capture 的真实 `generate-canonical` 后写入 `compute-accepted`，并以 `fs.watch` 等待 `release-compute` 后才转交完全相同的 task 给真实 compute Worker。
- Host drain 的 `baselineCaptures.beginClose()` 只标记 capture 取消，仍会等待其 `requestChunk()` 及 `baselineCaptures.whenIdle()`；因此 marker 证明目标 task 已被真实 Node compute executor 的 gate wrapper 接纳、但尚未转交 inner compute Worker 执行。它是 capture 已接纳但该段物理计算尚未完成的可控屏障，不声称 marker 已证明 inner compute 已开始。

临时目录、事件文件和 bridge 均仅属于测试 fixture；不向生产 options 增加测试标志。

## 执行步骤与断言

1. 创建真实 Persistence lane 与上述 Authority lane，等待 ready。以一个未驻留 canonical key 调用 mesh capture，并等待 `compute-accepted` 文件事件。
2. 在断端前确认 capture 未结算；如 diagnostics 可用，确认存在 pending capture/work。该步骤是 capture 被真实 Host 接纳的因果屏障。
3. 写入 `close-control`。断言 capture Promise 很快以 `NodeRpcClosedError` 或等价关闭错误拒绝，`whenFailed()` 解析且 lane state 为 `failed`。bridge 还必须先记录 main `{ type: 'fail' }` 已转给 inner、inner 的真实 `fatal` 已转回 main。
4. 在 `lane.stop()` 已创建后写入 fixture `stop-probe`；bridge 只有尚未转发真实或负对照 cleanup-complete 时才写入 `stop-pending`。这证明 stop 依赖的 cleanup barrier 尚未结算。测试先注册“stop 与 release 谁先发生”的 watcher，再写 `release-compute`；正路径必须观察 release 先发生，随后才等待真实 compute 转发完成及 inner `cleanup-complete`，并断言 `lane.stop()` 以 failure 拒绝。它不能成功把失败覆盖为 stopped。
5. 按 `NodeServerRuntime.finishShutdown()` 的所有权顺序显式执行 `persistence.close()`；仅在它成功后，使用新的真实 Persistence lane 打开同一目录，证明 writer 锁已释放。
6. 夹具 teardown 显式请求 outer 结束 inner，并等待 `inner-exited` marker；这是避免测试遗留 Worker 的夹具清理，不是 Authority lifecycle 断言。最后调用 `lane.close()`，等待/断言 `whenExited()` 因真实 outer Worker exit 失败结算。记录 inner 已在 `cleanup-complete` 后退出、outer 仅在 `close()` 后退出的顺序。

## 负对照、RED 与验收

该路径可能在现有实现中直接 GREEN，不虚构生产 RED。测试先加入一个明确标为 **negative control** 的桥接模式：它在收到 inner `fatal` 后错误地提前报告/退出，测试应因 `lane.stop()` 或 `whenExited()` 先于 `release-compute` 结算而失败。再关闭该模式，运行真实 bridge 路径通过，证明 oracle 对提前物理终态敏感。

验收只运行 Node22 定向测试、目标 Prettier/ESLint 和 TypeScript。记录 marker 顺序与 Node 版本；主进程 fixture 的 marker watcher 有 10 秒失败上限，超时会关闭 watcher 并报 fixture cleanup 错误。该上限只防止测试残留资源，不是正确性 sleep、轮询或性能指标。

## 边界

本测试只覆盖单条 mesh capture 的 control-port failure。它不覆盖多 capture reservation、浏览器 cancel、网络分页、WSS/WebTransport、WAN 或性能。若 bridge 无法保留 `MessagePort` transfer 语义，应修测试转发器；不得退化为假 Authority、假 Host 或生产测试后门。
