# Gameplay 消费者完整性：参考 DTO 实施计划

## 背景与目标

本计划落实冻结的 [网络选型](network-selection.md) 中 N0 投影后消息语料与 N2 前消费完整性要求。当前 `GameplayViewReference` 已携带玩家 HUD、库存、实体定义与生命值；独立 `EntityPosePublicationReference` 已携带实体位置、速度与落地状态。但浏览器的现有消费还将 actor 的 `behavior` 写入可观察的附近实体语义，现有参考投影没有该 allowlist 字段。

本切片的完成态是：增加一个最小、可验证、跨宿主的参考 Gameplay 消费者 DTO，使可靠 Gameplay、latest pose 与 player correction 有明确的同 epoch 关联、实体删除和重生规则；同时采集新一代独立参考语料。它不采用网络 wire、不改变浏览器或 Host 的运行行为、不声称远端 GUI 已可玩。

## 当前事实与缺口

- `AuthorityGameplayView` 同时给出 `entities`、`actors` 与 `player`，其中完整 `ActorState` 含 hunger、目标实体、POI、冷却和 wander index 等内部调度字段。
- `BrowserGameplay` 只读取每个 actor 的 `behavior`，将其与实体 id 关联后发布为 `presentedEntities[].behavior`；该值进入 `PresentedEntities` 的 `data-behavior`，因此是当前可观察消费者状态。
- `GameplayViewReference` 目前只投影 player、非玩家 `entities`、配方和快照上下文，且测试刻意禁止 `actors`。这避免泄漏内部状态，但也遗漏了上述唯一实际消费者字段。
- 3D presenter 的模型选择只需要 `id`、`type`、`archetype` 和 world-item 的 `stack.itemId`；伤害闪烁需要可靠 `health` 的下降。上述字段都已在可靠 Gameplay 中。
- presenter 的 yaw、步态和 bob 由前后 position 与本地展示时间计算；world-item 旋转也由本地时间计算。当前没有消费者读取权威 yaw、动作、动画或行动目标。`EntityPose` 已有 position、velocity、grounded，可供后续插值和预测，但不应因此添加未被消费的动画字段。

## 范围与非目标

本切片会：

1. 在 `src/server/protocol/` 增加新的、显式版本化的 Gameplay 消费者参考 DTO 与纯投影器。
2. 只白名单 actor 的 `entityId` 与 `behavior`，并为后续真实客户端适配记录可靠 Gameplay、pose、correction 的关联和丢弃规则。
3. 用真实 Host 的 starter ecology、现有本地 fixture-admin 扩容和保存恢复路径采集新的参考语料，并证明 actor/实体关联稳定。
4. 新增定向 Vitest，先取得缺 DTO/字段的 RED，再完成投影和新语料 GREEN。

本切片不会：

- 修改 `src/app/`、`src/client/`、`DedicatedServerHost` 或浏览器展示器；真正的客户端状态适配、插值、网络连接和 GUI 旅程留给后续切片。
- 透传完整 `ActorState`、目标、POI、饥饿、冷却、活动标记、wander index、metrics、contacts 或 diagnostics。
- 新增 yaw、动画、动作、攻击目标等未被当前消费者读取的权威字段。
- 改写既有 reference v1、CODEC9、directional 或 entity corpus 临时目录、manifest 或历史 evidence；不在本切片修改 C0/C1/C2 encoder、decoder 或 wire parser。
- 进行性能采样、浏览器测试、全仓 coverage 或网络部署。

## DTO 与版本决定

### 新的独立参考代次

现有 `NETWORK_REFERENCE_PROJECTION_VERSION = 1` 和其已记录语料保持不变。经本轮主线选择，新 DTO 固定使用独立 kind `gameplay-consumer-reference`，并定义专用 `GAMEPLAY_CONSUMER_REFERENCE_VERSION = 2`；其投影函数固定为 `projectGameplayConsumerReference`。不能在原 `gameplay-view-reference` 上静默追加字段或提高全局版本号：两者都会让历史的字段/解码证据看似仍代表新消息。

这只是参考投影版本，不是已采用 wire 版本。当前 codec 尚未采用，故不承诺原型历史 wire 兼容；后续 C0/C1/C2 若要支持该 DTO，必须各自新增 schema、解析器 RED/GREEN 和应用 oracle，不能把本计划当作采用证明。

新采集输出使用独立目录，例如 `/tmp/seedlands-network-gameplay-consumer-corpus-v2`，manifest 必须写入：

- 独立的 corpus format 与 `referenceGeneration: 2`；
- 新 DTO kind、专用 projection version、产生用 source SHA；
- seed、Host/fixture-admin 来源、record 顺序、每条 metadata 与二进制块（如有）的内容 hash；
- 与旧 corpus 的关系仅写明“基于同一产品来源的新增 generation”，不得复用或覆盖旧 manifest hash。

历史 `real-corpus-v1`、directional corpus 与 entity corpus 继续作为各自字段集合的冻结证据。新 generation 的失败或 `NOT_COLLECTED` 也只写入新目录。

### 最小 allowlist

可靠消息的新增部分为稳定排序的：

```ts
type ActorBehaviorReference = Readonly<{
  entityId: string;
  behavior: 'idle' | 'wander' | 'seek-food' | 'flee' | 'chase' | 'attack' | 'routine-home' | 'routine-work';
}>;
```

`actorBehaviors` 只包含在同一可靠 Gameplay `entities` 中、且 type 为 `creature` 或 `npc` 的 actor。每个 `entityId` 最多一次；行为枚举非法、空 id、孤立 actor、重复 actor 都是投影失败，不静默省略。输出按 `entityId` 排序并作深副本。保留 `entities` 内现有 `type/archetype/stack/health/maxHealth/position`，不复制完整 actor state。

当前生产关系只保证 actor 必须指向一个同 archetype 的 creature/npc：`spawn-creature` 可以创建未注册 actor 的 creature。因此本投影不得反过来要求每个 creature/npc 必有 actor；只验证每一个 actor 记录都能唯一关联到合法 entity。这个单向性来自 `AutonomyRuntime.registerActor()` 的实际前置校验，不以 fixture 猜测双向集合相等。

客户端展示定义实体的签名为 `(id, type, archetype, stack.itemId)`：可靠 Gameplay 首次提供该签名才可创建展示对象；同 id 的签名变化必须作为可靠 Gameplay 更新处理，销毁并重建本地展示对象，不能由 pose 改写模型定义。`stack.count`、health、maxHealth 和 behavior 是同一可靠状态中的可更新字段，不是 pose 的推断结果。

## 后续真实客户端适配门槛（本切片不采集、不验证）

以下是后续客户端状态适配必须实现和验证的 Given/When/Then，不是本切片新增的 reducer、接收器或通过证据。本切片只验证 DTO 源头、allowlist 和真实 Host 采集；epoch、删除、重生、传送、同 revision 冲突和 pose 缓存状态均标记为 `NOT_COLLECTED`，不能由单元 fixture 或 corpus DTO 深比较替代。

### epoch 与排序

1. 三类消息都必须匹配已建立会话的 `epoch`。错 epoch 一律拒绝，不写任何实体、pose、HUD 或预测缓存。
2. 可靠 Gameplay 以 `gameplayRevision` 单调处理；较低 revision 不得覆盖较高 revision。相同 revision 仅可幂等重放，不得以不同内容改写状态。其 `snapshotPhysicsTick`、`snapshotCommitSequence` 与 `snapshotWorldRevision` 是关联上下文，供诊断/因果检查使用，不冒充独立传输序号。
3. pose 只在同 epoch 内按发布者绑定的 `publicationSequence` 与 `physicsTick` 处理旧值。当前 sequence 是 recorder context，不提前改成公共 wire 字段；实际 transport 切片另定义每流序号和乱序规则。
4. correction 继续使用已有快照门禁与 `physicsTick`/确认输入序号规则。Gameplay 不能替代 correction 驱动本地预测，pose 也不能替代 correction 确认玩家输入。

### 实体关联与删除

- 可靠 Gameplay 是非玩家实体身份、可见模型定义、stack、health 和 behavior 的唯一基线；latest pose 只能更新已知同 id 实体的位置、速度、grounded，不能凭一个 pose 新建实体或补出 archetype/stack/health。
- 可靠 Gameplay 新 revision 删除某 id 时，消费者立即删除该实体、关联 behavior 与缓存 pose。之后收到的同 epoch 迟到 pose 不得复活该实体；只有更高可靠 Gameplay revision 再次引入该 id 才能创建。
- pose 的暂时缺席不等于删除。现有 pose 预算为 256，不能通过把 pose 缺席解释为消失来绕过可靠消息或扩大预算。
- 可靠 Gameplay 先到、pose 后到时可先以可靠 position 展示，随后使用最新 pose 平滑；pose 先到且实体未知时只可有界丢弃或缓存，不能创建未验证的展示实体。实现切片需选定其中一种有界策略并测试其上限。

### 玩家重生与传送

`GameplayViewReference` 有意不把 player 作为 `entities` 项。玩家 lifecycle、HUD、库存和 break action 来自可靠 Gameplay；玩家 body position、velocity、grounded、暂停和 input ack 只能以同 epoch `PlayerCorrectionReference` 为准。

因此重生动作成功后，消费者必须等待或合并其后的有效 correction 来重置本地 player body，不能从非玩家 entities 猜位置。当前本地浏览器的 respawn/本地管理 teleport 会从完整 `AuthorityGameplayView.entities` 读取 player；真正客户端适配时需改为上述 correction 路径。管理 teleport 不成为新的玩家公开动作；若服务端导致玩家位移，仍由 correction 表达。`accepted` 输入或请求接纳不等于已执行/已确认，不能据此提前移动玩家。

## 测试设计与预期 RED

### 纯投影单元

新增 `tests/server/network-gameplay-consumer-reference.test.ts`。先导入不存在的新 DTO/projector，取得缺模块 RED；随后覆盖：

1. 从真实 `AuthorityGameplayView` 投影可观察 actor behavior，稳定排序、独立副本、枚举和值域正确。
2. 完整 `ActorState` 的内部字段不出现在 DTO；原 v1 `GameplayViewReference` 仍不含 `actors`，既有 v1 投影字段不变。
3. 重复、孤立、空 id、非法 behavior、行为与非 actor entity 关联均明确拒绝。
4. 实体定义签名的同 id 不变/变更、health/stack/behavior 更新的纯关联约束；不把 position-only pose 作为模型定义输入。

### 真实 Host 语料

新增 change-local `e2e/network-gameplay-consumer-corpus.test.ts` 与专用 Vitest 配置。先预期缺 recorder/DTO 的 RED；GREEN 必须经真实 Host 路径采集：

1. starter ecology 的 actor entity 与对应 behavior；
2. 现有 fixture-admin 增加 world item、creature、actor 后的稳定 entity/behavior 关联；
3. 保存恢复后的同 id/entity 定义与 behavior 重新关联；
4. 每阶段可靠 Gameplay、pose、correction 的 epoch/上下文绑定，以及逐条内容 hash、frames index、manifest payload/provenance hash 的磁盘复核；
5. 重复写入同一新 generation 时字节内容可重复，且旧临时 corpus 文件的 hash 不变。

不把手工伪造 actor 或直接塞实体当作真实采集。不以这些 Vitest 证明 C0/C1/C2 已解码、GUI 已显示、远端连接已建立或网络乱序已处理。

## 准出标准与证据

| 准出项                                                 | 证据类型               | 通过条件                                                                          |
| ------------------------------------------------------ | ---------------------- | --------------------------------------------------------------------------------- |
| actor 最小 allowlist、值域、稳定排序与无内部泄漏       | Vitest                 | 预置 RED 后单元 GREEN；v1 DTO/旧语料合同不变                                      |
| 可靠 Gameplay、pose、correction 的关联、删除与重生语义 | NOT_COLLECTED          | 留给真实客户端适配切片；本轮只记录 Given/When/Then，不以测试专用 reducer 宣称通过 |
| 非玩家 actor 的真实来源与恢复                          | Vitest（change-local） | 三阶段真实 Host 采集、磁盘 index/hash/provenance 全部自洽                         |
| 新旧证据隔离                                           | Vitest（change-local） | 只写新的 generation；旧目录/manifest/hash 不变                                    |
| 正式 codec、网络、浏览器显示与多人/远端                | N/A                    | 留给各自后续切片，不从本计划推导已完成                                            |

本切片完成后，在进度记录中逐项回填 RED 命令、Node 版本、GREEN 结果、source SHA 与新 corpus manifest hash。不得以全仓静态、历史 codec oracle 或历史语料数字替代以上证据。

## 实施拆分与估算

| 子项                                     | 预计改动                                                    | 依赖与边界                                                      |
| ---------------------------------------- | ----------------------------------------------------------- | --------------------------------------------------------------- |
| 参考 DTO、纯投影器和 allowlist validator | `src/server/protocol/` 约 2–3 个小文件                      | 平台无关；不导入 app/client/Node；保留 v1 文件行为              |
| 单元投影                                 | `tests/server/` 约 1 个定向文件                             | RED→GREEN；不改现有浏览器算法                                   |
| 真实 Host 采集与独立配置                 | change-local e2e/support、test、Vitest config 约 3–4 个文件 | 复用真实 bootstrap、fixture-admin、保存恢复；只写新 `/tmp` 目录 |
| 交付记录                                 | 本计划和后续进度文件                                        | 中文；记录实际而非估计的验证结果                                |

预计是一个小型 N0 参考完整性包：约 6–8 个新增或局部修改文件，重点是字段来源与真实 Host 采集，不扩大到 wire、客户端连接、测试专用状态机或性能工作。当前 Gate 已固定：先由 `tests/server/network-gameplay-consumer-reference.test.ts` 取得缺模块 RED；只有主线放行后才新增 `src/server/protocol/` 的 v2 DTO/projector，再进入真实语料 RED/GREEN。客户端适配的状态语义另立实现与验收，不能随本包混入。
