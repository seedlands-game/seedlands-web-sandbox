# Living NPC GitHub Round 2 复核报告

冻结范围：`7c36c436f507d8401f13618411f233dbe34eb2f3..26ea89591e5f7a9a97c2a85dd04eaff2eb27d2d7`。已核对 `github-round2-recheck.json` 合同 SHA-256：`6f9212602e0107b5dcd8c3e677c5894e5329f5fac36364db3a8fbd41228a14d3`。读取前次 triage、两份修复报告、冻结 base 审阅规则及全部六个差异文件；只读静态复核，未运行测试、Browser、provider、依赖或 Git/repo 写操作。

## 变更

- `SchedulerDispatch` 增加可选 `retryAfterMs`。`CognitionRuntime.beginDispatch()` 仅在所有正常可派发前提已满足、但 `backoffUntil` 尚未来到时返回该正延迟；缺观察、暂停、pending receipt/memory、stale Authority 等拒绝仍只返回 `dispatched:false`。
- Scheduler 在该特定拒绝时恢复已取出的 reason 集合，并将唯一 debounce deadline 移至退避到期；不把普通未派发回调变为轮询。实际 `dispatched:true` 仍重置 fallback。
- terminal goal 的 danger 到期、无 `suspendedGoal` 路径清空 action/execution/stall/refresh，建立 `fallback-life` 的 active forage；有 `suspendedGoal` 的既有恢复路径仍恢复原 active goal。

## 验证

### 3967001265：退避事件恢复 — 已解决 P1

`runtime.ts:284-303` 先排除不可派发状态，再只为未到期 backoff 返回 `retryAfterMs`。`scheduler.ts:115-142` 只在 event、未 dispatch、有限正 delay 三个条件同时满足时保留原因并推迟 deadline；回调 finally 采用 `??=`，不会把已设 deadline 重写为普通 debounce。新到事件写入同一个 Set，故到期 reasons 稳定去重并合并。暂停会取消唯一 timer、恢复后以正常 debounce 重新排队；dispose 清空 reasons 并释放 timer。

`backoff-recovery.test.ts` 用真实 Runtime 覆盖 dialogue-heard 和 attacked：第一次 transport 失败、退避内较高 cursor observation、999ms 仍无第二次调用、到期后立即使用最新 cursor 重新决策。`scheduler.test.ts` 覆盖合并、不到期不重试、pause/resume、dispatch 后 fallback 和 dispose 零 timer。原 P1 已解决。

### 3967001269：terminal-goal danger recovery — 已解决 P1

`character-goal-runtime.ts:35-58` 在 danger 结束时继续 clear danger；有 `suspendedGoal` 时恢复它，无该状态时不复活 succeeded/failed 命令，而是清除残留动作/执行目标/计数并创建新 `fallback-life/forage/active`。两条恢复路径均只增加一次 record revision、记录一次 `fallback(danger-cleared)`、start 和 changed。

`character-danger-recovery.test.ts` 覆盖已 succeeded move-to 的两次 attack、危险仍 suspended 时导出 checkpoint、恢复后完成剩余危险时间并仅出现一次 fallback；另覆盖 failed follow target，不会复活旧 requestId。既有 active-goal flee 回归保持有 `suspendedGoal` 的恢复行为。原 P1 已解决。

## 风险

- 本复核没有执行 Root 正在负责的 full static/build、Browser 或真实 provider；这些结果不能由静态阅读替代。
- scheduler 使用 Runtime 与系统 clock 同源的 `Date.now()`；测试的 fake timers 同步推进该 clock。若未来注入独立 scheduler clock，backoff deadline 仍须保持同源。
- `dispatched:false` 的 fallback callback 保留已有的周期重排语义以防零延迟循环；本修复不会把它误识别为 backoff retry。

## 实际成本

约 0.28 agent-hour，低于合同 0.3 小时上限。未执行外部调用、测试、Browser、依赖操作、提交或外部写入。

## 独立审阅 Findings

未发现新的可证实 P0/P1/P2。覆盖：完整（限定的六文件 delta）。

Root补录：审阅者另行确认工作区仅测试增量（30秒截止与onTestFinished会话清理）没有改变断言和生产行为；异常路径仍释放两会话。
