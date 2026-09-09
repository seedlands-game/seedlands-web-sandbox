# 分阶段交付与验收计划

## 依赖、PR 与停止线

| 阶段                        | 可独立合并的交付                                                                                                               | 前置 / 后置                                                     | 准出与停止线                                                                                                |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| H1 共享合同与 Headless REPL | 世界身份/inspect/场景/命令/clock/Logic/Action/barrier/trace/checkpoint 的 core 类型与 Headless 实现，持续 JS 与 JSONL 开发宿主 | Node 已归档；不连接真实模型                                     | 同世界多轮操作与导出恢复，非法输入/并发/取消有结果；不得拿新 API 直接暴露可变 Runtime；实现前冻结 spec/hash |
| H2 Browser 世界一致性       | 在现有 Harness 上增加 Authority RPC，共用世界合同与 conformance fixtures                                                       | H1 的合同先冻结；浏览器实现可在稳定接口后开发                   | 两宿主显式推进得到一致世界/动作结果；真实渲染与输入检查另跑；仅实现共享世界能力                             |
| A1 正式 Actor 与分层算法    | 角色 Inventory/交互平权、Action 仲裁/终态日志、局部感知、反射/fallback，scripted provider 驱动                                 | 复用 H1/H2，角色数据/存档变更须单独审核                         | move/pickup/eat 首个工程闭环后扩展地形、装备/近战/交流；不得把 scripted provider 宣称真实 Agent MVP         |
| A2 Agent Server 与桥接      | 一个认知会话、SDK adapter、WS/ActorWorldPort、配对/能力/时效/预算、记忆确认与恢复                                              | A1 身份与 Action 合同冻结；可先 fake provider 联调              | Authority 二次授权、无全局泄漏、取消/断线/幂等/保存竞态通过；SDK 版本/许可证及 API 配置先准入               |
| A3 可玩单 Agent MVP         | 人格/目标/对话/可见反馈及真实模型；完整营地伙伴旅程                                                                            | H1–A2 全部通过                                                  | 一玩家一 NPC 真实浏览器旅程与保存再入完成；任一作弊、复制物品、穿墙、模型假完成均否决                       |
| 后续 LOD                    | 精度切换、休眠与离线追赶                                                                                                       | 本 MVP 的身份/动作/时间/事件与 persistence 稳定                 | 新 change、新状态连续性与因果验收；不属于本期                                                               |
| 后续 World AI               | 聚落/区域/事件目标与预算                                                                                                       | 复用个体信息与效应器合同；不必等待所有 LOD 功能但集成需明确时序 | 新主体权限、因果传播和宏观预算，不直接改个体记忆                                                            |

实施分工按实际授权与项目路由执行；本表是顺序与合同设计，不自行创建并行任务或 goal。每一阶段要更新估算，冻结输入/head，先 RED 后实现。旧 schema、API 或玩法假设改变时重新核对本设计；不能为了冻结而绕过 Authority。

## 实施前 RED 设计

本轮只设计，以下用例均 NOT_RUN。实现者需先提交能在旧代码失败的最小行为测试，并保留首个失败日志；现有代码不支持公共入口时，以缺失接口/能力断言做 RED，不临时造“已实现”适配。

| ID  | Given / When                                                       | Then / 核查点                                                                    | 证据层                                 |
| --- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------- | -------------------------------------- |
| H01 | 同一 REPL 连续创建夹具、查询、advance、查询                        | worldId 稳定、tick/revision 正确推进；第二条命令不是新世界                       | CLI JSONL + core 测试                  |
| H02 | running 时要求 advance，两个 mutation 并发                         | 明确拒绝/串行，无双时钟、双写或重复结果                                          | 确定性时钟/调度                        |
| H03 | 未加载 Chunk inspect；显式 prepare 后再读                          | unknown 与真实 Air 区分；read 不偷偷生成世界                                     | core + 双宿主                          |
| H04 | 请求 barrier 时持续产生新 observation                              | 固定 frontier 可终结；pending 的指定工作超时可诊断                               | core + Worker                          |
| H05 | 相同 checkpoint/脚本/ticks 两宿主运行                              | 世界 hash/Inventory/Action/事件一致；排除渲染指标                                | Headless + Playwright Authority Worker |
| H06 | restore bundle 被截断/版本不支持                                   | 原世界仍可用、不覆写存档；正常 restore 更换 epoch                                | fixture + 浏览器存储                   |
| A01 | 玩家和 NPC 同资源/姿态做拾取、食用、采集/放置、装备、合成、近战    | 共享规则给等价资源/耗时/距离/失败后果；控制适配可不同                            | core 成对用例                          |
| A02 | NPC 去取浆果，玩家先拾走；满背包/隔墙目标                          | 失败明确，无重复物品、远距拾取或隐私信息泄漏                                     | core + 浏览器真实输入                  |
| A03 | NPC 移动中玩家封路、挖脚下、目标跨 Chunk                           | 停止/跳跃/合法重算或失败；无 teleport/穿墙/无限重算                              | Physics + 浏览器轨迹/画面              |
| A04 | 受击/死亡时 LLM 仍等待，随后旧回答到达                             | 即时反射不等模型，旧 controlRevision 拒绝，死体不执行动作                        | fake 延迟模型 + Worker                 |
| A05 | 伪造 actorId/grant/source、他人背包、全局 inspect、set-block patch | Bridge 和直接 Worker 入口都拒绝；世界 revision 不因非法请求变化                  | 权限负例 + 浏览器                      |
| A06 | 隐藏 POI/隔墙物品/玩家私有 Inventory 含哨兵值                      | observation、errors、events、SDK prompt/trace 中不出现哨兵；已知旧事实有时间标记 | 序列化数据检验                         |
| A07 | 重复 sequence/request、同 ID 不同 payload、旧 epoch、乱序          | 效果至多一次；冲突/过期有具名回执；缓存淘汰不导致重做                            | 协议与恢复测试                         |
| A08 | 模型超时/非法 schema/超预算，WS flood/发送队列满                   | 有界拒绝/关闭/fallback，玩家继续可玩；记录实际调用与失败                         | 故障注入 + 浏览器                      |
| A09 | save 与 action/memory ACK/断线同时发生                             | checkpoint 是单一 cut；新 epoch 无迟到写入，无先记忆后事实                       | 可控调度 + persistence                 |
| A10 | 读旧版存档，首次启用 Agent，再存档重启                             | 不自动转所有 settler；Actor、Inventory、人格、目标/经历恢复且不复制身体          | 旧/新 fixture + 浏览器                 |
| A11 | 认知说“建好了”，实际 Action 失败                                   | UI/记忆不能把文本当世界已完成；事实来自回执                                      | fake provider + 浏览器                 |
| A12 | 同环境更换谨慎/冒险 profile，在竞争口粮与风险选择时                | 性格在选择/发言上有可解释差异；不因性格获得额外权限                              | 固定输出工程测试 + 真人/模型评价       |
| A13 | disconnect / close / restore 后资源清理                            | 无悬挂 WS/Worker/timer、旧输入或共享会话认知污染                                 | 生命周期 + 浏览器                      |

所有命令与检查以实施时 `package.json` 为准；至少 `pnpm verify:static`、`pnpm build` 为独立基础证据，需求浏览器测试放实施 change 目录。新长期基线提炼需项目规定的独立评审，不能在本设计提前承诺入 `tests/e2e`。

## 最终玩家旅程

由 DeveloperWorldHarness 建立版本化营地 fixture 后退出脚本控制，用真实键鼠输入操作玩家；NPC 由真实模型经 ActorWorldPort 驱动。至少连续记录进入→观察→交流→采集/拾取/食用→玩家干预→重规划/失败→地形变化→保存→重新进入。不得为截图瞬移 NPC、直接改 Inventory 或调用开发动作替它完成目标。

自动观察：同屏可见玩家/持久 NPC 状态；Action accepted/终态与动作姿态对应；一次物品转移、一处地形变化与材料账本一致；断网期间玩家仍能行动；重新进入 identity 与后果保持。原始证据绑定 source SHA、seed/fixture hash、模型/provider/config、checkpoint identity、输入序列与 trace。

视觉语义补充：连续早期/中段/转视角/受阻/恢复帧或视频，检查移动、手持物、采集/攻击动作和碰撞是否可信；UI 可读地显示 NPC 名字、公开行动/发言和连接状态。用 Playwright 验证程序化行为，Midscene/手工判断“像另一个玩家”的可见语义，不能以单帧证明持续行为。

真实模型试跑预注册为 3 个独立新会话、每个 10–15 分钟，至少 2 个完成营地核心目标；全部完成性格/目标可辨、玩家干预后合法处理、无世界规则绕过、断线安全和保存恢复检查。记录所有失败，不能重试到 3 次漂亮演示就报成功。若模型目标成功率不足，先缩小可选目标和改善观察/工具反馈；不通过扩权、隐藏失败或写死剧情修复指标。

这组门槛是工程 alpha 准出，不能证明广泛市场留存或所有 NPC 都像人。随后真实用户内测询问“它自己想做什么、你如何改变了它、留下了什么”，收集自由描述；不以架构指标代替体验反馈。

## 成本与性能验收

首先证明有界：每决策/会话的输入/输出/缓存/重试/费用、RPC 字节、队列峰值、动作完成/失败、World tick debt 和玩家 frame p95/p99 都可关联到同一 run。SDK usage 缺失标 unknown 并保守扣预留预算，不当 0。

任何采用 SDK/结构/语言以更快更省为理由时另做独立 A/B；本设计没有这种收益结论。A3 的性能控制：先注册预算，在机器性能窗口取得 A/A 噪声，再比较同种子、同动作计划/速率、同配置下“算法/scripted provider”与“真实异步桥接”；此对照是整项 Agent 接入成本，不能归因给某个 codec 或 SDK。必要组合端到端通过后才宣称满足预算，不能用 Headless 吞吐代替浏览器可玩性。

## 退出和重开条件

- 需要全局 inspect/任意 patch 才能成功：视为观察或 Action 设计失败，退回 A1/A2。
- 共享 Harness 必须模拟 GPU 才能对齐：职责拆分错误，保留浏览器专用层。
- 单 Actor/一个目标无法在 2 次有界设计修订后解释资源、错误与恢复：停止扩展技能，明确最小缺口重新审核。
- 稳定 NPC 行为只有重写整个 ECS 才能表达：先记录当前 owner/接口不可复用的证据，再重估；不以本设计默认授权大迁移。
- 用户要求离线进展或多个真实玩家：新阶段，不偷偷加入本期。

## 独立审阅补充用例

A07 增加：action/memory/cancel 共享序列交错；相同 requestId 不同 mutation payload 冲突；receipt 淘汰后旧序列与旧连接重放；restore 后 duplicate memory/action 不重复 effect。

A09 增加：cancel vs complete vs save 的每种合法提交顺序；断言 snapshot 的 worldRevision/commitSequence/agentState frontier 一致；确认不可逆 effect、memoryVersion 与 receipt ledger 在同一 cut。

A10 增加：schema 1 无 Agent 迁移；schema 2 Agent block 被删除/截断不得部分恢复；旧 epoch 回应在恢复中断提交前后都被拒绝。以上仍是 NOT_RUN 的实施前 RED 设计。

A07/A09 另断言：恢复中断的 Action 与关联 accepted receipt 在同一恢复 commit 变为同一 terminal，且新连接按原 key 查询得到同一终态和 commitSequence，不能长期 awaiting-action。
