# 客户端远端会话最小接线梳理

## 结论与边界

当前浏览器把 `BrowserAuthorityClient` 当作 Worker 端口适配器使用。N4 后应把它下方替换为已认证的远端会话适配器，而不是把 `AuthorityRequest`、Worker 控制命令或计算候选直接发送到网络。N0 的公共数据投影仍是草案，N2 的 28 条候选语料只证明该草案的 codec 保真，不表示玩家旅程已具备所需数据。

最小公共会话应向 app/client 暴露：连接生命周期、权威 welcome/基线、持续输入、有限 gameplay action、Chunk 订阅与基线/增量、commit/回执、可观察失败和断开。网络端必须显式禁用本地 Worker 才有的启动世界、暂停世界、任意编辑、管理员命令、客户端 canonical/Fluid/Logic 结果上传、持久化载荷和 `terminate()` 语义。

## 真实调用点

| 调用点                                                                                                                         | 现有用途                                                                                                 | 远端 Node 会话应支持                                                                                                 | 网络模式必须禁用或改写                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/app/game.ts:123-199`                                                                                                      | 以 `startBrowserWorkerSession()` 创建权威、计算、Logic，使用 ready 初始化相机、世界、HUD 与玩家。        | `connect()` 后交付 welcome、完整初始基线和 `ready`；只在校验通过后创建 `World` 与 `BrowserGameplay`。                | 浏览器不得发送 seed、legacy snapshots、初始 world time、频率或 `start-authority`。这些是本地开世界参数。                                      |
| `src/app/browser-worker-session.ts:40-117`                                                                                     | 本地将浏览器 compute/Logic 与 Worker Authority 双向编排；可生成 canonical Chunk、提交 Fluid/Logic 候选。 | 远端只保留浏览器的 mesh 计算资源；服务器自行运行 Authority、Fluid、Logic 和 bootstrap。                              | `onAuthorityChunkNeeded`、`acceptWorkerCanonical`、`commitFluid`、`failFluid`、`sendLogicIntents`、`requestLogicObservation` 不进入玩家网络。 |
| `src/client/authority/browser-authority-client.ts:182-192, 313-347`                                                            | 输入、暂停/恢复、world edit、action、命令、时间和保存。                                                  | 只保留有期限连续 input、可靠 edge、有限 gameplay action、显式 checkpoint 请求/结果。                                 | `world-edit`、`set-player-position`、`server-command`、`set-world-time`、`set-world-clock-rate` 均不是玩家网络 API；保存不能含路径或数据。    |
| `src/app/world/world-runtime.ts:40-77, 109-129`                                                                                | `WorldAuthorityPort` 提供 Chunk 准备、collision 查询、fluid、编辑与 worker-first mesh 输入。             | 支持兴趣订阅、取消订阅、已校验 Chunk baseline/delta、revision、`getVoxel`/fluid collision mirror 与本地 mesh 输入。  | 远端客户端不调用 `editWorld` 迁移、`acceptWorkerCanonical` 或把 mesh/canonical 结果返送权威；mesh 只在本地表现层。                            |
| `src/app/player/player-controller.ts:196-284, 394-423` 与 `src/client/local-player-prediction.ts:82-209`                       | 采样输入、本地物理预测、带 revision vector 的重放、权威修正与中性输入。                                  | 输入 sequence、target physics tick、ack、权威 body、ground/fluid、collision revision vector、`inputResyncRequired`。 | 不把预测 body 当作权威更新上传；未知/落后 collision baseline 时等待/重同步，不能用旧 world 重放。                                             |
| `src/client/authority/browser-authority-client.ts:426-511`                                                                     | epoch gate、snapshot/gameplay/commit、请求关联和 fatal 清理。                                            | 所有入站均携带 server epoch、session id、request/transaction id 与适用 revision；welcome 后才接收基线。              | 旧代次、错误 session、未请求 response、回退前连接的消息直接丢弃，不能重新进入 playing。                                                       |
| `src/app/application-shell.ts:27-78`、`src/client/shell/shell-controller.ts:36-75`、`src/app/ui/shell-overlays.svelte:135-160` | 启动、暂停、保存退出、错误反馈与 Svelte 菜单。                                                           | 显示 connecting/authenticating/syncing/playing、断连、重试、最后 durable checkpoint 和“仅断开”。                     | 不能把本地 `pause-authority` 映射为暂停远端共享世界，也不能以关闭 socket 代替服务器 terminate。                                               |

## 必须保留在浏览器的镜像与 mesh-only 计算

`WorldAuthorityPort` 的远端版本只应是客户端镜像端口：它保存已验证的 Chunk canonical/fluid/overlay 与 revision，供 `VoxelCollisionWorld`、`LocalPlayerPrediction` 和 `World` 查询。`prepareWorkerInput()` 给现有 `MeshTaskScheduler` 的 canonical/fluid/overlay 数据仍在浏览器本地使用；PlayCanvas mesh、GPU 资源、water transition、音频、HUD、相机和实体表现继续留在 app/client。

服务器发送的 Chunk baseline/delta 与 commit 必须先通过长度、hash、schema、world/session、前序 revision 和因果屏障校验，再原子更新 collision mirror，随后触发 remesh。客户端 mesh 结果不回传服务器。`releaseChunkNeighborhood()` 只能取消客户端兴趣/释放缓存，不允许释放服务器 canonical 状态；服务端按自己的 resident/Fluid/physics 规则管理权威驻留。

## 暂停、隐藏与保存退出

本地当前 `Game.setPaused()` 会调用 `authority.pause()/resume()`（`src/app/game.ts:302-315`）。远端模式的菜单、Esc、pointer unlock、打开设置与 `document.hidden`（`src/app/application-shell.ts:55-78`）只应：立即发送一次中性 input、清本地按键/连续破坏、暂停本地预测/表现与声音；服务端世界仍 tick，且以输入租期超时兜底。`PlayerController.releaseInput()` 已有中性输入路径，远端 adapter 应保留它。

“保存并返回主菜单”不能沿用浏览器存档语义：客户端请求一次合并的 checkpoint，展示服务器报告的最后 durable checkpoint；成功后再断开。失败时 UI 提供重试或明确“仅断开”，不声称保存成功。普通远端断连不触发本地同 seed 世界，也不自动重发未确认 craft/place；其状态是 `OUTCOME_UNKNOWN`，重新连接后读权威状态。

## 旧 epoch 与资源清理

远端会话转换先递增 client transition id，关闭旧写通道并拒绝其晚到 welcome/snapshot。随后清空 `BrowserAuthorityClient` 请求表、mesh/preparation cache、collision revision guard、预测 pending frames/offset、实体插值和 UI 请求状态；销毁/重建本地 Logic 客户端中不再需要的权威通道。新进程 server epoch 与恢复/传输 fallback 都要求新的完整 baseline，不能混用旧 Chunk revision 或预测输入。

现有 `dispose()` 会 `worker.terminate()`（`browser-authority-client.ts:374-385`），因此远端适配必须拆出“关闭本地 adapter 和 request registry”与“发送远端 disconnect”两条路径。旧连接的 `close()` 永远不能请求 Node 停止世界或释放其他玩家资源。

## 当前 wire 草案尚缺的旅程数据

N0 的 input、pose、delta 等投影不足以直接替换当前 Worker 契约。至少还缺以下版本化 DTO/行为：

1. welcome：server epoch、session/player/world id、seed 与 generator/content/physics/fluid schema、频率、能力/大小限制、初始 checkpoint、初始 snapshot/gameplay 和基线开始条件。
2. player correction：完整权威 body、ground/fluid、physics tick、ack input sequence、`inputResyncRequired`、完整 collision revision vector；缺项时不能安全重放预测。
3. gameplay view 与 action result：玩家状态、库存/配方、实体表现所需视图、可靠 transaction receipt、commit/durable sequence 与失败/未知结果。
4. world stream：Chunk baseline、fluid、overlay、delta、content hash、revision/`previousRevision`、commit index、重同步和取消；它们与 mesh/collision mirror 的接收顺序必须明确。
5. 会话故障与生命周期：认证/版本拒绝、backpressure/resync、心跳/超时、fallback、disconnect、重连 token 的范围，以及可呈现的失败原因。

## N4 后的实施与测试顺序

1. N4 固定 codec、传输、版本、消息资源限制和 fallback 后，定义一个不依赖 DOM/Worker/Node 的客户端会话端口；先让现有 Worker adapter 实现它，再新增 network adapter。
2. 将 `Game.start()` 分为本地世界与远端连接装配；远端 welcome+完整 baseline 后才安装 controller/HUD，移除 client-to-authority compute/Fluid/Logic 上传。
3. 用新镜像端口接 `WorldAuthorityPort`、prediction、Chunk streaming 和 mesh scheduler，加入 epoch/transition 清理与远端菜单行为。
4. 最后接 Svelte 连接/断连/保存反馈，保持口令仅会话内存，不放 URL 或 localStorage。

现有入口应扩展而非由 fixture 替代：`tests/client/browser-authority-client.test.ts`、`tests/client/authority-collision-mirror-client.test.ts`、`tests/client/authority-input-transport-integration.test.ts`、`tests/client/local-player-prediction.test.ts`、`tests/client/shell-controller.test.ts`、`tests/app/world-authority-boundary.test.ts`。N4 后新增当前 change 的 Playwright 用例覆盖远端 welcome → 基线 → 输入/修正、隐藏中性输入、断线/旧 epoch、保存失败/仅断开与 WSS fallback；Midscene 验收连接、同步、断连和保存状态文案。fixture 28/28 只可作为 codec 单元证据，不能替代以上真实旅程。
