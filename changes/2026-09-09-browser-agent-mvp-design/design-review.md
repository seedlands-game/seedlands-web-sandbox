# Browser Agent MVP 设计独立验收

审阅对象：`changes/2026-09-09-browser-agent-mvp-design/` 六份文档，及其中声称复用的 Actor、Gameplay、Harness、存档源码。审阅方式为一次静态阅读；未运行测试或浏览器。

## 结论

**有条件通过，需在设计交付前补两项最小合同。** 目标体验、单 Authority、Actor 平权方向、受限观察、断线反射、共享 Harness 与真实浏览器验收链条均已闭合；没有把现有 `PlayerState` 误称为 NPC 平权已经完成。两项缺口会使 A07/A09 无法在实现前写出无歧义的 RED，应该先补文档，不需要扩大功能范围。

补读 `architecture.md` 新增的“Agent Server 的可实施模块边界”（81–95）后，结论不变。独立 `apps/agent-server`、transport/session/context/provider/validator/receipt/budget 的拆分，以及“accepted Action ID 即结束本轮”的语义，正确地避免 SDK 自动工具循环将接纳误当完成；这改善 A2 的可实施性。其 `receipt-reducer` 仍是 Agent Server 的临时认知进度 owner，不能代替 B1 所需的 Authority 持久 mutation ledger，也没有规定 B2 的 snapshot extension，因此两项必要修订仍成立。

## 用户目标覆盖

| 目标                                                        | 文档证据                                                            | 结论                                                                  |
| ----------------------------------------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------- |
| 浏览器里一玩家与有身份、性格、目标、身体、背包的 NPC 共处   | `spec.md` 12、22–31；`agent-protocol.md` 7–11                       | 覆盖；阿岚的可恢复营地目标足够构成最小体验。                          |
| NPC 像另一玩家一样受规则约束，可观察、干预、失败、死亡      | `spec.md` 18、24–29；`architecture.md` 48–58；`acceptance.md` 29–32 | 覆盖；明确禁止开发命令和模型文本代替事实。                            |
| 不泄漏全局信息、不让本机模型成为写者                        | `architecture.md` 37–46；`agent-protocol.md` 49–57                  | 覆盖；ActorWorldPort、能力、局部观察和 Authority 二次校验的边界正确。 |
| 保存后 NPC 与世界后果连续，且无离线追赶                     | `spec.md` 29；`agent-protocol.md` 91–99；`acceptance.md` 37–38      | 意图覆盖；须补下述保存切面合同。                                      |
| Headless/Browser 用同一世界语义，同时保留浏览器真实体验验收 | `harness-contract.md` 3–36、61–65；`acceptance.md` 27、47–53        | 覆盖；显式推进语义与真实输入/视觉验收分离合理。                       |

现状佐证也与“计划而非已实现”的表述一致：`GameplayRuntime` 的 Inventory、采集、放置、食用、合成和攻击仍全部经私有 `player(id)` 取得 `PlayerState`（`packages/game-core/src/server/gameplay/gameplay-runtime.ts:153-339,520-524`）；现有 `ActionRuntime.start()` 会无条件中断同 Actor 的动作（`.../action-runtime.ts:43-58`），而浏览器 Harness 的 `advanceGameplay` 明确抛错（`apps/web/src/app/game-harness.ts:427-429`）。设计已经把这些列为 A1/H2 的工作，不构成“现状误报”。

## 必要修订

### B1：为所有 Agent→Authority mutation 固定单一幂等账本与恢复语义

`agent-protocol.md:45-47` 同时说“每个请求有结果”、`sequence` 属于“每个 connection/request stream”，又只对 `action-request` 明确示例；`memory-proposal`、`action-cancel` 的 requestId、canonical payload、sequence 所属 stream 和 receipt 状态机未被确定。`agent-protocol.md:87` 的 256 条终态回执和 `:93-97` 的 checkpoint 内容也没有说明 requestId→payload-digest→decision/action/commit 的记录是否属于原子 snapshot，以及淘汰后的重复包如何保证不重做。

这会直接使 A07（重复/乱序/缓存淘汰）和 A09（save 与 memory ACK 并发）存在两种可实现却不等价的解释：实现者可为 Action 和 Memory 各自递增序列，或把二者放同一序列；恢复后也可能把已提交 memory-proposal 当作新请求再次写入。

**最小修正：** 在 `agent-protocol.md` 的“消息信封与顺序”增加一个 mutation receipt ledger 表：

- 把 `action-request`、`action-cancel`、`memory-proposal` 明确列为 mutation；每条都带 `requestId`、同一 `connectionId` 的严格单调 `sequence`、canonical payload digest 和 `controlRevision`。若确需并行 stream，命名 streamId，并为每个 stream 定义独立的单调序列与全局 effect 顺序；首个 MVP 更简单的选择是每 connection 一个 mutation stream。
- Authority 在**接纳前**查询 ledger，在接纳/终态/记忆提交时与 effect/commit 写入同一 Authority 事务；同 key+digest 返回已有 receipt，不同 digest 返回 `REQUEST_CONFLICT`。明确 receipt 状态为 received/accepted/terminal，取消与完成竞态只固化一个 terminal receipt。
- ledger 的可恢复最小字段、保留窗口、gap/`RECEIPT_EXPIRED` 后的禁止重做规则进入 checkpoint；新 epoch/connection 的 query 只读 receipt，不能重放 mutation。A07/A09 分别加“restore 后 duplicate memory/action”和“cancel vs complete vs save”的 fixture。

这是定义已有“至多一次”和单一 cut 的实现边界，不增加 Action、模型能力或世界范围。

### B2：把 Agent 扩展纳入 FrozenGameSaveSnapshot 的版本化所有权，而非仅列出要保存的内容

`agent-protocol.md:93-99` 要求将 Actor、profile/goal、记忆、动作终态与 cursor 放进 `FrozenGameSaveSnapshot`，但没有指定该扩展由哪个 snapshot 子对象拥有、顶层 schema 怎样演进、何时由 Authority 冻结并交给持久化 adapter。当前 `FrozenGameSaveSnapshot` 只有 `gameplay` 与 chunks（`packages/game-core/src/server/persistence/game-save-snapshot.ts:11-21`），而 `GameplayRuntime.createSnapshot()` 的 `players` 与 simulation 快照也尚未含 Agent profile/认知（`.../gameplay-runtime.ts:403-414`）。

若不定这一归属，A09 的“一个 cut”可以被实现成 core gameplay save + 浏览器 IndexedDB 的独立 Agent save；即使两个都 ACK，也仍可能出现世界事实和 memory 的不同 frontier，正是设计要排除的情况。

**最小修正：** 在 `agent-protocol.md` 的“保存与恢复原子边界”和 `harness-contract.md` 的 `checkpoint.export/restore()` 行各补一段：

- 定义一个由 Authority 生成、由 `FrozenGameSaveSnapshot`（或其明确版本升级）唯一拥有的 `agentState` 子快照；列出 `actorBindings`、profile/goal、confirmedMemory、event cursor、action terminal/receipt ledger、相关 sequence/control revision 的最小字段，明确不保存 grant、connection、模型上下文和 pending/running Action。
- 规定 freeze 顺序为“停止接受新 mutation → 固定 commit frontier → 原子 capture canonical/gameplay/agentState → 持久化该单一 bundle ACK”；restore 在隔离候选 runtime 验证 bundle 后才替换 Authority，随后创建新 epoch、将在途 Action 统一写为 `interrupted: restored`，并撤销 lease。
- 使用 schema discriminator/迁移函数：旧版本读出 `agentState=none`，未知版本只读拒绝写回。A09/A10 的 fixture 应断言 bundle 内 worldRevision、commitSequence、agentState frontier 一致，且无法通过删除单独 Agent 记录得到“部分恢复”。

这也只是把文档已承诺的保存字段和原子性落到现有 snapshot 的一个明确扩展点，并不预先冻结具体公开 API。

## 已核对且无需扩大范围的点

- **Actor 平权：** `agent-protocol.md:71-81` 明确列出最终 Action 集，`acceptance.md:29-31` 给成对玩家/NPC 规则测试；`architecture.md:50` 要求消除 `player(id)` 假设。A1 可先以 move/pickup/eat RED 切入，再完成最终旅程需要的地形/交流，不需重写 ECS。
- **安全、顺序和反射：** grant 绑定、精确 Origin、两层验证、局部 Observation、非敏感 `TARGET_UNAVAILABLE`、controlRevision 和反射优先级都有可验证定义（`agent-protocol.md:15-21,51-67`）。B1 修完后能覆盖所有 mutation，而非仅覆盖 Action。
- **Harness：** pause/advance/barrier 的 epoch/frontier/timeout 合同避免用 sleep 伪造一致性；Headless/Browser 比较规范化世界语义，浏览器产品旅程再检查真实输入和持续视觉，切分正确。
- **最小切片：** 有明确 stop line，未引入 LOD、World AI、多人、通用规划或第二 Authority；真实模型只在 A3 作为产品验收，不用 scripted provider 冒充完成。

## 后置建议（非本次阻塞）

在 A2 安装依赖前，把 loopback/HTTPS 的实际浏览器连接可行性作为一项单独 preflight 记录即可。文档已明确这不是当前已验证能力（`agent-protocol.md:15`），无需在本设计阶段引入公网部署或改变浏览器安全设置。

## 变更

未修改仓库源码或文档；仅写入本独立审阅报告。

## 验证

完成六份设计文档与必要源码的静态交叉核对；未运行重量测试、浏览器或外部服务。合同 SHA-256 已匹配：`b899637464ec1aeaf9ff43e2942402ac6d7027096b6865250377ac2b7d0a04f6`。

## 风险

若 B1/B2 不修，重复包、取消/完成竞态和恢复后的 memory/action 可能以不同实现产生重复 effect 或非原子记忆，A07/A09 无法作为明确准出。其余风险已在阶段停止线和 NOT_RUN 产品验收中诚实保留。

## 实际成本

一次静态审阅；未消耗外部调用、未运行测试、未改动仓库。

## 负责者修订处置

2026-09-09：B1 已补为每 connection 单 mutation stream + Authority receipt ledger，固定规范化 digest、序列缺口、淘汰 floor、取消/完成竞态、旧连接恢复和 checkpoint cut。B2 已补拟议 FrozenGameSaveSnapshotV2 的 agentState 唯一所有权、gameplay 字段去重、capture/restore 顺序和 schema 1/2 迁移。harness-contract 与 acceptance 同步增加互引与 A07/A09/A10 负例；不扩大动作或部署范围。

本处置为文档修订，运行时验证仍 NOT_RUN；不把独立审阅当成代码实现或产品验收。

## 最后一次定向复核

Terra/high 第二次仅复核 B1/B2：基本闭合，另要求恢复时同步终结关联 accepted receipt。负责者已将该要求写入同一恢复事务，保留原请求 key/digest 并更新 terminal commitSequence，A07/A09 同步增加 Action/receipt 一致断言。该剩余问题已按建议修订；未再派发第三次审阅，不声称有第三次独立通过。
