# 输入方向与独立实体 pose：实施切片

## 目标与合同关系

本切片落实冻结 [network-selection](network-selection.md) 的 N0/N2 消息域和真实语料要求，沿用已授权的本地实施。只增加纯参考投影和当前 change 的采集/验证，不冻结 wire、发送频率、网络连接或 GUI；不改 Host 执行规则。完整编解码/传输门槛仍保留。

目前的 59 条共同链路样本只覆盖六类出站消息。新增输入 state/edge 与独立 pose 后，才能比较实际双向负载。不得把 HUD/库存与 entity pose 混在同一可靠 gameplay 消息，随后把少发字段的收益归功于 transport。

## 已核实的语义

- 入口实际为 `DedicatedServerHost.receiveInput(input)`；同步返回 `SequenceDecision`。`accepted` 只表示进入有界 pending，后续物理 tick 消费时才推进 correction 中的 `acknowledgedInputSequence`。内部 idle input 的 sequence=-1 不得当合法入站输入；初始 correction ack=-1 必须保留。
- `InputCommand` 已含 state 与 `edges.jumpPressed`，没有独立 edgeId/期限字段。本切片保留真实结构，不发明新输入协议。N3 分流前必须继续保证 edge 不因 latest 合并丢失。
- `AuthoritySnapshot.entities` 已含 id/type/archetype、Body position/velocity/grounded。pose 单列这些实际来源，排除 contacts、diagnostics、HUD、inventory；携带 epoch、physicsTick、commit/world revision 及显式 publication sequence context，后者必须说明来自哪个发布者，不能冒充 snapshot 固有字段。
- `Host.performAction(action,sequence)` 内部只构造 epoch/player issuer/`player-actions` stream/sequence，尚未消费外层 TransactionCommand 的 issuedAtMs/expectedCommitSequence。本轮不伪称这些字段已由 Host 验证，动作请求投影/接入另按真实调用合同补齐。

## 行为与测试设计（实现前）

1. Given 完整有效 InputCommand，When 参考投影，Then 精确保留 state/edge/sequence/target tick/time，并产生独立副本；内部 idle -1、unsafe integer、非法版本、非 finite/越界 move、非法 verticalIntent/boolean 均拒绝。不得通过复制任意额外字段扩大公共输入。
2. Given 同一输入与 Host 返回的 decision、紧邻调用后的实际 snapshot，When 决定投影，Then 同时保留 server epoch 与输入 identity、目标 tick、观测物理 tick/ack/resync；`accepted` 不改为 executed。wrong-epoch 等决定保留输入 epoch 与 server epoch 的区别；malformed raw input 只记稳定拒绝类别，不转储任意输入。
3. Given AuthoritySnapshot 与显式 publication sequence，When pose 投影，Then id 唯一、顺序确定、position/velocity/grounded 可逆，type/archetype 合法，所有计数安全且 f64 finite。多余 contacts/metrics 不进入投影。超过 256 个 pose entity 明确拒绝，不静默裁剪；这是探索接收预算，不是缩减有效世界工作量。
4. Given 真实受控 Host，When receiveInput 返回 accepted，Then 决定时 ack 仍为旧值；推进目标 tick 后 correction 才确认；重复序号被拒绝且 ack 不因此推进；本小语料不单独证明重复 edge 的运动效果。未能从真实 Host 采到的实体规模/状态只用独立标记的 structured synthetic 补充，原 CODEC9 不改写。

新增纯投影位置：`src/server/protocol/network-reference-input-types.ts`、`network-reference-input.ts`、`network-reference-pose.ts`。确定性用例：`tests/server/network-reference-input.test.ts`、`network-reference-pose.test.ts`，先取得缺模块或行为失败 RED，再实现 GREEN。源码/测试遵守既有 500 有效行与平台边界。

真实采集采用新 change-local 用例与独立 corpus 目录，不能覆盖 `/tmp/seedlands-network-real-corpus-v1`。相关 parser、三候选 schema 与浏览器互操作在 `/tmp` 的可丢弃原型独立扩展，不能直接升级为生产协议。

## 准出与当前状态

| 准出                                                | 证据类型 | 当前                                        |
| --------------------------------------------------- | -------- | ------------------------------------------- |
| 输入/决定的值、边界、副本及 accepted/ack 区分       | Vitest   | 已取得 RED；input 11 项、pose 9 项 GREEN    |
| pose 字段投影、版本关联、唯一性与预算               | Vitest   | 已取得 RED；input 11 项、pose 9 项 GREEN    |
| 真实 Host 输入→决定→后续 ack 与新 corpus provenance | Vitest   | 采集 1/1；三候选实际 Host 重放 2/2 GREEN    |
| 平台边界、格式、命名与类型                          | Static   | 完整 verify:static 通过                     |
| 浏览器/Node 构建                                    | Build    | 浏览器与 5 入口 Node 构建通过               |
| 可见 UI、连接和视觉                                 | N/A      | 本切片无 UI/连接实现，不能声明 GUI/网络准出 |

## 独立复审后的证据补充设计

- pose 序号的发布者写入每条语料 provenance 和 manifest，固定说明来自 `DedicatedServerHost.subscribe` 的单次 recorder 订阅。本次不把 recorder 身份扩成未来 wire 的生产字段。当前五条 pose 都只有 player，仅是双向小语料；真实非玩家、不同密度与 gameplay 消费者仍是 N2 缺口。
- 从磁盘重新计算 corpus、manifest payload、每条 content 的 SHA-256，并核对索引与 provenance 绑定。对同一次 capture 重写两次只证明 writer 稳定，不能声称两次 Host 执行完全一致。
- 新增 `e2e/network-directional-application.test.ts` 与独立配置，显式接收三候选解码 fixture。先校验来源绑定和逐字段等价，再将每个 codec 解码后的 input 送入新建的真实 Host，核对即时 decision、wake 后 correction 与 pose。预期 RED 为缺少 fixture/解码记录或破坏输入导致重放不一致；不在计时区导入原型，不把类型断言当 wire 校验。
- 浏览器互操作单独运行新 21 条语料，与原 9 条不同 epoch/世界的语料不拼成同一业务序列。功能互操作、Host 重放和未来性能采样分别记证据。

本切片属于原大规模 change 预算中的 N0/N2，当前不增加网络技术采用或部署范围，不重复创建 goal。阶段结束更新实际测试/构建和 SHA，N2 采样仍须独占窗口。

## 本切片交付快照

新增纯参考投影及两组单元测试、change-local recorder 与输入应用 oracle，未改变 Host 执行规则。输入关系独立审查、实际 Host 重放和完整静态/构建已通过；详细来源、范围、命令与最终原型 SHA 见 [进度](network-input-pose-progress.md) 和 [证据](network-input-pose-evidence.json)。原冻结 spec/附件未变，整个 change 仍 Active。非玩家补充语料另按 [采集合同](network-entity-corpus-plan.md) 验证；表示域、正式性能与网络采用继续保留门禁。
