# Web↔Node 本机单人闭环执行记录

## M0 RED

- 源码起点：`3481069`（合同提交，基于 `3c727f7`）。
- 合同校验：`implementation.json` 的 SHA-256 为 `721bd6e9e54f61f58c35ddab740590e5249749134367d00c3877e157185b642c`，全局校验脚本返回 `valid: true`。
- RED 命令：`pnpm exec vitest run tests/server/network-playable-protocol.test.ts tests/node/node-network-options.test.ts tests/node/node-authority-publication-listener.test.ts tests/client/remote-authority-client.test.ts`。
- RED 结果：退出码 1；4 个测试文件失败。缺少远端客户端和 publication listener 隔离模块；CLI 拒绝 `--listen`；C0 不识别 `session-hello`；interest 仍接纳多主块请求。
- 接缝：公开入口只允许首条有界凭据握手、输入、玩家 action、单主块 interest、checkpoint、heartbeat 和 disconnect。Node 将每连接的客户端序号映射到进程内持续单调的 Authority 序号；浏览器不创建 Authority、Logic、Fluid 或持久化写者，完整基线只由 Node capture 并经既有 reference publication/reassembly/consumer 安装。
- 安全边界：远端产品禁用 `editWorld`、`setPlayerPosition`、时间/暂停和 server command；单连接网络 listener 失败只关闭该连接，不能终止 Authority lane。

## M1 Node 与 Web 接线

- `b6ab3e0` 增加 loopback WebSocket 入口、精确 Origin/口令握手、单玩家容量、受限公开消息、Node publication 隔离、baseline 分页发送与 dist-only listen+hello 检查；`4719842` 将浏览器双模式入口、远端 Authority 镜像、完整 Authority mesh 输入和首帧接入产品。
- Node 为唯一 Authority writer。浏览器远端模式不启动本地 Authority/Logic/Fluid/persistence，也不允许管理式 `editWorld`、传送、调时间或暂停接口。远端 canonical 缺失会等待/重抓，不进入本地生成回退。
- 客户端 URL 先经 `new URL` 解析，再精确限制 `ws:`、`127.0.0.1`/`::1`、`/seedlands`，并拒绝 username/password/query/hash。实验握手显式标记 `experimental-local-c0-v1`，没有将既有 draft v1 宣称为正式 wire 采用。
- 首次可操作门槛按 Authority 玩家脚下层的 3×3 Chunk 完成 mesh 后结算；仓库落表代表 mesh 任务完成，合法空 mesh 不会因 `triangles === 0` 卡死。精确 y=32/64 边界使用既有 `COLLISION_EPSILON` 选择脚下层。

## M2 完整游玩与异步资源

- `51e97fa` 完成真实输入、跳跃、挖放、Node 保存、离开/断线、手动重连和重启恢复；`ef71bfb` 将运行证据绑定源码；`7191c06` 增加真实 WebSocket 负向与无连接 tick；`e1d7ab3`、`331fea0`、`ae8a49f` 收敛 pending/cancel/revision/首屏地层边界。
- Node 把每个新连接从 0 开始的输入、edge、action 与 capture 身份映射到进程内持续单调序号；断线立即清输入并取消连续破坏。旧连接 cleanup 不能清除新连接输入，未知动作不自动重发。
- baseline 请求最多 32 个，checkpoint 只允许一个 durable 写入在途，输入 RPC 最多 32 个在途；action、发送字节、socket buffered amount、baseline 在途字节和全消息/action 速率分别有界。重复/过期 requestId、超空间 interest、协议错误或反压只关闭该连接。
- 受控测试覆盖 capture 永不完成时 session drain 和真实 network listener 都能关闭、真实 capture 被取消、迟到 completion 不发送；分页测试在 first page 后注入新 commit，再送 last page，旧 bundle 被拒绝并可重抓。正确 Authority-complete Worker lease 发出后若 commit 使 owner 失效，原任务结果也被拒绝。

## 冻结源码与真实旅程

- 生产/测试冻结提交：`ae8a49fd9f43c1e29b59a518e35473205eff3b08`。最终旅程开始时 `git status --porcelain` 为空；JSON 中 `sourceTreeStatus` 为 `""`，并记录 8 个关键源码/测试输入及实际 `apps/node-server/dist/node-server.js` 的 SHA-256。
- 命令：`pnpm test:web-node-playable`，退出码 0。Node 先从冻结源码重建 5 个 ESM 入口；Vitest 10 个文件、23 项通过；真实 Chromium 1 项通过，23.7 秒。该耗时只表示功能测试完成，不是性能样本。
- 同一 Pointer Lock 流程中，初始 Authority tick 397，脚下层 3×3 均已有 rendered revision，初始 loaded/rendered/ready baseline 为 17/12/17；WASD 移动后转向，跳跃从 y=18 到 y=18.91 且峰值 `onGround=false`。
- 左键挖掘使 world revision 从 1 到 2；真实拾取并切换 hotbar 后右键在 `[0,19,-1]` 放置 voxel 2，world revision 为 3，collision chunk revision 与 rendered revision 均为 2 后才截图。
- 保存返回菜单后关闭页面，重新连接仍是同一 server epoch，Authority tick 增至 903 且方块仍在。停止日志给出 `durableCommitSequence: 1110`；同数据目录重启后 server epoch 改变，ready 日志从 durable 1110 恢复，方块仍在。无连接持续 tick 另由直接读取 `runtime.authority.latestSnapshot()` 的 Node 集成测试证明，不依赖公开调试 RPC。

### 原始证据

| 文件                                  | SHA-256                                                            | 作用                                                                 |
| ------------------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------- |
| `evidence/web-node-01-early.png`      | `5f957c7f49afd9e764cdf7057f6b3c99ea9744cb5006052aaf107af6d879e8b4` | 完成脚下 3×3 mesh 后的早帧，NPC 脚下无天空洞                         |
| `evidence/web-node-02-moving.png`     | `f14ed4181f833a42bea70028160713d67c0f190f7f009bf76c46fc54ebf070dd` | 同一 Pointer Lock 流程移动中帧                                       |
| `evidence/web-node-03-turned.png`     | `048848832005298e359ff2b45086c7317eb05092f8410aa794d6eae9a61ac03f` | 同一流程相机转向帧                                                   |
| `evidence/web-node-04-placed.png`     | `55e5f5fd30389e06e66c55d43b4e08bd10a3886caed6b7c312a16277bf38fe7d` | 对应 revision 网格完成后的可见泥土方块                               |
| `evidence/web-node-05-restarted.png`  | `b8aef969f8a659eb83d44a8d5f325a9270a3fc0ddae69cfa3676c4aca0465c1e` | Node 重启恢复后的真实画面                                            |
| `evidence/web-node-playable-run.json` | `9ddcbb5fd100d31fb79648731012a16679a63c3dcc648f4426869ac09e7d9647` | 原始 Authority/镜像、jump、挖放、durable、重连/重启和 source binding |

JSON 经 Prettier 格式化后内容未变，表中为最终提交文件 hash。

## 回归门禁

- `pnpm verify:static:ci`：退出码 0；244 个文件通过、2 个 skipped，1236 项通过、4 项 skipped；line coverage 96.89%。首次运行只发现新生成 JSON 未格式化，执行现有 Prettier 后完整重跑通过。
- `pnpm build:web`：退出码 0；Svelte/TypeScript 和 Vite 生产构建通过。
- `pnpm build:server`：退出码 0；Node 5 入口构建通过。
- `pnpm verify:node-isolation`：退出码 0；隔离目录没有 Web 源码、未复用根 `node_modules`、未发现 Web 产品依赖。
- `pnpm verify:web-node-playable-dist`：退出码 0；仅 dist 真实 listen+hello 通过。
- `pnpm test:e2e:regression`：退出码 0；既有 Chromium 15 项通过。该命令改写的 Delivered loading 截图已用 Git 恢复，未提交历史证据变化。
- 删除现成 `apps/node-server/dist` 后单独运行真实 WS 与 offline runtime 两个测试文件：5 项通过，证明默认 static/coverage 不依赖工作区遗留 dist；临时 source artifact 在测试 teardown 删除。
- 独立 Terra/high 对 `ae8a49f` 的 source binding、五张原帧、WASD/jump/挖放/durable/reconnect/restart 与 5 个关键测试文件 13 项复核通过（7.80 秒）；root 持有独立报告，最终 CI 终态由 root 收口。

## 剩余边界

- 当前只支持本机 loopback、一个 Node 世界和一个玩家控制租约；需要手动重连。没有账户、多玩家、局域网/公网、TLS/WSS 或自动重试。
- `experimental-local-c0-v1` 仍是实验合同，不是 N2–N4 正式 wire/codec 采用结论，也没有网络性能收益声明。
- 保存只承诺已收到 checkpoint receipt 的 durable 状态；关闭页面本身不保证最后一个未知结果动作已经落盘。浏览器旧存档不会自动导入 Node 数据目录。
- M3 的最终独立报告入库、最新 GitHub CI 终态与 PR ready-for-review 由 root 完成；PR 不自动合并。
