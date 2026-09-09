# ChatOpenAI 扩展字段往返准入

日期：2026-09-09。固定依赖：`@langchain/openai@1.5.11`、`@langchain/core@1.2.9`。

本地无真实供应商的 OpenAI-compatible HTTP fixture 返回标准 `tool_calls`、`reasoning_content`，并在 message 与顶层响应分别加入 `provider_message_id`、`provider_trace`。标准 `ChatOpenAI` 保留了工具 ID、参数与 `reasoning_content`，但丢失了另外两个 opaque 字段，无法形成提案要求的完整请求/响应审计引用。

因此启用 `GatewayChatModel` 薄适配：仍继承标准 `BaseChatModel`、使用标准 Human/AI/Tool message 与工具绑定，只保存并转发 OpenAI-compatible 消息；完整原始 message/response 放入 `additional_kwargs`，由 workspace journal 无损持久化。再次发送历史消息时会过滤这两个 `gateway_raw_*` 审计字段，避免将其递归发给上游；原生 reasoning 和 message 扩展仍会保留。畸形工具 JSON 进入标准 `invalid_tool_calls`，不会静默丢失。

适配器不实现重试、排队、供应池或供应商路由。外部 `AbortSignal` 和本地 `timeoutMs` 都约束唯一一次 `fetch`，测试确认超时不会产生第二次尝试。fixture 使用逻辑档位 `flash`/`pro`，没有真实模型名或凭据。

可执行证据位于 `tests/agent-server/gateway-model.test.ts`。
