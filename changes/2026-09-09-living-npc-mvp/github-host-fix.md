# A2 GitHub Host Correctness 修复报告

固定合同：`living-npc-github-host-fix`，SHA-256 `2f3a6aa2bfc873a8714e346dfe48b8fc950b9476a3b6105791a850abc3fa3b81`。冻结基线：`6a24891142dc0abc196a8c07c2488eb308f902fe`。

## 变更

- Pro 压缩被 pause/dispose/deceased 取消时不再在硬阈值生成确定性 prepared rotation；若模型忽略取消并迟到返回候选，Runtime 会在 memory 请求发出前显式拒绝候选。已经发出的 memory 请求及其暂停期间 ACK 处理保持原语义。
- DeepSeek transport 不再使用无界 `response.text()`。成功响应通过 reader 逐 chunk 累计 UTF-8 原始字节，超过 `maxResponseBytes` 立即取消 reader 并拒绝；Content-Length 预判超限以及 HTTP/429 错误也取消未消费 body，Retry-After 保留。零长度 chunk 不进入累积数组。
- 已取消的调用信号在 fetch 前终止；外部 abort listener 只在需要时注册，并在 finally 中移除。超时 timer 同样只在实际请求前创建并清理。
- `follow` 工具 schema 与本地 validator 只接受 `entity` target；可见 POI 仍可由只读工具检查，但 `available_actions(ref=POI)` 不再宣称支持 follow。
- Flash 调用期间若收到不同 observation cursor，即使 character revision 不变，也丢弃旧模型提案而不发 intent；新事件留在上下文，并经 scheduler 有界 debounce 重新决定。非 significant event 同样触发一次 fresh re-decision。
- Authority 以 `CHARACTER_REVISION_CONFLICT` 拒绝 intent 时，Host 不信任可能仍为旧值的 receipt cursor。它等待 cursor 前进或 revision 改变的新 observation；等待期间 fallback/deferred dispatch 被挡住，避免对旧快照紧密重试，之后用新观察重新调度。

## 验证

- RED：修复前聚焦命令产生 6 个预期失败，分别证明 POI follow 被错误接受、旧 cursor Flash intent 被发出、硬阈值 pause 留下 prepared rotation、分块响应未有界读取、Content-Length 超限未取消 body、pre-aborted signal 仍进入 fetch。
- GREEN：`./node_modules/.bin/vitest run tests/agent-server/github-host-fix.test.ts tests/agent-server/runtime.test.ts tests/agent-server/context-session.test.ts tests/agent-server/deepseek-transport.test.ts tests/agent-server/cognition-graph.test.ts`：5 files / 28 tests 全部通过。
- 回归包含真实协议形状的 `CHARACTER_REVISION_CONFLICT` 且 receipt cursor 等于旧 cursor；180 秒 fallback 推进期间模型调用数不增加，直到新的非 significant observation 到达才重新决定。
- 回归验证高 cursor 事件在旧 Flash 提案丢弃后仍存在于下一次请求，旧 tool call 不进入历史，最终 intent 使用新 `observedCursor`。
- 回归分别验证 streamed overflow、Content-Length quick reject 和 HTTP error body 的取消，以及 pre-aborted 请求完全不调用 fetch。
- 修改文件的 `git diff --check` 通过。生产源码和既有 runtime 测试文件均低于 500 行；含新增聚焦测试的本次净新增约 400 行。

## 风险

- 本实施者未运行 provider、Browser、安装、全量测试或全局构建。真实 Browser + Flash 由 Root 在冻结源码后验证；Root 同时负责 expectedCursor 的 Bridge/Authority 传播及全局门禁。
- 外部 abort 目前沿既有 transport 分类表现为 timeout；Runtime 在 pause/dispose/deceased 路径会丢弃该状态，因此没有扩大 wire 或日志内容。
- Host 只在收到新 observation 后重试 Authority cursor/revision conflict；这有意依赖 Bridge 的正常轮询，避免在未知新世界状态上重放旧决定。

## 实际成本

- 本次约 0.35 agent 小时，低于 1.5 小时合同上限；未派发子任务，未做外部写入。
- 真实模型与 Browser 调用 0，API 费用 0。
- token、credits 与平台计费分母不可见，记为 unknown。
