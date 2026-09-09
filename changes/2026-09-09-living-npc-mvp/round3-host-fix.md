# A2 Round 3 Host 修复报告

固定合同：`living-npc-round3-host-fix`，SHA-256 `9a179455aed1418b9f1322fc81ecad2b0cbfb1fab845daef672f5bf5fb1d5d03`。冻结基线：`0ce2bfc3b53e6be179f6d315016972d4be5e1885`。

## 变更

- `CognitionRuntime` 将每个新连接收到的首个有效 active observation 作为历史基线：完整事件写入 `ContextSession`，同时把 `latestEventCursor` 与 `lastDecisionCursor` 设为 observation cursor，不发送事件通知。
- 因此重连返回的保留事件可用于后续认知上下文，但不会立即重复生成 speech/intent，也不会在 60–600 秒 fallback 到期后重放。
- 首帧绑定校验仍先于基线建立；非法 observation 不会消耗首帧。暂停中的非法 observation 保持 `paused` 状态。deceased 首帧仍先进入终态且不调用模型。
- 只有基线后的新事件继续走原有 debounce、并发、新鲜度和预算门禁。没有连接本机 Host 的 NPC 仍由世界侧确定性 forage 行为负责，本次没有修改协议或 core。
- 既有 runtime/backoff/GitHub correctness 测试改为显式先发送空事件 baseline，再发送触发事件，不再依赖已废止的“首帧历史即新事件”语义。

## 验证

- RED：新增重连回归在修复前失败；第二个 Runtime 收到同一 retained dialogue 后产生了 1 次 provider 调用，预期为 0。
- GREEN：`./node_modules/.bin/vitest run tests/agent-server`：11 files / 43 tests 全部通过。
- 主回归先让第一个 Runtime 在 baseline 后消费 dialogue 并接收 Authority accepted receipt；随后重建 Runtime，送入同一 retained event，推进 60 秒完整 fallback 仍为 0 调用。再送入 cursor 2 的新 dialogue 后只生成 1 个 intent，且请求上下文同时含 cursor 1 历史与 cursor 2 新事件。
- 补充回归覆盖暂停中非法首帧、随后有效无事件 baseline、resume 后完整 fallback 不调用模型，以及之后新事件正常唤醒。
- `git diff --check -- apps/agent-server/src tests/agent-server` 通过。生产 Runtime 433 行，既有 runtime test 487 行，新增聚焦测试 124 行；本次总新增约 173 行，低于 500 行限制。

## 风险

- 重连边界明确为“历史重建，不自动重放离线期间未确认的命令”。如果玩家希望 Host 对离线期间发生的旧 dialogue 采取新动作，需要新的产品/协议语义；当前合同明确不这样做。
- 本实施者未运行 provider、Browser、安装、全局格式化、全局构建或 Git 写操作。Root 负责真实 Browser + Flash 和全局门禁。

## 实际成本

- 本次约 0.20 agent 小时，位于原 cognition pool 内并低于 0.75 小时上限；未派发子任务。
- 真实模型与 Browser 调用 0，API 费用 0。
- token、credits 与平台计费分母不可见，记为 unknown。
