# T0/T1 浏览器与 Node loopback 功能探针

## 状态与边界

本记录是进入 N3 前的一次可丢弃能力探针，只回答固定小型人工消息能否在当前本机环境完成 WebSocket 连接、识别两类逻辑流、关闭/取消和显式跨流因果等待。它不使用真实游戏 DTO，不采集吞吐、时延、CPU、内存、公平性、拥塞或丢包数据，也不形成 T0/T1 采用结论。冻结的正式选型边界仍以 [network-selection.md](network-selection.md) 为准。

原型全部位于 `/tmp/seedlands-t0-t1-loopback/`，没有导入 `src/`、生产入口或包脚本，也没有新增或修改依赖。浏览器端使用原生 `WebSocket`；`ws` 8.21.3 的官方说明同样要求浏览器客户端使用原生对象，并提供了一个 HTTP/S 服务上按路径承载多个 `WebSocketServer` 的参考方式。[ws 8.21.3 README](https://github.com/websockets/ws/blob/8.21.3/README.md)

## 环境与做法

- Node：`v22.22.2`，本机现存 Raycast runtime。
- 浏览器：本机 Google Chrome `152.0.7977.76`，Playwright 报告的 UA 为 `HeadlessChrome/152.0.0.0`。
- Playwright：仓库锁定的 `1.62.1`。
- Node WebSocket：仓库锁文件中已经存在的传递依赖 `ws@8.21.3`；原型以绝对路径读取，没有把它变成生产依赖。
- 平台：macOS arm64。
- 服务：只监听随机 loopback 端口；T0/T1 主探针为 `127.0.0.1` 明文 `ws://`，补充能力检查为 `[::1]` 明文 `ws://`。
- 载荷：固定短 JSON 文本；服务端设置 `maxPayload: 64 KiB`、`perMessageDeflate: false`。压缩关闭符合 `ws` 服务端默认行为，也避免把压缩成本混入这个功能探针。[ws 8.21.3 README](https://github.com/websockets/ws/blob/8.21.3/README.md#websocket-compression)

Playwright 官方建议使用与版本配套的浏览器，并对自定义可执行文件路径提示谨慎。本机缺少该 Playwright 版本期望的 bundled Chromium，所以本次显式启动现存 Chrome；结果只证明上述精确组合，不能代替后续固定最低浏览器版本矩阵。[Playwright 浏览器说明](https://playwright.dev/docs/browsers)、[BrowserType.launch](https://playwright.dev/docs/api/class-browsertype#browser-type-launch-option-executable-path)

## 可重放命令与产物

```sh
chmod +x /tmp/seedlands-t0-t1-loopback/run-node22.sh
/tmp/seedlands-t0-t1-loopback/run-node22.sh
```

默认路径可由 `PROBE_REPO`、`PROBE_NODE22`、`PROBE_ARTIFACT_DIR` 和 `SEEDLANDS_CHROME_PATH` 覆盖。命令成功输出：

```text
{"artifactDirectory":"/tmp/seedlands-t0-t1-loopback/artifacts","t0":"PASS","t1":"PASS","ipv6":"PASS","node":"v22.22.2","chromium":"152.0.7977.76"}
```

本次产物：

| 路径                                                    | SHA-256                                                            | 用途                                 |
| ------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------ |
| `/tmp/seedlands-t0-t1-loopback/probe.mjs`               | `7692b6a6f9545f58d9e6ac82a962dc6ede2230be5b485b5cce4e7790f5ec6e55` | 服务端、浏览器动作与断言             |
| `/tmp/seedlands-t0-t1-loopback/run-node22.sh`           | `02f100a0693a8e46a3ba69024557a8524bd0d861e122021afd0ab4f6d1ad51ae` | 固定 Node 22 的重放入口              |
| `/tmp/seedlands-t0-t1-loopback/artifacts/result.json`   | `e8e2bdc4e72fe131033afd0655d8a98c463d35550e9444afcefd303b349a7a41` | 结构化环境、断言和限制，共 6074 字节 |
| `/tmp/seedlands-t0-t1-loopback/artifacts/events.ndjson` | `7cb78dcd548135f5cfdf9ec42139fbba8280fb3bd36a08dc8b100536958d145e` | 服务端 17 条有序事件，共 2221 字节   |

## 实际功能结果

| 检查                  | 实际结果                                                                                             | 能证明的范围                                                                         |
| --------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| T0 单连接双逻辑流     | `PASS`；`control-1`、`bulk-1` 共用 `T0-1`，回显顺序与发送顺序一致                                    | 当前单 WebSocket 上的两个小消息可按一个连接识别和有序回显                            |
| T0 关闭               | `PASS`；浏览器与服务端都观察到 code `1000`、reason `t0-done`，服务端记录该连接曾承载 control 与 bulk | 关闭单连接会同时失去其上的两个逻辑流                                                 |
| T1 分离连接           | `PASS`；control 为 `T1-2`，bulk 为 `T1-3`                                                            | 两个路径可形成两条实际 WebSocket 连接，消息不能只靠到达连接猜测会话身份              |
| T1 跨流因果           | `PASS`；人工到达顺序为 `control-dependent → bulk-1`，客户端应用顺序为 `bulk-1 → control-dependent`   | 多连接不能依赖全局 FIFO；显式 `dependsOn` 门可以阻止新控制状态越过所依赖的 bulk 基线 |
| T1 取消与隔离         | `PASS`；服务端撤销仍在应用层 hold、尚未发送的 `bulk-cancel`；bulk 正常关闭后 control 仍可回显        | 独立 bulk 连接关闭不必关闭 control；取消只覆盖尚未发布的应用层工作                   |
| 浏览器/服务端排队信号 | `PASS`；两端 `bufferedAmount` 均为 number，固定小消息后浏览器值回到 0                                | 当前 API 能报告已排队但尚未发送的字节；没有验证高水位、持续背压或资源上限            |
| IPv6 loopback         | `PASS`；Chrome 与 Node 经 `ws://[::1]` 完成固定文本回显                                              | 只证明本机 IPv6 loopback 明文连接，不能证明公网 IPv6 或 WSS                          |
| T2 WebTransport       | `NOT_VALIDATED`；浏览器中 API 类型为 `function`                                                      | 只记录 API 存在，不证明 HTTP/3、可靠流、datagram、证书或服务端能力                   |
| T3 WebRTC DataChannel | `NOT_VALIDATED`；浏览器中 `RTCPeerConnection` 类型为 `function`                                      | 只记录 API 存在，不证明 ICE、DTLS/SCTP、TURN、部分可靠性或部署成本                   |

T1 的乱序由服务端屏障明确制造：服务端先收到 bulk 但暂不回显，control 回显到达后浏览器才请求释放 bulk。这是正确性 fixture，不是网络调度概率、时延或性能证据。

## 背压与关闭的后续验证需求

浏览器 `bufferedAmount` 表示通过 `send()` 排队、尚未传到网络的字节；连接关闭后它不会自动归零，关闭后继续调用 `send()` 还可能继续增长。[MDN bufferedAmount](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket/bufferedAmount) 因此正式实现与 N3 至少需要：

1. 为每条连接同时限制待发送消息数与字节数，并为 T1 增加同一会话的聚合上限，防止拆连接绕过总预算。
2. 高水位时只合并尚未交给 WebSocket 的可替换移动/pose 状态；动作、跳跃边沿、提交和 Chunk 基线必须等待、显式拒绝或进入可恢复重同步，不能静默丢弃。
3. 浏览器 WebSocket 没有可依赖的 `drain` 事件；需要有界调度器轮询或发送完成策略，并在低水位恢复准入。正式测试必须使预算真的被触发并断言内存/队列有界，本探针没有制造这种负载。
4. `close()` 会在先前已发送的消息处理后才开始关闭握手，所以它不能撤回已经交给 WebSocket 的消息。[MDN close](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket/close) 协议必须区分“仍在应用队列、可取消”“已交给传输、等待结果”“权威已接纳/可能已提交”三种状态。
5. 覆盖正常关闭、服务端关闭、无关闭帧断开、浏览器进程退出、半开连接、心跳超时和服务关停；所有 accepted 动作最终必须成功、明确失败或在重连后按 identity/sequence 查询，不能只让 Promise 消失。
6. T1 两条连接必须绑定同一认证主体、session、epoch、generation 和限额；任一条重连时要冻结旧连接写入，重新建立 Chunk revision/commit 因果屏障，并防止重复动作。

## 跨流正确性验收需求

正式协议至少需要为动作结果、世界提交、Chunk 基线/增量和 pose 写明 `epoch`、消息序号、Chunk revision、依赖的最低 commit/revision 与是否可独立解释。接收方只有在依赖已验证并驻留后才能应用消息；依赖被取消、淘汰、损坏或超过预算时，应请求完整基线或明确失败。验收需覆盖：

- control 先到、bulk 后到；bulk 先到、control 后到；重复、旧代次和依赖永不到达。
- 多个 Chunk 并行时只解除相关依赖，不能用某个不相干 Chunk 的到达推进全局门。
- 关闭 bulk 后 control 仍可报告取消/重同步，但不能使用缺失基线继续展示新 pose 或执行依赖动作。
- T0 与 T1 在相同消息语义和相同 codec 下产生等价的最终可观察状态；本探针的人工 echo 不能证明这一点。

## IPv6、WSS 与部署待验证项

本次没有建立 TLS，也没有访问 PVE、远端主机或公网地址。`WSS` 状态为 `NOT_COLLECTED`。后续部署检查需至少覆盖：

- 实际域名的 A/AAAA 解析、IPv4/IPv6 TCP 可达性和 Happy Eyeballs 行为；`::1` 通过不代表公网 IPv6 路由或防火墙通过。
- 浏览器信任链、证书 SAN、有效期/轮换、TLS 版本，以及反向代理对 Upgrade、Origin、认证头、真实客户端地址和最大消息的处理。
- 代理/负载均衡的空闲超时、ping/pong、优雅排空、多实例会话绑定和 T1 两连接是否落到兼容的后端状态。
- T0/T1 使用 TCP；即使未来 T2 使用相同数字端口，HTTP/3/QUIC 的 UDP 监听与防火墙仍需独立验证。不得以本探针推断 UDP 可达。

## 结论边界

当前环境下，T0 和 T1 都具备继续进入正确性集成的最小浏览器到 Node 功能基础；T1 确实允许一条 bulk 连接关闭而 control 继续，但也立即引入会话绑定、聚合预算和跨连接因果门。没有性能证据表明 T1 优于 T0，也没有证据支持正式采用任一方案。WSS、公网 IPv6、代理、目标浏览器矩阵、真实消息、持续背压、故障恢复以及 T2/T3 仍待后续门禁验证。
