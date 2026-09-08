# N1 T2：现代 WebTransport loopback 能力探针

本文记录一次仅在本机 loopback 执行的能力探针。它用于缩小旧 `@fails-components/webtransport`/quiche Chrome 握手失败的未知区间；不构成 Node 专用服务器、Go 侧车、最终 transport、正式证书或 wire 的采用决定。

## 结论

2026-09-07 04:00:56Z 至 04:00:58Z，Google Chrome 152.0.7977.76 与 `github.com/quic-go/webtransport-go v0.13.0` 在 macOS ARM64 的 `127.0.0.1` 上完成了实际 HTTP/3/QUIC WebTransport 会话。浏览器处于安全上下文，使用 `serverCertificateHashes` 固定自生成的短期 ECDSA P-256 叶证书，没有使用忽略证书错误选项或修改系统信任。`ready`、一条浏览器发起的可靠双向流回声及一个浏览器发起的 datagram 回声都通过。

这证明**当前 Chrome 可以与该现代实现完成本机 IPv4 loopback 的会话、可靠流和 datagram**。它不证明旧 quiche 失败的唯一根因，也不证明正式服务端、Linux x64 离线产物、IPv6、LAN/WAN UDP、可信公开证书链、资源上限或产品侧车边界。

## 候选与冻结输入

| 项目                    | 实际值                                                                                                                                             |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Go 侧车候选             | `github.com/quic-go/webtransport-go v0.13.0`，官方 README 标为 draft-16                                                                            |
| 上游版本来源            | [v0.13.0 release](https://github.com/quic-go/webtransport-go/releases/tag/v0.13.0)，[官方仓库](https://github.com/quic-go/webtransport-go)         |
| 许可                    | MIT；仅记录候选上游许可，尚未进行产品分发/SBOM 准出                                                                                                |
| Go 运行时               | `go version go1.26.3 darwin/arm64`；模块声明 Go 1.26.0                                                                                             |
| Node 运行时             | `/tmp/seedlands-node-22/node-v22.23.2-darwin-arm64/bin/node`，`v22.23.2`                                                                           |
| 浏览器                  | Google Chrome 152.0.7977.76，通过 Playwright 1.62.1 独立 context 启动                                                                              |
| WebTransport 模块和校验 | `webtransport-go v0.13.0`，`h1:RJLrTUHlTj8jJaQlQJUy0z0Mf7u1fVM0I6L1b9pe2M0=`；`quic-go v0.62.0`，`h1:ZHDjCk5OacATwGvs8PWE97CTvX7AqZiVoW7++ZOXTf8=` |
| 临时原型目录            | `/tmp/seedlands-webtransport-go-loopback-v013-G3KZiy`；不导入仓库、不会作为交付源码                                                                |

`go.mod`、`go.sum` 与完整模块清单的 SHA-256 分别为 `43f3cd7471020299911202c728dbb30bc29a2eaaff349750c0465143d02f1df5`、`c07dc55f5b68455a49f1ff3768696af9202b3c508bb8a250b80e6c815711a687`、`e2928696816c551925d3dbf9ecfdcc7594d9c61917eaa7344d9366bb63e4a2b4`。最终 Go 探针源码和构建产物的 SHA-256 是 `da68811f0d87427f03ba1d3288e5674272b541c28107d2ee4de386c619c83d1a` 与 `78128239b3cadeb38b7617d508a249282c74c2d4a54203bdaae6eacaed855eb7`；浏览器驱动源码是 `87c25b9d2def602944fe55b825976e10e13a0825e67b1ff07dd45e37a7204892`。这些源码只保留在可丢弃的 `/tmp` 原型中，本 change 不包含私钥、证书文件或原型源码副本。

## 运行方式与安全边界

探针的 Go server 只通过 `udp4` 绑定 `127.0.0.1:0`，本次实际端口为 UDP `127.0.0.1:60650`。为提供安全页面而创建的临时 HTTP server 只绑定 TCP `127.0.0.1:59959`。两者都由测试进程在 `finally`/shell trap 中关闭。

Go 进程在内存中生成 24 小时有效的 ECDSA P-256 自签名叶证书：Subject `localhost`，SAN 含 `localhost`、`127.0.0.1`、`::1`。私钥没有写盘或输出；浏览器只收到 DER SHA-256 pin `yyI1OecOqgWK6QjG6p1VKLbPhEuQx8nCZp/b5ASATGU=`。浏览器实际连接的 WebTransport URL 是 `https://127.0.0.1:60650/echo`，来源页面是 `http://127.0.0.1:59959/`，并记录 `isSecureContext=true`。没有传递 `--ignore-certificate-errors`，没有使用 `ignoreHTTPSErrors`，没有更改系统信任。

server 通过 `webtransport.ConfigureHTTP3Server` 配置 HTTP/3 WebTransport settings，并打开 QUIC datagram 与 partial-delivery；会话建立后接受一条双向流，以 `io.Copy` 回声，并将每个收到的 datagram 原样 `SendDatagram` 回去。每个阶段以 JSONL 记录；浏览器、HTTP server 和 UDP server 都在返回前关闭。最终进程检查没有发现遗留探针 server 或临时 Chrome。

## 实际通过阶段

| UTC 时间                             | 阶段                 | 观察结果                                                                          |
| ------------------------------------ | -------------------- | --------------------------------------------------------------------------------- |
| 04:00:57.474088Z                     | UDP/H3 ready         | 仅 loopback 的 UDP listener 就绪，输出证书 pin 与 draft-16 标记                   |
| 04:00:57.720Z                        | 浏览器页面           | 临时 loopback HTTP 页面就绪                                                       |
| 04:00:58.187116Z                     | origin 检查          | 浏览器 origin 为 `http://127.0.0.1:59959`                                         |
| 04:00:58.194769Z                     | WebTransport session | server 交付 session，远端为 `127.0.0.1:51382`                                     |
| 04:00:58.198551Z 至 04:00:58.202659Z | 可靠双向流           | server 接受浏览器流并成功回声 22 B；浏览器读回 `reliable-loopback-v013`           |
| 04:00:58.203768Z                     | datagram             | server 成功回声 22 B；浏览器读回 `datagram-loopback-v013`                         |
| 04:00:58.297492Z 至 04:00:58.304714Z | 关闭                 | 收到 SIGTERM 后记录 `closed`；datagram 读取的 `EOF` 是 browser close 后的正常结束 |

对应运行、浏览器结果、server JSONL 和 readiness 文件 SHA-256 依次为 `870b4e3c313948c1b0456c48192fd12953e452d4edd20feb82fa6471a87daa85`、`e652cd70b617defacda08458e2bf7aa12d64b19afec2afa9585bfa0f07485ce0`、`3497945eb19b9922e5c94d764651d98051c213c98a15a069c471907f8b096357`、`29e083eaf034d39672969f7c46dbbd14c5de1a6c3d12402a4efcb9cd26efbf48`。路径和结构见同目录的 [JSON 证据](network-webtransport-loopback-evidence.json)。

## 初轮工具问题与修正

1. 初次 `go get` 后用 `go list -m -json all` 列举模块时，`proxy.golang.org` 对 `golang.org/x/term@v0.45.0` 返回一次 `EOF`。`go get` 已成功写入直接锁定模块，随后缓存完成后重新执行模块清单成功；这不是 WebTransport、QUIC 或浏览器连接失败。
2. 第一次实际编排在 server ready 后，浏览器驱动从 pnpm 根按 `require('playwright')` 解析失败，错误是 `Cannot find module 'playwright'`。Chrome 尚未启动，未发出 WebTransport 请求；修正为显式使用已安装的 Playwright 1.62.1 路径后才开始协议探针。
3. 第一次成功传输后，临时 Go runner 将 `server.Close()` 触发的预期 `context canceled` 错误错误地写成 `serve-error`。修正关闭判定并重新构建、完整重跑后，最后日志为 `closed`。该问题只影响原型关闭日志分类，不影响首轮已看到的 session、流和 datagram 结果；本记录仅以第二次干净运行作为通过证据。

## 与旧 quiche 失败的关系

旧候选使用 `@fails-components/webtransport 1.6.8`/quiche 时，Chrome 152 已创建 WebTransport 但 `ready` 报 `Opening handshake failed.`，server 未交付 session。新探针使用不同实现、draft-16 设置并固定 WT URL 与 UDP 都为 IPv4 loopback，已经到达 session 和应用回声，因此可排除“当前 Chrome 完全不能进行 loopback WebTransport”这一总类判断。

旧原型的源码、锁定输入和 QUIC/HTTP3 分层日志未保留在 `/tmp`，所以不能从这次结果严谨推出旧失败属于证书、`localhost` 地址族、QUIC TLS/ALPN、HTTP/3 settings、Extended CONNECT 或旧草案互操作中的哪一个。现代成功也不能作为旧 quiche 或生产环境的兼容性承诺。

## 仍未满足的门禁

- Node 22 仍没有公开内置 HTTP/3/WebTransport server API；本证据中的 Go process 是临时 sidecar，不等于产品运行时决策。
- 未验证目标 Linux x64 的完全离线 artifact、依赖许可证/SBOM、冷启动、进程隔离、资源上限、背压、异常包、优雅退出超时或崩溃隔离。
- 未验证 IPv6、LAN、NAT、防火墙、WAN UDP、公开证书链、正式 origin、反向代理、认证或任何远端/PVE 环境。
- 未与 WSS fallback 建立或比较；可靠回声不可被算作 fallback 成功，也没有性能样本。
- 未发送游戏 DTO、未冻结 wire、未实现 GUI 或正式 transport adapter；本结果不可以替代 N2--N4 的语义、真实语料、浏览器应用与 E2E 门禁。
