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
- 首次可操作门槛按 Authority 玩家脚下层的 3×3 Chunk 完成 mesh 后结算；仓库落表代表 mesh 任务完成，合法空 mesh 不会因 `triangles === 0` 卡死。精确 y=32/64 边界使用既有 `COLLISION_EPSILON` 选择脚下层。`4cf859d` 在完整半径流送前先排这 9 个 interactive 请求，并允许已排队的同 key 原位升级；其它高度层随后继续流送。

## M2 完整游玩与异步资源

- `51e97fa` 完成真实输入、跳跃、挖放、Node 保存、离开/断线、手动重连和重启恢复；`ef71bfb` 将运行证据绑定源码；`7191c06` 增加真实 WebSocket 负向与无连接 tick；`e1d7ab3`、`331fea0`、`ae8a49f` 收敛 pending/cancel/revision/首屏地层边界。`7da861a` 将正常 60Hz 采样压成单一在途与单一 latest，`9ef0982` 拒绝旧输入回执解锁新代际，`4cf859d` 收敛单 Worker 首屏排序。
- Node 把每个新连接从 0 开始的输入、edge、action 与 capture 身份映射到进程内持续单调序号；断线立即清输入并取消连续破坏。旧连接 cleanup 不能清除新连接输入，未知动作不自动重发。
- baseline 请求最多 32 个，checkpoint 只允许一个 durable 写入在途，输入 RPC 最多 32 个在途；action、发送字节、socket buffered amount、baseline 在途字节和全消息/action 速率分别有界。重复/过期 requestId、超空间 interest、协议错误或反压只关闭该连接。
- 受控测试覆盖 capture 永不完成时 session drain 和真实 network listener 都能关闭、真实 capture 被取消、迟到 completion 不发送；分页测试在 first page 后注入新 commit，再送 last page，旧 bundle 被拒绝并可重抓。正确 Authority-complete Worker lease 发出后若 commit 使 owner 失效，原任务结果也被拒绝。

## 冻结源码与真实旅程

- 合并新 base 后的完整真实旅程冻结提交：`04a80763c5e723a6fb01d23fc9856f6fcd9a70be`，其父 `b0a5a1d` 是 PR #17 与新 base `21d6e37` 的普通 merge。旅程开始时 `git status --porcelain` 为空；JSON 中 `sourceTreeStatus` 为 `""`，并记录 29 个网络、首屏、输入、实际 Node dist、appearance 装载、地形/物品/UI 资源与 E2E 输入的 SHA-256。
- 命令：`pnpm test:web-node-playable`，退出码 0。Node 从冻结源码重建 5 个 ESM 入口；Vitest 11 个文件、34 项通过；真实 Chromium 1 项通过，20.2 秒。该耗时只表示功能测试完成，不是性能样本。
- 同一 Pointer Lock 流程中，初始 Authority tick 215，脚下层 3×3 均已有 rendered revision，初始 loaded/rendered/ready baseline 为 9/9/9；WASD 移动后转向，跳跃从 y=18 到 y=18.708333 且峰值 `onGround=false`。
- 左键挖掘使 world revision 从 1 到 2；真实拾取并切换 hotbar 后右键在 `[-1,20,-2]` 放置 voxel 2，world revision 为 3，collision chunk revision 与 rendered revision 均为 2 后才截图。
- 保存返回菜单后关闭页面，重新连接仍是同一 server epoch，Authority tick 从放置后的 720 增至 850 且方块仍在。停止日志给出 `durableCommitSequence: 1052`；同数据目录重启后 server epoch 改变，ready 日志从 durable 1052 恢复，方块仍在。无连接持续 tick 另由直接读取 `runtime.authority.latestSnapshot()` 的 Node 集成测试证明，不依赖公开调试 RPC。

### 原始证据

| 文件                                  | SHA-256                                                            | 作用                                                                |
| ------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------- |
| `evidence/web-node-01-early.png`      | `0e71a9f51ded2d9fa2b6373f428b74cdf20c56b99d776098062626c082d9c85d` | 合并后 appearance 生效且完成脚下 3×3 mesh 的早帧                    |
| `evidence/web-node-02-moving.png`     | `b2f4b18f46458f5c70c5a9cfb86e5bcbe9d90dafb88249444a22b51d34413736` | 同一 Pointer Lock 流程移动中帧                                      |
| `evidence/web-node-03-turned.png`     | `ebc8aae19394daeb04d4ac7a2208e2b4a6a3d8197b424a67f46bcabb9447f4a6` | 同一流程相机转向帧                                                  |
| `evidence/web-node-04-placed.png`     | `80961e347b5769a83f6311458c407e50c4b07b7f161fa4cc5d04e13f94fcf7d9` | 新地形外观下对应 revision 网格完成后的可见泥土方块                  |
| `evidence/web-node-05-restarted.png`  | `da2342f7f3a3bb277b3ccc7d19b298aedea27960d8de35d7ecd12ada0ff1a723` | Node 重启恢复后的真实画面                                           |
| `evidence/web-node-playable-run.json` | `1c4552cfbd2711651e2599699018bf14b5247e348074a56f4dfbb48ab001baf5` | 原始 Authority/镜像、jump、挖放、durable、重连/重启和 29 项源码绑定 |

JSON 经 Prettier 格式化后内容未变，表中为最终提交文件 hash。

## 回归门禁

- 合并新 base 后 `pnpm verify:static:ci`：退出码 0；260 个文件通过、2 个 skipped，1302 项通过、4 项 skipped；line coverage 96.89%。原始日志为 `/tmp/seedlands-web-node-playable/base-sync-static.log`。
- `pnpm build:web`：退出码 0；Svelte/TypeScript 和 Vite 生产构建通过。
- `pnpm build:server`：退出码 0；Node 5 入口构建通过。
- `pnpm verify:node-isolation`：退出码 0；隔离目录没有 Web 源码、未复用根 `node_modules`、未发现 Web 产品依赖。
- `pnpm verify:web-node-playable-dist`：退出码 0；仅 dist 真实 listen+hello 通过。
- `pnpm test:e2e:regression`：退出码 0；既有 Chromium 15 项通过且未改写历史 evidence。`pnpm test:pr15:integration`：退出码 0；合并 base 的资产包/外观应用 2 项通过。本任务仅验证合并后的 PR #17 接缝，不处理或修改 PR #15。
- 删除现成 `apps/node-server/dist` 后单独运行真实 WS 与 offline runtime 两个测试文件：5 项通过，证明默认 static/coverage 不依赖工作区遗留 dist；临时 source artifact 在测试 teardown 删除。
- 独立 Terra/high 对 `ae8a49f` 的 source binding、五张原帧、WASD/jump/挖放/durable/reconnect/restart 与 5 个关键测试文件 13 项复核通过（7.80 秒）；`4cf859d` 的新 source binding、`21d210b` 的最终 delta 和 CI 终态由 root 继续独立收口。

## CI 定时确定性修复

- `ae8a49f` 的 GitHub CI 在真实 WebSocket burst 用例偶发无法于第 181 条 heartbeat 关闭。产品 token bucket 的 burst 为 180、补充速率为 120/s；coverage instrumentation 处理消息超过约 8.34ms 时会合法补回一个 token，因此原测试把执行吞吐误当成纯 burst 边界。
- 本次只在 malformed 分支完成后、burst 连接建立前 mock `node:perf_hooks` 的 `performance.now()` 为 0，并以 `try/finally` 恢复。真实 listener/client、181 条消息、3 秒 deadline 和产品限额均未改变；该断言只验证零时间流逝下的 burst 计数，不作性能测试。
- 定向普通模式：`pnpm exec vitest run tests/node/node-playable-network-integration.test.ts --maxWorkers=1`，1 文件 4 项通过，3.87 秒。
- 单文件 coverage instrumentation 下同样 4 项通过；该窄命令因只加载一个文件而不满足仓库全局 80% coverage 阈值。随后运行 package.json 登记的 `pnpm test:coverage:ci`，244 文件通过、2 skipped，1236 项通过、4 skipped，line coverage 96.89%，退出码 0。
- 这是测试时钟确定性修复；生产源码仍为 `ae8a49f`，真实旅程和 evidence source binding 无需重跑或改写。

## 正常输入背压与首屏排序修复

- CI `34201850621` 的受控日志显示正常 idle 输入约 60Hz 直发，在慢 Authority 超过约 0.53 秒时碰到 Node 的 32 pending 安全门并以 4003 关闭。RED 中 65 次采样产生 65 条 wire 输入、Authority 同时收到 32 条；Node 的恶意 raw WebSocket 33 条拒绝用例仍通过。
- `7da861a` 增加单一在途和单一 latest 槽，只在真实发送时投影 tick/expiry，并在原 500ms 租期内保留一次合并 jump；匹配 decision 才解锁。`9ef0982` 的补充 RED 证明旧 `sequence=9 requiresResync=true` 曾清掉当前队列，修复后旧/未知 decision 不触发 callback，也不解锁当前序号。
- CI `34204391543` 证明输入 pending 关闭已消失，但三次都在脚下 3×3 的 30 秒门槛超时。Medium 的 50 key、单 Worker、Node baseline 串行排序中，旧顺序最后一个必需角块约为第 17 项；等待本身不会提升已请求 key。
- 首屏排序 RED：单槽受控慢准备夹具中，前九项混入 y=1 普通 streaming；以每 bundle 2 秒的功能故障模型，旧最后必需项超过 30 秒。`4cf859d` GREEN 后脚下 9 key 均在前九项，模型结算为 18 秒，第十项继续普通流送，请求总数不增长。合法空 mesh、y=32/64、取消和诊断 callback 抛错仍通过。
- Terra 复核指出旧合法空 mesh 测试预先 resolve 了 `waitForFirstVisible`，会掩盖“9 个必需块全空且其它块也无三角形”时的死锁。新增 RED 在永不 resolve 的 first-visible 下 25ms 内失败；`21d210b` 移除远端专用路径的该前置等待后，3 个相关文件 22 项、完整 typecheck 与 ESLint 通过。本地入口仍调用独立的 `waitForInitialVisibleChunk`，普通 mosslight 完整旅程不受此分支改动，按独立审阅约定未机械重跑。
- Harness 模式的 30 秒失败现在输出只读 JSON：必需/已完成数、queued/preparing/failed/meshing 和 upload 计数；不包含 key、口令、frame 或内部管理入口。诊断自身失败也由 `finally` 保证原超时错误结算。

## CI 首屏超时定位

- `4cf859d` 的 CI `34207971935` 三次都在远端首屏 30 秒门槛失败；超时聚合均为总请求 50、已完成 7、preparing 1、queued 42，failed/meshing/upload 均为 0。该证据说明脚下 3×3 的优先顺序已生效，但第 8 个 baseline 的准备没有在预算内结束；此前 2 秒故障夹具只验证顺序，不证明真实 CI 吞吐。
- 当前诊断 checkpoint 只为 Harness/E2E 打开：Node 对前 12 个 baseline 请求、最多 96 条事件记录匿名 ordinal、tail 等待、capture、projection、send 的耗时与结果，以及实际 page count/bytes；Web 只保留首 9 个匿名请求的 descriptor 到达、期望/已收页数、字节数与 ready 耗时。字段不含 chunk key、requestId、口令、口令文件或 frame，回调异常不影响网络会话。
- 本地可玩闭环和 `4cf859d` source-bound 旅程已通过；GitHub CI 的初始同步超时仍是 Active 产品问题。本 checkpoint 用下一轮一次失败还原第 8 个请求停在 capture、projection、发送或浏览器重组中的哪一段，再据证据做有界修复；没有改并发、baselineTail、协议、Node 预算或 30 秒门槛。
- 定向验证：`pnpm exec vitest run tests/node/node-playable-network-session.test.ts tests/client/remote-authority-mesh-mirror.test.ts tests/app/world-initial-playable-area.test.ts --maxWorkers=1`，3 文件 14 项通过；Node/Web typecheck、受影响文件 ESLint/Prettier、`pnpm build:server` 与 `pnpm build:web` 均退出 0。Node 测试连续排入 20 个 unavailable baseline，确认只记录前 12 个且总数不超过 96；Web 测试完成真实 descriptor/分页重组后再排请求，确认只保留前 9 个匿名状态且字段不含 key/requestId。
- 合并后的诊断 CI `34211532822` 将方向进一步收窄到浏览器收到 descriptor 后的 page 消费/重组：Node 后续请求 capture 为 13–68ms、projection 为 4–15ms、send 为 4–18ms 且均已发送 54 页；Web 前几个 descriptor→ready 约 1 秒，第 7 个增至约 5–10 秒，第 8 个在超时前只处理 12/26 页。该证据不支持把问题归因于 Node capture/tail，也不支持未经测量改并发或串行 hash；下一步只补 Web arrival/verification 和 reassembler 汇总诊断。
- 最后一层 Harness 诊断在 `acceptPage` 的 await 前记录 arrivalPages/arrivalBytes 与 first/last arrival elapsed，在 reassembler 返回后记录 verifiedPages/verifiedBytes 与 last verification elapsed；timeout 同时汇总 activeBundles、digestingTransfers 和 reservedBlockBytes。记录仍限于首 9 个匿名请求，不输出 key、requestId、bundle identity 或 frame。受控 RED/GREEN 在首个真实 page Promise 未结算时观察到 arrival=1、verified=0、activeBundles=1，再完成全部真实分页并观察 ready 与账本归零；2 文件 10 项、Web typecheck、受影响 ESLint/Prettier 通过。
- CI `34213458251` 显示 arrival 与 verified 完全一致、两者只差约 0.1–0.5ms，digesting 为 0；Node 已发送的 page 在进入 mirror 前逐步变慢。当前不据此断言 GPU 根因。已固定非生产单轴实验：真实 Chromium/Node/seed/viewport 下 A 连续绘制，B 仅 loading 阶段以 `autoRender=false` 和每 100ms `renderNextFrame` 降低绘制频率。实验仍要求脚下 9 个 key 经 rendered revision、恢复连续绘制、真实最终帧与 SwiftShader renderer readback；正式 `AAABBA` 和停止线记录在 `render-contention-experiment.json`，由原生 CI 在原门禁之后独占 benchmark window 执行，Terra 以 `seedlands-performance-validator` 身份复核冻结合同、运行身份、原始结果与准出，root 通过已授权 push 触发。结果另存 `/tmp/seedlands-web-node-playable/render-contention/`，不覆盖正式五帧和旅程 JSON。
- 为保证正式采样的 clean preflight，原远端旅程和 loading regression 增加 CI 专用输出目录环境变量，默认路径仍保持历史交付行为；未改写旧图片或断言。正式 runner 在写 invocation 前拒绝任意非空输出目录，并把独立验收合同纳入 sourceInputs。probe 同时观察真实 Application destroy 与产品错误：ready、认证失败、连接关闭或手动 release 都先恢复连续绘制并请求真实 postrender；每个 B（包括失败样本）的恢复状态与 finalPostrender 时间进入原始结果。
- 实验每个 trial 都使用独立空数据目录和新 Node 进程，同一浏览器进程只复用启动成本、每次新建 context；不跨样本复用 canonical、tick、存档或 Node 缓存。本地非计时自检以两个真实 B 会话覆盖成功和产品认证失败：成功侧 GL 回读为 ANGLE SwiftShader、required rendered=9、`autoRender` 恢复后发生 postrender且最终帧完整；失败侧在 Application destroy 时立即恢复 `autoRender`、清 timer并记录 terminal=failed、finalPostrender=null、unavailable=`application-destroyed`，没有强行 render。记录在 `/tmp/seedlands-web-node-playable/render-contention-selftest-4008f2f-failure/`。该自检发生于后续小修工作树，只证明 probe/清理/画面语义，不是冻结样本或性能结论。

## 剩余边界

- 当前只支持本机 loopback、一个 Node 世界和一个玩家控制租约；需要手动重连。没有账户、多玩家、局域网/公网、TLS/WSS 或自动重试。
- `experimental-local-c0-v1` 仍是实验合同，不是 N2–N4 正式 wire/codec 采用结论，也没有网络性能收益声明。
- 保存只承诺已收到 checkpoint receipt 的 durable 状态；关闭页面本身不保证最后一个未知结果动作已经落盘。浏览器旧存档不会自动导入 Node 数据目录。
- M3 仍需先定位并修复 GitHub CI 的初始同步 30 秒超时，再由 root 完成最终独立报告、最新 CI 终态与 PR #17 ready-for-review。PR 不自动合并；PR #15 的冲突和 main 整合由用户在另一台设备处理，本任务不改动 #15，#17 保持现有 base。
