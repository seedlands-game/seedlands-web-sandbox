# A2 本机认知宿主实施报告

固定合同：`living-npc-compression-fix`，SHA-256 `643e3a0fed196f2fea5bddbe2042c6c622ed6fbdbe0292d02f1ad0ef0eedfe98`；基线源码 `b69c42d5d07165f4a37193e6dc5e8313733ed4ff`。

## 变更

- 新建 `apps/agent-server` workspace app，平台无关逻辑与 `src/node` 适配分层；提供 package `build`、`typecheck`、`test`、`start` 脚本。
- 使用 `@langchain/langgraph@1.4.14` 的真实 `StateGraph` 实现 `assemble-context -> model -> validate -> bounded-read/model 或 END` 显式图。最多 3 次真实模型调用；只注册 `inspect_visible`、`inventory`、`available_actions` 和唯一 mutation 工具 `propose_intent`，所有参数本地严格校验。
- DeepSeek Chat Completions 薄 fetch adapter 固定 Flash `deepseek-v4-flash-vision-exp` 文本决定与 Pro `deepseek-v4-pro` 压缩；完整回放 Flash assistant/tool history 及 `reasoning_content`。错误不含响应正文或密钥。
- Pro 压缩从输入硬剥离 provider reasoning，并把完整公开历史编码成一个普通 `user` 数据文档；每条记录标明 `authority-event`、`authorized-observation`、`prior-memory`、`perceived-input`、`model-proposal`、`model-utterance`、`authorized-read-result` 或 `authority-receipt` 来源，以及 confirmed/observed/untrusted/unconfirmed 可信度。Pro 不再收到可续写的原生 Flash assistant/tool 协议轮次。
- Pro 仅可返回纯文本摘要；任何 `tool_calls`、DSML/工具控制标记、空内容或超过 16000 字符的结果均拒绝。软阈值失败保留旧历史；硬阈值仍生成经过控制标记转义的确定性候选，且必须等待 Authority ACK 才提交。
- 压缩冻结 cursor 与历史长度，压缩期间新事件留在尾部。结果先发 `memory` 请求，Authority accepted/succeeded 后才原子切换；拒绝保留旧历史。暂停期间到达的 memory 或 intent 回执仍完成必要对账，但不会把运行态错误改回 ready。
- event debounce、单请求并发、session token/call budget、transport backoff 和 60..600 秒 active-time fallback 独立。普通 observe 不重置 fallback，scheduler 仅在 runtime 同步确认 provider work 已派发时重置；暂停保留剩余 active time且不补洪峰。
- Authority intent 回执会补齐原始 `propose_intent` tool pair。accepted 即结束这次认知提交等待，世界中的持续目标不会阻塞后续对话；迟到旧 requestId 回执不改变当前决定。
- Loopback WebSocket 使用 exact Origin allowlist、首帧显式配对、不可变 `(sessionId, worldId, epoch, entityId, incarnation, policyRevision)`、双向单调 sequence、共享 128 KiB UTF-8 frame 上限、256 KiB backpressure、默认单连接和完整 dispose。
- CLI 默认 `ws://127.0.0.1:8787/`；`AGENT_SERVER_PORT=0` 可随机端口。stdout 只输出实际 URL、临时配对码和可用状态。密钥解析优先 `DEEPSEEK_API_KEY`；复用 `MIDSCENE_MODEL_API_KEY` 时强制同时使用 `MIDSCENE_MODEL_BASE_URL`。
- 状态 usage 的 `estimatedCostUsd` 根据 2026-09-09 公开 Flash/Pro hit、miss、output 价目保守估算，不冒充实际账单；预算明确为 runtime session 生命周期，不声称小时自动刷新。

## 验证

- `corepack pnpm --filter @seedlands/agent-server test`：8 files / 32 tests 全部通过。新增覆盖真实 Pro RED 形态：压缩请求只有 system + 单个 source-labelled user 数据文档，proposal/receipt/observation/prior-memory 语义区分，private reasoning 缺席；分别拒绝 `tool_calls`、DSML 控制标记、空内容和超长摘要且不替换旧历史。另覆盖暂停期间 intent 与 memory 两条迟到回执路径，回执后状态保持 paused。既有多只读工具批次、同 revision 新事件尾部保存、memory ACK 原子切换、scheduler、生命周期、密钥脱敏与 WebSocket 边界回归继续通过。
- `corepack pnpm --filter @seedlands/agent-server typecheck`：通过。
- `corepack pnpm --filter @seedlands/agent-server build`：通过，生成 ESM Node bundle；共享 core value 已打入 bundle，产物没有遗留 `@seedlands/game-core` TypeScript runtime import。
- `prettier --check apps/agent-server tests/agent-server`、`eslint apps/agent-server/src tests/agent-server`、`git diff --check -- apps/agent-server tests/agent-server`：通过。
- CLI 产物在显式清空 DeepSeek/Midscene 环境变量后，以随机端口启动并输出 `modelAvailability:"missing-key"` 的 machine-readable metadata；SIGINT 正常退出。另一次只判定现有进程环境可用状态的启动检查也未调用模型。两次均没有读取 `.env` 或输出密钥。
- 本次实施者未执行真实模型请求。真实 Pro 修复复验仍由 Root 执行；本报告只证明确定性请求形状、拒绝路径和状态机回归，不能代替 provider 语义验收。

## 风险

- 服务重启只从世界持久摘要与 Authority 最多 128 条近期事件分页重建新会话；112K 软阈值前尚未压缩的早期 Flash 私有 history 会丢失。本实现不宣称断连恢复完整 provider history，也不会把私有 reasoning 写进世界。
- `estimatedCostUsd` 是代码内固定的公开价目估算，供应商改价后可能过时，且不等于账单。真实成本以 provider 账单为准。
- V01-V05 属于 A1 世界/身体所有权，V08 的真实模型闭环、V09 Browser 旅程和 V10 根门禁/CI/独立审阅由 Root 聚合；A2 focused tests 只证明本机宿主边界与 mocked transport 行为。
- 默认只允许一个 WebSocket 连接；重连会新建连接内 Flash history，并依赖 Authority cursor 对账。配对码仅在进程内有效，但同一进程生命周期可用于重连。

## 实际成本

- 本次增量墙钟约 0.25 agent 小时，位于 cognition 既有 17 小时分配内且低于本次 1 小时上限；未派发子任务，未做外部写入。
- 本实施者真实 API 调用 0 次，实际 API 费用 0；mock 与本地构建不产生模型账单。
- token、credits 与平台计费分母不可见，标记 unknown；不做伪造换算。
