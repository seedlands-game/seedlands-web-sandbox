# Node Authority capture 控制端口失败进度

## 已完成

- 已在 `tests/node/authority-capture-control-failure.test.ts` 建立真实 Node Authority/Persistence/compute Worker 路径的定向回归。
- 测试专用 bridge 只转发 façade 实际 control port 与临时构建的真实 `node-authority-worker.mjs`；它用文件事件关闭对端端口，不伪造正常 response 或 Host。
- fixture 在 lane ready 后、返回测试 handle 前写入 gate；受控 compute wrapper 只在目标 chunk 的真实 `generate-canonical` 已被接收时写 marker，使用 `fs.watch` 在先、存在检查在后的顺序等待 release，再转发同一 task 与真实 compute response/ArrayBuffer transfer。不会因 capture 调用与启用 gate 的竞态漏过目标任务。marker 只证明 task 已到达真实 executor 的 wrapper，尚未证明 inner compute Worker 已开始执行。
- 正路径证明：控制端口断开后 capture RPC 立即以 `NodeRpcClosedError` 失败，`whenFailed()` 可见；bridge 记录 `fail` 已转给 inner 和 inner 真实 `fatal` 已转回后，测试创建 `lane.stop()` 并请求 `stop-probe`。未转发 cleanup-complete 的 `stop-pending` marker 与预注册的 release watcher 共同证明 stop 在 release 前不结算；release 后才等待真实 cleanup 并以失败结算。随后 fixture 按 Authority → Persistence → Authority close 的所有权顺序关闭，并以新的真实 Persistence lane 重开目录。
- 负对照仅让测试 bridge 故意提前报告 `cleanup-complete`，oracle 在尚未 release compute 时观察到提前 stop 结算。它是夹具故障敏感性证据，不是生产 RED，也不记录为真实 Authority 缺陷。
- inner Worker 的结束由 fixture teardown 单独记录；它不被误称为 production `whenExited()`。外层 façade Worker 仍只在 `lane.close()` 后由真实 Worker exit 结算。主进程 marker watcher 有 10 秒失败上限；dispose 即使 marker/inner/persistence 清理失败仍会 finally close façade 与删除临时目录，并以 AggregateError 保留异常。初始化失败也会关闭已创建 Persistence/lane 后删除目录。

## 验证证据

- 初始 RED：Node22 定向运行因缺少测试 fixture 模块失败，确认用例先于实现落盘。
- GREEN：`PATH=/tmp/seedlands-node-22/node-v22.23.2-darwin-arm64/bin:$PATH pnpm exec vitest run tests/node/authority-capture-control-failure.test.ts --no-file-parallelism --maxWorkers=1`，2/2 通过。
- Prettier 与目标 ESLint 通过。
- `pnpm typecheck` 已执行；当前阻断项以最近运行输出为准，并非本测试 fixture。修复本测试 fixture 后 TypeScript 输出未再报告本次新增文件。

## 未做事项

未运行全仓 coverage、生产 build 或性能采样；未覆盖多 capture 共享预留、浏览器取消或公开网络传输。
