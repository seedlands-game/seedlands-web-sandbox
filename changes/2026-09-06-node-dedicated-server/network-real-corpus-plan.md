# N0 真实 Host 语料采集与公共投影计划

## 状态与结论

当前 N2 的 28 条样本只是合成探索候选，不能冻结 wire 或选择 codec。真实语料必须由运行中的 Authority Host 在**公共网络投影边界**采集：记录已经认证、验证且按会话语义整理的入站/出站 DTO；不抓取 `AuthorityRequest`/`AuthorityResponse` 的 Worker 消息，不序列化 `AuthorityRuntime`、`GameServer`、diagnostics、Logic/Fluid/mesh 内部状态，也不上传 trace。

本计划先以受控固定 seed 的 `DedicatedServerHost` 生成可审阅 reference corpus；该 helper 记录投影后的 DTO，且把 Chunk 的 metadata UTF-8 与完整 canonical/fluid 二进制块分开保留，不是 wire encoder。每个未出现的真实场景标为 `NOT_COLLECTED`，不得用合成 sheep/slime/villager、数值 epoch 或手写 Chunk 填补。

## 已核实的真实语义来源

| 公共语义               | 当前权威来源与字段                                                                                                                                                                                                                      | 当前浏览器消费者                                                                                              | 采集的最小投影                                                                                                                                                  | 不可原样上网的内容                                                                                                                                                               |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 会话与 ready           | `src/worker/authority-worker-protocol.ts` 的 `AuthorityReady`：`playerId`、`seed`/`seedText`、`generatorVersion`、`worldTime`、频率、初始 `snapshot`/`gameplay`                                                                         | `src/app/game.ts` 用 ready 初始化相机、World、HUD                                                             | `WelcomeReference`：string epoch、server/session/world/player id、seed、generator/game/content/physics/fluid 版本、频率、显式 limits、初始与 durable checkpoint | `worldId`、server/session epoch、content 版本、limits 与 durable checkpoint 由 Node 接入适配器作为显式 context 提供；reference 只允许空 capability 且 `wireStatus=not-adopted`。 |
| 连续输入与可靠 edge    | `src/runtime/session-protocol.ts` 的 `InputCommand`：string `epoch`、`stream`、`sequence`、`targetPhysicsTick`、`issuedAtMs`、`moveX`/`moveZ`、`verticalIntent`、`jumpHeld`/`jumpPressed`                                               | `src/client/local-player-prediction.ts` 生成并预测；Worker 回 `input-decision`                                | `PlayerInputV1` 与 `InputReceiptV1`；保留实际 string epoch、`-1` 初始 ack 语义、序号、tick 与输入字段                                                           | 合成 `sprint`、`underwater`、独立 edgeId 均不是当前 `InputCommand` 字段。                                                                                                        |
| 权威修正               | `src/server/authority/authority-session-types.ts` 的 `AuthoritySnapshot`：`physicsTick`、`commitSequence`、`acknowledgedInputSequence`、`inputResyncRequired`、player body/grounded、`chunkRevisions`、world revision/time、paused      | `LocalPlayerPrediction.applyAuthoritySnapshot()` 用 ack、body、grounded、revision vector 重放                 | `PlayerCorrectionV1`：epoch、physics/commit tick、signed ack（允许 `-1`）、resync、position/velocity、grounded、完整 collision revision vector、world revision  | `diagnostics`、contacts、physics cost、residency、全部其他 bodies 不是 correction 必需字段；当前 snapshot 没有权威 `inFluid`，不能伪造。                                         |
| 可见实体与 HUD         | `AuthorityRuntime.view()` 返回 `AuthorityGameplayView`：`gameplayRevision`、`player`、`entities`、`actors`、`craftableRecipeIds`、`metrics`；实体实际 type 为 player/world-item/creature/npc，archetype 为 grazer/night-stalker/settler | `BrowserGameplay.refresh()` 投影 HUD、库存、实体表现与行为标签                                                | `GameplayViewV1`（玩家 HUD/背包/配方）及 `EntityPoseV1`（id、type、archetype、position、可选 velocity、需要的生命/stack/behavior、source gameplay revision）    | `metrics`、完整 `actors`、持久化字段和未被 UI/表现消费的实体字段不自动进入网络。                                                                                                 |
| gameplay action 与回执 | `AuthorityAction`/`AuthorityActionResult` 的 action union；`authority-response.result` 目前为 `unknown`，附 gameplay/commits                                                                                                            | `BrowserGameplay` 对 craft/attack/break/place/respawn/inventory 显示成功或失败并排队保存                      | 可靠 `GameplayActionV1`、带 transaction id 的**类型化** `GameplayActionReceiptV1`、必要 gameplay revision 与 commit refs                                        | 不能直接发送 `unknown result`、本地 `server-command`、set-world-time/clock、任意 set-player-position 或 worker request id。                                                      |
| 世界提交与碰撞         | `WorldCommitResult`：`worldRevision`、结构 Chunk revisions、`collisionDelta`、semantic events；`AuthorityCollisionBaselineResult` 有 canonical/fluid ArrayBuffer                                                                        | `AuthorityCollisionRevisionGuard` 与 baseline client 先安装基线再重放；`World.consumeServerCommit()` 更新表现 | `WorldCommitReference`、`ChunkBaselineReference`；baseline 保留 key/revision、完整 canonical/fluid、副本长度/元素类型与注入的 SHA-256                           | `metrics`、任意 semantic `data`、Worker mesh overlays、客户端 mesh/canonical 回传都不进入公共 game stream。                                                                      |

`AuthoritySnapshot.epoch` 已是 string，`InputCommandBuffer` 的 `acknowledgedSequence` 初值明确为 `-1`。`AuthoritySession.snapshot()` 当前 bodies 使用 `{ position: {x,y,z}, velocity: {x,y,z} }`，不是合成语料的数组 pose；投影器应明确变换并在 N2 前以字段级等价验证。真实 archetype 也必须以上述枚举为准，某次 Host 未出现的种类仅登记缺失。

## 真实 Host recorder 位置与流程

1. change-local `NetworkProjectionRecorder` 已用固定 Host fixture 验证；未来的 Node Authority 会话适配器才是它的正式落点。其输入是已认证的 session identity、`AuthorityRuntime.ready()`、`wake()`、`view()`、`takeCommits()`、`readCollisionBaseline()` 的**投影结果**，不是 Worker port 的 `postMessage` 载荷。现有 Worker 路径只用来核对消费语义：`src/worker/authority-worker.ts` 以至多 60 Hz 发布 snapshot、以 20 Hz 发布 gameplay，并附 commits。
2. 入站在身份/epoch/序号/范围校验之后记录 `PlayerInputV1` 与 decision；拒绝项记录稳定 reason、字段类别和大小，不记录认证 token、原始输入文本或任意对象转储。出站在 projection、长度/版本/因果校验之后记录 payload hash 与接收端应用结果。
3. recorder 每条只存：投影器版本、产品 source SHA、Host 配置 hash、session/player/world id、方向、类别、可靠性/期限、因果 id、字段 schema、payload content hash、长度、采集时单调序号和 `NOT_COLLECTED` 原因。本阶段只使用明确的测试 seed 与测试世界，不伪名化它们或改写 id/长度；记录中排除凭据和真实用户内容。trace 留在本 change 的本地运行证据目录，不上传、不提交。
4. baseline hash 由显式的异步 `sha-256` digest 端口计算：Node 适配器可注入 `node:crypto`，浏览器适配器可注入 WebCrypto，投影层只校验算法标识与小写 64 位 hex，不导入 Node builtin。`uint16-source-buffer` 只说明当前 Authority TypedArray 的原始字节，**未规范网络字节序**；N2 前必须转为统一 little-endian 数值块，或在正式 corpus 中显式登记并验证实际字节序，不能把它当正式 wire。recorder 必须在正式 codec 之前写出 canonical projected corpus（例如 JSON Lines metadata + binary sidecar hash）；四个 codec 仅读取该 corpus，禁止在某 codec 内增删字段。编码前再执行同一 schema/预算 validator，编码后由接收镜像应用并记录成功/拒绝。

## 采集旅程与因果要求

| 旅程                 | 必须从真实 Host 取得                                                                                    | 关键因果/验收                                                                       | 缺失时的记录方式                                                |
| -------------------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| 冷 join 至 playing   | `WelcomeV1`、初始 correction、初始 gameplay、至少一组 Chunk baseline 与 commit checkpoint               | welcome 校验后才安装镜像；baseline 在关联 commit/revision 前到达并可读              | `NOT_COLLECTED: host-join-fixture-missing`，不得造 seed/Chunk。 |
| 输入、jump edge、ack | 连续/跳号 input、接受/重复/过期 decision、`ack=-1` 初始 correction 和至少一条已 ack correction          | epoch/stream/sequence 与 target tick 一致；预测只重放有 collision baseline 的输入   | `NOT_COLLECTED` 并注明未能诱发的 decision。                     |
| 碰撞与 Chunk 变更    | actual `WorldCommitResult`、delta、baseline、一个缺 baseline/落后一版/追平恢复序列                      | `previousRevision` 连续；缺失/旧 baseline 时不重放并发起重同步                      | 由受控 Host mutation 得到，不能手写 cell 或 fluid。             |
| 实体/HUD             | gameplay view 的 0/实际可见数量、真实 player/world-item/creature/npc/archetype、库存/制作/破坏/死亡状态 | `gameplayRevision` 单调；EntityPose 以 source revision 拒绝旧包；HUD 不包含 metrics | 当前世界没有某 archetype 就标缺失，不扩大场景生成。             |
| gameplay action      | 真实 craft/attack/break/place/respawn/inventory 请求及成功、失败、重复/断线后未知结果                   | transaction receipt 幂等；commit 与 gameplay revision 可关联                        | `unknown result` 必须先被类型化，未定义前只记录缺 DTO。         |
| 关闭/恢复            | 隐藏中性输入、断连、重连新 epoch、全量 resync、保存退出或仅断开                                         | 旧 epoch payload 不得更新新镜像；远端断连不暂停世界                                 | 本地 Worker `pause-authority` 不能当共享 Host 暂停证据。        |

## 正式投影缺口与先决校验

1. `WelcomeReference` 已覆盖 current ready 可得的 seed、generator、频率、world time 与 initial checkpoint；server/session/world id、content/schema 版本、limits 与 durable checkpoint 只能经显式 context 输入，尚无 Node 接入适配器证明其运行配置。它严格标记为 `wireStatus: not-adopted` 且空 capability，不是握手 wire。
2. `PlayerCorrectionV1` 缺明确 `inFluid`；现有 `AuthoritySnapshot` 有 grounded 和 collision vector，但没有可直接上网的水中状态字段。需要定义来源和客户端消费者后才能加入。
3. 当前 gameplay 是完整 view，`actors`/`metrics` 与 `AuthorityActionResult.result: unknown` 不能直接构成公共 DTO。需定义 entity pose delta/keyframe、行为显示白名单、类型化 action receipt 及 inventory/item schema/version。
4. `WorldCommitResult.semanticEvents[].data` 是 unknown；Chunk baseline 当前由 request/response 取得。Reference 已从真实 `readCollisionBaseline()` 复制完整 canonical/fluid，并经可注入 SHA-256 产生 hash；仍缺 public subscribe/cancel、transfer id/page、压缩标记、resync reason 与可靠流边界。必须先投影再采集。
5. 公共 DTO validator 要显式检查：string/array/frame/解压预算，安全整数与 signed `-1` ack，f64 finite，epoch/session/stream 一致，revision predecessor，action transaction、旧 epoch 和 request correlation。拒绝不得推进 collision mirror、HUD、预测或队列。

## N2 重新准入条件

- 有真实 Host 的投影 corpus，带投影器/source/config/content hash，并至少覆盖 cold join、`ack=-1`、已 ack input、真实 commit/baseline/delta 与一项真实 action receipt；其他缺场景明确 `NOT_COLLECTED`。
- C0/C1/C2/MP 对完全相同的投影 corpus 强等价，接收端实际应用到 collision mirror、prediction 和 gameplay/HUD 镜像；合成 corpus 只能留作开发 smoke。
- 每个 codec 有独立 wire-level 畸形 mutation（frame/version/length/discriminator/计数/非有限或等价表示/oversize/trailing），与共享 DTO validator 证据分列。
- C1 改为有界单 buffer 与复用 `DataView` 后重新验证/登记 source 与 bundle hash；未满足时不比较其 CPU/分配。
- 以上只使 N2 能开始可比实验；仍需 N3 transport 与 N4 真实旅程/WAN 证据才允许冻结 wire 或 GUI/部署。

## 2026-09-07：已注册 actor 密度语料（计划待实施）

### 目标、代次与不变量

在现有小规模真实实体语料之外，新增一个**独立 generation** 的密度来源，只验证当前公开 `Gameplay v2`、`EntityPose` 与 `PlayerCorrection` 在真实 Host 的 32 和 128 个已注册 actor 档可被完整投影。它不重写 `/tmp/seedlands-network-real-corpus-v1`、`/tmp/seedlands-network-entity-corpus-v1` 或 `/tmp/seedlands-network-gameplay-consumer-corpus-v2`，也不把小样本替换成密度样本。

每个档位使用一个全新、固定 seed 的 `DedicatedServerHost` 和独立持久化实例；同一档位的 C0/C1/C2 必须读取同一份已写盘的 canonical records、实际字段、seed、Host config 与 source hash，禁止由候选 codec 触发不同生成、不同命令或不同投影。目录暂定为不覆盖旧代的 `/tmp/seedlands-network-gameplay-density-corpus-v1/actors-32` 与 `/tmp/seedlands-network-gameplay-density-corpus-v1/actors-128`。最终目录名、generation、manifest format 在 RED 用例和 recorder 一起冻结，不借用历史 manifest 的 content hash。

本阶段不提高 `MAX_RETAINED_ACTORS = 512`，也不改变 `EntityPose` 的 256 项上限。32、128 指**实际已注册 autonomous actors**，不是手写 snapshot 的数组长度、保留上限或性能目标。记录时同时保存并断言实际：

| 字段                                               | 含义与要求                                                                                               |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `registeredActorCount`                             | 从真实 `GameplayView.actors` / consumer `actorBehaviors` 可交叉核对的已注册 actor 数；必须恰为目标档位。 |
| `totalEntityCount`                                 | 同次真实视图中包含 player、world item 与所有实体的实际数量；不预设为 `目标 + 1`。                        |
| `poseEntityCount`                                  | 同次 `EntityPose` 投影的实际项数；必须等于该次可投影实体数且不超过 256。                                 |
| `gameplayEntityCount`                              | 同次 Gameplay v2 的非玩家实体数；当前投影明确排除 player，不能与 pose 总数混称。                         |
| `gameplayRevision`、`physicsTick`、`worldRevision` | 每帧真实因果上下文，用来证明推进后的 publication 不是同一静态 view 的重复序列化。                        |

本 fixture 只有一名 player：每次捕获都断言 `poseEntityCount = totalEntityCount`、`gameplayEntityCount = totalEntityCount - 1`，并单独断言 `registeredActorCount` 为目标档位。现有 starter ecology 和世界物品保持存在，因而总实体数以实测为准；若它们使 pose 超过 256，则该档明确 RED/拒绝，不裁剪、不开大预算，也不伪造只含 actor 的视图。

### 真实来源与采集旅程

1. 各档先走 `DedicatedServerHost.create` 的正常 safe-spawn、starter ecology 和加载流程，不设置 `initialPlayerBodyPosition`，不直接写 `EntityStore`、`GameplayRuntime`、actor map 或 snapshot。
2. 用现有 `AuthorityRuntime.executeCommand` 的 `local-developer` fixture identity 和既有 `spawn-actor` 命令补足到目标数。命令明确记录来源为 fixture 管理操作、actor id、archetype、位置、命令序号及 capability；它不是入站玩家 action，也不扩大任何网络权限。位置采用固定、互不重叠的确定性格点，archetype 的分配规则也写入 config，避免某次随机分布改变消息字段。
3. 最后一条命令成功后，经一个有界、真实 Host 的 simulation/wake 推进取得新的 correction、pose、Gameplay v2 publication；记录推进前后实际 tick/revision 与 actor/entity 计数。此处只确认状态确实来自推进后的 Host，**不**采集耗时、吞吐、CPU、内存或 tick p95。
4. 每档至少写一组相同 publication 顺序的 `player-correction`、`entity-pose`、`gameplay-consumer` records。correction 是玩家权威状态；pose 与 Gameplay v2 分别保留其既有完整允许字段。不得为密度而缩减 actor behavior、实体、库存或其他当前公开字段。
5. 写盘后重读，逐条重算 content hash，复核 index、manifest payload hash、corpus hash、provenance、source/config hashes，并与内存记录 `deepStrictEqual`。manifest 必须包含目标 actor 数、实际五项计数、seed、生成/投影版本、命令来源和有界推进说明；候选 codec 的 decode/application 验证在后续包中读取该 manifest，不在本采集包内实现。

### RED / GREEN 与保存恢复取舍

最小 RED 先让 change-local 用例要求每档的目标 `registeredActorCount`、完整三类别 publication、实际计数关系、推进后 tick/revision 变化以及 provenance/hash 绑定；在尚无 collector 或只产生 starter ecology 时，应因缺 records、计数不足或未推进而失败。GREEN 仅在上述真实路径满足后写入两个新目录，并显式验证 32/128 的 `poseEntityCount <= 256`。

本包**不机械重复**保存恢复：`network-entity-corpus` 与 gameplay-consumer v2 的三阶段小规模旅程已经验证 starter ecology 不重复、同一 `MemoryGamePersistence` 恢复和新 Host publication。密度包的首要未知量是当前公开投影的数量与字段完整性；除非 RED 暴露命令扩容后保存边界会改变 actor registration 或 publication 字段，否则不把保存/恢复加入 32/128 旅程。若需要该问题，另建以 32 或 128 真实登记为输入的恢复子包，不能在本包临时扩大。

### 非目标、后续门槛与范围归属

这不是 startup、world commit、interest/visibility、baseline、传输背压或完整 N2 合同：不证明 join burst、可靠重传、乱序、GUI 表现、客户端 actor lifecycle、WAN、codec 性能或正式网络采用。现有 256 pose 预算只作为接收前的明确 gate；512 actor 上限只作为产品既有上限，二者均不成为扩容授权。

实现预计只新增 change-local density collector、Vitest config、定向采集用例和进度/证据摘要；不修改生产 API、投影 DTO、原型 codec 或旧语料。它属于原 N0/N2 估算的实体代表性补齐，不申请新的性能实验或额外范围；将来的 timing 采样必须基于本 generation 的固定 records 另行合同、单独执行与报告。
