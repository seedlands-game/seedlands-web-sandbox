# B 标准框架最小接入建议

本记录只做 API 准入检查，不实现产品宿主，也不改 workspace 依赖。检查日期为 2026-09-09。仓库当前已有 `@langchain/core@1.2.9` 与 `@langchain/langgraph@1.4.14`；隔离的 `/tmp` tarball 检查了当前发布的 `langchain@1.5.10`、`deepagents@1.13.3`、`@langchain/langgraph-checkpoint-postgres@1.0.5` 和 `@langchain/openai@1.5.11`。

由于 G 当前为 NO-GO，以下只是 G 修复并复验通过后的 B 实施边界。

## 推荐组合

1. 以 `langchain.createAgent` 作为标准循环，显式传 `model`、领域工具、`stateSchema`、`contextSchema`、`checkpointer` 与 `store`。持久状态进入 `stateSchema`，非持久的可信绑定进入 `contextSchema`。
2. flash/pro 使用宿主选择的两个固定模型对象或网关别名。模型和工具不得自行选择或提升 tier。模型客户端重试设为 0，确保最多 3 次和 Retry-After 只由网关执行一次。
3. 首选 `@langchain/openai` 的标准 Chat Completions 适配器指向已准入网关。B 的确定性测试必须证明它保留 `tool_calls`、`tool_call_id`、`reasoning_content` 和供应商 opaque 字段，并把 `AbortSignal` 传到 HTTP 请求。若标准适配器丢失合同必需字段，再实现一个很薄的 `BaseChatModel` 边界适配器；它必须实现 `_generate`、`_llmType` 与 `bindTools`，把额外字段放在 LangChain message 的 `additional_kwargs`，不拥有重试、队列或模型路由。
4. `PostgresSaver.fromConnString(...)` 作为 agent checkpoint；初始化时执行一次 `setup()`。`PostgresStore` 作为跨 thread 的 Store，使用其显式启动/建表和停止生命周期。数据库连接、schema 和释放由 Node 宿主拥有。
5. thread/checkpoint key 与 Store namespace 都由可信宿主从 `(worldId, timelineId, actorId, incarnation)` 绑定生成。浏览器、模型工具参数或模型生成的路径不得选择其他角色 namespace。

## Deep Agents 的使用边界

`deepagents.createDeepAgent` 会组合文件系统等内建能力，传入业务 tools 并不自动移除这些工具。NPC MVP 不应整体启用默认 Deep Agent。只在需要有界虚拟工作区时，选择性组合其 `FilesystemMiddleware` 与 `StoreBackend`：

- `StoreBackend` 接收显式 `BaseStore` 和宿主生成的静态/动态 namespace factory；不得使用缺少角色绑定的默认 namespace。
- 只公开已审阅的有界文件操作；移除默认子 agent、shell、任意文件系统和自主摘要能力。
- `CompositeBackend` 只有在确有多个已审阅存储域时才需要，当前不预建。
- Pro MEMORY 写入仍是单独、宿主授权的工作流。StoreBackend 只是持久化机制，不能证明 Pro-only、revision CAS 或 Authority 接纳语义。

## 需要 B RED 先证明的接缝

- 同一个完整工具回合经过 LangChain message 转换后，tool ID、公开 reasoning/opaque 字段仍可回送；私有推理不进入跨模型 MEMORY 摘要。
- `RunnableConfig.signal` 的取消真正到达网关；`timeout` 与 `maxConcurrency` 不被误当成网关全局策略。
- Postgres checkpoint 和 Store namespace 在断线、重连、incarnation 变化及并发 revision 冲突时隔离正确。
- 只启用领域工具与受限 StoreBackend 工具，默认 Deep Agent 工具不可达。

这些 RED 通过之前不增加产品依赖，也不在 Agent 内补写网关许可池。
