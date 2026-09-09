# A2 本机认知宿主：代码阅读与独立审阅报告

## Review identity 与范围

- 对象：普通提交 `b763bb030f1d8c629b8c19b418eaa0de454e7580`，父提交/冻结基线 `b7d7169d3afc5da5a4e56e134c31424ec5aada5d`；比较边界为 parent → commit。
- 合同：`living-npc-cognition-review`，SHA-256 `f2fedc4c2f7a82302c00ed39f275e8023027ab61fdba606dd2ace9ae654b2fe5`。
- 读取方式：所有受改源码、测试、spec、协议、相邻 package/exports 与审阅规则均由上述冻结 Git tree 读取；未混入当前工作区 WIP。已读 base `AGENTS.md`、Code Review Skill、`review-workflow.md`、`project-rules.md`、spec。
- 范围：39/39 个 changed paths，A2 和共享 character protocol；A1 世界实现与 A3 Browser 未纳入提交，未把它们当作此 diff 的缺陷或验证结果。未执行模型调用、浏览器、完整 suite、提交或外部写入。

## 一句话结果与风险热点

该提交正确地把世界写入保留给 Authority，并在 loopback 传输、工具约束、回执配对、取消和基础调度上建立了清楚边界；但运行中接收的、未改变 `character.revision` 的 Authority event 可以在异步模型返回时被覆盖，从认知历史永久丢失，违反 V07 的并发事件不丢失合同。

## 变更分层与阅读顺序

1. 先读 `packages/game-core/src/runtime/character-control-protocol.ts`：它只表达通用角色、binding、sequence、intent/memory/receipt，不导入 provider。
2. 再读 `apps/agent-server/src/node/websocket-host.ts` 和 `wire-validation.ts`：精确 Origin、loopback、pairing、immutable binding、递增 client sequence、frame/queue 上限后才构造 runtime。
3. `runtime.ts` 是认知状态 owner：observe 追加事件，scheduler 启动决定，graph 提议意图，Authority receipt 才闭合 tool pair；context rotation 先准备，只有 memory ACK 才切换。
4. `cognition-graph.ts`、`cognition-tools.ts`、`deepseek-transport.ts`：最多三次 Flash 调用、局部 read、唯一 `propose_intent` mutation；保持 Flash reasoning/tool replay，transport 进行有界 HTTP 解析和错误脱敏。
5. `context-session.ts`、`budget.ts`、`scheduler.ts`：分别处理冻结 cursor/ACK 切换、每 runtime ledger、event debounce/active-time fallback。

```mermaid
sequenceDiagram
  participant B as Browser/Authority
  participant W as WebSocket host
  participant R as CognitionRuntime
  participant M as Flash/Pro
  B->>W: hello(binding, token, seq=0)
  W->>R: create bound runtime
  B->>W: observe(events, cursor, seq++)
  W->>R: receive observe
  R->>M: Flash graph (bounded reads)
  M-->>R: propose_intent + reasoning/tool call
  R-->>B: intent(observed revision/cursor)
  B-->>R: Authority receipt
  R: append matching tool receipt
  R->>M: optional Pro rotation, frozen cursor
  R-->>B: memory candidate
  B-->>R: accepted receipt
  R: atomically replace frozen prefix
```

## Diff codemap 与 39-file coverage

| 已读路径（39/39）                                                                                                                                                                                                                   | 角色与审阅结果                                                                                                                                                                                                                                             |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.ls-lint.yml`; `eslint.config.mjs`; `scripts/eslint/package-boundary-rule.mjs`; `pnpm-lock.yaml`                                                                                                                                   | 新 app 命名、Node adapter/package 方向与锁定依赖。没有发现 core 反向依赖或未声明 app 依赖。                                                                                                                                                                |
| `apps/agent-server/package.json`; `tsconfig.json`; `README.md`; `src/index.ts`; `src/model-types.ts`; `src/config.ts`; `src/node/main.ts`                                                                                           | 独立 Node app、公开入口、环境解析、CLI。密钥不进入 stdout；缺 key 明示 unavailable。根 `build`/`typecheck` 尚不涵盖此包，但该包提供独立 scripts，属于集成门禁待 Root 聚合，不在此 commit 声称已覆盖。                                                      |
| `src/budget.ts`; `src/scheduler.ts`                                                                                                                                                                                                 | reservation 先占用并将 in-flight 计入 call/input/output；event 合并，仅 dispatched 后刷新 fallback；pause 保存剩余时间。                                                                                                                                   |
| `src/cognition-graph.ts`; `src/cognition-tools.ts`; `src/deepseek-transport.ts`                                                                                                                                                     | LangGraph read loop、严格 goal/reference/position 校验、Flash reasoning 与 tool pair replay、1 MiB response 上限/timeout/429 分类。                                                                                                                        |
| `src/context-session.ts`; `src/runtime.ts`                                                                                                                                                                                          | context 冻结/ACK 切换及 runtime 生命周期；发现下述异步 event 覆盖问题。                                                                                                                                                                                    |
| `src/wire-validation.ts`; `src/node/websocket-host.ts`                                                                                                                                                                              | 深度有限但有 frame 先界、首帧 token、exact origin、loopback、绑定和 sequence gate；close/error 释放 runtime。                                                                                                                                              |
| `packages/game-core/src/runtime/character-control-protocol.ts`                                                                                                                                                                      | 通用控制 wire 类型及限制常量；不感知模型/provider，所有世界操作仍为 Authority consumer 的职责。                                                                                                                                                            |
| `tests/agent-server/budget.test.ts`; `cognition-graph.test.ts`; `context-session.test.ts`; `deepseek-transport.test.ts`; `fixtures.ts`; `runtime.test.ts`; `scheduler.test.ts`; `websocket-host.test.ts`; `wire-validation.test.ts` | 覆盖 reservation、bounded graph/tool ref、rotation ACK/失败、reasoning replay、dispose/death、fallback、pairing/origin/sequence 与 UTF-8 frame。未覆盖下述「模型在途时同 revision 新 event」乱序反例，也未对完整 Flash tool history 发起真实 Pro request。 |
| `tests/governance/monorepo-package-boundaries.test.ts`; `tests/governance/runtime-purity-eslint.test.ts`                                                                                                                            | package direction、core export 和 `self` AST 规则正反例。                                                                                                                                                                                                  |
| `changes/2026-09-09-living-npc-mvp/spec.md`; `cognition-delivery.md`; `contracts/cognition.json`; `contracts/parent.json`; `contracts/predecessor-triage.json`; `contracts/world.json`; `estimates.md`                              | A2 合同、边界、成本和 A1/A3 分工记录。实现报告的 focused-check 成功记录仅作作者提供的 SHA 绑定证据，不替代本审阅的语义证明。                                                                                                                               |

## 测试与证据边界

任务提供的提交前证据为：A2 8 files/25 focused tests、app typecheck/build、ESLint 均通过；共享 protocol 的 ESLint property-name 调整另有 6-test RED/GREEN。它们可证明已列出的 mock/静态/构建合同，不能证明 provider 对跨模型压缩历史的接受性，也没有触发模型 in-flight 时 cursor 新增而 character revision 不变的并发路径。

未运行新的检查：本审阅合同禁止 full suite、浏览器与模型调用；也未将当前 checkout 的结果移植到此 SHA。

## 待确认问题

`context-session.ts:62-64,183-195` 为 Pro 请求删除 Flash `reasoning_content`，但保留 assistant `tool_calls` 和 `tool` roles；`deepseek-transport.ts:134-141` 又始终启用 thinking。官方说明所述「携带 tools 的后续请求需要完整 reasoning replay」不能直接推出这个 Pro（未携带 tools）请求必然 400，因此不作为 finding。现有 Pro smoke 只压缩 Authority events，未覆盖带 Flash tool history 的请求。应在修复后留下的真实 Pro 预算中执行一次完整 Flash `assistant(tool_calls + reasoning_content) → tool receipt` history 的压缩验收；若 provider 拒绝或把原生 tool history 作为续写会话，改为带 cursor/来源的纯公开事实 transcript，再发给 Pro，且不含 private reasoning。

## 人类复核建议

1. `apps/agent-server/src/runtime.ts:291-303`：确认 event freshness 的提交 gate 是否应使用 observation cursor 或 context append generation，而非只用 character revision。
2. `apps/agent-server/src/context-session.ts:139-166`：确认 rotation frozen prefix、graph 追加尾部和 Authority ACK 的三方时序；补一个 event 在 Flash await 期间到达的反例。
3. `apps/agent-server/src/context-session.ts:62-64,183-195`：在真实 Pro 上验证含完整 Flash tool pair 的压缩载荷，再决定事实 transcript 边界。

## 独立审阅 Findings

### [P1] 在途模型决定会覆盖同 revision 的新 Authority event

- 位置：`apps/agent-server/src/runtime.ts:137-142,291-303`；配合 `apps/agent-server/src/context-session.ts:101-116`。
- 触发：Flash graph 已在 `await decideWithGraph(...)`，Authority 送达一个 cursor 更高但不改变 `observation.character.revision` 的 event（协议 `CharacterEvent` 独立于 revision，未规定每种 event 必须修改角色状态）。`receive()` 将它追加到 context 并提高 `latestEventCursor`；随后旧 graph 完成。
- 影响：stale guard 只比较 context generation 和 character revision，二者仍相等，因而 `replaceMessages(result.messages)` 把 graph 开始时的快照写回，抹掉刚追加的 event。其 cursor 已被 `latestEventCursor` 消费，后续 observation 不会再次追加；NPC 失去该对话/攻击/目标变化的认知历史，且若它是 significant event，调度虽被唤醒但新决定也没有该事实。压缩时同样不可能恢复已被覆盖的记录。
- 规则/合同：STATE-01 的异步新鲜度提交边界；spec V07「新增事件不丢失」和 V02/V06 的事件响应。
- 证据：`appendEvents()` 直接变更 `messagesValue`（context-session:111-116）却不改变 generation；graph 在 invoke 的 `assemble-context` 处复制 `priorMessages`（cognition-graph:59-83）；runtime 在 await 后只检查 revision/generation 再整体 replace（runtime:291-303）。现有 `context-session` 测试只覆盖 Pro rotation 中的新 event，`runtime` 测试没有该决定在途乱序。
- 建议：在每次 append events 时递增用于 optimistic commit 的 generation/revision，或记录 graph 的 input cursor 并在 await 后若 `latestEventCursor > observation.cursor` 直接丢弃结果并保留/重新调度；更稳妥的是将 graph 产生的追加结果作为 delta 合并到最新 context，禁止无条件 replace。补 cursor 增长、character revision 不变的 async model regression test，覆盖普通决定和 rotation。
- 置信度：高。

Coverage：完整（39/39 changed files accounted for；1 个 P1，未发现可证实 P0/P2）。
