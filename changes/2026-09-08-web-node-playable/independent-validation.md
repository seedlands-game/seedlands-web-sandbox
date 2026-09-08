# Web/Node 可玩闭环独立验收（首轮源码与测试设计）

审阅对象：`51e97facf8ec1e736ee5f9b1c9bac87642eb6550`（功能冻结）。

审阅时间：2026-09-08。范围为合同 `validation.json` 的首轮静态源码、测试设计和现有原始产物检查；未运行浏览器或全套命令，未读取 `.env` 或凭据，未修改仓库内容、索引、提交或远端。

## 源码审阅结论

### protocol：静态通过，仍待最终负向实证

- `network-c0-codec.ts:99-118` 在解码时按消息方向调用 `isPublicInboundMessage()`；因此 Node 在 hello 前的 `decoded.message` 虽作局部类型投影，实际已由严格字段 allowlist 验证。`session-hello` 需精确 draft version、transport、非空且最多 256 字节的 access key（`network-message-semantics.ts:271-281`）。
- `node-playable-network-server.ts:73-107` 精确校验 Origin 与 `/seedlands`，限制未认证升级数，禁用 permessage-deflate，限制 frame；密钥使用长度相同后的 `timingSafeEqual`。认证后用 `active || attaching` 排他拒绝第二连接（:107-137）。
- `node-playable-network-session.ts:202-255` 把动作按 requestId 高水位与 256 项 receipt 窗口去重；输入、interest、取消、checkpoint、heartbeat 均只接受公开消息。入站/发送/基线预算及关闭路径分别位于 :112-167、:324-351。
- 仍没有以该 SHA 绑定的真实 WebSocket 负向结果，故 Origin/key/version、第二连接、非法/超限 frame、发送失败后 world tick 持续、重复动作/interest 及关闭清输入，均为最终定向复验项，当前不能标为实测通过。

### authority：静态通过，因果与取消的旧 P1 已有针对性实现

- 远端启动走 `RemoteAuthorityClient.connect()` 与 `startPlayableWorkerSession()`；远端 authority 明确是 `meshInputMode = 'authority-complete'`，禁止 browser `pause/editWorld/setPlayerPosition/setWorldTime/command`（`remote-authority-client.ts:48-95, 280-321`）。`World` 仅在该模式从 `prepareCompleteWorkerInput()` 接收完成的权威主块/26 halo，再把 task/result 的 chunk、halo、generator identity 交给 `acceptDerivedMesh()`（`world-runtime.ts:118-151`）。因此审阅范围内未发现远端启动 Browser Authority、Logic、Fluid 或 canonical 生成的路径。
- `RemoteAuthorityMeshMirror` 在 descriptor 记录 27-entry owner，在 commit 到达时维护每 chunk revision watermarks，标记已落后的 owner；完成 bundle 时拒绝 descriptor 后已过期的 baseline（`remote-authority-mesh-mirror.ts:183-260`）。这为 Node baseline 页与后续 publication 的 socket 交错提供消费者侧 revision 屏障，避免旧页覆盖新 revision；缺口会失败并触发调度层重试，而非浏览器生成回退。
- `node-playable-network-session.ts:100-167, 324-351` 的 `closedSignal` 参与 baseline promise race；close 会取消已分配 capture。`whenDrained()` 等待的 tail 因 close signal 可及时结算。因此先前检查点中“关闭无限等待 capture”的具体调用链在此 SHA 已被修正。最终仍须用可控阻塞 capture 的真实 server/socket 用例证明 HTTP listener 在预算内关闭，且迟到 descriptor/page 不可送达。

### journey：测试设计覆盖完整流程，现有 artefact 不可归因于冻结 SHA

`changes/2026-09-08-web-node-playable/e2e/web-node-playable.spec.ts` 已设计真实 UI/Pointer Lock、WASD、转头、jump、左键挖掘、右键放置、保存 durable stop、关页后 tick、手动重连与 Node 重启恢复的单一顺序流程（冻结版本 :174-321）。其检查镜像已放置体素、chunk revision 与 rendered revision 对齐，未走管理 edit RPC。

工作树已有五张截图及 `web-node-playable-run.json`，但该 JSON 的 `sourceSha` 是 `8cd0868...`，早于本冻结 SHA，且当时没有逐源文件 hash/工作树状态绑定。因此它只能说明早期流程曾成功，不能作为 `51e97fa` 或后续冻结的验收证据。当前 HEAD 已新增待提交的 E2E source binding 改动；最终验收必须使用实施者给出的最终冻结 SHA 和同次原始 JSON/hash/帧。

### regression：待最终冻结执行

本轮未执行 `verify:static:ci`、`build:web`、`build:server`、isolation、专项 E2E 或 CI，因为工作树此时已有后续未提交 E2E/source-binding 改动，结果不能归因于 `51e97fa`。CI `34194141726` 由 root 监控，未重复轮询。

## 完成状态

首轮静态审阅完成；没有发现阻断性的、可在 `51e97fa` 直接复现的新源码缺陷。不能以此宣布完整验收通过。

## 提交和推送

无。未修改 Git index、提交、push 或 PR。

## 变更

仅新增本临时独立验收报告：`/tmp/seedlands-web-node-playable/independent-validation.md`。

## 验证结果

冻结 SHA 的协议 allowlist/认证、单 Authority 的远端入口、revision-watermark 基线结算、取消 drain 与 E2E 合同设计均已静态核验。现有早期浏览器 artefact 已检查但不具备本冻结源码绑定；不计为通过。

## 限制

尚未取得最终冻结 SHA、同次 source binding 原始记录、负向 WS/阻塞 capture 原始日志、最终 CI 状态，且按任务要求未抢占浏览器或重复整套验证。功能验证不构成性能证据。

## 剩余工作

收到最终冻结 SHA 后进行第二次有界验收：核对 E2E 的 source SHA、逐文件 hash 与洁净状态；检查早/中/转头/稳定放置/重启原始帧；执行或读取同 SHA 的定向 WS 负向、交错 revision 与 capture-close 测试；复核静态/两端构建/isolation、CI 及本地模式回归的明确输出，再回填准出范围。

## CI 34194141726 失败归因（有界只读复核）

CI 的 Static verification 与 Package builds 都在最先执行的 `pnpm ssg:check` 失败，异常完全一致：`Prerendered start screen is stale. Run pnpm ssg:update.`。两条脚本链分别为根 `verify:static:ci` 与 web `build`；因此这不是 lint/typecheck、Rust、Node 构建或浏览器回归失败，且两 job 不是两项独立根因。

根因可精确归属 `51e97fa`：该提交修改 `apps/web/src/app/ui/start-screen.svelte`，新增/变更远端模式的文案及 `data-remote-server-info` SSR 输出，但提交的 name-status 不包含 `apps/web/src/app/ui/generated/prerendered-start-screen.html`，该生成物与父提交完全相同。`apps/web/scripts/render-prerendered-start-screen.mjs` 以当前 Svelte renderer 生成 fragment，再对该已提交文件作字节相等比较；故 CI 拒绝的是应提交的生成快照遗漏。CI 的 `VITE_COMMIT_SHA=f7a7c...` 来自 GitHub pull_request 的 merge commit 环境变量，不是失败原因；执行的 checkout 源已由任务指定为 `51e97fa`。

最小修复交接：在实施者最终工作树中运行一次 `pnpm ssg:update`，只把生成的 `apps/web/src/app/ui/generated/prerendered-start-screen.html` 与已变更的 start-screen 源一并纳入该修复提交；随后在同一最终冻结 SHA 用 `pnpm ssg:check` 复核生成物，继续既定静态/两端构建/专项验收。不要改 CI、跳过 `ssg:check`，也不要手工编辑生成 HTML。此处没有运行 CI、浏览器或任何验证命令。

## 第二阶段：`e1d7ab3402d6a848b0ad812b77f6d8c1e5ca9331` 定向测试设计复核

### 已得到直接保护的范围

- `tests/client/remote-authority-mesh-mirror.test.ts:78-108` 分别让 commit 在 descriptor 前，以及 descriptor 后/最后 page 前到达。两例都断言 pending load 被拒绝、无 ready owner，前者还断言马上允许以新 requestId 重新请求。这直接覆盖 mirror 的 revision watermarks、`staleAtDescriptor` 与拒绝旧 capture 的路径（被测实现 `remote-authority-mesh-mirror.ts:183-260`）。
- 同文件 :111-139 断言 mesh result 必须匹配 task 的 chunk revision、halo revision、generator version，并包含 authority-complete/non-procedural 标记，能拒绝显式错误 identity 的 Worker 结果。
- `tests/node/node-playable-network-session.test.ts:124-162` 用不结算的 capture 驱动 `socket close`，断言 `whenDrained()` 不再等待它、captureId 被取消、迟到完成后不再写 socket。它正对 `closedSignal`、`pendingCaptures` 与 `createPlayableBaselineSender` 的早期取消检查。
- 同文件 :94-122 覆盖 checkpoint durable write 被阻塞时第二个请求被关闭，而非并发累积；`e1d7ab3` 中 `checkpointRequestHighWatermark` 加单一 pending 计数因此有可执行保护。
- `7191c06` 的真实 WebSocket integration 已覆盖 foreign Origin、错 key、第二客户端、重连后 input sequence 0、非法 C0、rate burst 后 Authority 仍 running；offline runtime 测试覆盖没有网络会话时 Authority tick 仍推进。它们由 `test:web-node-playable` 纳入。

### 仍需补齐的确定性缺口

1. 名为“paged bundle”的 mirror 用例实际 mock 的 `acceptPage()` 首次就返回完整 bundle，没有先到 page、再 commit、最后 page 的跨页状态。建议最小补一例：first page 返回 `null`，第二页才返回 bundle；descriptor → first page → commit → final page，断言拒绝、owner 不是 ready、后续 ensure 使用新 requestId。
2. Worker late-result 用例只篡改 haloRevision，并未验证“曾正确的 task lease 在 commit 后才返回”的情况。建议先 `prepareComplete()` 取得原 task/result，随后 `consumeCommits()` 使它过期，再提交未篡改 result，断言 `acceptMesh()` 为 false；这才覆盖 revision 失效后旧异步 Worker 结果不能被新 owner 接收。
3. capture-close 单测使用迟到的 `{ status: 'unavailable' }`，足以覆盖 capture await 后的 cancellation short-circuit，但仍没有真实 `createNodePlayableNetworkServer.close()` 的 listener 级预算证据。需要一个可控 fake lane + real WS test：interest 令 capture 卡住，关闭 socket/调用 server close，断言 close 在固定小预算内完成、`cancelBaselineCapture` 已调用，随后 resolve capture 后绝不输出 descriptor/page。现有 7191 real WS 测试没有 interest/capture 或 server close。
4. “全 handle 有界”尚不能标通过。`e1d7ab3` 仅给 checkpoint 增加 `MAX_PENDING_CHECKPOINT_REQUESTS = 1`；interest 为既有 32，action 为既有 256，浏览器 pending 为 64。`input-state` 仍可在 `await authority.receiveInput()` 期间持续进入未串行的 `void handle(message)`，没有 session 层 pending-handle 计数。实际 Node Authority RPC 有全 lane `maxRequests: 256` 的下层限制，因而生产 lane 会最终拒绝，但 session 本身没有独立且可测试的上限，fake/替代 authority 可让未结算 input handles 随时间增长。应明确决定把 256 lane cap 作为本合同边界并以真实 lane 证明拒绝/世界存活，或在 session 加共享 pending-handle count/bytes gate；两者之一必须有对应阻塞-input 测试。当前 checkpoint 用例不能代表所有 handle。

### 阶段结论

revision barrier、checkpoint pending 与 session-level close drain 的核心路径已有有效测试设计，尚不能据此宣称 revision 的真实分页/worker late result、server listener close 与所有 handle pending 均已验收。以上四项是最小补测或边界澄清，不涉及浏览器或全套复跑。本阶段未运行测试、CI 或浏览器。

## CI 34195454723 失败归因（`e1d7ab3`，有界只读复核）

根因与预判一致，且仅发生在 Static verification 的 coverage 阶段：新增 offline/runtime integration 测试把 worker entry 固定解析为 `apps/node-server/dist/*.js`，但 Static job 只执行 `verify:static:ci`，此前没有 `build:server`。因此 `createNodeServerRuntime()` 在启动 persistence worker 时找不到 `apps/node-server/dist/node-persistence-worker.js`。Package builds 已独立成功（其中 node-server build 与 isolation 均成功），Chromium regression 也成功；失败不是产品构建、浏览器或 Node runtime 行为回归。

`tests/node/node-playable-network-integration.test.ts:151` 的 `runtime.stop()` 是初始化失败后的 secondary teardown error：`beforeAll` 在创建 runtime 前已抛出，`runtime` 尚未赋值。它掩盖但不改变第一个“Cannot find module ... node-persistence-worker.js”的根因。offline test 的 `afterAll(() => artifact.close())` 若 fixture 自身失败也有同类二次报错风险。

最小修复范围：

1. 保持 Static job 不依赖先前 job 的 `dist`；这两个 runtime tests 应通过测试专用的临时、isolated Node artifact fixture 从当前 source 构建 authority/persistence/compute entries，并传入这些 file URLs。不要为静态覆盖门禁加入全局 `build:server` 前置，也不要把未提交 dist 纳入仓库。
2. 两个 fixture-owning suite 的 teardown 采用可选资源：`runtime`、`network`、`artifact` 初始化为 `null`/可选，只有已创建才 stop/close；data directory 非空才 rm。这样 fixture/build 失败时只报告原始启动失败，不再出现 `undefined.stop`/`undefined.close`。
3. fixture 应在每 suite 结束删除其临时 artifact，并沿用合成 access key/临时 data directory；不读真实口令。

本结论来自 CI 原始日志和 `ci-34195454723-result.json`：Static 1,228 passed、两个新 suite 因同一缺失 dist 失败；Package builds 与 Chromium regression 通过。未重跑 CI、浏览器或本地全套。

## 最终冻结 `ae8a49fd9f43c1e29b59a518e35473205eff3b08`：独立证据与定向复核

### Source 与原始旅程证据

- 当前 HEAD 与 origin 均为 `ae8a49f`；工作树除本次产出的未跟踪 `changes/2026-09-08-web-node-playable/evidence/` 外无改动。证据 JSON 的 `sourceSha` 为完整同一 SHA，`sourceTreeStatus` 为空。
- 已本地重新计算 JSON 所列八项 SHA-256，逐项相同：Authority worker、network session、实际执行的 `apps/node-server/dist/node-server.js`、game、远端 evidence、remote client/mirror 与本 change E2E。故这次浏览器证据绑定的是冻结 source 和实际 Node entry，不是早期 `8cd0868` 产物。
- 原始 JSON 记录真实远端 source、17 个 ready baselines/12 rendered chunks 的初态；WASD 后权威位置从 `[-3.5,18,-3.5]` 移至约 `[-0.62,18,-1.61]`；jump 峰值 y=18.91 并回到 onGround；挖掘使目标为 0，放置的 `[0,19,-1]` 类型 2 具有相同 chunk/render revision 2。
- durable stop 回执为 commit sequence 1110。关闭页后重连仍为同一 server epoch，physics tick 从 750 至 903，放置体素保留；重启后的新 epoch 从同一 data directory 读到 durable sequence 1110，world revision 3 与放置体素类型 2 仍保留。
- 已按同一输入流程审看五张 PNG：早期、移动、转头、稳定放置和重启后画面均为连续的远端森林会话；地表连续可见，放置帧可见被选中并呈现的泥土方块，重启帧为稳定地表。截图是视觉语义佐证，权威提交/持久化结论由上述浏览器 mirror、Node 日志和 E2E 断言共同支撑。

### 先前缺口的最终源码/测试复核

- `331fea0` 将 mirror test 改为由真实 baseline projection/reassembly 产生多页 bundle。它实际执行 descriptor → 首页 → commit → 余页，并断言 owner 不 ready 且请求拒绝；也覆盖 commit 在 descriptor 前时立即允许新的 requestId。无再以“单页即完整 bundle”替代分页。
- 同一 test 从有效 authority-complete lease 构造匹配 identity 的 result，在 commit 使 owner stale 后以同一旧 result 再提交并拒绝。消费者的 `state.stale`/release preparation 与 remote mirror 的 `owner.ready` 双重门禁都在此路径中被走到。
- network integration 现在通过临时 isolated source artifact fixture 构造 Worker entries，避免 Static job 依赖预先存在的 dist；teardown 只清理已初始化资源。它以真实 WS listener 阻塞 capture，断言 `blockedNetwork.close()` 完成、client 1001、capture cancel 调用，以及迟到完成无后续传输。offline runtime 同样使用 fixture，覆盖无连接时唯一 Authority tick 推进。
- `node-playable-network-session.test.ts` 新增 33 个阻塞 input RPC，断言第 33 个以 4003 关闭且只进入 32 个 Authority 调用；源码以 `MAX_PENDING_INPUT_REQUESTS` 和 finally decrement 实施该 session 边界。checkpoint、interest、action 与 client pending 的既有上限仍在，故此前“input handle 只靠 lane 256”缺口已关闭。
- `ae8a49f` 的 `waitForInitialPlayableArea()` 用 `floorDiv(y - COLLISION_EPSILON, 32)` 选择玩家脚下层，并只要求 repository 中有对应完成 chunk，不要求三角形数非零；`world-initial-playable-area.test.ts` 覆盖 y=32/64 两个边界及 empty mesh。这与本次早期原帧的稳定地层相符。

### 独立定向执行

已串行执行、未触发浏览器：

`CI=true corepack pnpm exec vitest run tests/client/remote-authority-mesh-mirror.test.ts tests/node/node-playable-network-session.test.ts tests/node/node-playable-network-integration.test.ts tests/node/node-playable-offline-runtime.test.ts tests/app/world-initial-playable-area.test.ts --no-file-parallelism --maxWorkers=1`

结果：5 files / 13 tests 全部通过，7.80 秒。该命令包含真实本机 WS listener 和临时 Node artifact fixture，不包含 Playwright 或全套 gate。

### 当前准出状态

本独立部分通过：冻结绑定、真实浏览器游玩/保存/重连/重启原始证据、原始帧审看、交错 revision、late Worker result、capture-close、input pending、isolated Node runtime 及初始地层边界均有相应源码与定向测试证据。

仍待 root 提供的最终完整门禁日志与 CI `34197432534` 终态，再把 regression/CI 项从“未由本 agent 复核”改为最终准出或明确失败范围。未把未到的结果标为通过，也未作性能声明。

## CI 34197432534 失败归因（冻结 ae8a49f；2026-09-08）

结论：Static verification 与 `test:web-node-playable` 均在同一真实 WebSocket 用例 `tests/node/node-playable-network-integration.test.ts:243` 失败；失败是测试的时间假设不成立，尚无证据表明服务端关闭或 Authority 隔离实现失效。`b6141c9` 只提交交付文档和 evidence，未改变这一源码或测试，因此不能以 ae8/b614 宣告 CI 基线或专项门禁已通过。

可复现原因：`apps/node-server/src/node/server/node-playable-network-rate-limit.ts` 的每条入站消息都从 `performance.now()` 计算 elapsed，并按 `elapsed * 120` 补充 message token；初始桶为 `inboundBurst = 180`。用例只发送 181 个 heartbeat。只要服务端逐条处理期间累计经过约 `1 / 120` 秒，补回的一个 token 就足以接受第 181 条，socket 保持开启，随后三秒关闭等待超时。这同时解释两个 CI job 的同一失败；它不是通过增加关闭等待时间可修复的问题。

最小确定性修复交接（Sol）：仅在该 burst 断言的局部真实 WS 路径导入 `performance`（`node:perf_hooks`），以 `vi.spyOn(performance, 'now').mockReturnValue(0)` 冻结时钟；`try` 内完成 `connect()`、`nextAuthorityTick()`、181 条 heartbeat 和预期 `{ code: 4003, reason: 'rate-limit' }`，`finally` 调用 `mockRestore()`。限流器每次调用都读取同一 `performance.now()`，故第一至第 180 条消耗初始 token，第 181 条确定关闭；仍经真实 listener、真实 ws 客户端和 C0 编码，且无需改生产限额、超时或跳过负向覆盖。应将 spy 放在 malformed 分支之后并置于 finally，以免污染同 Vitest worker 的其余用例；可加一句测试注释说明真实时钟会补 token。

本阶段未重跑 CI、全套门禁或浏览器，符合委托边界。

## 最终测试冻结 `f1d91162dc2d82e3d17e1f3ce664d9c9b10ca8a7`：CI 定时修复只读复核

通过。`f1d9116` 相对父提交只改动一项测试及 change 的执行/交付记录；没有 `apps/node-server/src` 或其他生产源码差异。测试在 malformed 分支成功完成之后才导入生效范围：它从 `node:perf_hooks` 取得同一 `performance` 对象，以 `vi.spyOn(performance, 'now').mockReturnValue(0)` 覆盖 burst 连接创建、welcome/tick 与 181 条 heartbeat 的时间读取，并在 `finally` 无条件 `mockRestore()`。

这精确落实了先前交接：限流器对每条消息动态读取 `performance.now()`，零 elapsed 下 180 个初始 message token 逐个消耗，第 181 条必走既有 `close(4003, 'rate-limit')`。真实 Node listener、`ws` 客户端、C0 二进制编码、关闭 deadline 和生产 `inboundBurst=180`/`120/s` 限额都未变；因此该修复消除了 CI 吞吐导致的 refill 竞态，未将产品逻辑、超时或覆盖期望放宽。spy 的 `try/finally` 边界也避免其泄漏到后续 capture-close 测试或同 worker 测试。

`execution.md` 记录实施者在此冻结后运行 `pnpm test:coverage:ci` 为 244 files、1236 passed、4 skipped、line coverage 96.89%、exit 0，另列 build、isolation、dist listen 和 Chromium 回归命令均为 exit 0；本 agent 按本阶段范围未复跑，故将其作为待 root 以 CI `34199427735` 独立收口的本地执行记录，而非独立 CI 通过声明。

最终独立源码/测试准出：通过冻结 source/evidence binding、五帧真实旅程审看、Authority/持久化重连重启链路、revision/capture-close/pending/initial-area 定向覆盖，以及本次限流测试确定性修复的静态复核。GitHub CI 最新终态仍由 root 外部核验；在该终态到达前，CI 回归项保留“待收口”。本报告不再等待或重复执行全套检查。

## CI 34199427735 Chromium 失败：base-path 归因与有界复现

CI 终态：`f1d9116` 的 Static verification、Package builds 和专项 Vitest（10 files / 23 tests）均成功；Chromium 的三次尝试均在首个 `connect()` 等待 `window.__seedlandsRemoteEvidence` 的 30 秒处超时。因此 CI 回归门禁仍失败，不能准出。

排除的假设：`page.goto('/?harness=1')` 在 `SEEDLANDS_BASE_PATH=/seedlands-web-sandbox/` 下确会收到 Vite 的根路径跳转，但最终 URL 是 `/seedlands-web-sandbox/?harness=1`，search 仍为 `?harness=1`，没有丢失 harness。以同一 base path、`CI=true`、独立端口、真实 `apps/node-server/dist/node-server.js`、Vite 和 Chromium 进行的轻量诊断中，等待 `#enter` enabled 后切换 remote、填写 synthetic key 后，`__seedlandsRemoteEvidence` 正常安装；最终页面为 playing、无 `start-error`、Node ready/stopped 正常。诊断记录、console、Node 日志和截图在 `/tmp/seedlands-web-node-playable/basepath-diagnostic.{json,png}`。

按授权又运行一次真实专项：`CI=true SEEDLANDS_BASE_PATH=/seedlands-web-sandbox/ SEEDLANDS_E2E_PORT=4195 pnpm exec playwright test changes/2026-09-08-web-node-playable/e2e/web-node-playable.spec.ts`，一项通过，24.0 秒。该命令是同 base-path 的可复现产品流程，包含连接、Pointer Lock、挖放、关闭重连和 Node 重启。它没有复现 CI 等待失败，故当前证据仅支持“CI/Linux 或瞬态条件仍未知”，不支持修改产品、Worker URL 或延长 30 秒等待。

最小诊断补丁交接（不改变成功路径或 timeout）：让 `connect(page, testInfo)` 在 `page.goto` 前注册局部 console/pageerror 收集；在 `waitForFunction` 抛错时，写入 `testInfo.outputPath('remote-connect-diagnostic.json')` 并 attach：最终 `page.url()`、pathname/search、`Boolean(window.__seedlandsRemoteEvidence)`、`#start-card` 的文本、`.start-error` 文本、`#enter` 的 visible/enabled 状态、console/pageerror 队列及现有 synthetic `nodeLog`（至少 ready/stopped）。同时 attach 一张失败时页面截图到 test output。不得序列化 password input 的 value、outerHTML 或 access-key-file 内容；现有 Node 输出不打印该 synthetic key。若这些记录证明服务端连接已建立又异常关闭，再以 Node 测试 listener 的 close code/reason 做第二步定向记录；在没有此证据前不扩大为产品日志或 timeout 改动。

本次真实专项按委托会改写 `changes/2026-09-08-web-node-playable/evidence/` 的五张帧和 JSON；完整副本已保存至 `/tmp/seedlands-web-node-playable/f1-basepath-e2e/evidence-after-run/`，测试输出在同目录 `playwright.log`。工作树当前该 evidence 目录为修改状态，并且运行 JSON 的 `sourceTreeStatus` 明确包含 root 预存的 `architecture-review.md` 修改和未跟踪 independent-validation；本 agent 未执行 git restore 或其他 Git 写操作。root 应定向恢复 evidence 后再继续，不应把本次诊断产物作为冻结证据提交。

## CI 34201850621 / `f33f541`：真实慢 Authority 输入积压根因与修复边界

已由三次 CI 脱敏诊断确认：base path 与 query 正确、无 pageerror、Node inline ready 正常；客户端主动 WebSocket close 后 start error 一致为 `Node 连接已断开：protocol:Too many pending input requests.`。这不是 connect timeout 根因。

源码因果链明确。`PlayerController.update()` 对每一次 prediction advance 的每条 command 调用 `authority.sendInput()`；`LocalPlayerPrediction` 以 physicsHz（远端为 60 Hz）采样，正常静止状态也产生递增序号。`RemoteAuthorityClient.sendInput()` 目前每次直接发送一条 `input-state`，没有在途计数或 latest 合并。Node `node-playable-network-session.ts` 对每条 input-state 异步 await `authority.receiveInput()`，保持 `MAX_PENDING_INPUT_REQUESTS=32`；慢 Authority 约 0.53 秒即可使正常首屏中性输入达到 32，下一条按既有恶意流量防护关闭 4003。CI 浏览器 GPU stall 与完整 baseline/mesh 初始化可使这个窗口稳定出现，和三次同点失败一致。

最小可验收 Sol 修复边界：只在 Web 的 `RemoteAuthorityClient` 增加 input-state 的单在途、单 latest-pending 背压。首条立即发；在该 `inputSequence` 的 `input-decision` 到来之前，将之后的预测 command 覆盖为一个最新 command，不再写 socket。收到匹配 decision 后清在途并发送最新状态；在发送的当下重新按当前 snapshot/elapsed 投影 target tick，并让被合并 command 的 jump edge 与其 state 一同发送，以免 edge 在长期积压时过期。`requiresResync` 时丢弃 queued 旧 state，保留既有 controller resynchronize，再由下一帧采样。dispose/fail 清空 in-flight 与 pending。Node 的 32 项 gate、所有公开协议和 compute 默认均不变；这给慢 Authority 的常规运行保持不超过一个 input RPC 在途，仍允许原始恶意 WS 客户端被 32 gate 关闭。

RED/验收测试：RemoteAuthorityClient 的可控 fake socket 在不投递 input-decision 时连续发送至少 64 个 prediction command，只观察一条 wire input-state；投递首条 accepted decision 后只发最后一个 sequence/state，第二次 decision 后无额外发送；测试 merged jump edge 与 flush state 使用同一重新计算的有效 target window；requiresResync 不会 flush 已缓存旧 state。保留 Node 现有 33 条 raw input-state 阻塞用例（仍为 4003、仅 32 次 Authority receiveInput）。再加一个受控慢 Authority transport/integration 场景：first receiveInput unresolved 时客户端产生超过 32 条预测输入，断言连接不关闭且 Authority 一次在途；resolve 后只最新 state 继续。这是运行时背压验证，不能仅修改首屏 E2E 或增加等待。

本阶段未写源码或测试，也未重跑浏览器/CI。
