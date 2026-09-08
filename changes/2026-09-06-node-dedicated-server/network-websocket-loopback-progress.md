# 普通 WebSocket loopback 能力探针

## 结论

在 Node.js 22.23.2、已缓存的 `ws 8.21.3` 与 Playwright 1.62.1 下，短时 `ws://127.0.0.1` 探针已分别通过 Chrome 152.0.7977.76、Firefox 153.0 和 Playwright WebKit 26.5。每个引擎均完成 T0 单连接的双向严格字节回显与 T1 两条独立连接的各自回显、关闭；所有关闭码为 `1000`。这只是 T0/T1 的本机普通 WebSocket 功能证据，不能作为正式 transport 采用或性能结论。

## 范围与方法

- 没有安装依赖、没有修改产品代码、包配置、浏览器信任或系统设置。`ws` 的 `perMessageDeflate` 显式关闭。
- listener 只短时绑定 `127.0.0.1` 的随机端口 `63858`；完成后 `listenerClosed=true`、`remainingClients=0`，三个浏览器均在 `finally` 关闭。
- T0：浏览器向服务端发送固定 8 KiB 二进制帧和两个小控制二进制帧，服务端逐字节回显；服务端再发送不同的对应三帧，浏览器逐字节回显给服务端。
- T1：同一浏览器建立独立 `/realtime` 与 `/bulk` 连接；前者回显两个控制帧，后者回显 8 KiB 帧。该结果只证明连接映射和关闭独立可用，未测量也未证明抗 TCP 队头阻塞收益。

## 可复核证据

- 执行时间：`2026-09-07T05:26:21.870Z` 至 `2026-09-07T05:26:24.541Z`。
- Node：`/tmp/seedlands-node-22/node-v22.23.2-darwin-arm64/bin/node`，`v22.23.2`，darwin/arm64。
- 探针源码：`/tmp/seedlands-websocket-loopback-N1-20260907T052456Z/ws-loopback-probe.mjs`，SHA-256 `ac6f7229494b43ad181741ec6a3425427a07a9d9336cbf4a13bc13f9bc385454`。
- Node 依赖：`ws 8.21.3`（package.json SHA-256 `a56a3fd55945a3ce177e3ca165dafae6f7eb03b7aefd58c092ac723d5741a6fb`）；Playwright `1.62.1`（package.json SHA-256 `ca170ec143a88ed3043ac953eb3b2377b2b97304104f4e1e23316684ce2c35af`）。来源为本工作树既有缓存，未下载。
- 运行命令：`/tmp/seedlands-node-22/node-v22.23.2-darwin-arm64/bin/node /tmp/seedlands-websocket-loopback-N1-20260907T052456Z/ws-loopback-probe.mjs`。
- 完整逐引擎连接、帧长度、SHA-256、关闭和清理结果见 [network-websocket-loopback-evidence.json](network-websocket-loopback-evidence.json)，SHA-256 `6ec9f6b9ceda53dde01edb3bfd9e91d5dfd1abce2f296847aa41feb46e9f55c7`。
- 探针首次把 `ws/package.json` 当模块入口，启动前在 `WebSocketServer is not a constructor` 处失败；该次没有创建 listener 或启动浏览器，随后以包解析基准加载 `ws` 后通过。完整错误及修正边界在 JSON 的 `attemptHistory`。

## 严格边界与后续缺口

`wss://`、可信 TLS 证书链、HTTPS 页面到 WSS、Origin/认证门禁、LAN/公网/IPv4/IPv6、代理/防火墙和真实网络故障均为 `NOT_COLLECTED`。T1 没有模拟拥塞、丢包或大块竞争，不能声称降低延迟、提高吞吐或缓解 TCP 层队头阻塞。Playwright WebKit 结果也不等同 Safari 或 iOS 设备验收。

该探针符合冻结合同中“WebSocket + Node `ws` 为 T0 参考、关闭 `permessage-deflate`”的局部功能验证；正式部署仍需要独立完成 WSS 可信证书和真实网络门禁。
