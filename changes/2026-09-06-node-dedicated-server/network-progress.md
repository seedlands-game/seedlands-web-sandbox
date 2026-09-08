# P0N 网络前置选型进度

本文件记录 2026-09-07 的 N0/N1 前置结果。它只基于当前源码、官方资料和 `/tmp/seedlands-network-probe-Gl8xBv` 中可丢弃的本机探针；没有修改产品源码、依赖、配置或网络监听，也没有读取 `.env` 或访问远端环境。

## N0：现有边界与可实施公共 DTO

### 现有消费链

| 当前对象                              | 当前生产者                                       | 浏览器实际消费者                                                                                         | 不能原样作为网络包的原因                                                                                                                            |
| ------------------------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AuthorityReady`                      | `authority-worker`                               | `BrowserAuthorityClient`、`Game` 启动和 `WorldRuntime`                                                   | 同时含 session 元数据、完整 `AuthoritySnapshot`、完整 `AuthorityGameplayView`。初始同步可以借用其语义，但 wire 应拆开欢迎信息、世界基线与玩法基线。 |
| `AuthoritySnapshot`                   | `AuthoritySession`，worker 以不高于约 60 Hz 发布 | `AuthorityPresentationSync` → `PlayerController` 的预测校正；`AuthorityCollisionBaselineClient`；Harness | 混有 player/实体 Body、contacts、Chunk revision、世界时钟、tick debt、可选 diagnostics。诊断、服务端成本和 Fluid/驻留细节不是远端客户端必需数据。   |
| `AuthorityGameplayView`               | `GameServer` 玩法快照                            | `BrowserGameplay` 的 HUD、背包、制作、破坏覆盖层、实体表现和 actor 行为标签                              | 完整 `PlayerSnapshot`、`GameplayEntity[]`、`ActorState[]` 和 metrics 被一起传递；UI 与表现只需要各自的最小字段。                                    |
| `WorldCommitResult` / collision delta | `GameServer.editBatch()`                         | `WorldRuntime.consumeServerCommit()`、`AuthorityCollisionRevisionGuard`                                  | 必须保持世界提交顺序、Chunk revision 链和基线可恢复；不可随 pose 丢弃。                                                                             |
| `InputCommand`                        | `LocalPlayerPrediction`                          | `InputCommandBuffer`、预测回放和 `input-decision`                                                        | 当前把持续状态和 `jumpPressed` 边沿绑在一条消息里；若直接改为最新优先 datagram，会错误丢掉一次性跳跃。                                              |

以下是 wire v1 实现应建立的公共投影。类型名是拟议的 `src/runtime/network-protocol.ts` 公共 DTO，不是当前已存在的产品接口。所有编号均为非负安全整数；解析前验证协议版本、会话、长度、枚举和资源上限。

```ts
type SessionRef = Readonly<{
  protocolVersion: 1;
  sessionEpoch: string; // 每次连接/世界切换均变化
  worldId: string;
  playerId: string;
}>;

type ReliableEnvelope<T> = Readonly<{
  ref: SessionRef;
  stream: 'control' | 'events' | 'world';
  sequence: number; // 仅在本 stream 内单调
  message: T;
}>;

type InputStateDatagram = Readonly<{
  ref: SessionRef;
  inputSequence: number;
  targetPhysicsTick: number;
  expiresAfterPhysicsTick: number;
  moveX: number;
  moveZ: number;
  verticalIntent: -1 | 0 | 1;
  jumpHeld: boolean;
}>;

type InputEdge = Readonly<{
  ref: SessionRef;
  edgeId: number;
  targetPhysicsTick: number;
  expiresAfterPhysicsTick: number;
  kind: 'jump-pressed';
}>;

type PlayerCorrection = Readonly<{
  ref: SessionRef;
  poseSequence: number;
  physicsTick: number;
  acknowledgedInputSequence: number;
  acknowledgedEdgeId: number;
  inputResyncRequired: boolean;
  body: BodyDto;
  grounded: boolean;
  collisionRevisionVector: readonly ChunkRevision[];
}>;

type EntityPose = Readonly<{
  ref: SessionRef;
  poseSequence: number;
  physicsTick: number;
  entities: readonly EntityPoseDto[];
}>;

type ChunkBaseline = Readonly<{
  ref: SessionRef;
  key: string;
  revision: number;
  generatorVersion: number;
  canonical: Uint8Array;
  fluid: Uint8Array;
}>;
type ChunkDelta = Readonly<{
  ref: SessionRef;
  worldCommitSequence: number;
  key: string;
  previousRevision: number;
  revision: number;
  cells: readonly CellDeltaDto[];
}>;
```

`BodyDto` 是位置、速度与形状已由协议版本固定的数值投影；`EntityPoseDto` 只包含 id、type、archetype、position 与表现所需速度/朝向。它不包含 contacts、physics debt、恢复诊断或服务端 lane 统计。玩家 HUD/背包、制作列表、破坏状态、一次性战斗/拾取/死亡事件另走 `events` 可靠流，按独立 `gameplayRevision` 去重；近处 actor 只投影 `entityId + behavior`，不发送完整 `ActorState`。`metrics` 完全不进入玩家网络 DTO，仅可在受权限保护的调试观测中单独采样。

### 可靠性、期限与背压

| 类别                                               | 首轮 transport 语义                             | 背压/超时                                                     | 说明                                                                                   |
| -------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| welcome、能力协商、身份、世界/生成器版本、断连原因 | 可靠有序 `control`                              | 不能静默丢弃；连接预算满时拒绝新会话                          | 完成状态转换后才允许其它流接收业务包。                                                 |
| `InputStateDatagram`                               | 可丢、最新优先；T0 参考组以可靠消息承载同一 DTO | 每玩家只保留最新一个；超过 `expiresAfterPhysicsTick` 直接丢弃 | 仅连续状态可这样处理。保留递增 input sequence 与目标 tick，服务端仍做窗口/租期校验。   |
| `InputEdge`                                        | 可靠有序 `control`                              | 有限去重表，过期拒绝并回执                                    | 一次性跳跃不能由最新状态覆盖；不得因重连重做。                                         |
| `PlayerCorrection`                                 | T0 用可靠 `control`；T2 才比较可丢 pose 载体    | 接收端只保留同 session 最大 `poseSequence`；必要时触发 resync | 保留 ack、物理 tick、collision revision vector，供当前 `PredictionBuffer` 重放与判定。 |
| 其它 `EntityPose`                                  | 可丢、最新优先                                  | 每实体/快照取最大 `poseSequence`，短时插值后 held             | 只服务表现；不作为放置、命中或本地碰撞的权威依据。                                     |
| gameplay UI/实体生成消失/actor 标签/动作结果       | 可靠有序 `events`                               | 有界事件队列；溢出关闭 session 并完整 resync                  | `gameplayRevision` 单调，动作结果按 request id/transaction key 幂等。                  |
| Chunk baseline、Chunk delta、world commit          | 可靠 `world`；baseline 与大块独立有界流         | 可取消未订阅 Chunk；delta 缺前序或基线时请求 baseline         | 大 Chunk 不进入 pose/datagram；不把 `1 MiB` Worker frame 限制当作 datagram 限制。      |
| 诊断和性能统计                                     | 低优先级、可降频/省略                           | 不参与权威恢复                                                | 正式网络组仍在本地 trace 记录相同指标。                                                |

### 必须显式持有的因果关系

1. `SessionRef` 的 `sessionEpoch + worldId + playerId + protocolVersion` 必须匹配。重连生成新 epoch；旧连接关闭写通道，不能借 fallback 或旧 datagram 重放动作。
2. `InputStateDatagram.inputSequence` 与 `InputEdge.edgeId` 是两条独立单调链。`PlayerCorrection` 只确认已消费的最大 input/edge；迟到、重复、窗口外和超期必须有可观察的决定，不能把“最新”误当作“已经执行”。
3. 玩家校正的 `collisionRevisionVector` 是屏障：客户端只有在每个涉及 Chunk 的本地碰撞基线 revision 不低于该值时才重放预测。否则先请求/等待基线或执行明确 resync，绝不拿新权威 body 对旧碰撞体回放。当前源码已经以 `AuthorityCollisionRevisionGuard` 和 `PredictionBuffer` 暴露这一需求。
4. `ChunkDelta.previousRevision → revision` 必须连续；`worldCommitSequence` 只在自己的可靠流内排序。多条 QUIC stream 的可靠性不提供全局排序。缺前序、hash/长度错误、超出重排窗口时失效缓存并请求 `ChunkBaseline`。
5. gameplay 的 `gameplayRevision`、动作 `requestId/transaction` 与关联的 world commit 不能被 pose 覆盖。UI 可等待可靠事件；玩家可见世界变化只在关联 Chunk 基线/增量已应用后呈现。
6. 接收端序号仅用于拒绝旧包；它不是权限。所有操作仍由服务端从认证 session 绑定 playerId，检查距离、库存、世界版本和 transaction 去重。

### 首批 RED 输入

这些是 `tests/server/network-message-semantics.test.ts`、`tests/client/transport-fallback.test.ts` 和 change-scoped Playwright 的首轮输入清单；尚未创建测试文件，故状态均为待写 RED。

1. 合法 welcome 后，错误 protocol、错误 epoch、错误 world/player 的每一类消息都被拒绝，且不会改变会话状态。
2. input state `10` 后到达 `9`，只保留 `10`；同一 input sequence 的不同 body 不能覆盖。`targetPhysicsTick` 已过或远超窗口时要求 resync。
3. input state 被丢弃/重排时，可靠 `jump-pressed(edgeId=7)` 仍只执行一次；重发 `7`、迟到 `7`、过期 `7` 均不能再次跳跃。
4. 收到确认 input `12`、但本地仅有 Chunk revision `4` 且校正要求 `5`：不回放，不穿透，发 baseline 请求；baseline `5` 到达后才重放。
5. `ChunkDelta(4→6)`、长度错误 baseline、错误 key、错误 generator version、同 revision 重复和 `6→7` 乱序，分别走拒绝或完整 baseline 恢复，绝不部分写入。
6. world commit `103` 先于 `102`：保留有界等待；超过 `AUTHORITY_COMMIT_REORDER_WINDOW` 后清空相关镜像并单次 resync。
7. gameplay revision `8` 到达后 revision `7` 不回滚 HUD/背包；一个 transaction 在重连前后重复只回同一结果，不重复放置/扣库存。
8. 大 Chunk 可靠流占满时，pose 队列只保留最新、控制/动作仍能在各自额度内前进；可靠队列超限必须显式失败/断开，不能无限增长。
9. datagram 为空、超过协商上限、字段非有限、数组长度超限或未知 discriminator：解析失败前不分配大对象，计数并按连接策略关闭/拒绝。
10. transport 失败后降级 WSS：新 session epoch 全量同步；旧 transport 的迟到 action、commit、pose 不被接纳，认证/版本错误也不得被“降级”绕过。

## N1：能力探针与当前采用结论

### Node 22 与 T2 候选

Node 22 的官方 API 索引列出 HTTP、HTTP/2、HTTPS、TLS 与 UDP/datagram，却没有 HTTP/3 或 WebTransport server 模块；HTTP/2 也明确是基于一个 `net.Socket`/`tls.TLSSocket` 的 HTTP/2 实现。因此 Node 22 基线不可被当作内置 HTTP/3/WebTransport 服务端。Node 22 的少量 `ERR_QUIC_*` 实验错误名不能替代公开、可部署 server API。

本轮只选择一个外部候选做有界探针，未做全量矩阵：

| 候选                                                                                       | 版本/许可/安装体积                                             | 依赖与平台代价                                                                                                                                                                                                           | 本机证据                                                                                                                                                                                            | 结论                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------ | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@fails-components/webtransport` + `@fails-components/webtransport-transport-http3-quiche` | 均为 1.6.8、BSD-3-Clause；npm 解包声明为 441,147 B + 340,806 B | `bindings`、`debug`、`@types/debug`；quiche 另有 `cmake-js`、`node-addon-api`、`prebuild-install`。macOS ARM 实际安装总计 15,976 KiB，其中 `webtransport.node` 6.6 MiB。包声明 Node `>=20`，但其 HTTP/3 层是原生 addon。 | 初始 Node 26 import 的 `quicheLoaded` 成功并导出 `Http3Server`；原生文件 SHA-256 为 `7e8a242fdf6c057a29705c296589549410fc3f8e3fd6d75516f6bdf0b95d2824`。后续 Node 22 真正 listener/回环结果见下段。 | **仅保留 T2 能力候选，未入选。** 自身 README 把 HTTP/3 层称为 duct-tape，列出未实现 WebTransport API，并说明无预编译时构建可能超过 20 分钟；Node 22 与目标 Linux x64 必须单独验证。 |
| `ws`                                                                                       | 8.21.3、MIT、npm 解包 150,929 B                                | 无 runtime dependency；当前 lockfile 已解析该版本。需要 Node HTTPS 证书和 HTTP/1.1 Upgrade，不需要 QUIC 原生 addon。                                                                                                     | 尚未建立 server/client，因为本轮禁止绑定端口；其功能应是 T0 的明确参考实现。                                                                                                                        | **T0 首选参考组。** 它不提供 datagram 或跨 TCP 流隔离，因此不是 T2 的替代证明。                                                                                                     |

2026-09-07 追加的本机 Node 22 探针使用官方 archive 的 `/tmp/seedlands-node-22/node-v22.23.2-darwin-arm64/bin/node`（本机 SHA-256：`18e387c90ab8a8400183e8bdd396376e1e875b91b4c874b894dcade7b35bf572`）。它能加载同一 6.6 MiB N-API addon、在仅 `127.0.0.1:0` 绑定的临时 UDP listener 上完成**Node 22 客户端 → Node 22 服务端**的 `ready`、可靠双向流回显 `[1,2,3,4]` 和 datagram 回显 `[9,8,7]`。这证明该 macOS ARM 组合可运行，并不证明 Linux x64、浏览器或 WAN；library 同时对 `datagrams.writable` 输出 deprecated 警告，适配层不得把该旧接口直接写进产品 DTO。

### 浏览器、TLS 与 UDP

本机 Google Chrome 152.0.7977.76 的 headless 渲染进程在安全的 `file:` 临时页报告 `typeof WebTransport === 'function'`；普通 `about:blank` context 则没有该全局，验证了 secure-context 前提。MDN 说明 WebTransport 只在 secure context 中可用，并连接到 HTTP/3 server。

随后以 Playwright 独立 browser context 对 Node 22.23.2 `Http3Server` 做了真正 loopback 探针：服务端临时绑定 `127.0.0.1:0`，使用一天有效期的 ECDSA `localhost` SAN 证书；浏览器创建 `WebTransport(https://localhost:<ephemeral>/echo, { serverCertificateHashes: [{ algorithm: 'sha-256', value: <DER SHA-256> }] })`。没有使用 `--ignore-certificate-errors`、`ignoreHTTPSErrors` 或系统信任修改。Chrome DevTools Protocol 收到 `Network.webTransportCreated`，但十秒内没有 `webTransportConnectionEstablished`，`transport.ready` 以 `WebTransportError: Opening handshake failed.` 拒绝，服务端 session reader 同时超时；因此浏览器没有完成可靠双向流或 datagram echo。

这是一条**失败的真实浏览器能力证据**，不是 API 存在性判断。当前数据不能精确区分 Chrome 对 certificate hash/本机自签名链的处理与该 library 的旧 WebTransport/HTTP3 互操作问题：该 package 自己声明只实现旧 draft 的部分内容，且 Node-to-Node 同包回环已通过。不能把任一原因写成已证实，也不能将 Node 回环通过改写为 Chrome 通过。

T2 的最小真实探针仍缺少以下条件：

1. 一个可被 Chrome 正常信任的测试证书及与 URL 主机名匹配的 HTTPS origin；不要靠浏览器忽略证书错误作为产品证据。当前自签名 ECDSA + `serverCertificateHashes` 未产生成功连接，故它不能充当该缺口的替代物。
2. 一个与当前 quiche package 独立的、实现最新浏览器 WebTransport/HTTP3 的 sidecar 候选。`webtransport-go v0.9.0`（MIT）是下一候选；本轮仅尝试下载其受限依赖，因本机到 `golang.org/x/net`、`x/sys`、`x/crypto` 的 IPv6 HTTPS 请求超时而未能构建。这是本机依赖获取阻塞，不是该 sidecar 的互操作结论。
3. 在隔离本机 fixture 中短时绑定一个 loopback UDP H3 listener；若同一个 fixture 还提供 WSS fallback，则 TCP 与 UDP 都是独立监听和独立关闭对象。
4. 浏览器实际等待 `transport.ready`，打开一条双向可靠流，写/读一个有版本的控制 DTO，再向 datagram writer 写一个小于协商上限的 pose DTO 并验证服务端回显。结果需记录协商 datagram 上限、ALPN/H3、证书/UDP失败原因及完全关闭。
5. 在 Node 22.23.x 和目标 Linux x64 离线/CI 产物重复 addon 加载和该 loopback 测试；之后才允许安排 LAN/IPv6/公网 UDP 验证。任何 UDP 不可达或 API/握手失败都计入 T2 失败并转 T0，不得把 WSS fallback 数据标成 QUIC。

本轮已执行受控、自动关闭的 loopback UDP fixture；所有 server/client/browser 进程结束后释放端口。仍缺可信 TLS fixture 和当前可构建的独立 sidecar。标准 WSS fallback 应采用 Node HTTPS + `ws`，并由**新的 session epoch**全量恢复；不得使用该 WebTransport package 的 proprietary WebSocket polyfill 作为产品 fallback。普通浏览器 WSS 同样要求可信证书，因此当前自签名证书不构成 fallback 成功证据。

### 当前决策

N0 语义投影可作为主线协议实现的输入；先以同一 DTO 在 T0/WSS + C0 参考组接线，禁止冻结 wire v1。N1 已排除“Node 22 内置 WebTransport server”的假设，并新增 Node 22/macOS ARM 的 addon、H3、可靠流与 datagram 自回环成功证据；但 Chrome 152 对该候选的真实 `ready` 已失败。T2 仍缺可信 TLS、独立新协议 sidecar 的 Chrome H3/UDP/stream/datagram 联通、Linux x64、LAN/IPv6/WAN 证据。N2/N3/N4 与最终默认传输保持未完成。

## 来源与可复核命令

- [Node.js v22 API 索引](https://nodejs.org/download/release/latest-v22.x/docs/api/)；[Node.js v22 HTTP/2 文档](https://nodejs.org/download/release/v22.23.1/docs/api/http2.html)。
- [MDN WebTransport](https://developer.mozilla.org/en-US/docs/Web/API/WebTransport)；[WebTransport W3C 规范](https://w3c.github.io/webtransport/)；[QUIC RFC 9000](https://www.rfc-editor.org/rfc/rfc9000.html)。
- [fails-components/webtransport 仓库](https://github.com/fails-components/webtransport)；[npm package](https://www.npmjs.com/package/@fails-components/webtransport)；[ws package](https://www.npmjs.com/package/ws)。
- 探针命令只在 `/tmp/seedlands-network-probe-Gl8xBv` 中安装候选、生成一天有效的测试证书、运行 Node 22 回环和独立 Chrome context；所有 listener 均为 `127.0.0.1:0` 并在 `finally` 中关闭。没有创建产品文件、远端写入或公网监听。该临时目录是可丢弃产物，不纳入仓库或交付证据。
