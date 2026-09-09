# Agent Server、受限协议与持久化

下列 `actor-world/1` 为拟议合同，实施前冻结字段/schema/限额及正反例。它不复用退役 Node 世界网络协议，不把可信 LogicObservation 作为外部协议。

## Actor 事实与认知模型

Authority 持有 `ActorId → EntityId + identityRevision` 的正式绑定，身体死亡与实体重建会更改 incarnation，Actor 的人格和历史身份是否续存由生命周期规则决定。本期 NPC 死亡即停止 Agent；不得自动创建另一个同名身体逃避死亡规则。世界首次配置可创建 NPC，此后 load 不重复 spawn。

最小角色数据：稳定 ActorId、EntityId、body/health、Inventory/装备、needs、profileId/profileRevision（人格特征、动机、限制）、goal（类型、参数、进度与状态）、已确认记忆/承诺索引、Action 当前/终态记录和 trace 游标。人格是可审阅短描述 + 少量偏好值，不能只是每次 prompt 里随机名字；目标必须可行动、可完成/失败/放弃。

认知记忆区分 `observed-fact`、`heard-claim`、`own-intention`、`belief`。事实有 eventId/observationId 来源；他人说法不能变为客观事实。模型可提交有界摘要/目标建议，由 Authority 校验仅引用该 Actor 已收到的事件再记入 checkpoint；模型不向真值表写“目标已完成”。Agent Server 维护临时上下文缓存，世界 checkpoint 中已确认数据才是跨重启恢复源。

## 连接、配对与能力

浏览器在用户显式启用本机 Agent 后主动连接固定 loopback WS。开发 Origin 用本机 HTTP；公开 HTTPS 页面连接本机端点的混合内容/本地网络访问策略必须在产品化前单独验证，不能把 localhost 开发成功当公网发布成功。本期不修改浏览器安全选项绕过限制。

Agent Server 监听 loopback，检查精确 Origin，拒绝缺失/任意 Origin。短时单次配对凭据用于有界首消息，不放 URL、localStorage、日志或 trace；由本机启动输出/输入渠道交用户。浏览器决定把哪一 Actor 授给该连接，Authority 签发/登记会话局部 opaque capability。服务器不能自报 actorId/capabilities 获得权限。

首消息只有 `hello`，在 5 秒内完成版本与配对；随后 Browser/Authority 返回 `bound`（身份、grantId、controlRevision、有效 Action catalog 和最近 observation）。握手失败不转发世界信息。authority-issued grant 绑定 worldId、epoch、actorId、identityRevision、connectionId、有效期与能力集合；不把共享开发工具注册给模型。

两层校验：Bridge 做 schema、帧大小、消息速率、连接绑定预检；Authority 在接纳和最终效果提交时验证 grant、Actor 存活、资源/距离/遮挡/材料及新鲜度。即使绕过 Bridge 直接构造 Worker 消息，也无法越权。

## 消息信封与顺序

```json
{
  "protocol": "actor-world/1",
  "kind": "action-request",
  "worldId": "world-example",
  "epoch": "load-epoch-example",
  "connectionId": "connection-example",
  "actorId": "actor-example",
  "identityRevision": 2,
  "grantId": "opaque-example",
  "sequence": 7,
  "requestId": "request-example",
  "observationId": "obs-example",
  "controlRevision": 4,
  "action": { "type": "pickup", "targetId": "visible-item-example" }
}
```

例子不含真实凭据。语义 Action 参数只包含动作所需最小目标，禁止附加 `patch`、`ServerCommand`、脚本或自填 capabilities。未知字段拒绝；版本不支持明确错误并关闭，不做静默降级。

消息族：`hello/bound`、`observation`、`events`、`action-request/action-accepted/action-result`、`action-cancel`、`memory-proposal/memory-committed`、`ack/resync`、`heartbeat`、`error/closed`。每个请求都有具名成功或失败结果；action-accepted 仅表明排入执行，不能展示为已经完成。

sequence 在每个 connection/request stream 严格递增；同 requestId + 同规范化 payload 重传返回原接纳/终态，payload 不同返回 `REQUEST_CONFLICT`。不能把较大 sequence 永久覆盖缺失前项；出现缺口要求 resync。Action ID 由 Authority 分配、跨恢复有持久递增/唯一命名空间。connection 更换后旧结果一律失效；用新连接的 query/receipt 查询已接纳结果，不盲目重放旧动作。

### 统一 mutation receipt ledger

`action-request`、`action-cancel`、`memory-proposal` 共用**每 connection 一个 mutation stream**，均带同一套 world/epoch/Actor/connection、requestId、sequence、controlRevision 和 payload。查询/heartbeat/ACK 不占 mutation sequence；服务端事件使用独立 eventSeq。Authority 对 schema 校验后的规范化 payload 自行计算 digest，不信任客户端提供的 digest；规范化固定字段顺序、数字编码与 UTF-8，拒绝非有限数值和重复 JSON key。

| 持久字段                                | 语义                                                                                   |
| --------------------------------------- | -------------------------------------------------------------------------------------- |
| key                                     | worldId + issuedEpoch + actorId + connectionId + requestId；Actor incarnation 单独核对 |
| sequence / payloadDigest / mutationKind | 同流唯一序列与规范化请求；当前流 expectedNextSequence/highWater/evictionFloor 一并记录 |
| receiptState                            | accepted 或 terminal；received 只可作为内存预检，不对外当接纳 ACK，也不产生 effect     |
| outcome                                 | actionId（若有）、接纳/拒绝码、终态/取消结论，memoryVersion（若有）                    |
| frontier                                | 接纳/终态各自的 commitSequence，事件引用与 Actor controlRevision                       |

Authority 顺序是：验证连接/epoch → schema 与 digest → 查询 ledger → 检查 sequence/grant/前置条件 → 在同一 Authority 事务写接纳或拒绝 receipt，并与对应 effect/commit 一致发布。异步 Action 的 accepted 与稍后的 terminal 是两个合法提交，绝不让 terminal 先于 effect 或拥有两个最终结果。memory-proposal 的 confirmedMemory 与 terminal receipt 同事务写入。action-cancel 自己有请求终态，同时引用目标 Action 的唯一终态；cancel/complete 竞态按 Authority 提交顺序决定，不能两个都声称改变目标。

同 key+digest 重发只读原 receipt；不同 digest 拒绝 `REQUEST_CONFLICT`。sequence 小于 expectedNext 且 receipt 已淘汰返回 `RECEIPT_EXPIRED`，不得进入执行；大于 expectedNext 返回 `SEQUENCE_GAP`，由调用方同步 highWater。已拒绝的合法信封也占用序列并有 receipt，避免下一请求永远卡住；未知版本/无法解析帧在流外关闭，不产生序列。

每 Actor 当前流最多保留 256 个最近终态和所有在途接纳项（在途本期至多 1 个 Action，memory/cancel 同步完成）；按有界窗口淘汰时更新 evictionFloor。新连接撤销旧连接，不保留无限连接 highWater；任何旧 connection/epoch 的 mutation 都在查账前拒绝。新连接可只读查询最近回执的原 key，查不到明确 expired，不能借换连接重发旧 mutation。客户端必须先 resync 当前 Action/Inventory/confirmedMemory；新目标是新决定，不是自动重试旧 effect。

账本、highWater/evictionFloor 和 confirmedMemory 与世界一起进入同一 checkpoint。restore 后旧 mutation 永远不能执行；最近 receipt 可查询用于解释历史。进程崩溃只恢复 checkpoint cut 之前的事实和账本，不承诺尚未保存的内存 ACK 持久；未保存 effect 与未保存 receipt 一起丢失。

## Observation 与知识边界

Authority 按绑定 Actor 生成：自身身体/需求/Inventory；当前感官范围与遮挡允许的实体、公开动作和地形；本人动作回执；本人参与或听到的局部事件；此前合法获得且有时间标记的知识；可用动作目录。每个 snapshot 标注 physicsTick/simulationTime、observationId、资源版本及截断游标。

不包含 seed、未见 Chunk 内容、完整 POI、别人的背包/内部目标/记忆、其他 Actor 的私有 observation、全局实体列表或开发 trace。NPC 可以知道自己亲历而玩家未亲历的信息；“不读玩家不可见全局信息”是对全局开发视角的禁止，不要求所有角色记忆相同。未知必须显式 unknown，不能把观测遗漏当对象不存在。

目标引用可以来自新观察或该 NPC 已知地点；对记忆中的旧位置只按知识描述走近再确认，不能通过 action error 获得未观察对象的精确位置/物品/健康信息。非法目标统一返回非敏感 `TARGET_UNAVAILABLE`；详细拒绝原因只给开发 trace。

事件 snapshot 与 delta 分开：pose/need 可以合并为最新快照；动作终态与世界后果不能丢弃。事件流以 Authority cursor ACK，缺口时先发送 `RESYNC_REQUIRED` 和当前 Actor snapshot + 持久回执，不假装缺失历史已被认知。只发送该 Actor 可知事件，开发全局事件 ID 不直接允许反查。

## 时效、执行与仲裁

模型决定使用高层时效：绑定 observation 与 controlRevision，建议最大 30 秒真实推理超时、5 秒模拟时间 observation age（可配置并在测试前固定）。paused/调试状态仍以 monotonic real timeout 约束外部请求。过期返回 `STALE_OBSERVATION` 并推最新观察，不能把现有 Logic TTL 200 ms 直接改大。

不要求全局 worldRevision 完全不变：玩家远处无关编辑不应饿死 NPC。Authority 对动作相关目标、Inventory、grant、Actor incarnation、可知集合和必要 Chunk revision 校验；实际 effect 时再次检查距离、视线、生命和资源。移动目标若变了由执行层更新/失败，不能把旧目标位置当实际对象位置。

每 Actor 一个当前主要 Action，模型一次提交一个 Action；短计划留在认知 goal 中，成功/失败后才提交下一步。替换必须携带 expectedActionId 和 controlRevision，不能利用现有 `ActionRuntime.start()` 的自动替换抢占高优先级反射。取消命中完成竞态时回原终态，不制造第二终态。

优先级：死亡/移除/撤权 → 受击/明确危险反射 → 当前已接受 Action → 新认知请求 → fallback。每次反射、控制权切换或 restore 增 controlRevision；旧模型轮次取消且其结果即便到达也拒绝。

## 首个切面的 Action 合同

| 动作                      | 正常规则 / 资源 / 失败                                                                                                         |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| move-to / cancel / idle   | 到已知位置，算法导航→wish→同一 Physics；有界路径/重算/超时，不 teleport。目标失效、无路、缺块具名终态                          |
| pickup / drop             | 自己身体交互距离、遮挡和 Inventory 容量；world-item ↔ Inventory 原子转移，同一物品被玩家先取后失败，不能重复增加               |
| eat/use-item              | 自己 slot、物品定义和数目，经与玩家相同 use 规则；消耗一次，恢复相应需求，不将 grazer 的 hunger=0 当通用玩家规则               |
| break-block / place-block | 与玩家相同可达/遮挡、材料/工具和耗时规则；break 生成真实掉落，place 消耗真实 stack，放置不占据身体；开发 set-block/fill 不可用 |
| equip / craft             | 自己装备/slot 与已解锁配方，固定本切面已有的木材/木剑等配方；不能 give-item，不能根据文本臆造配方                              |
| attack                    | 合法装备和既有近战阶段、hit/cooldown/可中断规则；NPC 与玩家均能受伤死亡；不直接调用 damage patch                               |
| say                       | 有界 UTF-8 文本转成近距离角色发言事件，按听觉范围分发；不会产生物品、目标完成或世界事实                                        |

第一可演示里程碑可以先跑 move/pickup/eat；**只有这三项不算最终 MVP 达标**。最终切面还需至少一次正常地形操作、玩家干预/交流、规则平权与保存恢复；无需求的高级技能不提前扩展。

## 断开、预算与错误

初始建议限额：单帧 64 KiB，Actor snapshot 32 KiB；事件每批最多 64 条；最多 4 次模型决定/分钟、一个在途调用，正常冷却 15 秒，重大受击由算法处理不增加模型风暴；1 次网络重试计入调用预算，语义非法结果不自动无限修复；每回合输入/输出 token 上限、会话总 token/美元上限必须由启动配置明确给出，无预算配置不开真实模型。

每连接消息速率 10 条/秒、burst 20；最多 16 未确认回执、128 待发事件/512 KiB 发送队列；满时停止新认知请求，要求 ACK/resync，持续不消费则断开并 fallback。terminal receipt 保留最近 256 条/Actor，关键因果另入 checkpoint trace；回执被淘汰后返回明确 `RECEIPT_EXPIRED`，禁止“没查到就重做”。这些数字是可验证上限，实施按真实最大 schema 样本复核，不是性能推荐。

服务不可用、模型异常、schema invalid、预算耗尽或连接 15 秒无心跳：清除 grant、停止新决定、使旧回应失效；移动等持续 Action 中断，已提交的原子效果保留。NPC 可观察地 idle/fallback，玩家 UI 显示原因但世界仍可游玩。手动重连重新配对/绑定，不重置 NPC 记忆或生成新身体。

## 保存与恢复原子边界

在一个 FrozenGameSaveSnapshot 中保存 canonical/Gameplay/Actor/Inventory、当前 goal/profile、Action 终态索引、已确认认知与事件 cursor。Agent Server 提交的 memory-proposal 必须先收到 Authority ACK 才能成为可恢复记忆；模型临时上下文可丢失，不能在磁盘先写“已吃掉”后再期待世界最终提交。

保存中的当前 Action 不必等模型结束。恢复后所有 pending/running Action 以明确 `interrupted: restored` 转入终态，path/输入/控制 lease 清空；已经完成的 effect 不回滚或重演。真实长期过程若需恢复执行，应由后续逐动作合同引入；本期重新观察并重新决定。持久事件/记忆已达上限时按确定窗口保留及摘要，丢弃必须有 gap marker，不能静默制造“记得完整历史”。

save 前后的消息有明确 cut：快照保留截至 commit frontier 的已确认认知和世界事实；cut 之后的 ACK 不属于该 checkpoint，恢复时新 epoch 拒绝其旧响应。Browser crash 只恢复最后成功 checkpoint，UI 不能把未持久的中途状态说成已保存。

旧存档升级：新增字段缺失时只迁移为“无 Agent 绑定/无认知记录”；不要自动把所有 settler 变成 Agent。首次显式创建单 NPC 时赋身份；未知版本拒绝写回、保留原存档。迁移 fixture 包含基线真实保存和新 NPC 保存、无效/截断记录；禁止以“可重新生成世界”替代兼容验收。

### 版本化保存所有权

拟议将 `GAME_SAVE_SCHEMA_VERSION` 从当前 1 升至 2，`FrozenGameSaveSnapshotV2` 在现有 `gameplay/chunks` 旁增加唯一的 `agentState: AgentStateSnapshotV1 | null`。具体类型在 A1/A2 的 spec/hash 冻结并逐项测试；本轮不修改生产格式。`agentState` 由 Authority 生成并拥有，持久化 adapter 只存单一 bundle，不另外拼接 Agent Server 文件或第二条 IndexedDB 记录的“最新值”。

| 子快照             | 最小字段与唯一 owner                                                                                                                                                                                                                                                                                           |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| gameplay           | Entity 身体、生命、Inventory/装备、需求、动作事实/序列（现有 gameplay schema 3 如需加入 NPC Inventory 则升级，并有旧版本迁移）；同一字段不在 agentState 复制为第二真值                                                                                                                                         |
| agentState         | schemaVersion、sourceEpoch、同 bundle 的 worldRevision/commitSequence、actorBindings（ActorId/EntityId/incarnation）、profileRevision/profile、goal、confirmedMemory/claims/beliefs 与 memoryVersion、event cursor/gap marker、receipt ledger/highWater/evictionFloor、controlRevision、动作终态引用和恢复策略 |
| 不保存为可复用权限 | grant/配对凭据、活动 connection、SDK 对话对象、模型未确认上下文、隐式思考链、输入租约                                                                                                                                                                                                                          |

冻结按一次 Authority 保存事务：暂停接纳新 mutation 到有界队列 → 完成已经进入事务的写入并固定 frontier → 在不推进世界的 capture 段同时冻结 canonical/gameplay/agentState → 恢复正常调度 → adapter 持久化该不可变 bundle 并 ACK。不等待模型或无限期等待正在移动的 Action；正在移动的事实可存在于 gameplay cut，agentState 只记录引用与 `interrupt-on-restore` 策略，不保存一份可独立恢复执行的 pending/running Action 副本。

恢复先验证整个 bundle 的版本、身份、hash、引用、ledger/action 关联和三个 frontier 一致，再在隔离候选中迁移并生成新 epoch。候选恢复的首个 Authority 提交将 pending/running Action 固化为 `interrupted: restored`、清空路径/输入、提升 controlRevision、撤销旧连接权限；同一恢复提交还将所有关联的 accepted Action receipt 同步固化为相同的 `interrupted: restored` 唯一终态，写入该新 commitSequence；保留原请求 key/digest 供新连接只读查询，不能让 ledger 留在 accepted 而 Action 已终结。完成后才对 UI/Bridge 发布 ready。新恢复提交有新的 commitSequence，不把它假装为历史 snapshot 的原 frontier。失败保留原世界及原保存，不做部分 Agent 恢复。

旧顶层 schema 1 迁移为 agentState=null，并用既有 gameplay 迁移链读取旧世界；未知顶层或 agentState 版本拒绝激活/写回。manifest 必须记录 agentState 的存在性/完整性：schema 2 存档本应含 Agent 时，删除该块是损坏，不能退化为“无 Agent”。新存档关闭 Agent 也保留其已确认历史，不能以移除连接删除角色。

## 本期权限威胁边界

防护对象是未配对本机网页、被提示注入误导的模型、恶意/失效 Agent Server 响应及跨 Actor/跨 epoch 重放。拥有本机开发者权限、能改源码或直接控制浏览器调试器的用户不是本期反作弊对手；DeveloperWorldHarness 是可信开发能力，不能被包装成普通玩家授权。

Authority 在初始化时区分可信生命周期/开发端口与 Actor 消息端口；Actor 端口不提供 createActor、grant、restore、inspect-global 或切换控制者方法。Bridge 的连接消息只能进入 Actor 命令 allowlist，不能伪装成管理消息调用绑定接口。配对/撤权由可信 UI 生命周期端口发起，生成 grant 的秘密或内部句柄不交给模型。此端口隔离与逐消息权限检查一起测试，不能只检查 JSON 的 `sourceType='agent'` 字段。
