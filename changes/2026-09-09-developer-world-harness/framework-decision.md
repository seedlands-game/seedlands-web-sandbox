# 下一阶段 Agent Harness 框架决策

2026-09-09。此决策替代上一轮对 OpenAI Agents SDK 的优先推荐。H1/H2 不安装任何生产模型 SDK，不调用模型；下述版本只固定本次隔离实验。

## 结论与选择口径

下一阶段采用 **LangGraph JS 的显式状态图 + DeepSeek V4 薄协议适配器**。先用 Flash 验证日常决定，Pro 作为同 fixture 的质量候选；不自动用 Pro 补偿失败而突破预算。应用只实现世界相关状态机、预算、上下文与协议映射，不自建通用 Agent 平台。

这是协议与生命周期适配选择，不是性能、智能或成本胜出的结论。没有真实模型 A/B，不能声称 Flash 足够聪明，也不能把 mock 测试叫 DeepSeek 联调通过。下阶段先完成下文准入，再安装到独立认知宿主；SDK 不进入 core 或浏览器世界包。

| 候选                       | 已核验能力                                                                                                                 | 本次约束下的结论                                                                                                                                                                                                                                 |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| DeepSeek Harness           | 官方开源 Cordis 插件体系，持久 session、工具与回路；有 `sdk-minimal`，并非只能作为编码 CLI。TS 客户端启动同版本 dsh 子进程 | 认真纳入后暂不采用公共 TS SDK：官方明确不支持单轮取消，只能关闭整个 runtime；`run()` 返回整段活动到 idle 的最终回复，不能直接当作一个世界 request 的结果。直接组装底层插件可以再研究，但需自行拥有 profile/插件/取消边界，当前不是最短已验证路径 |
| LangGraph JS + 薄 provider | 显式节点、checkpoint、interrupt/resume；把动作提交与等待回执放不同节点                                                     | 推荐。隔离实验已验证暂停与恢复不重复提交；应用仍须持有 request ledger，不能误把图 checkpoint 当世界提交                                                                                                                                          |
| LangChain `ChatDeepSeek`   | 有 DeepSeek 专门适配、工具、流、AbortSignal；当前版本保留入站 reasoning 字段                                               | 当前默认 outbound 路径在实验中丢失历史 `reasoning_content`，不直接采用。可在上游修复后用同实验重新准入；LangGraph 并不要求用它作模型 transport                                                                                                   |
| OpenAI Agents SDK          | 完整工具回路、运行取消、session、guardrail 与 tracing，可自定义 Model                                                      | 默认 Chat Completions 适配在同实验也丢失该字段。写自定义 Model 可修复，但外部动作 accepted/terminal 仍需应用断点，当前没有优于显式图的证据。上一轮只核查 OpenAI 资料就优先推荐，依据不足，撤回                                                   |
| 直接 API + 完全自建回路    | 能控制所有协议字段                                                                                                         | 保留薄 transport，不重写通用图执行、暂停与 checkpoint。仍由应用管理世界权威、预算和知识来源，这是框架不会替代的职责                                                                                                                              |
| 托管 Agent Sandbox         | 可复用远端运行环境                                                                                                         | 不满足本阶段轻后端/本机认知宿主约束；未做性能或价格淘汰                                                                                                                                                                                          |

DeepSeek Harness 的预览状态与取消限制见[官方项目](https://github.com/deepseek-ai/deepseek-harness)、[架构](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md)、[TS SDK 的 Known Limitations](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/sdk/client/README.md)。后续若其公共协议支持可关联、可取消的单轮与外部回执，或实际插件试验显著减少集成范围，重开比较；不把 preview 本身当作永久否决理由。

## 可复验实验

LangChain 的框架层也纳入了比较：官方 `createAgent` 提供工具回路、结构化结果、动态上下文与 middleware，可在模型/工具边界插入限额和拦截。它与 `ChatDeepSeek` 这个 provider adapter 是两件事。本轮选择显式 LangGraph 节点，是因为世界提交、等待 Authority 回执、恢复对账各有独立状态和准出要求；使用 `createAgent` 也可做，但仍要增加这些应用状态与 DeepSeek wire 适配。未对 `createAgent` 宣称取消或 checkpoint 能力缺失，后续可在同 fixture 上替换验证。[Agent API](https://docs.langchain.com/oss/javascript/langchain/agents)、[middleware](https://docs.langchain.com/oss/javascript/langchain/middleware/overview)

DeepSeek SDK 额外来源已固定到提交 `5dda764ed3aa172535a7967b06ff95d9cbfe536a`（2026-09-08）；文档 URL、SHA-256 与核查时间见 [dsh-source.json](experiments/framework/dsh-source.json)，固定提交文档与读取字节已比对一致。该证据是源码核查，不是 SDK 执行实验。

注册表还显示 `@deepseek-ai/dsh-sdk-client` 的 `latest` 仍指向旧 `0.0.1-rc.1`（BSD-3-Clause），当前源码对应 `alpha: 0.1.5-alpha.1`（MIT）；不能用不固定版本的安装命令复现源码结论。具体标签与发布时间保存于 [registry.json](experiments/framework/registry.json)。

完整脚本、依赖锁与机器结果位于 [experiments/framework](experiments/framework/README.md)。安装限定 `/tmp`，禁用 install scripts，模型 transport 是进程内 mock；tracing 关闭。未读取任何凭据。

| 实验                                                                                                         | 结果                                                       |
| ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| `@langchain/deepseek 1.1.11`，入站 assistant reasoning + tool call，随后完整 AIMessage 与 ToolMessage 再调用 | 入站字段保留；第二次请求丢失 `reasoning_content`           |
| `@openai/agents 0.17.2`，默认 OpenAIChatCompletionsModel，工具返回 accepted                                  | 第二次请求丢失同字段                                       |
| `@langchain/langgraph 1.4.14`，submit 节点 → interrupt 节点 → 外部 completed 回执恢复                        | 提交计数始终为 1，暂停期间不假完成，恢复后取得真实输入回执 |

实验对照只检查 wire 与副作用次数，不计时，不冒充性能 A/B。已发布版本由 npm 注册表交叉核验（LangGraph 2026-09-04、ChatDeepSeek 2026-09-01、Agents 2026-09-08）；不能把 GitHub main package 的版本当 npm stable。[LangGraph interrupts](https://docs.langchain.com/oss/javascript/langgraph/interrupts) 明确恢复会重跑当前节点，因此世界提交必须在前一节点，并由 Authority 对相同请求去重。

DeepSeek 当前 [thinking 文档](https://api-docs.deepseek.com/guides/thinking_mode/) 要求携带 tools 的请求回传所有历史轮的 reasoning 字段，包括没有工具调用的轮次。模型历史必须由 provider 私有 wire journal 保存；不可将私有推理复制进角色记忆、玩家对话、世界 trace 或分析日志。不能在连续 history 中随意丢弃字段来“压缩”。

## DeepSeek V4 配置与准入

当前官方列出 `deepseek-v4-flash` / `deepseek-v4-pro`，分别对应 Flash-0731 / Pro-0813；两者为 1M 上下文、最大输出 384K。它们是会更新的别名，运行证据记录请求 model、响应 model、配置 hash 和时间，不能声称固定别名等于固定权重。[模型表](https://api-docs.deepseek.com/quick_start/pricing/)

日常初始配置为 Flash、thinking enabled、effort low、`max_tokens=4096`；需复杂社会取舍的比较样本另跑 Pro/high，不能自动升级。1M 容量不是应用预算。thinking 下 temperature/top_p 等不生效，不能靠改 temperature 定义 NPC 性格；人格来自显式 profile、目标权重和受控评价。[思考参数](https://api-docs.deepseek.com/guides/thinking_mode/)

薄 provider 负责 HTTPS 请求、原样保留 assistant/tool wire 字段、流式合并（按 call id/index）、本地 schema 验证、usage、超时和 AbortSignal。可以复用标准 fetch/HTTP 客户端；不复用会转换丢字段的默认 message adapter。不要为绕过问题转成无 schema 自由文本。

准入必须逐项通过：

1. 固定上述隔离 fixture，薄适配的多轮/多工具/non-tool reasoning 回放通过；官方 strict mode 仍是 beta，本地校验必须保留。[工具协议](https://api-docs.deepseek.com/guides/tool_calls/)
2. 真实 Flash/Pro 账户分别验证工具 schema、空内容、流截断、usage/缓存计数、长 reasoning 和取消；只报告确实跑过的模型。
3. 拒绝超量工具、未知字段、旧 epoch、失效观察与无权限目标；一次 decide 最多一个世界 mutation，多个提案不可隐式顺序执行。
4. 接受后不再次提交，动作完成/中断才唤醒；取消模型不等于取消世界 Action。断线后按 request ledger 对账。
5. context 轮换在完整工具对边界，恢复只使用确认的世界 cursor；旧图/旧 wire session 不复活已撤销能力。
6. 本机实际运行与真实浏览器玩家旅程完成后才能宣称 A3。SDK mock、Headless scripted 与模型文本漂亮均不能代替。

LangGraph 只保存认知执行的应用状态。持久 saver 的具体后端在 A2 冻结；首版允许重启后从 Authority 的确认 cursor 重建新图，不要求恢复一半的模型思考。无需引入 LangSmith 服务；应用 trace 仅含模型名、计数/耗时、状态转换和不含秘密的因果引用。[持久化合同](https://docs.langchain.com/oss/javascript/langgraph/persistence)
