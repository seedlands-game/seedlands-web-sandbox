# N1 T2：WebTransport 浏览器能力矩阵

本文是在既有 Chrome loopback 证据之外，对已缓存的 Playwright Firefox 与 Playwright WebKit 进行的同一临时 Go HTTP/3/WebTransport echo 探针记录。它只覆盖本机 IPv4 loopback、短期 ECDSA P-256 证书 pin、会话建立、一条可靠双向流及一个 datagram；没有性能采样、浏览器下载、远端监听、产品代码改动或 transport 采用决定。

## 目标与状态定义

冻结 N1 合同要求 Chromium、Firefox、WebKit 桌面与拟支持移动端分别取得实际能力证据，不能用兼容性表替代。

- `PASSED`：在这一次受控环境中，浏览器接受 `serverCertificateHashes`、进入 `ready`，并完成要求的回声路径和关闭。
- `DATA_PATH_FAILED`：API、构造或会话可能已经通过，但某条实际数据路径在明确阶段失败；它不等同“浏览器完全不支持 WebTransport”。
- `NOT_COLLECTED`：本机尚未实际运行该目标，或没有设备/运行时；环境缺失不写成 `UNSUPPORTED`。
- `INCONCLUSIVE`：探针自身没有覆盖到所需阶段，不能用于浏览器结论。

## 共同固定条件

| 项目                  | 实际值                                                                                                                                                                                |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 服务端                | 临时 `/tmp/seedlands-webtransport-go-loopback-v013-G3KZiy` 中的 `webtransport-go v0.13.0`（draft-16）与 `quic-go v0.62.0`                                                             |
| 运行时                | Go 1.26.3 darwin/arm64；Node 22.23.2；Playwright 1.62.1                                                                                                                               |
| 监听                  | WebTransport/HTTP3 仅 `127.0.0.1:0` UDP；临时来源页面仅 `127.0.0.1:0` TCP；每轮结束关闭                                                                                               |
| TLS                   | 内存中生成 24 小时 ECDSA P-256 叶证书，SAN 为 `localhost`、`127.0.0.1`、`::1`；仅将 DER SHA-256 作为 `serverCertificateHashes` pin 传给浏览器；不写私钥、不忽略证书错误、不改系统信任 |
| 判定负载              | 可靠双向流 `reliable-loopback-v013` 与 datagram `datagram-loopback-v013`，均为 22 B，仅证明功能路径                                                                                   |
| 固定 Go server 二进制 | SHA-256 `78128239b3cadeb38b7617d508a249282c74c2d4a54203bdaae6eacaed855eb7`                                                                                                            |

现有 Chrome 152.0.7977.76 成功证据在 [network-webtransport-loopback-progress.md](network-webtransport-loopback-progress.md) 及其 JSON 中，未被本轮修改。

## 结果矩阵

| 目标                     | 实际版本/环境                              | API 与 pin 构造 | `ready`/server session | 可靠双向流                                        | datagram                             | 当前状态                                                                          |
| ------------------------ | ------------------------------------------ | --------------- | ---------------------- | ------------------------------------------------- | ------------------------------------ | --------------------------------------------------------------------------------- |
| Chromium                 | Google Chrome 152.0.7977.76                | 已通过          | 已通过                 | 已通过                                            | 已通过                               | `PASSED`，仅既有 loopback 范围                                                    |
| Firefox                  | Playwright Firefox 153.0                   | 已通过          | 已通过                 | 已通过                                            | 已通过                               | `PASSED`，仅本机 loopback 范围                                                    |
| WebKit                   | Playwright WebKit 26.5                     | 已通过          | 已通过                 | `createBidirectionalStream()` 10 秒 deadline 超时 | `transport.datagrams` 为 `undefined` | `DATA_PATH_FAILED`：当前候选+该 WebKit build 不能满足 N1 的流与 datagram 同时要求 |
| 系统 Safari              | Safari.app 存在，但本轮未启动/自动化       | 未采集          | 未采集                 | 未采集                                            | 未采集                               | `NOT_COLLECTED`；不能由 Playwright WebKit 推导                                    |
| iOS Safari               | 无 Simulator、无已接入设备                 | 未采集          | 未采集                 | 未采集                                            | 未采集                               | `NOT_COLLECTED`                                                                   |
| Android Chromium/Firefox | 无 Android SDK、emulator、adb 或已接入设备 | 未采集          | 未采集                 | 未采集                                            | 未采集                               | `NOT_COLLECTED`                                                                   |

**Playwright WebKit 不等于 Safari 或 iOS Safari。** 它可提供一个桌面 WebKit 引擎的实现信号，不能替代 Apple 系统 Safari 或实际 iOS 设备的版本、策略、证书与 UDP 行为证据。

## Firefox 153.0：通过

Firefox 在 2026-09-07 04:11:54Z 至 04:11:56Z 运行。浏览器报告 `isSecureContext=true`、`WebTransport` 为 function；它接受 `serverCertificateHashes` 构造参数，`ready` 成功，服务端交付 session，可靠流与 datagram 分别回声 22 B，最后 browser 与 server 都关闭。

Firefox 运行、浏览器结果、server 日志和 readiness 文件的 SHA-256 分别为：

- `bdd6f181144ce8c192edfe488e0bb57a91c268e957ee44704e54e41344568c80`
- `c874bee4f6ff97e4aa4341cf9a9b35768f7d69244b7bb50c95aec4ad8c578990`
- `ddca623c5f08c147335b7d928574547db9cf3f706b9fdd9210de894ba3186331`
- `722bf9cdcc080e2da7f4acb0783423a7ef6589d19f00cd3d4f7dcd45d650fbd8`

## WebKit 26.5：两次记录与最终分阶段结论

第一次 WebKit 调用到达 server session，但原浏览器矩阵 runner 没有对 `createBidirectionalStream()` 设置独立 deadline，结果文件为空。该次为 `INCONCLUSIVE`，不能用于判定 WebKit。运行、空结果和 server 日志 SHA-256 分别为 `c3d366f5680d8083448a16e07c019b784db44b52747ceb6d704373237eebdeb7`、`e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`、`29015f70f289e029d79662fb38a7507c951d799e5771df9248f12af7339435d3`。它在受控中断后 server 记录 `closed`，没有保留本轮 probe server 或 browser runner。

第二次在同一候选、同一证书策略和同一 loopback 条件下给可靠流各操作设置 10 秒 deadline。WebKit 26.5 通过安全上下文、API、pin 构造、`ready` 与服务端 session，但 `createBidirectionalStream()` 在 deadline 到期前未完成。因此结果是 `DATA_PATH_FAILED`，尚未对 datagram 做独立尝试。

第三次保持上述设置不变，只把 `ready` 后的可靠流与 datagram 改为相互独立的有界检查。它稳定复现：

1. `secureContext=true`，`typeof WebTransport === 'function'`。
2. 构造接受 `serverCertificateHashes`，`ready` 成功，服务端交付 session。
3. `createBidirectionalStream()` 在 10 秒后报 `create-bidirectional-stream timeout after 10000ms`；服务端没有接受可靠流。
4. `transport.datagrams` 是 `undefined`，读取 `.writable` 报 `TypeError`；因而当前 build 没有可用的 WebTransport datagram 对象。
5. 显式关闭成功；server 收到结束并记录 `closed`。

第三次运行、浏览器结果、server 日志和独立 runner 的 SHA-256 分别为 `803b38670a350a745480af6dae8d949c349d783a6736503b0fe18e05ff272a3a`、`7d8d2d6ebfc17afe638de69e865aeae9916d140ae823ea77ff906ea3f93fd9a3`、`99bcfd8e2af503d7d44ee5b8738b43e5e1240f16284597d0a24c634ccf7624ae`、`15e33e66074ba6952f188b26c7a06522142330b1fa9a29e0eb4d6416380041c8`。完整路径、端口、时间和结构化错误见同目录 [JSON 证据](network-webtransport-browser-matrix-evidence.json)。

这不是对全部 Safari/WebKit 版本的普遍性断言，也不说明 WebKit API 不存在或握手失败。它精确说明：在 Playwright WebKit 26.5、现代 Go v0.13.0 sidecar、当前 pin 和 IPv4 loopback 的组合中，N1 所要求的一条双向可靠流和一个 datagram 都未形成可用路径。

## 移动端与后续最小计划

本机只有 Command Line Tools，`xcrun simctl` 不可用；未找到 Android SDK、`adb`、`emulator` 或 `avdmanager`，没有已接入的 iOS/Android 设备。因此移动端全部是 `NOT_COLLECTED`，并不表示相关浏览器不支持 WebTransport。

下一有界步骤应先明确产品拟支持的移动浏览器与最低版本，然后在受控设备或安装好的 Simulator/emulator 上重放同一个无需互联网的 probe：安全页面、证书 pin、`ready`、可靠流、datagram、关闭和阶段日志。不能以桌面 Playwright WebKit 替代 iOS。Linux x64 离线侧车与 LAN/WAN/IPv6/正式 TLS 仍是独立门禁。

## Linux x64 交叉构建附录：仅产物能力

使用同一冻结的 `/tmp/seedlands-webtransport-go-loopback-v013-G3KZiy` 模块和 Go 1.26.3 执行一次 `CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath`。构建成功，产物 `webtransport-loopback-server-linux-amd64` 的 SHA-256 为 `46345c3b68ee6bed57a29e4a659421296ef182777364b28785acbc643932bba8`，大小为 11,182,631 B。

macOS `file` 将它识别为 `ELF 64-bit LSB executable, x86-64, statically linked`。本机没有 `readelf` 或 `greadelf`，因此“没有动态依赖”仅以该 `file` 输出为边界，不替代目标 Linux 的装载审阅。构建前后 `go.mod` 和 `go.sum` 的 SHA-256 均未变化，分别为 `43f3cd7471020299911202c728dbb30bc29a2eaaff349750c0465143d02f1df5` 与 `c07dc55f5b68455a49f1ff3768696af9202b3c508bb8a250b80e6c815711a687`。

只读盘点发现本机 OrbStack 中已有一个运行中的 Ubuntu Noble ARM64 实例，Docker 没有运行容器；没有可执行该 x86-64 Linux 产物的现成 Linux x64 环境。本附录状态为 **交叉构建通过、Linux x64 运行 `NOT_COLLECTED`**。它没有执行 binary、监听端口、连接浏览器、访问远端或创建容器，不能写成 Linux 握手/关闭、离线部署或动态库兼容已通过。
