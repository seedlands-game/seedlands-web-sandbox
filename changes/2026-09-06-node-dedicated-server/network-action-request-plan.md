# 玩家动作请求与回执：实施切片

## 目标与边界

补齐冻结 N0/N2 的小动作请求方向与真实 Host 应用闭环。此前已验证完整动作回执 schema，但这不等于入站动作请求已经覆盖。本切片只做纯参考投影、当前 change 的语料与可丢弃 codec 扩展，不采用 wire、不增加 listener、GUI 或身份权限。

## 实际调用合同

`DedicatedServerHost.performAction(action, sequence)` 的真实参数只有 `AuthorityAction` 与 sequence。Host 从自己的 epoch 和 `runtime.playerId` 构造 `{epoch, issuer, stream: 'player-actions', sequence}`，并经有界 action 队列调用现有事务去重和玩法规则。它没有消费 `TransactionCommand.issuedAtMs` 或 `expectedCommitSequence`，不能在当前 oracle 中伪称这两项已执行。

参考 DTO 定义为 `{kind: 'action-request-reference', projectionVersion: 1, action, sequence}`。只序列化真实参数；epoch/issuer/stream 在采集 provenance 中明确是 Host 所有的调用上下文，不从客户端 payload 获得授权。未来 transport 的 epoch/session 封套与认证绑定仍需正式适配层验证，这份裸参数参考不是可直接上线的请求协议。

## 行为与测试设计

1. Given 九种合法 AuthorityAction 与非负安全 sequence，When `projectActionRequestReference(action, sequence)`，Then 只保留该动作定义字段并生成独立副本。槽位等保留 MAX_SAFE_INTEGER，以便实际业务返回 invalid-slot；位置保留带符号安全整数，不偷偷缩成 int32。
2. Given 非法 type、字段、空/超既有参考预算的文本、非法整数或稀疏三元组，When 投影，Then 明确拒绝，不能生成 malformed reference。动作 canonical copy 与已有 receipt 投影共享同一局部 helper；保留既有成功/失败回执语义，先测再提取。
3. Given 实际新 Host，When 用唯一 sequence 顺次发送九种动作和一次同 key 同 payload 重试，Then 记录每条请求、真实回执与实际 gameplay/snapshot 锚点；成功、业务失败与重复回执分别标记，不制造成功结果。同 key 改 payload 不执行新业务；如现有 receipt 拒绝重标不同动作，记录原回执绑定，不伪造新结果。
4. 三候选对同语料强等价，解码后的 action/sequence 在全新 Host 实际调用；结果及关键 gameplay 状态与源 Host 一致。重复动作不让世界/库存再次改变。校验与 oracle 不纳入未来 codec 计时。

生产文件：`src/server/protocol/network-action-request-reference.ts` 与按职责提取的 action copy helper，已有 `network-action-reference.ts` 改为复用。单元：`tests/server/network-action-request-reference.test.ts`，复验既有 receipt 测试。采集/应用：`e2e/network-action-corpus.test.ts`、`vitest.action-corpus.config.ts`；如应用 oracle 拆文件，其独立配置与 fixture 输入须显式，不默认混入长期基线。

原型只位于 `/tmp/seedlands-network-probe-codec`，新真实语料 `/tmp/seedlands-network-action-corpus-v1-source-bound`，保留旧 `/tmp/seedlands-network-action-corpus-v1` 且不改写旧 9/21/6 条语料。记录逐条内容、manifest、源码/配置和可信 Host 上下文的来源绑定；生成结果不提交为原型生产代码。

## 验收与状态

| 准出                                | 证据类型                  | 当前                                           |
| ----------------------------------- | ------------------------- | ---------------------------------------------- |
| 九动作、参数域、复制与 receipt 兼容 | Vitest                    | RED 后 GREEN，reference 36/36                  |
| 实际调用/回执/重试与语料来源        | Vitest                    | Node 22 source-bound 真实 40 条，采集 1/1      |
| 三候选解码应用与互操作              | Vitest、Manual supplement | Host 应用 3/3，Chrome 双向各 40；不证明 GUI    |
| 平台/格式/命名/类型                 | Static                    | 通过                                           |
| 浏览器与Node构建                    | Build                     | 通过                                           |
| 正式网络身份与重连、UI/WAN、性能    | N/A                       | 本切片不实施或宣称准出，原 change 后续仍需完成 |

本切片属于既有 N0/N2 估算范围；沿用最近滚动剩余区间，未扩大产品范围，不创建 goal。独立分工：Terra 负责纯投影与单元，Sol 负责真实 Host 采集/应用，root 负责原型整合、审阅及统一准出；阶段结束保存并推送稳定检查点。

## 采集前补充：整数零的统一表示

只读核对发现，生产事务的 Map/序号比较、库存下标、体素键及 Int32Array 将整数 `-0` 与 `0` 视为同一值，没有依赖符号的业务分支；而 C2 的整数线格式只有数学零。为使公共参考值与 content hash 在 codec 之前一致，所有标为整数的参考字段在完成原安全整数/范围校验后，把零投影为 `+0`。范围包含请求/回执/输入序号、tick/revision、库存下标与计数、动作整格坐标及枚举 verticalIntent；不改变允许的整数范围，也不修改 Host 执行规则。

**浮点字段保持 `-0`**，包括 move、issuedAtMs、位置/速度等已定义 f64 的字段。不按数值是否恰为整数猜测字段类型。三候选只编码共同的 canonical 整数值，shared schema 对非 canonical 整数负零拒绝；该规则不是某个 codec 私自少保留信息。

新增 `tests/server/network-reference-integer-zero.test.ts`，先要求原投影把 integral `-0` 变为 `+0` 得到 RED，再只修正参考投影及共享 action copy；同一用例要求 f64 `-0` 仍保留。重跑全部 reference 单元、真实语料和三候选 pipeline，范围仍为本次 N0/N2 的数值合同收口。

## 应用 oracle 的当前源码绑定门

应用 oracle 除校验 corpus、manifest 与逐帧内容自洽外，还必须以固定路径清单重新计算当前工作树源码的 SHA-256，并与 manifest 的 `source.explicitInputSha256` 精确比较。清单与采集器一致，包含 action copy、request、receipt、共同整数 helper、gameplay/correction 投影和采集用例；缺项、多项或任一过期 hash 都必须在创建 Host、调用 `performAction` 前拒绝。这样最终复采是可执行门禁，不依赖人工确认“应该是最新语料”。

同一门禁精确校验 action provenance 的字段集合、`attempt`、`retryOfRequestFrameId`、`observedResult` 和四帧组内一致性。第二次 `select-hotbar` 必须明确引用第一次 request，使用相同 action 与 sequence；其余调用为第一次尝试且没有 retry 引用。`observedResult` 必须与真实 receipt 的 outcome 一致，authority context 必须与 receipt transaction 交叉绑定。该来源说明仍是测试证据，不替代正式网络身份认证。

实际证据为：源码绑定空实现先使过期、缺项、多项三个负例 RED；实现后门禁真实拦住一次格式化导致的旧采集 hash。固定源码后在 Node 22.23.2 采集 `/tmp/seedlands-network-action-corpus-v1-source-bound`，再以 source-bound decoded fixture 运行应用 oracle 3/3 GREEN。旧语料目录未覆盖；生产源码的完整静态与构建已通过；应用门补充后定向 3/3、格式/ESLint、完整类型检查及 source-bound Chrome 互操作再通过，具体范围见进度记录。
