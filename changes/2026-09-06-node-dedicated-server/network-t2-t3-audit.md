# T2 WebTransport 失败分层复核与 T3 WebRTC DataChannel 架构审计

本文完成 [network-selection.md](network-selection.md) 要求的 T3 架构审计，并复核 [network-progress.md](network-progress.md) 已记录的 T2 探针。结论只来自官方标准、Node.js 官方文档、候选实现的官方仓库以及已完成的本机探针记录。本轮没有安装依赖、启动浏览器或 listener、运行 benchmark、修改产品代码或访问远端。

当前结论是：**T2 的失败已经定位到 WebTransport 会话建立之前或建立期间，但不能再归因到单一的证书、UDP、QUIC/HTTP3 或草案互操作层；T3 在协议上可以承载本项目的三类消息，但尚未证明普通网页到公开 Node 22 服务端在目标网络与离线产物中的可用性。** 两者都保留为有条件候选，本文件不选择最终 transport。

## 一、T2 失败发生在哪一层

### 已确认事实

1. Node.js 22.23.2 的官方 API 索引包含 HTTP、HTTP/2、HTTPS、TLS、UDP/datagram 与 WebSocket，没有公开的 HTTP/3、WebTransport server 或 `RTCPeerConnection` 模块。因此 T2 和 T3 的 Node 服务端都需要外部实现；Node 错误表里存在实验性的 `ERR_QUIC_*` 名称不等于存在可部署的公开 server API。[Node.js 22 API 索引](https://nodejs.org/download/release/latest-v22.x/docs/api/)、[Node.js 22 全局对象](https://nodejs.org/download/release/latest-v22.x/docs/api/globals.html)
2. 已有 T2 探针中的 Chrome 152 在安全上下文中暴露 `WebTransport`，构造请求后 CDP 收到 `Network.webTransportCreated`。所以这次失败不能写成“浏览器没有 WebTransport API”。
3. 同一套 `@fails-components/webtransport` 1.6.8 与 quiche addon 已在 Node 22/macOS ARM 上完成 Node 到 Node 的 UDP loopback、`ready`、可靠双向流与 datagram 回显。这证明该本地二进制和自身协议栈基本能工作，不证明它与 Chrome 当前协议实现互通。
4. 浏览器到 `Http3Server` 时没有出现 `webTransportConnectionEstablished`，`transport.ready` 最终以 `WebTransportError: Opening handshake failed.` 拒绝，服务端没有交付 session。可靠流和 datagram 的应用回显都还没有开始。

### 分层判断

| 层次                        | 当前证据                                                                               | 判断与仍未知项                                                                                                                                                                                                                                                                                                                        |
| --------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 浏览器 API / secure context | `typeof WebTransport === 'function'`，CDP 创建事件存在                                 | **已通过 API 准入。** API 存在只证明可发起连接，不证明网络或协议互通。                                                                                                                                                                                                                                                                |
| URL 与构造参数              | 使用 `https://localhost:<port>/echo` 和 `serverCertificateHashes`，构造未同步抛错      | **构造层已通过。** 证书信任在连接期间验证，构造成功不能证明证书被接受。                                                                                                                                                                                                                                                               |
| 证书                        | 一天有效期、ECDSA、`localhost` SAN、叶证书 DER SHA-256；未忽略证书错误                 | 当前记录没有保存曲线、完整 X.509 扩展与 Chrome 的证书失败原因。现行规范要求 X.509v3、有效期不超过两周、至少支持 ECDSA P-256、不得使用 RSA，并允许浏览器追加实现要求。因此“证书符合全部要求”与“证书导致失败”都**未证实**。[WebTransport 证书要求](https://www.w3.org/TR/webtransport/#dom-webtransportoptions-servercertificatehashes) |
| DNS / UDP 到达              | server 绑定 `127.0.0.1`，URL 使用 `localhost`；server 未得到 session                   | 没有 packet capture、qlog 或 Chrome netlog，不能判断浏览器是否先选了 `::1`、UDP 是否到达、还是收到后在更高层拒绝。**UDP 可达性未被该失败单独证伪。**                                                                                                                                                                                  |
| QUIC TLS / ALPN / HTTP/3    | 没有 connection-established，server 无 session                                         | 无分层日志，无法区分 QUIC version、TLS、ALPN、HTTP/3 SETTINGS、Extended CONNECT 或 WebTransport capability negotiation。                                                                                                                                                                                                              |
| WebTransport 草案互操作     | 候选官方 README 仍说明 API 并非全部实现，并把 HTTP/3 包称为 “duct tape-style solution” | 草案/协议不匹配是合理嫌疑，但当前探针没有握手 trace，**不能定案**。现代 `webtransport-go` 的版本变化也显示 draft token、SETTINGS、流控和 session 校验仍在演进。[fails-components 官方 README](https://github.com/fails-components/webtransport)、[webtransport-go releases](https://github.com/quic-go/webtransport-go/releases)      |
| 应用协议                    | server 从未交付 session                                                                | **尚未进入。** 现有失败不能归因于游戏 DTO、stream framing 或 echo 逻辑。                                                                                                                                                                                                                                                              |

准确表述应是：**Chrome 已调用 WebTransport，但连接在 server session 交付之前失败；证书、地址族/UDP、QUIC TLS/ALPN、HTTP/3 SETTINGS/Extended CONNECT 与草案互操作仍处于同一个未拆开的失败区间。**

### T2 下一证据门

1. 退役 `webtransport-go v0.9.0` 作为下一候选：官方安全公告说明 `<=0.9.0` 可被远端反复开关 stream 造成无界内存增长，修复版本是 `v0.10.0`。当前官方 release 已到 `v0.13.0`，要求 Go 1.26 或更新，并基于更新的 quic-go；应重新冻结受支持版本、源码和模块 hash，而不是重试旧版。[GHSA-2f2x-8mwp-p2gc](https://github.com/quic-go/webtransport-go/security/advisories/GHSA-2f2x-8mwp-p2gc)、[v0.13.0 release](https://github.com/quic-go/webtransport-go/releases/tag/v0.13.0)
2. 使用浏览器正常信任的证书，或完整记录并验证符合现行 hash 证书要求的 P-256 短期证书；不能用 `ignore-certificate-errors` 作为产品证据。
3. 同时采集浏览器 netlog/qlog、server QUIC/H3 日志和 loopback UDP 到达证据，把失败依次定位到 UDP、QUIC TLS/ALPN、HTTP/3 SETTINGS、Extended CONNECT、WebTransport session。
4. session 建立后才继续验证一条可靠双向流和一个小 datagram；分别记录协商能力、大小上限、关闭与取消。没有 session 时不得把 API 存在或 Node 自回环写成 Chrome 可用。
5. 在 Node 22 目标 Linux x64 的完全离线产物中重复启动、握手和退出；再进入 LAN、IPv6 与公网 UDP。当前没有这些证据。

## 二、T3 的真实协议与服务组成

普通网页的入口是 `RTCPeerConnection` 和 `RTCDataChannel`，Node 22 自身不提供对端实现。完整路径至少包含：

```text
浏览器页面
  ├─ HTTPS/WSS 信令：认证、offer/answer、ICE candidates、重启与会话 epoch
  └─ RTCDataChannel 消息
       SCTP（多 stream、可靠或部分可靠）
       DTLS（加密、完整性、对端证书指纹）
       ICE（候选收集、连通性检查、选路与 restart）
       UDP；必要时浏览器以 UDP/TCP/TLS 连接 TURN，再由 relay 转发

公开 Node 22 服务
  ├─ 现有或新增的 HTTPS/WSS 信令入口
  ├─ 外部 WebRTC endpoint 实现（每 session 的 PeerConnection/ICE/DTLS/SCTP）
  └─ 只向权威运行时转交已认证、已限流、已校验的业务 DTO
```

WebRTC 标准不规定信令传输；JSEP 明确由应用通过 WebSocket 等机制交换 offer/answer，Trickle ICE 再增量交换候选。因此 T3 不能替代 WSS/HTTPS 信令，也不能只监听 UDP 就成为普通网页可用的完整服务。[W3C WebRTC](https://www.w3.org/TR/webrtc/#intro)、[JSEP RFC 8829](https://www.rfc-editor.org/rfc/rfc8829.html)

### ICE、STUN、TURN 与公开服务器

- ICE 从主机、STUN server-reflexive 和 TURN relayed 候选中组成候选对，执行连通性检查并选出路径；同时支持 IPv4/IPv6 与 ICE restart。[ICE RFC 8445](https://www.rfc-editor.org/rfc/rfc8445.html)
- 公开 Node 服务器有公网 UDP candidate 时，部分浏览器网络可直接连通；这不证明企业网、运营商 NAT、IPv6-only/双栈切换或阻断 UDP 的网络能直连。
- STUN 只帮助发现映射，不替用户数据中继。直接候选都失败时需要 TURN relay；TURN 的带宽、连接数、凭据、配额、地区和故障恢复成为产品运维成本。[TURN RFC 8656](https://www.rfc-editor.org/rfc/rfc8656.html)
- `turn:`/`turns:` 以及 UDP/TCP/TLS 是候选能力，不代表目标浏览器与候选 Node 实现在目标网络上一定能建立 DataChannel。必须从实际 selected candidate pair 记录 candidate type、地址族和传输，才能确认直连或 relay。
- ICE restart 允许重新选路，但不是业务会话连续性的证明。恢复期间仍要用连接 `sessionEpoch`、权威动作幂等键和完整 resync 防止旧通道迟到包改变新会话；这两个 epoch 不得混用。

### DTLS、身份与权限

RFC 8831 的 DataChannel 栈是 SCTP over DTLS over ICE/UDP。DTLS 提供机密性、来源认证和完整性；SDP 中的 fingerprint 把握手证书绑定到协商。应用仍必须把经过认证的信令会话绑定到 `sessionEpoch + worldId + playerId`，并由服务端执行权限、距离、版本和幂等检查。成功的 ICE 或 DTLS 只证明网络对端持有对应密钥，不自动赋予玩家权限。[DataChannel RFC 8831](https://www.rfc-editor.org/rfc/rfc8831.html)、[WebRTC Security Architecture RFC 8827](https://www.rfc-editor.org/rfc/rfc8827.html)

## 三、多 DataChannel 的语义边界

### 建议只作为待验证映射

| 业务 lane          | DataChannel 候选配置                       | 必须保留的应用层规则                                                                                                                 |
| ------------------ | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| `control/events`   | `ordered: true`，完整可靠                  | 协议/身份先准入；动作 request id 与 transaction 幂等；可靠队列超限时显式失败，不无限积压。                                           |
| `world/bulk`       | 独立 `ordered: true` 可靠 channel          | Chunk 基线/增量保持 key、revision、hash、长度与取消 generation；大消息按协商上限有界分块。                                           |
| `pose/input-state` | 可研究 `ordered: false, maxRetransmits: 0` | 只允许可替换状态进入；仍用 input/pose sequence、target tick、expiry 和 collision revision gate。跳跃边沿与动作不能放入可丢 channel。 |

W3C API 中 `ordered` 默认为 `true`；`maxPacketLifeTime` 与 `maxRetransmits` 是互斥的部分可靠选项。`maxRetransmits: 0` 加 unordered 可形成 RFC 所称的 “UDP-like” 服务，但它仍是 SCTP user message：发送一次不等于必达，也不是 QUIC datagram，更不提供业务过期和因果一致性。[W3C RTCDataChannel](https://www.w3.org/TR/webrtc/#dom-rtcdatachannelinit)、[RFC 8831 第 6 节](https://www.rfc-editor.org/rfc/rfc8831.html#section-6)

多条 DataChannel 共享一个 `RTCPeerConnection` 下的 SCTP association、DTLS 与 ICE 路径。每个 SCTP stream 有自己的有序语义，但不存在跨 channel 的全局顺序；control 的 commit/revision 屏障仍要显式约束 pose 和 world。ICE/DTLS/SCTP association 故障会共同影响所有 channel，不能把它等同于 T1 的两条独立 TCP 连接或 T2 的 QUIC stream/datagram 组合。

大消息还有一项必须实测的前提：RFC 8260 message interleaving 只被 RFC 8831 要求为 SHOULD。没有 interleaving 时，大 user message 会独占 SCTP association，RFC 8831 建议发送端把最大消息限制到 16 KiB。即使有多个 channel，也不能在未验证双方协商能力前宣称 bulk 不会阻塞 control。[SCTP message interleaving RFC 8260](https://www.rfc-editor.org/rfc/rfc8260.html)、[RFC 8831 第 6.6 节](https://www.rfc-editor.org/rfc/rfc8831.html#section-6.6)

`RTCSctpTransport.maxMessageSize` 由本地发送能力与 SDP `max-message-size` 协商；远端没声明时 WebRTC API 使用 65,536 字节默认值。它与当前 Worker 的 1 MiB frame 上限无关。任何 Chunk 方案必须先读协商值，再用应用层有界 framing、hash 与取消；不能依赖 SCTP “arbitrarily large message” 的理论重组能力。[W3C maxMessageSize](https://www.w3.org/TR/webrtc/#dom-rtcsctptransport-maxmessagesize)、[RFC 8841](https://www.rfc-editor.org/rfc/rfc8841.html)

发送背压只有 API 原语，没有自动策略：`bufferedAmount`、`bufferedAmountLowThreshold` 与 `bufferedamountlow` 可以驱动暂停/恢复，但需要本项目为每 channel 和整个 connection 同时设消息数、排队字节、在途字节与最大消息上限。关闭/取消 bulk 时还要递增业务 generation，迟到的可靠消息不得恢复已 evict 的 Chunk；只调用 `RTCDataChannel.close()` 不能替代这条语义。

## 四、Node 22 服务端候选主源审计

本轮只核对主源，没有安装或运行候选。

| 候选               | 当前主源事实                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | 离线产物与隔离成本                                                                                                                                                                                                                                                                                                 | 当前判定                                                                                                                               |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| `werift`           | 官方 release 与 `develop` manifest 为 `0.24.4`，MIT，Node `>=16`，同时导出 CJS/ESM；README 声明 TypeScript 实现 ICE/ICE-Lite、restart、ICE-TCP、TURN UDP/TCP/TLS、DTLS、SCTP 与 DataChannel，并列出 Chromium E2E。顶层 manifest 直接依赖未出现 native optional package。[manifest](https://raw.githubusercontent.com/shinyoshiaki/werift-webrtc/develop/packages/webrtc/package.json)、[README](https://raw.githubusercontent.com/shinyoshiaki/werift-webrtc/develop/README.md)、[release](https://github.com/shinyoshiaki/werift-webrtc/releases/tag/v0.24.4)              | 更接近可审计的 JS/TS 离线依赖树，但仍需锁定所有传递包、license、bundle/import 方式和体积。协议栈与游戏服务共享 V8 时可能带来 CPU/GC 与畸形包风险；应验证 Worker 或独立进程隔离、资源上限和退出。                                                                                                                   | **保留进入功能原型的候选。** 上游能力声明和 Chromium E2E 不能替代本项目的 DataChannel-only、Node 22/Linux x64、TURN 与长期资源验证。   |
| `node-datachannel` | `master` manifest 为 `0.33.2`，Node `>=18.20`、N-API 8、CJS/ESM、MPL-2.0，封装 `libdatachannel`。README 声明 Linux x64 二进制约 8 MB，optional packages 同时覆盖 glibc 与 musl；GitHub 当前 latest release 页仍为 `v0.33.1`，所以实施前要从 registry/lockfile 冻结实际发布版本，不能把源码 head 当已发布包。[manifest](https://raw.githubusercontent.com/murat-dogan/node-datachannel/master/package.json)、[README](https://raw.githubusercontent.com/murat-dogan/node-datachannel/master/README.md)、[releases](https://github.com/murat-dogan/node-datachannel/releases) | 离线产物必须携带与目标 libc/arch 完全匹配的 optional package 和 `.node` 文件，验证 Node 22 加载、动态库、hash、SBOM 与 MPL-2.0 分发要求。原生崩溃可能终止整个 Node 进程，若采用应优先放在独立 child process；Worker thread 不是 native crash 的充分隔离边界。无预编译时的 CMake/C++ 构建不能成为生产首次启动路径。 | **保留进入功能原型的候选。** 预编译支持声明不等于目标 Linux x64 离线 artifact 已验证，也没有本项目浏览器互操作、TURN、关闭和资源证据。 |

两个候选都不能因为能创建 `PeerConnection` 或官方有 echo 示例就宣布可用。还要确认它们在固定版本下真正支持：DataChannel-only SDP、DCEP 或固定 channel id、双方协商的 `max-message-size`、RFC 8260 interleaving、部分可靠配置、selected candidate stats、ICE restart、TURN UDP/TCP/TLS、完整关闭和失败清理。

## 五、离线发布与 Linux x64 门禁

1. 冻结精确 package 版本、源码 commit、lockfile、license 和每个分发文件 hash；禁止运行时下载依赖或临时编译。
2. 在目标 Linux x64 主机确认 glibc/musl、Node 22 小版本与 CPU 架构。`node-datachannel` 必须用对应 platform package 做离线 import、建连、关闭和进程崩溃恢复；`werift` 必须验证 bundle 后没有遗漏动态资源或只在开发环境存在的依赖。
3. artifact 需明确包含或外置：信令服务、WebRTC endpoint、TURN 地址与凭据获取、证书/DTLS 策略、日志与健康检查。`werift-ice-server` 的 reference server 存在不等于它已通过生产 TURN 准出。
4. 外部协议实现不得成为第二 Authority。它只解析有限信令和 DataChannel envelope，按字节/连接/候选/channel/消息限额转交现有权威 API；异常输入、慢消费者和连接关闭都要有界。
5. 终止顺序必须可观察：停止新 session → 拒绝新业务动作 → 排空或明确失败已接纳的可靠消息 → 关闭 DataChannel/PeerConnection → 关闭 UDP/TURN/信令资源 → 等物理进程退出。超时不能把仍在运行的 native/协议写者报告为已关闭。

## 六、UDP 不可达与 fallback 语义

T3 的 ICE 会先在已配置候选中选路；“直接 UDP 不通”不等于立即跳 WSS，也不等于 TURN 一定成功。可用性实验必须分别记录 direct、server-reflexive、relay，以及浏览器到 TURN 服务的 UDP/TCP/TLS 传输；TURN 到公开 Node 对端的实际 relay 路径也需单独记录。达到预登记连接 deadline 后仍没有已认证且 DataChannel open 的 selected pair，才把 T3 判为本次连接失败。

随后允许降级到 T0/T1，但必须遵守以下规则：

这里存在三个不同身份维度：`sessionEpoch` 是一次 transport/连接尝试的代次，fallback、重连或世界切换都会生成新值；`serverEpoch`（Authority runtime 内对应权威 `epoch`）是服务端权威进程的启动代次，也是动作事务键的命名空间；持久 `worldId` 和 generator/content/physics 等版本描述世界身份与兼容性。新 transport 会话不自动产生新 Authority，也不得改写权威 epoch。

1. 关闭失败的 `RTCPeerConnection`，创建新的连接 `sessionEpoch`，通过 WSS 做完整基线同步；不复用旧 DataChannel 上的 transport sequence 窗口。若仍连接同一运行中的 Authority，welcome 的 `serverEpoch` 保持不变。
2. 旧 ICE generation、旧 channel 和迟到消息一律拒绝。已经发送但未收到权威 receipt 的动作必须保持原始 `issuer + stream + sequence`、原 Authority epoch 和完全相同的 submitted action；不得用新的 `sessionEpoch` 或新的 Authority epoch 重写幂等键。
3. 同一 `serverEpoch` 内，客户端可以查询或按原键、原 payload 重试，由权威回执缓存返回原结果；超出有界保留窗口时返回 `OUTCOME_UNKNOWN`，不重新执行未知结果。若服务端重启后 `serverEpoch` 已改变，先完整 resync 并查询权威状态，原动作结果保持 unknown，不能换新键静默自动重做。只有上层动作合同与用户的新意图允许时，才可提交一笔新的动作。
4. 认证失败、协议版本不兼容、world/player 不匹配、封禁或资源滥用不能通过换 transport 绕过。fallback 只处理能力或网络失败。
5. T3 benchmark 中发生 fallback 的 run 记为 T3 连接失败，WSS 数据不能计为 T3 性能；可用性报告另记失败耗时、TURN 尝试与 fallback 完成耗时。
6. WSS/TURN/T3 的健康与退出分别观测。它们即使使用同一个数字端口，TCP 与 UDP 仍是独立 listener、防火墙和转发规则。

## 七、保留与条件淘汰的证据门

### T3 可进入 N3 有界原型的最低功能门

1. 固定候选与版本，在目标 Node 22/Linux x64 离线 artifact 上，由拟支持的真实桌面浏览器完成已认证信令、offer/answer、candidate exchange、ICE/DTLS/SCTP connected 和三条 DataChannel open。
2. 用固定小 payload 验证 control 可靠有序、world 可靠有序、pose unordered/零重传；验证重复、乱序、丢失与过期时业务 sequence/tick/revision gate 正确。不能只做 echo。
3. 分别通过公网 IPv4、IPv6 和 TURN relay；UDP 被阻断时至少验证一个预登记的 TURN TCP/TLS 路径或明确失败后 WSS fallback。记录 selected candidate pair，而不是只看 `connectionState=connected`。
4. 验证大 world message 并发时 control 仍按预算前进；记录 `maxMessageSize`、interleaving 是否实际协商、每 channel 与总 `bufferedAmount`。没有 interleaving 时按小消息/分块约束重测。
5. 验证单 channel close、整个 association 失败、ICE restart、server restart、信令断开、TURN 故障与慢消费者；所有 accepted 动作都有 receipt 或明确失败，资源和进程最终退出。
6. 完成 dependency/license/SBOM、离线安装、冷启动、目标 libc、故障隔离与资源上限检查。native 候选还需独立进程 crash fixture。

### 保留条件

满足上述功能门后，如果 T2 仍无法通过目标浏览器/网络能力门，或 T3 在代表网络中证明了 T0/T1 无法提供的可达性或部分可靠行为，T3 才进入 N3 的小型性能原型。之后仍按 `network-selection.md` 的预登记主指标与至少 10% 收益门判断，不因协议功能丰富而采用。

### 条件淘汰

出现任一项即可在本轮淘汰对应 T3 实现；若所有实现都触发，则淘汰 T3：

- 无法在目标浏览器与 Node 22/Linux x64 建立 DataChannel-only 会话，或 direct 与预登记 TURN 路径都不能覆盖目标网络；
- 无法证明多 channel 的因果正确性、背压有界、关闭可终止，或 bulk 会持续阻塞 control 且无法通过有界分块解决；
- 无法制作无运行时下载的离线 artifact，许可证/NOTICE/SBOM 或 native crash 隔离不满足发布边界；
- 只能依赖长期 TURN relay，且带宽、连接容量或运维成本超过预登记预算；
- 功能门通过后，在相同 DTO、codec、频率和网络条件下没有达到冻结的主要收益门，或产生不可接受的核心尾延迟/资源退化。

## 八、审计结束时仍未知

- T2：Chrome 探针失败的第一根因、现代 `webtransport-go` 与目标 Chrome 的实际互操作、可信证书路径、Linux x64 离线 artifact、LAN/IPv6/WAN UDP 都未知。
- T3：`werift 0.24.4` 与 `node-datachannel` 实际发布版本在本项目中的 Node 22/Linux x64 加载、浏览器 DataChannel-only 互操作、RFC 8260 interleaving、部分可靠性、TURN 路径、长期资源和 crash/close 行为都未知。
- 部署：目标主机的公网 UDP、IPv6、防火墙/NAT、TURN 容量与证书/信令入口尚未验证；本轮没有修改 PVE 或任何远端配置。
- 性能：本轮没有采样，所以不存在 T2、T3、T0 或 T1 的性能优劣结论，也不能据此冻结 wire v1 或最终 transport。

## 官方来源

- [W3C WebRTC Recommendation](https://www.w3.org/TR/webrtc/)
- [RFC 8831: WebRTC Data Channels](https://www.rfc-editor.org/rfc/rfc8831.html)
- [RFC 8829: JSEP](https://www.rfc-editor.org/rfc/rfc8829.html)
- [RFC 8445: ICE](https://www.rfc-editor.org/rfc/rfc8445.html)
- [RFC 8656: TURN](https://www.rfc-editor.org/rfc/rfc8656.html)
- [RFC 8260: SCTP Message Interleaving](https://www.rfc-editor.org/rfc/rfc8260.html)
- [RFC 8841: SCTP/DTLS SDP Offer/Answer](https://www.rfc-editor.org/rfc/rfc8841.html)
- [RFC 8827: WebRTC Security Architecture](https://www.rfc-editor.org/rfc/rfc8827.html)
- [W3C WebTransport Candidate Recommendation](https://www.w3.org/TR/webtransport/)
- [Node.js 22 API](https://nodejs.org/download/release/latest-v22.x/docs/api/)
- [fails-components/webtransport](https://github.com/fails-components/webtransport)
- [quic-go/webtransport-go releases](https://github.com/quic-go/webtransport-go/releases)
- [werift 官方仓库](https://github.com/shinyoshiaki/werift-webrtc)
- [node-datachannel 官方仓库](https://github.com/murat-dogan/node-datachannel)
