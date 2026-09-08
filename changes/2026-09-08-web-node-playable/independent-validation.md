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

## `7da861a` 背压修复复核补充：旧 resync decision 缺口

定向验证已执行：

`CI=true corepack pnpm exec vitest run tests/client/remote-authority-client.test.ts tests/client/remote-authority-mesh-mirror.test.ts tests/app/playable-worker-session.test.ts tests/node/node-playable-network-session.test.ts tests/node/node-playable-network-integration.test.ts --no-file-parallelism --maxWorkers=1`

结果为 5 files / 17 tests 通过。静态审阅确认单在途/latest、jump 有效期、close/fail clear、真实 `createSession` 慢 Authority 夹具和保留的 Node 32 项 raw-client 防护均实际接线；其中 slow fixture 证明 65 条正常 client sample 只有一条 Authority RPC 在途，settle 后发送最后状态。

但发现需在最终准出前修复的真实旧结果缺口：`RemoteAuthorityInputPipeline.acceptDecision()` 当前在比较 `inputSequence !== inFlightSequence` 前执行 `if (requiresResync) this.queued = null`。因而一个旧/未知且 `requiresResync=true` 的 input decision 能丢弃当前新在途输入的 latest 槽。`RemoteAuthorityClient.receive()` 随后无条件调用 `onInputDecision`，还会令 PlayerController 对旧 decision 做 resynchronize。现有测试仅以 `requiresResync=false` 覆盖旧 decision，未捕获此分支。

最小修复：pipeline 应先匹配 in-flight sequence，未匹配返回明确 ignored 结果且不改状态；仅匹配时清 in-flight，匹配且 requiresResync 才清 queued。返回值需区分 ignored 与 matched-no-next，客户端只对 matched decision 调用 callback/可能 flush。新增 RED：发送 sequence 0/1，投递旧 sequence 9 的 `requiresResync=true`，断言 wire 仍仅 0、callback 未调用；随后匹配 sequence 0 accepted，断言 sequence 1 flush 且 callback 只收到 0。该修复不改变产品预算、jump 规则、Node 32 gate、E2E timeout 或 compute 默认。

因此 `7da861a` 的慢 Authority 背压主路径通过，但最终准出暂阻于此一个 old-resync decision 状态完整性缺口；未运行浏览器/全套/CI。

## CI 34204391543 / 599bf78：初始 3×3 远端可玩区超时（只读归因）

CI 的三次 Chromium 尝试均在首个远端连接 30 秒后停在产品错误“初始区块加载超时，请重试。”；页面仍在 /seedlands-web-sandbox/?harness=1，无 pageerror，Node inline Authority 已 ready，WebSocket 随启动失败关闭。故这不是 base path/query、输入 32 项 gate 或 Node 启动失败；输入积压错误已消失。专项 Vitest 在同一 job 为 10 files / 27 tests 通过，但不能替代这一真实 Chromium 首屏失败。

源码显示一个足以造成慢机超时的启动排序缺口：

- 三个浏览器性能档均设 maxWorkerTasksInFlight: 1。每个网格任务在派发 worker 前，scheduler 都 await beforePrepare 到 RemoteAuthorityMeshMirror.ensure；一个 baseline 未完整到达/准备前，后续 mesh task 不会开始。
- Node session 对每条 interest-update 用 baselineTail 串行执行完整 sender：capture、27-entry authority-complete projection、descriptor 和所有 page 发送完成之后，才发送下一 request。每个 mesh baseline 含 27 chunks；canonical+fluid 共 2,654,208 bytes（约 2.53 MiB），按 64 KiB pages 约 42 页。
- Medium 的首轮 updateStreaming 一次排入 2 × 5 × 5 = 50 个 mesh keys。初始可玩区方法没有请求或提升 9 个脚下层 key：它先等任一有三角形块 visible，随后只轮询 repository 的 3×3 是否已提交。scheduler 已有 key 时在早期 return，无法将 streaming 请求升级。
- Manhattan 排序并非随机：同距离的稳定顺序保留构造时的 y=0 在 y=1 之前。但仍不等于 3×3 bootstrap。最后一个脚下层角落在约第 17 个完整串行 baseline 后：y0 中心、y1 中心、四个 y0 cardinal、四个 y1 cardinal，再加 y0 distance-2 组中位于该角落之前的项。这里有八个非必要 bundle 在完整 3×3 前，慢 Linux/软件 WebGL 下可线性放大到 30 秒。

因此有“完整半径的常规 streaming 未给首屏 3×3 确定优先权”的真实产品缺口；目前日志没有每阶段计数，尚不能把本次三连失败归因成某一个瓶颈，更不能据此增加 timeout。

### revision/halo starvation 假设

该假设在源码层面可发生：mirror 接到 structural commit 时会遍历 owner 的 27-entry descriptor；任一 halo revision 高于 descriptor 时，会置 ready=false、staleAtDescriptor=true，而整 bundle 页到齐后拒绝并使 prepare 失败。随后 streaming retry 可以重新请求。

但本次没有 commit/retry 计数，不能声称它已经发生。远端 RemoteAuthorityClient.setFluidActiveChunks 目前为 no-op，所以 Web 的首轮 50 key 不会直接启动 Node Fluid active window；其他 Authority 初始 mutation 仍需用实际 commit telemetry 判定。该假设应作为待诊断分支，而非既定根因。

### 最小诊断与 RED 边界

不改变 timeout、compute fixture 或协议预算。将启动失败的 E2E 诊断增加一个脱敏、只读 initialPlayableProgress：

- required：center/9 个 key 的 repositoryReady、missing、firstVisible；分别列出/计数 queued、preparing、inFlight、commitQueue/attaching。World 已有 aggregate generation/meshing/upload queue gauge，但缺少 required-key 状态。
- remote：baseline request sent、descriptor received、page count/completed bundle、ready owner、pending owner，以及按 reason 的 unavailable/rejected/timeout/cancelled/retried。单列 required owner 的上述计数，才可区分“第 17 个 bundle 尚在等”“bundle 已齐但 worker/commit 未推进”“反复 stale”。
- revision：descriptors marked stale-at-arrival、commits invalidating active owners、page-complete superseded/rejected 的计数；可安全只输出计数和 chunk-key，不输出 access key/outerHTML。
- scheduler/commit：streaming priority 队列、preparing、worker in-flight、accepted-but-not-attached、repository attached；现有 telemetry queue depth 不能判断 required 9 个的位置。
- Node 若本测试已经持有 runtime，可从既有 readDiagnostics 读取 host 的 pendingBaselineCaptures、chunk request/compute diagnostics；不要给公开协议新加调试 RPC，也不打印 access key。E2E 失败日志可附 synthetic Node ready/stop 及该结构。

明确判定：required pending 而 descriptor/pages/ready owner 持续增加是正常慢进展；required descriptor/page 或 accepted-owner 重复但 stale/retry 持续增加才支持 revision starvation；ready owners 已足而 required repository/attach 无增量则转查 worker/WebGL commit budget。

最小行为修复应先有受控 RED：以可控慢 capture 或 baseline sender/mesh worker 断言 remote 初始 3×3 的九个脚下层 key 都在任何非必要 key 前进入 capture/prepare，且其 empty mesh 仍可通过 ready。然后以相同慢条件验证旧排序会把 required 最后角落推到该队列之后，而新排序在既有 30 秒契约内完成。

实现可选其一：

1. 在远端 start 前先只请求脚下 3×3，ready 后释放完整 radius；或
2. 更小的常规行为变更是添加明确 bootstrap priority，允许已排入的 streaming request 被 required 3×3 原地提升（当前 requested.has 的 early return 必须处理），而中心若已 preparing 保留、不抢占。完整 radius 的其余请求仍随后执行，local 模式和合法 empty mesh 语义不变。

这不是“把 Manhattan sort 调一下”即可验收：现有稳定排序确实使 y0 在同距 y1 前，但 y1 中心和 y1 cardinal 仍会排在 required corners 前。待上述诊断或 RED 证明具体分支后再选择实现；本阶段未改源码、未运行浏览器/CI/全套，也未增大 timeout。

## PR17 checkpoint `4cf859db1f1edf882a0f2f672852f7bd57ea93e7`：bootstrap/old-decision 定向复核（待空网格修复）

`9ef0982` 已正确完成此前 old decision guard：pipeline 先比对 in-flight sequence，未匹配回执返回 ignored、不改 queued；RemoteAuthorityClient 仅对 matched decision 通知 controller 或 flush。现有 RED/GREEN 覆盖 old `requiresResync=true` 不清掉新的 latest，也覆盖匹配 resync 清队列、close/fail 清理与之后正常 seq 继续。没有改变 Node 32 pending gate、jump expiry 投影或协议字段。

`4cf859d` 的核心优先级因果也成立：Game 在完整 radius streaming 前创建 remote initial barrier；async barrier 在首次 await 前同步将脚下 3×3 用 interactive 入 scheduler。若这些 key 已被 streaming 请求占用，scheduler 现在原地提升 queued/replacement/deferred 的同一 request，而不再 early return；单 Worker / Node baseline 串行下，required 九项会在未开始的 streaming 前派发。完整 radius 仍由随后 `updateStreaming()` 排入，local 仍使用原有 `waitForInitialVisibleChunk()`，未增加本地首帧门槛。测试以每 bundle 2 秒的 slow prepare 证明旧顺序最后 required 为 34 秒、priority 后九项为 18 秒并继续派下一 nonrequired 项，具备受控慢条件的有效 RED/GREEN。

但本 checkpoint 尚不能准出。`waitForInitialPlayableArea()` 仍在 required-key completed 检查之前 await `repository.waitForFirstVisible()`；repository 只有某 attach 的 `summary.triangles > 0` 时 resolve firstVisible。因而 9 个 required mesh 均为合法 empty，且尚无任一 nonempty chunk attach 时，会挂到 30 秒 timeout。这与新 spec 中“完成以每个必需 key 已 postrender 为准，不要求非空三角形”和“避免合法空网格让首个可见网格永久等待”冲突。

现有 `world-initial-playable-area.test.ts` 没有抓住该路径：empty cases 将 `waitForFirstVisible()` stub 为立即 resolve。最小修复为 remote initial barrier 删除这一个 firstVisible await，直接等待九个 required `repository.chunks`（该 map 在 attach/postrender 写入）；local 的 `waitForInitialVisibleChunk()` 保持不变。RED 应构造一个永不 resolve 的 firstVisible promise 和已 postrender 的九个空 required records，断言 remote barrier 仍 resolve。无需加 timeout、改变 compute fixture 或放宽任何队列限制。

已按范围运行：

`CI=true corepack pnpm exec vitest run tests/client/remote-authority-client.test.ts tests/app/initial-playable-area-priority.test.ts tests/app/world-initial-playable-area.test.ts --no-file-parallelism --maxWorkers=1`

结果：3 files / 13 tests passed，1.33 秒。该通过不消除上述遗漏的真实 empty-firstVisible 分支。未运行浏览器、CI 或全套，未触碰 evidence；CI `34207971935` 仍由 root 监控。

## CI 34207971935 / `4cf859d`：首屏排序修复后的真实 Chromium 吞吐诊断

三次失败诊断完全一致：`requiredChunks=9`、`completedChunks=7`、`queuedRequests=42`、`preparingRequests=1`、`failedPreparations=0`、`meshingRequests=0`、`uploadQueue=0`。页面/base path/harness 正确、无 pageerror，Node ready，仍在 30 秒首屏 timeout 后才断开。

这证明 `4cf` 的优先级实际生效，但还不能证明吞吐足够：总首轮为 50 个 request，7 个已完成、1 个正在 prepare、42 个排队，恰为 50；第八个 required 正在 prepare、第九个还在高优先队列。没有 failed preparation、worker in-flight 或 upload backlog，因此当前证据不支持 revision retry、worker mesh 或 PlayCanvas attach 为主阻塞，也不能以此前受控 RED 中每 bundle 2 秒的假定推导真实 CI 时长。三次同一水位说明持续的 capture/projection/transport/reassembly prepare 路径在该环境的完成率不足以在 30 秒内完成九项。

最小修复前先补每个 required key 和 aggregate 的分段、脱敏诊断：

- client/mirror：interest sent、descriptor received、pages received/total、bundle complete、owner ready、unavailable/rejected/stale invalidated/retry；
- scheduler：prepare start/end、worker start/end、accepted result、repository attach；
- Node：baselineTail queued/active，capture start/end/result/reason，projection start/end，descriptor/page count 与 send completion，以及 pending capture。

在同一 30 秒 timeout 时输出这些阶段和持续时间。判定规则：第八个没有 descriptor 是 Authority capture 或 tail；descriptor/page 缓慢是 projection/send；page 完而 owner 未 ready 是 reassembly；owner ready 后才检查 worker/attach。仅若证据显示 Node 已能在 worker/commit 期间继续准备下一 baseline，才考虑 9-key 有界 prefetch 以重叠阶段；若 capture/send 本身已占满 30 秒，则必须审查传输去重/协议边界，不能仅调整 scheduler、timeout 或 E2E fixture。

`21d210b` 已独立补掉前节发现的合法空 3×3 首屏卡住：remote barrier 不再 await firstVisible，只等待 required repository records；local path 不变。该修复不是本次 7/9 吞吐失败的解释。

本次未运行浏览器、CI 或全套，未修改源码、测试、evidence 或 Git 状态。CI 仍失败，PR17 尚不能准出。

## `dae0ea6ccc3f91d506f6c8b0d9a33ccd3817f336`：初始 baseline 分段诊断复核

诊断路径在正常产品会话默认关闭。浏览器端只有 remote 且 harness query 存在时才传入 `initialSyncDiagnostics`；Node 只有 E2E 子进程显式设置 `SEEDLANDS_E2E_PLAYABLE_DIAGNOSTICS=1` 时才向 network server 注入 diagnostic callback。未设置二者时，mirror 不创建诊断 entries，Node sender 使用 no-op callback，公开 C0 协议、输入/interest budget、session lifecycle 和普通 Node 输出均未改变。

诊断本身足以区分本次待判定的分段：Node 对 anonymous ordinal 输出 tail queued/start、capture start/complete（含安全的状态 reason）、projection complete、send complete（pages/bytes）；browser timeout 输出 9 个请求的 requested/descriptor/pages/ready 与 elapsed、descriptor/ready elapsed、expected/received pages/bytes，再合并现有 scheduler/repository counters。没有 key、requestId、session ref、URL password 或 access key；tests 明确检查序列化结果不含 chunk key。发送页的计数只在成功 enqueue 后增加，mirror ready 只在 reassembly/consumer accept 后标记，因而能够区分 capture/tail、projection/send、page reassembly 与 worker/attach 后段。

协议和清理边界保持：session 的 diagnostic callback 受 `try/catch` 包裹，抛错不会传播进 baseline tail 或 socket handler；sender 原有 bundle close、capture unset 和 cancellation finally 仍在。客户端 timeout 的 diagnostics callback 已有异常时仍按原 timeout reject 的定向测试。默认 no-op 与诊断回调均不写入 socket/C0 payload，不更改取消、pending 或 session close 行为。

已运行：

`CI=true corepack pnpm exec vitest run tests/app/world-initial-playable-area.test.ts tests/client/remote-authority-mesh-mirror.test.ts tests/node/node-playable-network-session.test.ts --no-file-parallelism --maxWorkers=1`

结果：3 files / 14 tests passed，1.07 秒。未运行浏览器、CI 或全套。

唯一需确认/修正的范围差异：Web mirror 严格记录前 9 个 request，但 Node session 的 `MAX_DIAGNOSTIC_BASELINE_REQUESTS` 是 12，且测试也以 ordinal 12 为期望；96 event 上限有效。若合同的“first9”是严格输出上限，Node 应改为 9 并更新测试，避免第 10–12 个非 required streaming request 被 E2E Node log 输出。若 12 是有意为了诊断尾部，应在 spec/执行记录说明这个例外。除这一项外，本诊断 delta 的默认关闭、事件有界、匿名化、失败隔离与阶段可区分性通过静态和定向复核；尚待新 CI 日志，PR17 仍不准出。

补记：root 已确认 Node 前 12（最多 96 events）是有意的最小诊断范围：browser 仅追踪首个 required 9，Node 多出三项用来观察首屏完成后普通 streaming 是否启动。该分层限制现已接受，不构成修复缺口；后续 spec/执行记录应保留此理由。`dae0ea6` 的诊断 delta 在该约定下通过本独立复核，CI 结果仍待新基线整合后产生。

## CI `34211532822` / `b0a5a1d`：首屏优先级后的浏览器基线消费瓶颈（只读归因）

三次 Chromium 失败都保留了正确的首屏调度状态：required 9 中已完成 7 或 8、另一个在 preparing，`failedPreparations=0`、`meshingRequests=0`、`uploadQueue=0`；Node inline ready，且其余 42/41 个普通请求仍排队。结合这次 Node 前 12 条分段记录，优先级、Node capture、projection 与 server send 都不是第 2–9 个 required bundle 的主耗时：Node 对这些 bundle 的 capture 约 13–68 ms、projection 约 4–15 ms、全部 54 个 page 的 send completion 约 4–18 ms。首次 bundle 的 capture 为约 4.7–7.3 s，确实消耗首屏预算，但不能解释随后 browser 每 bundle 越来越慢的尾部。

相反，Web 端的 `descriptor → ready` 先约 1.1 s，随后扩至约 2.8–3.8 s、4.9–10.5 s；第 8 个 bundle 在 Node 已报告 54 pages 全部 send complete 后，浏览器 timeout snapshot 仍只完成 12/54 或 26/54 page。当前 `receivedPages` 只在 reassembler 的 `acceptPage()` await 成功后递增，因此这确定为“浏览器已进入 descriptor 后，到 page 验证/reassembly/consumer-ready 的消费区间”积压，不能据此断言网络未投递，也不能归咎 Node capture/tail、worker mesh 或 upload。

根因层面的重要反证：客户端不是把 54 个 page 显式排为一条 `receiveTail`。WebSocket listener 对每个 message 直接 `void authority.receive(event.data)`；`receive()` 中单个 baseline-page await mirror，但彼此可并发。core 的并发契约测试也明确构造 54 个并发 `acceptPage()`，期望同时 `digestingTransfers=54`。所以“每个 page await”不等于已证明 54 个 hash 串行，不能把约 1 秒误写成 `54 × frame` 或单一 crypto 瓶颈。

不过该区间存在有根据的高成本候选：每个 27-entry bundle 有 canonical/fluid 两个 transfer，即 54 个全块 page；每个完整 transfer 都在 Web 侧 `bytes.slice()` 后调用 `crypto.subtle.digest`，并以 hex 字符串比较。因此一个约 2.53 MiB bundle 会触发 54 次 copy/digest/JS completion；与此同时场景 application 在开始连接前已经 `app.start()`，首个 chunk attach 后会持续 frame/render。软件 WebGL 与 main-thread message decode/reassembly 可能共同放大后面 bundle 的完成时间，但现有日志没有 message-arrival、digest-start/settled 或 frame/long-task 相关性，尚不能在这些候选中定案。

### 最小下一步：先补有界观察，不改 30 秒或协议

仅在既有 harness diagnostics 开关下、限于前 9 个 Web request，补以下匿名聚合字段：

- `baseline-page` 到达/完成计数及首末到达时刻；现有 `receivedPages` 保留为 verify/accept 后计数，二者分离。
- C0 decode、mirror/reassembler accept 的累计/最大耗时，以及 timeout snapshot 的 `activeBundles`、`digestingTransfers`。不输出帧、chunk key、requestId、session ref、口令或 payload。
- 同一 request 的 descriptor、54th-page-arrival、all-digest-settled、consumer-ready 的时间点。由此才能区分“浏览器 JS 尚未收到 page”“收到但 C0/复制阻塞”“digest in flight”“digest 已完成但 consumer/attach 未完成”。Node 现有 capture/projection/send 分段无需扩大。

这只是诊断，必须保持 callback 失败隔离、96 event/12 Node 与 9 Web 的既有界限、timeout/cancel/close 原语不变；不能进入公开协议或改变会话行为。

### 修复决策边界

当前 30 秒是 spec 明定的产品合同，失败时仍必须报错；三次数据只显示进展，不足以证明任一尝试必将在稍后健康完成。因此不能以“正在推进”为由直接加大等待。若新分段表明 page 已快速到达而 digest/reassembly 完成慢，修复是 Web reassembly/协议传输的性能工作：例如减少每 bundle page/digest/copy 数量，或把可安全 transfer 的 reassembly 移到已有 worker。这会涉及 C0 reference、revision/cancel/ownership和 A/B 端到端测量，不能以本诊断推断收益或保证 30 秒，剩余成本高。

若 page-arrival 明显被渲染长帧延后，loading 期间减少重复 3D render 可以作为更窄的候选，但不能直接关闭 render：当前 required 完成以每个 chunk postrender 为准，直接停 render 会使 visibility barrier 永远不结算。它必须以受控 browser RED/GREEN 证明：9 个 authority-complete mesh 仍 attach、各自 postrender 后 barrier 完成，最后画面完整，再以同源/同机器 A/B 证明对慢机路径有效；否则只是隐藏视觉门槛。它属于渲染调度性能优化，不是已证实正确性缺陷。

另一条成本较低但需要产品授权的路线是把“固定 30 秒内全 9 postrender”改为有绝对上限的进度门禁：只在 required request 的安全阶段持续前进时延续 loading，仍对无 descriptor/page/digest/attach 进展、失败、cancel 和 close 及时失败，并向玩家显示可取消的进度。这是用户可见首屏合同变化，不能伪装为 test timeout；需修订 spec、明确总上限及 RED（停滞仍在原 deadline 失败、持续进展有界完成、disconnect/cancel 不延长），再做真实浏览器验收。它可解决已证实的“健康但慢”环境，却不替代后续吞吐 A/B 优化。

本轮未运行 browser、CI 或全套，未改源码、测试、证据或 Git 状态。工作树中的 evidence 修改由实施者持有，未触碰。CI `34211532822` 仍失败，PR17 不能准出。

## `bb880542ec00258c3e8123be9772ad1e77750d7c`：Web page arrival / verification 最后一层诊断复核

通过本层定向复核。此提交只扩展 Harness 失败快照，未改 C0 message、baseline reference/reassembly 的校验、reservation、取消、revision owner 或 scheduler 行为。`acceptPage()` 仍以原有 `requireReassembler().acceptPage(page)` 作为唯一重组调用；诊断仅在调用前记录页面进入 mirror 的匿名计数/字节/时刻，在该 promise 正常返回后记录 verification 完成。若重组抛错，原异常与 clear/cancel 路径保持，verified 不会被伪增；若 diagnostics 未启用，新增分支不写诊断状态。

Web 仍严格只在 `diagnosticsEnabled` 且 request ordinal 小于 9 时创建 entry；snapshot 只枚举该 map。输出没有 chunk key、requestId、bundle identity、session ref、口令或页面 payload。新增 reassembler 汇总只有 `activeBundles`、`digestingTransfers`、`reservedBlockBytes`，足以和 `arrivalPages/Bytes`、`verifiedPages/Bytes`、first/last arrival、last verification 对照：

- arrival 增长而 verification 不增长且 digesting 大于零，指向已进入 mirror 的重组/验证等待；
- arrival 未到 expectedPages，不能把 server send completion误判为浏览器已消费；
- verification 已齐但 owner 未 ready，才继续检查 consumer/owner；
- active/reserved 为零则排除 timeout 时仍有本地 reassembler bundle。

术语边界应保留：这里的 arrival 是 **C0 已 decode、payload block 已解析并进入 `RemoteAuthorityMeshMirror.acceptPage()`**，不是浏览器网络栈收到 WebSocket frame 的原始时刻。因此它足以将原先“page 消费”再切成 mirror-entry 与 verify/reassembly，但若 arrival 本身迟滞，仍不能单独区分 WebSocket delivery、主线程调度和 C0 decode；只有需要继续追该分支时才应增加更早的、同样有界的观察点。

受控测试真实保持 pending 的首个 page promise 时确认 `arrival=1`、`verified=0`、`activeBundles=1`、reservation 非零；全部真实分页完成后确认 ready 和 reassembler 账本归零，并验证匿名化。本人额外运行：

`CI=true corepack pnpm exec vitest run tests/client/remote-authority-mesh-mirror.test.ts tests/app/world-initial-playable-area.test.ts --no-file-parallelism --maxWorkers=1`

结果：2 files / 10 tests 通过（0.63 s）。未重跑 browser、全套或 CI。实施者报告的 260 files / 1302 tests、build/isolation/dist、原15回归、资产2、真实远端 34 Vitest + 20.2 s Chromium，以及 source `04a8076` evidence，均为其本地记录，仍待 root 以新 CI 终态收口。`25b59fe` 仅处理 main squash ancestry/文档上下文，未作为本层生产行为变化计入。

## CI `34213458251` / `25b59fe`：arrival/verification 诊断定案与最小 renderer 对照

新分段排除了本地 reassembly/crypto 为当前主阻塞。三次失败中，每个已到达页面都满足 `arrivalPages === verifiedPages`、bytes 相等，`lastVerificationElapsedMs` 只比 `lastPageArrivalElapsedMs` 晚约 0.2–0.5 ms；timeout 的 `digestingTransfers=0`，仅当前未完成 bundle 保持 `activeBundles=1` 与其 2,654,208-byte reservation。换言之，页面一旦已 C0 decode 并进入 mirror，就很快通过 reassembly/verify；此前的 54 次 WebCrypto 候选不成立为这次 CI 的尾部解释。

真正变慢的是进入 mirror 前的 page task 到达节奏。三次中第 2–5 bundle 的 descriptor 后完整 54 page 约需 0.93–1.05 s；后续第 6 约 2.8–3.1 s，第 7 约 4.4–9.5 s，最后的第 8/9 在 timeout 时只有 12–35/54。相应 Node bundle 已在数毫秒内完成 54 page send；capture/projection/tail 不构成该段瓶颈。`arrival` 位于 C0 decode 后，因此该证据仍把“浏览器 WebSocket message task 未开始”与“同步 C0 decode 很慢”合并为 pre-mirror 区间，不能只凭日志选择二者之一。

日志中的 `GPU stall due to ReadPixels` 不能当作 renderer 因果证据：connect 失败处理会在 `waitForFunction` 抛错后调用 `page.screenshot()`，该截图本身可产生 ReadPixels 警告；console 事件的到达顺序不足以证明该警告发生于首屏 page 消费期间。

### 最小、可证伪的 renderer 竞争对照

不扩大 telemetry、协议或 30 秒。仅为 E2E Harness 增加一个远端 loading 诊断开关，并在相同 Chromium/Node/seed/base-path 下做 A/B：

1. baseline 保持当前连续 `autoRender=true`；
2. experiment 从 remote scene 开始至 initial barrier settle 的 `try/finally` 内设 `app.autoRender=false`，保留 PlayCanvas rAF/update、网络、worker、commit 与 Svelte loading UI；定期（例如 100 ms）设 `app.renderNextFrame=true`，使每个已 attach chunk 仍在真实 postrender 上结算；finally 无论 success、timeout、cancel 或 disconnect 都清 timer、恢复 `autoRender=true` 并请求一帧。

PlayCanvas 明确保证 `autoRender=false` 只跳过 render，应用 update 仍每帧运行，`renderNextFrame` 会执行一次真实 render；但 `playcanvas-chunk-adapter.attach()` 依赖 `postrender` 完成 repository/initial barrier，所以实验不能完全关闭 render。A/B 两侧必须继续断言 9 个 required key 都经过 postrender、合法空 mesh 正常完成、30 秒合同不变，且成功侧继续完成同一真实移动/跳跃/挖放/保存/重连/重启旅程。只在该对照使三次同环境稳定通过、而 baseline 保持该 arrival 拖慢形态时，才能把 renderer/main-thread 竞争认定为可操作原因。

若对照失败或 arrival 分布无改善，不应产品化 render 改动；下一步最小观测仅在现有首 9 request 内把 WebSocket message-listener entry 与 `decodeC0Envelope` 前后时间接到已有 arrival 字段，以分开 event dispatch 与 C0 decode。不是通用 telemetry，也不记录 payload/identity。

若对照成立，产品修复边界才是 remote loading 的按 attach 请求 render（替代定时器）、barrier finally 恢复连续渲染，并新增 attach/postrender、cancel/timeout、local 模式不变的 RED/GREEN。它是为满足既有 30 秒首屏合同的正确性收口；任何“更快”的结论仍需同源、串行的 A/B 端到端测量，不能由该诊断或一次 CI 成功宣称。

本轮仅阅读 CI/source，未运行 browser、CI 或全套，未修改源码、index 或 evidence。CI `34213458251` 仍失败，PR17 不准出。

## `4008f2f5a4553f10272f09432bbd5d7033a36300`：render-contention AAABBA 正式采样准备审阅（未执行样本，当前阻断）

已重新计算固定验收合同 SHA-256，仍为 `1ae93e3714a6f09ecc4a6686b4c606ab0e28fde5068bb50d0592c2f8f665262b`。本轮只读审阅实验定义、runner、probe、真实 Node fixture、Playwright 配置及 root 尚未提交的 CI 接线；没有运行 browser、正式样本、CI 或全套，也没有改动工作树源码、测试、证据或 index。

实验设计的有效部分如下：序列是固定 `A,A,A,B,B,A`；每个 trial 都新建空数据目录和独立 Node Authority 进程，Browser 保持同一进程但每次新建并关闭 context；固定 seed、viewport、inline compute 和 SwiftShader launch 参数，并以 GL renderer readback 作为环境核验。A 保持 `autoRender=true`；B 只在远端 loading 期以 100ms cadence 请求真实 `renderNextFrame`，不会停掉 update、rAF、网络、worker、attach 或 `postrender`。两侧都以真实 UI 点击到 9 个 required chunk 的 rendered revision 为计时和正确性门槛；30秒写作右删失而不是虚构 ready 时间，B 两次均须不晚于24秒，且 A 的首两个和后置平衡 control 都必须在30秒 timeout。每个 B 成功还要求9块、恢复 `autoRender`、恢复后真实 postrender、最终 PNG；任一样本 renderer 非 SwiftShader、B 失败或完整性缺失均会给出 `stop-without-product-adoption`。这满足单轴、失败止线和不以倍率声称性能收益的治理边界。

但 `4008f2f` 在正式执行前有下列必须修正的可执行性缺口，已交 root/Sol：

- runner 仅拒绝已有 `invocation.json`，却先用 recursive mkdir 建目录，因此正式目标不是“新空目录”；遗留 PNG/log/test artifact 可以混入。正式模式须要求输出目录此前不存在，或以排他的新 run directory 创建；`benchmark-window` 的 `window.json` 在批次结束才写入，不与此冲突。
- probe 仅在测试 finally 调用 `release()`。产品 remote start 失败会经 `application-shell.ts` 的 `game.abortStart()` 销毁 application；此时不存在可观察的 postrender，不能把 `autoRenderRestored` 或 `finalPostrenderAtMs` 伪造为成功。最小实现应立即观察 startup failure/close：app 尚存则清 cadence、恢复并等待一次真实 postrender；app 已 dispose 则记录诸如 `failure-after-app-disposed` / `restoration-not-observable-after-dispose` 的失败终态。任何 B failure 仍是整体 veto。
- `render-contention-experiment.json` 明定正式身份绑定“本合同输入哈希”，但 runner 和 raw result 的 `sourceInputs` 都没有 `changes/2026-09-08-web-node-playable/contracts/validation.json`。应将其加入两处哈希清单；完整 clean Git SHA 仍保留为总身份锚点。
- CI 在 experiment 前运行 `pnpm test:e2e:regression`，其中 `changes/2026-09-07-loading-performance/e2e/loading-performance.spec.ts:66` 硬写已跟踪的 `changes/2026-09-07-loading-performance/evidence/world-loading.png`；随后 active journey 的 `web-node-playable.spec.ts:48` 也硬写该 change 的已跟踪 PNG/JSON。当前 CI patch 已设置 `SEEDLANDS_LOADING_EVIDENCE_OUTPUT` 和 `SEEDLANDS_WEB_NODE_EVIDENCE_OUTPUT`，但两份源码尚未读取它们，所以环境变量目前无效，formal runner 的 clean preflight 必然会拒绝。最小正确修复是两处测试都用 `resolve(process.env.<VAR> ?? historicalDefault)`，CI 指向 `/tmp`，默认继续写历史本地 evidence。PR15 integration 的所有 screenshot 使用 `testInfo.outputPath()`，不污染跟踪树。不要用 CI `git restore` 来遮蔽未知污点。

CI patch 的位置和条件其余可执行：原 required job 名 `Chromium regression` 及原门禁保持；仅 PR17 分支、在所有既有门禁之后以 `!cancelled()` 执行 `build:server` 和完整 benchmark window，15分钟外层上限覆盖六次受限 trial；即使先前门禁失败，步骤会收集诊断但 job 仍保留失败。SHA-pinned `upload-artifact` 对同一条件上传完整 `/tmp` 正式目录、保留7天，能留住失败样本。该 native CI 批次由 root 触发并持锁执行；Terra 仅负责独立审阅与验收，不能称为直接操作 CI。

结论：AAABBA 的统计与正确性门槛设计通过静态审阅；`4008f2f` 尚不能开始正式采样，须先合入上述目录新鲜度、失败恢复语义、合同 hash 和两条上游 evidence 输出隔离的最小修复。本段不构成产品性能结论或 PR17 准出。

## `59c078d` 与 `21777c603ce11a07b58596389d7c61548749d164`：render-contention 冻结 delta 定向复核

本轮按固定合同 SHA-256 `1ae93e3714a6f09ecc4a6686b4c606ab0e28fde5068bb50d0592c2f8f665262b`，只读比对 `4008f2f..21777c6`。HEAD 为 `21777c6` 且工作树干净；`git diff --check` 无输出。未运行浏览器、CI、正式样本或全套，未改源码、测试、证据或 Git 状态。

此前的四项执行阻断均由代码闭合：

- runner 在正式模式创建目录后以 `readdir` 拒绝任何非空输出；整批 native benchmark window 互斥、每次 CI runner 新建的前提下，这足以阻止残留 artifact 混入，不必增加通用跨进程目录锁。
- runner 和 raw result 的 `sourceInputs` 都新增 validation contract；正式记录同时保存 clean tree status、完整 HEAD 和 Node dist hash。自检来自含未提交工作树的 `4008f2f`，因此只证明 probe 行为，不能代替冻结正式身份。
- loading regression 与 web-node journey 都改为读取 CI-only evidence output env，默认路径仍为各自历史 evidence。CI 先将两者定向到 `/tmp`，PR15 integration 仍只写 Playwright output；因此正式 runner 的 clean-source preflight 不再因既有门禁改写已跟踪 PNG/JSON 而失效。
- probe 把 terminal 扩为 `failed`，监听 application destroy 和仍存活时的 product error。ready 路径才恢复 autoRender、请求一帧并以真实 postrender 结束；失败路径清 timer、恢复属性并把 `finalPostrenderUnavailableReason` 记录为 `application-destroyed` 或 session-ended，未调用 renderNextFrame。自检 raw result 的成功 B 有 required=9、SwiftShader、恢复后 postrender 和 PNG；错误口令 B 有 `terminal=failed`、`autoRenderRestored=true`、`finalPostrenderAtMs=null`、`application-destroyed`，证明不会伪造失败后 postrender。每个 formal trial 的 fresh Node/data/context、30秒右删失、AAABBA、B≤24秒、9块/PNG/SwiftShader及所有 veto 仍未变。

CI 接线仍保留 `Chromium regression` 名称和全部原门禁；仅目标 PR17 分支在已有门禁之后、`!cancelled()` 下 build Node dist 并由 native CI 持有完整 benchmark window，上传完整 `/tmp` artifact 7天。该批次尚未触发或执行，不能从自检推导性能结论、正式采样结果或 PR17 准出。

剩余唯一最小一致性项已交 root：`render-contention-experiment.json` 和 spec 还写 failure/close 也“强制一帧”，但当前已接受的正确语义是 application destroy 后不得渲染，只能恢复可恢复的属性并记录 postrender 不可观察。应改为 ready 强制一帧并验证 postrender；failure/close 在 app 存活时恢复，destroy 时明确记录 unavailable。此项是说明文字与实际清理语义的校正，不改变采样轴、阈值、CI或生产逻辑。完成该文案修正后，本独立审阅认为正式 AAABBA 批次可执行，等待 root 授权 push 触发原生 CI 后再核验原始结果。

### 最终实验冻结身份：`a35b64b7b750ee9cf46ae28d4bd75cb47b01546a`

已只读复核 `21777c6..a35b64b`，工作树仍干净、固定合同 SHA-256 未变。delta 仅把 experiment JSON/spec 对齐已验证的清理语义：ready 才强制一帧并验证 postrender；failure/close 仅恢复可恢复状态，application 已销毁时记录不可观察，不调用 render 或伪造 postrender。它不改变实验代码、AAABBA 顺序、100ms cadence、30秒右删失、24秒 B 门槛、Node/Browser 隔离或 CI 原门禁。

至此，所有此前列出的正式采样阻断已关闭。本独立审阅确认 `a35b64b` 的一次原生 CI 固定 AAABBA 批次可执行。该结论只说明冻结输入和执行条件合格；尚未取得该批次原始 artifact/CI终态，不能宣称性能候选成立、产品变更或 PR17 准出。root 已授权并负责 push/触发原生 CI；待其交付原始结果后再按 invocation/raw-results/PNG/window 与 CI 状态复核。

## 原生 CI `34218178776` / merge source `91f7a7b765fa42a95be80bdd0646d8f1bb39cfa9`：render-contention 批次无效的 base-path 归因

只读检查 `/tmp/seedlands-web-node-playable/ci-render-contention-34218178776/`、对应 Chromium log 与冻结源码。六个 trial 都在 `armProbe()` 的动态 import 处抛出同一错误：`http://127.0.0.1:4173/@fs/home/runner/.../render-contention-probe.ts` 无法 fetch。失败发生在 `page.click('#enter')` 之前；每条 raw result 都是 `outcome=failure`、`probe=null`、renderer/evidence/required chunks/final frame 均为空。每个临时 Node 仅打印 ready 后被 finally 停止，没有真实远端连接、baseline、mesh、postrender 或 B rendering cadence。因此 raw summary 中的 `stop-without-product-adoption` 是脚本安装失败的机械结果，六个样本全部无效，既不能作为 A 对照失败，也不能作为 B 候选反证、性能数据或产品结论。本次 artifact 必须保留，但从正式 AAABBA 统计中排除。

根因确定为 base-path：Playwright 当前 base URL 是 `/seedlands-web-sandbox/`，而 spec 把绝对文件系统 Vite URL 固定为根路径 `/@fs...`。Vite base middleware 对不以 raw base 开头的非 HTML 请求返回 404；游戏页面仍可经 base redirect 正常加载，故两种现象可同时成立。最小修复只应让 `probePath` 按 `SEEDLANDS_BASE_PATH` 构造，例如以 `new URL('@fs' + resolve(probeFile), new URL(basePath, origin)).pathname` 生成 `/seedlands-web-sandbox/@fs/...`；根路径继续得到 `/@fs/...`。不得变动 experiment axis、AAABBA、100ms cadence、30秒右删失、24秒阈值、Node fixture、生产逻辑或 timeout。

身份和前置条件有效但不救活样本：`invocation.json` 与 `raw-results.json` 一致记录 `sourceSha=91f7a7b`、空 `sourceTreeStatus`、固定 validation contract hash 和相同 Node dist hash。root 另核对该 CI merge commit parents 为 main `ddffbcb` 与 `a35b64b`，其 tree 等同本地 `a35b64b^{tree}`，所以 artifact 确实执行了冻结内容。benchmark window 也完整记录本次独占失败（exit 1）。原 Active journey 同 job 仍是首屏 7/9 timeout，可作为既有产品故障持续的独立门禁记录，不能挪作本批 A 样本。

下一步只需在同一非根 base 下运行非计时 selftest 的成功 B 与错误口令 B，确认 probe 可以安装、前者完成9块/真实恢复后 postrender、后者记录 destroy/unavailable cleanup；然后以新的 clean freeze 重做一次原生正式批次。本轮未运行 CI、browser、正式样本或全套，也未改源码、测试、证据或 index。未发现其他正式批次阻断。

## 原生 CI `34219596804` / merge source `2c07500f9ba1089541b24a28d6876a1407670ce4`：有效 AAABBA 结果与 active-gate 差异

本轮只读复核正式 artifact `/tmp/seedlands-web-node-playable/ci-render-contention-34219596804/`、window、raw result、六张 PNG、冻结测试源码和 CI step 状态；未重跑样本、CI、browser 或全套，未改源码、测试、证据或 index。`invocation.json` 与 `raw-results.json` 记录同一 merge source、空 `sourceTreeStatus`、固定 validation contract hash `1ae…262b`、一致 Node dist hash及逐文件输入 hash。root 已验证 merge commit 的树与提交冻结内容一致。`window.json` 表明 `seedlands-performance-validator` 独占窗口、exit 0；experiment step 和 artifact upload 都成功。

六个正式 trial 全部经真实 Node Authority、完整 9 个 required rendered revision、恢复后 postrender 和最终 PNG。原始 click-to-ready 为：A1 8341.8ms、A2 10612.2ms、A3 10195.9ms、B4 10153.7ms、B5 10049.9ms、A6 10939.7ms。B 的 98/95 次 paced render requests、97/94 次 paced postrender、恢复状态和 ANGLE SwiftShader renderer 都被记录；六个 PNG 都有独立 SHA-256。本人实际查看 A1、B4、A6 原帧：三者均为完整的可玩森林场景、HUD/调试状态显示 loaded/rendered 9，没有 loading/error/空白画面。

这不是渲染调度候选成立的结果。尽管 B 的正确性和24秒余量条件均满足，首两个 A 及后置 A 都没有在30秒 right-censor，而是同样完成；summary 的 `CONTROL_NOT_REPRODUCED`、`initialAaBothCensored=false`、`balancedControlsBothCensored=false` 与 `stop-without-product-adoption` 正确。候选应按既定 stop line 关闭，不应产品化 autoRender 调度，也不得把该数据报告为加速收益。

同一 CI 中 Active Web-to-Node journey 仍在 30 秒于7/9首屏失败，但它不能替代这批 A 样本：experiment 启动时已有 clean/fresh identity、固定 six-trial sequence和SwiftShader readback；active gate 是另一个测试语义。两者共用 seed、inline fresh Node fixture、viewport、base-path、真实 remote form、30秒 product deadline 和九块门槛。实验 A 还增加了 probe 的 rAF/postrender observer，所以没有证据说 probe 自身降低了负载。

独立源码比较得到的可证实差异与最小后续检验如下：

- experiment 专门使用 `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`，并回读确认 SwiftShader；active gate 使用默认 headless launch，当前失败 artifact 没有 renderer identity。因此 graphics backend 是首要、尚未证实的运行环境差异。
- experiment 通过 `browser.newContext()` 建立其 page，active 使用 Playwright fixture context；experiment serial/retries=0，active 在 CI 有重试且 retry 才启用 trace。首次 active 失败先于 retry trace，故 trace 不是已证实的主因，但 context/trace 仍是控制变量，不能和 graphics 混为产品问题。
- active 的 diagnostic listener 只订阅每个 Playwright WebSocket 的 `close`，没有注册 `framereceived`/`framesent` consumer。更关键地，已核验 Playwright 1.62.1 dispatcher 本身无条件创建 WebSocket dispatcher并转发 frame events，所以“删 page.on('websocket') 会解除逐帧序列化”没有源码依据，不能作为修复方向。失败后的全页 screenshot 在30秒后才执行，也不能解释启动期慢。

最小可检验下一步是测试层而非产品改动：为 active connect 在 application 仍存活时记录一次匿名 WebGL renderer identity，并提供只供该测试的 opt-in launch args，精确复用 experiment 的三项 SwiftShader args。在相同 Linux、`/seedlands-web-sandbox/` base、同 seed、fresh Node、30秒合同下，对 active test 单独比较默认与 forced-SwiftShader；保持 WebSocket diagnostics、输入/网络源码和所有产品调度不变。若两侧结果相同，则排除 graphics 后再以同样单变量方法审 context；若仅 forced 通过，应先把 CI graphics 后端作为门禁环境问题处理，不把实验候选或内核优化错误地归为产品修复。

PR17 仍不准出，因为 active journey 当前 CI 失败；本有效 experiment 只支持停止 render-contention 候选。

## 图形启动兼容诊断：CI 草案预审（源码 delta 待冻结）

本轮只读审阅 root 未提交的 CI diff 与当前源码，没有运行 browser、CI、正式样本或全套，未改源码、测试、证据或 index。草案正确停止 AAABBA experiment，保留原默认 `pnpm test:web-node-playable` 门禁，随后仅对 PR17、在 `!cancelled()` 和单一 benchmark window 内运行一条 forced-SwiftShader 完整 journey，明确 `--retries=0`、新的 `/tmp` evidence 目录、同一30秒产品合同，并上传默认、forced、window和 Playwright failure artifact。它不计算倍率、不重启 render 候选，符合“测试环境兼容诊断”的单变量范围。

正式冻结时需满足以下最小条件：

- 当前 package 尚不存在 CI 草案引用的 `test:web-node-playable:browser`。Sol 必须新增该 browser-only script，仍先 build Node dist、再仅运行本 change 的完整 Playwright journey，且确保 CI 的 `--retries=0` 真正传递给 Playwright；默认完整 gate 的现有 Vitest+journey 命令不变。
- `SEEDLANDS_E2E_SWIFTSHADER=1` 只能增加 experiment 已采用的三项 Chromium flags：`--use-gl=angle`、`--use-angle=swiftshader`、`--enable-unsafe-swiftshader`；默认 launch options 必须字节语义不变。
- renderer identity 必须从已创建的 PlayCanvas `Application.graphicsDevice` 读一次，成功 journey JSON 和 timeout diagnostic 都记录匿名 renderer/vendor。不得让测试在启动前调用 `canvas.getContext()`、新建 graphics device、关闭渲染或添加节流；test-only accessor/probe 可以读取已有 application。
- `/tmp/.../journey` 与 `/tmp/.../graphics-forced` 是两条可独立归属的证据；job-level `test-results/` 可留作 failure attachment，但会混合该 job 前序测试，不能替代两个明确目录的身份或结果。

根因判定的停止线充分：若 default 仍失败、forced 完整 journey 成功，首先归因 CI Chromium graphics launch，并由人决定是否固定 CI renderer；若两者一致，关闭 graphics 假设。保持 WebSocket diagnostic listeners、协议、产品调度、timeout和输入不变。待 Sol 冻结源码 delta 后再作一次只读核对。

补正上一段的脚本边界：forced CI step 已在同一 benchmark window 内、调用 browser-only script 前紧邻执行 `pnpm build:server`，因此 `test:web-node-playable:browser` 不应重复构建；它只需启动该 change 的完整 Playwright journey并接收 `--retries=0`。执行的 dist 身份仍由紧邻 build 和两条 journey 各自记录的 source inputs 归属；`test-results` 仅作辅助失败附件，不作任何旅程身份依据。

## `8a5b40a37e1add93866c097a94bd90cb09b2aaa0`：图形启动兼容对照冻结 delta

按固定 validation contract（SHA-256 `1ae93e3714a6f09ecc4a6686b4c606ab0e28fde5068bb50d0592c2f8f665262b`）只读比对 `ba894ac..8a5b40a`。工作树 clean，`git diff --check` 无输出。未运行 browser、CI、全套或构建，未改源码、测试、证据或 index。

此前 identity 时机阻断已关闭。新的 test-only probe 在点击连接前 arm，只以 rAF 查询已经由游戏启动创建的 `pc.Application`；一旦从既有 `graphicsDevice.gl` 取得 device type、renderer、vendor/version 即缓存并停止 rAF。它没有调用 `canvas.getContext()`、新建 graphics device、写入应用状态、暂停或节流 render。连接成功、超时诊断、手动重连和 Node 重启都读同一缓存；finally 必定 release。新增错误认证测试明确等待真实 Application destroy 后读取缓存，验证无法再访问 live app 时 identity 仍可用；本地同 base 的成功与错误认证自检已由实施者记录通过。

默认 Playwright launch 路径保持；仅 `SEEDLANDS_E2E_SWIFTSHADER=1` 才添加与已停止 AAABBA 实验相同的 `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader` 三项 flags。新增 `test:web-node-playable:browser` 只执行原完整 Playwright journey；CI 在 benchmark window 外紧邻完成 Node dist build，window 内以 `--retries=0` 运行 forced journey。默认完整 gate、30秒首屏合同、全部真实键鼠挖放/durable/reconnect/restart 断言及两个独立 `/tmp` evidence 目录均保留。AAABBA step 已从 CI 移除；本对照不收集或宣称性能倍率。main journey 的三次 successful connection identity 写入其 source-bound JSON；错误认证的 identity 以单独 Playwright attachment 随 `test-results` 上传，且 timeout failure JSON 也会直接记录 identity。

结论：`8a5b40a` 的一次默认与一次 forced-SwiftShader 完整旅程对照可执行，无剩余源码/CI接线阻断。待 root 提供本机默认原日志/五帧和原生 CI 原始对照后，才能判定 graphics 假设或 PR17 准出。

## 本机默认图形完整旅程：`8a5b40a37e1add93866c097a94bd90cb09b2aaa0` 的最终 source-bound 证据（Linux 对照待到）

root 在 clean `8a5b40a` 上执行了未强制 SwiftShader 的 `pnpm test:web-node-playable`；本人只读复核原始日志 `/tmp/seedlands-web-node-playable/final-local-8a5b40a.log`、更新后的 JSON、逐项 hash 与五张原帧，没有重跑 browser、构建、CI 或全套。命令先重建 Node dist，随后 11 个 Vitest 文件的 34 个测试均通过，两个 Chromium 旅程测试通过，合计 20.5 秒。该结果是本机功能证据，不是性能采样或 default/forced 的比较结论。

JSON 的 `sourceSha` 为 `8a5b40a…`，`sourceTreeStatus` 为空；34 个 `sourceInputs`（含 Node dist、完整 journey spec 和新增 graphics identity test-only files）均与实际文件 SHA-256 相符。root 随后只把这六个证据文件提交为 `bee9a47`，生产、测试与 config 内容仍是 `8a5b40a`；因此 evidence 的 source SHA 与当前仅证据提交的 HEAD 不同是预期的，且不破坏这次运行身份。Node dist 的记录 hash 同样与实际 dist 内容匹配。

真实旅程证据满足已知的端到端链条：初始远端 `loadedChunks=renderedChunks=readyBaselines=9`；移动后跳跃的权威 y 从 18 上升到 18.9916667；放置为 `[-1,20,-2]` 的 type 2、chunk revision 2；放置后 tick 736 到手动重连 tick 872，Node 关闭的 durable commit 为 1074，重启后 Authority 恢复相同 durable commit 且场景 ready。三次连接（initial/reconnect/restart）都有已创建 WebGL2 Application 的缓存 identity，均为 ANGLE Metal / Apple M3 Pro，而非 forced SwiftShader。

本人查看五张原始 PNG：early、moving 和 turned 三帧均显示已进入同一真实森林与 HUD；placed 帧在瞄准线处清楚显示悬空的泥土方块；restarted 帧恢复为可玩的森林地面与 HUD。画面没有 start-error、空白或加载遮罩。它们支持真实 Pointer Lock 后的移动、转头及稳定放置视觉状态，但不替代 Linux CI 的完整同源复核。

结论：本机默认 GPU 的最终旅程可作为 `8a5b40a` 的有效 source-bound 功能与视觉证据；它不证明原生 CI 的 default gate 已通过，也不证明 SwiftShader 是或不是 Linux 失败根因。等待 root 提供 `34222361251` 的 default 与 forced 原始结果后，按两个独立 `/tmp` 目录、renderer identity、30秒门槛及完整旅程断言做最终对照准出。

## CI `34222361251` / `8a5b40a`：默认与 forced 图形对照的失败归因（尚无产品修复结论）

本轮只读检查 job `102048239272` 的完整日志、下载 artifact、forced early PNG 和输入/Pointer Lock/Authority 源码；没有重跑 CI、browser、正式采样或构建，也没有改源码、测试、证据或 Git 状态。

默认 Active gate 的三次 initial 连接均在既定 30 秒首屏门槛失败，且 failure diagnostics 三次都已经读到 `ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)`。所以它不是“默认 GPU 与 forced SwiftShader”这个单变量的干净对照：默认 headless 已落在 SwiftShader，forced 的 flags 不能据此被认定为唯一环境修复。默认诊断仍是已知的 required 9 中 7/8 完成、无 preparation failure、远端 baseline 已持续到达的首屏问题，保持为未解决的产品门禁失败。

forced 旅程确实越过了首屏并取得 Pointer Lock，且写出 `/tmp/.../graphics-forced/web-node-01-early.png`；该 PNG 显示完整 HUD 与 loaded/rendered 9，不是 start-error 或空白。但随后 KeyW 的 5 秒权威距离只达到 `0.019641855...`，未达到 >1；旅程在移动断言处停止，没有 moving/turned/placed/reconnect/restart 帧、没有成功 `web-node-playable-run.json`。window 正确记录 exit 1。因此 forced 不能作为完整闭环通过、CI renderer 固化依据或最终准出证据。

early 图的视线确实朝天空，且软件渲染约 9 FPS / 277.5ms frame；但现有 `PlayerController` 每 tick 把 `camera.forward.y=0` 后再 normalize，故单独的 pitch 不能解释 W 的水平 wish 变小。现有 artifact 没有 initial/current snapshot、velocity、view angle、按键注册、input decision 或 ACK/lease 数据，无法区分碰撞卡住、Pointer Lock/keyup 导致客户端不送 W、权威 input 被 late/resync 拒绝，或低帧率下的投影时序问题。

源码给出一个需验证、但尚未证实的输入候选。`projectRemoteInput()` 以 Web 收到 snapshot 的时刻和该 snapshot 的 physics tick 计算 `target = max(command target, snapshotTick + elapsedTicks + 2)`；它不知道该 snapshot 已在 Node→Web/主线程队列中停留多久。Node session 则在 `targetPhysicsTick <= currentTick` 时把 input-state 判为 `late`，即使 expiry 还没到。慢 SwiftShader / message dispatch 时，额外 2 tick（约 33ms at 60Hz）可能不够；这与 Mac GPU 本机通过相容，但当前 CI 没有 decision 计数，不能据此提前调整 target lead、expiry、30秒、移动距离或 seed。

最小下一步应是一轮 test-only、失败时才输出的 movement-window 诊断，保持现有完整 journey、阈值、seed、协议和产品行为不变：

- KeyW down 前记录一次现有 `RemotePlayableEvidence`；失败或达到 >1 时记录 final，并在窗口内以有界 200–250ms cadence 留不超过约 24 个 sample。每个 sample 至少包含 authority/presented position 与 velocity、physicsTick、viewAngles、onGround、aimed voxel、pointer-lock 是否仍为 `#game`、以及 controller 是否仍持有 `KeyW`。这能先分开 collision/presentation 与按键/视角问题。
- 仅在 `SEEDLANDS_E2E_PLAYABLE_DIAGNOSTICS=1` 的既有 fixture 诊断路径，给 client pipeline 添加只读快照：last-sent/in-flight/queued sequence、最后一个 projected input 的 `moveX/moveZ,targetPhysicsTick,expiresAfterPhysicsTick` 与发送时刻；并有界记录匹配 decision 的 sequence、accepted/late/resync 计数与本地 receive 时刻。Authority snapshot 已含 `acknowledgedInputSequence` 和 `inputResyncRequired`，应直接带入 evidence，而不是改变传输语义。
- Node 对同一诊断开关为每条 input decision 或最多最近 32 条写入脱敏结构化记录：client sequence、decision、target/expiry tick、receive 时 `currentTick`、pending-input count。按 sequence 与 client 记录关联，即可确定是否是 `target <= currentTick`，无需同步两侧 wall clock 或记录任何 payload/credential。

判定保持窄：W 在 client 已注册、持锁且本地 predicted/presented 已移动而 authority ACK/decision 多为 late/resync，才进入可复现的 target-age/lease RED；W 未注册或 lock 丢失则修测试交互/事件证据；accepted ACK 却 authority/presentation 零移动则再查 collision/physics。未取得这些数据前，不应修改 lead、租期、render、timeout、distance、seed 或 CI renderer，也不能把本次 forced 首屏成功解释为 PR17 通过。

## `2c3d2778f21a26ab5228f79aa49bb049a185054b`：movement-window 诊断冻结审阅（一个事件上限阻断）

本轮依据固定 validation contract（SHA-256 `1ae93e3714a6f09ecc4a6686b4c606ab0e28fde5068bb50d0592c2f8f665262b`）只读比较 `bee9a47..2c3d277`，审阅定向测试、诊断设计及本机 WIP 失败 JSON；没有运行 browser、性能批次、构建或 CI，也没有改源码、index 或 CI。当前工作树的 delivery/estimate/execution 三个改动由 root 同步整理，未计入该 checkpoint 生产/test delta。

生产 input 投影、jump lease、Node late 判定、30秒首屏、W 的 >1 门槛和 seed 均未修改。`projectRemoteInput()` 仍按原公式投影 target/expiry；`createSession()` 的 admission/decision 路径只在原 decision 计算的前后读取并记录副本。client 输入 pipeline 仍只保留一个 in-flight 与 latest queue；未知/旧 decision 的匹配 guard、resync 清理和已有 32 pending server 保护未变。package 的默认完整 gate 与 browser-only 完整旅程都仍包含原 web-node journey 和 graphics identity failure 测试，CI default/forced 两门禁未被此 checkpoint 改写。

诊断启用范围正确：浏览器侧仅在既有 `initialSyncDiagnostics` 时创建输入窗口；Node 仅在现有 E2E diagnostic callback 存在时创建汇总器。Web 和 Node 都最多保留16条非中性 sample，neutral state 不占 sample 预算；client sample 以 inputSequence 记录 projected target、当时 snapshot tick/elapsed、move X/Z、matched decision 与本地 decision latency。Node sample 以相同 client inputSequence 记录 admission currentTick、target/expiry、move X/Z 和最终 decision；close 时只发一条匿名 summary。runtime evidence 还带入 `interactionBlocked`、input summary，journey progress/failure JSON 另记录 Pointer Lock/focus/visibility、initial/W 前/current、graphics identity 和已脱敏 Node log。afterEach 捕获诊断写入错误而保留原 Playwright 失败，因此诊断失败不会覆盖原异常；page close 后再等待 terminal Node summary 的路径也有界。

给出的本机 WIP failure JSON 已实际证明字段可关联：client sequence 217 的 projected target 244，在 Node admission currentTick 237 时后续 decision 为 late；JSON 同时有 client late/resync 累计、Node terminal decision summary、initial/current state、Pointer Lock 与原 mesh revision failure。它是未冻结源码的行为自检，不能充作 source-bound 准出或 CI 重现；但足以证明下一次 CI 能定向区分非中性输入是否发送、是否被 late/resync 拒绝，以及 accepted 后的权威位置是否仍不移动。

**阻断：现有全局 Node 事件上限没有闭合。** 原合同/规格要求前12个 Node request、最多96条事件。baseline 路径仍可用满 `MAX_DIAGNOSTIC_EVENTS=96`；session close 不受该计数约束再发一条 `node-playable-input-summary`，故最坏可输出97条 Node diagnostic event。现有测试只分别断言 baseline ≤96、input summary=1，未覆盖同一 session 的总数。

最小修复不改变任何产品行为或诊断字段：为 terminal input summary 预留一格，令 baseline event cap 为95（或以一个共同总计数确保 baseline + terminal summary ≤96），并添加同一 session 同时产生满额 baseline 与 input 的联合上限测试。完成后，该诊断可用于下一轮 CI 定位；在修复前不应把 `2c3d277` 称为合同内可执行冻结。

## CI `34226402889` / merge source `a1f6dd30f24add8d2a7542eeb2ad1a6583a08fa6`：输入对账后的 forced camera-turn 失败

本轮只读检查 `/tmp/seedlands-web-node-playable/ci-input-34226402889/`、forced failure JSON、两张原帧、CI job log 与现有 Pointer Lock/input 源码；未运行测试、CI、browser 或构建，未修改工作树。

默认 gate 的三次 initial 仍在30秒首屏失败。forced journey 这次已经通过 initial 9块、Pointer Lock 和 W 移动：从 `[-3.5,18,-3.5]` 到 `[4.22849,18,-15.08026]`，故先前的 W 零位移不再是本次 forced 的终止原因。early/moving 两帧显示同一真实运行中的 HUD 与远端场景；moving 帧的 FPS 约2、frame 1024ms，说明图形环境依旧很慢，但这不是对性能的采样结论。

forced 随后在 camera-turn 失败。failure JSON 同时表明页面仍 `pointerLock=game`、focused、visible、`interactionBlocked=false`；movementStart 与 failure current 的 view angles 完全同为 `[-33.365051...,54.441405...]`。因此在 W 已使权威位置移动约15m之后，两个 `page.mouse.move()` 没有令 controller yaw 发生可观察变化。该事实排除“W 未输入”作为这一断言的直接原因，但尚不能从现有数据区分 Playwright/Chromium Pointer Lock 下没有派发相对 mousemove、事件派发后没有被 controller 消费，或低帧率期间自动化 mouse 时序与截图/readback 的交互。

输入对账已成功收集且显示另一个独立问题信号，不能拿来解释 yaw：client 最终 `sent=103`、`accepted=69`、`late=28`、`resync=33`，Node summary 一致；多条非中性 row 有 inputSequence 对应的 target、admission tick 和 decision。特别是 sequence 478 的 target 1934 被 accepted，而后 sequence 480 的 target 1913 被判 `target-out-of-order`，随后仍有 accepted 与 late。该 target 回退是真实远端输入稳健性候选，适合另立受控 RED（乱序/陈旧 snapshot 后 projected target 不得对同一 session 向后退，并保持旧 decision/resync/jump 语义）；它不是相机转向的因果证据，也不能在本轮直接调整 lead、lease 或 Node late 规则。

camera-turn 的最小下一步应保持 test-only、单变量和有界：在原两次真实 `page.mouse.move()` 前后以 capture-phase 的被动 `mousemove` observer 记录最多16条 `{movementX,movementY,pointerLockElement}` 与计数/非零计数，并在每个 call 前后读取已有 viewAngles；另只记录两次 screenshot 的外层耗时。这不替换为 `dispatchEvent`、不注入 yaw、不改变 product pointer-lock handler/render/input/timeout。若 observer 没有 nonzero relative event，问题收敛为 CI Playwright pointer-lock mouse 兼容性，需要修测试驱动方式后再重跑完整旅程；若有非zero event而 yaw仍不变，才检查 controller handler/生命周期；若只有 screenshot 前后发生长阻塞，再以该单项确定是否影响自动化时序。不能由当前 late/resync、frame time 或天空视角直接推出任何一种。

这轮仍无成功 forced run JSON、转头/跳跃/挖放/durable/reconnect/restart 证据，PR17 不准出。此前 `2c3` 的最多96条 Node diagnostic event 静态上限阻断也仍适用，除非后续冻结显式以共同预算闭合并覆盖联合测试。

### CI 无 GPU 功能环境的 Low/viewport 提议：技术审阅意见（未实施）

不建议把固定 Low 质量或更小 viewport 作为当前 camera-turn 的直接修复：本次的硬证据是 W 已完成而 yaw 始终为零；只有被动 `mousemove` 的真实 relative delta 才能分开“CI 根本未派发相对鼠标事件”和“事件已派发但 controller 未消费”。前一类不会因画质或像素面改变而解决，后两类也不应靠降低负载猜测。

若后续单变量观察显示 relative event 已到达、controller 路径正确、软件 SwiftShader 的 frame/readback 负载才使完整功能旅程失去可执行性，可以通过单独 spec 修订定义受支持的“CI 功能兼容 profile”：固定产品已有的 Low 质量和明确 viewport，保留远端 Authority、真实 Pointer Lock/键鼠、9个 required postrender、30秒首屏、完整挖放/durable/reconnect/restart断言。profile、viewport、renderer 与独立 `/tmp` evidence 必须一起身份绑定。先在1280 viewport下只切 Low，必要时再以单独决定讨论 viewport，避免两变量同时改变掩盖原因。

该 profile 只能证明该明确兼容配置下的功能闭环，不能取代本机 native 1280 source-bound 五帧，也不能把当前默认 Linux gate 的失败改写为通过或静默放宽既有合同。是否把它提升为 CI required renderer/profile 是范围与产品契约决策，须在 mouse 观察结果后由人明确批准；本轮不实施也不作性能结论。

## 完整 Chromium new-headless 候选：测试环境兼容性审阅（未执行）

本轮按固定 validation contract（SHA-256 `1ae93e3714a6f09ecc4a6686b4c606ab0e28fde5068bb50d0592c2f8f665262b`）只读审阅当前未提交的 `playwright.config.ts`、图形身份采集、PR17 CI step 与 spec；没有运行浏览器、CI、构建或性能样本，也没有修改生产代码、测试、证据、index 或 CI。当前 working tree 含 root/Sol 的未提交 WIP，以下结论只针对已见 delta，不能当作已冻结结果。

该候选有明确依据。当前本机默认会选择显式 `/Applications/Google Chrome.app/...`，而 Linux CI 的默认 headless 未设 `channel`；Playwright 1.62.1 官方文档说明，未设 channel 的 headless 使用独立 Chromium headless shell，`channel: 'chromium'` 则选择完整 Chromium 的 new headless，并把它定位为更适合高准确 E2E 的模式。因此相同 SwiftShader renderer 或 version 字符串不能证明两个实际可执行产品、Pointer Lock 行为或调度语义相同。它比降低 viewport 或把产品切到 Low 更窄，且无需改变产品。

`SEEDLANDS_E2E_FULL_CHROMIUM=1` 的 config 实现本身正确：它禁用本机 system Chrome 路径，并仅设置 `channel: 'chromium'`；1280×720、headless、Medium、base path、30 秒首屏、真实 Pointer Lock 键鼠、挖放、保存、重连、重启和原有断言均不变。source-bound 输入已包含 `playwright.config.ts`；每次 connection 的 identity 会记录 `configuredChannel`、managed/system executable 来源、实际 browser version、user agent 和 WebGL identity。成功 JSON 与失败诊断都会继承这些字段，不含口令。

本次 CI 接线没有阻断。正确对照基线是已失败、已启用三个 SwiftShader flags 的 forced journey；本轮只在该基线增加 `SEEDLANDS_E2E_FULL_CHROMIUM=1`，所以相对 forced 基线只有 browser channel 这一变量。原 default headless-shell gate 保留、不改 required 名称，且不会因 full Chromium journey 通过而重写 default 的失败。

因 default 与 forced 之间原本已有三个 GL flags，结果仍不能单独归因于 channel 相对 default gate，也不能证实或否证 SwiftShader flags 的影响。它只能回答：在相同 explicit-SwiftShader 兼容配置中，managed full Chromium new headless 是否能完成原完整 journey（含错误认证身份缓存）。成功才构成该明确测试环境可工作的证据；是否把它提升为 CI required 环境，仍是后续测试契约决定，而不是产品修复或性能收益结论。失败则记录实际 stage，关闭该兼容候选后再使用既定的被动真实 `mousemove` 观察定位 yaw，而不继续调图形参数。

## d7f86ec：输入单调与 Node 诊断总上限定向审阅

按固定 validation contract（SHA-256 1ae93e3714a6f09ecc4a6686b4c606ab0e28fde5068bb50d0592c2f8f665262b）及 seedlands-code-review，本轮只读审阅该普通提交相对父提交的7个文件、相邻 client/session/core gate、现有 scheduler 和 CI 34227894490 failure artifact；未运行 Vitest、browser、构建或 CI，未改源码、index、证据或工作树。当前 HEAD 为 d7f86ec，tree 为 4200069793b77383a51f2b7944329778459117e6；git diff --check 无输出。实施者记录的两文件13项定向测试、typecheck 和 lint 为已有证据，本人未复跑。

结论：未发现可证实的 P0/P1/P2 阻断。修复把已真正发送的 input-state target 保存在远端 connection pipeline 内，后续 snapshot 接收时刻重置造成的 elapsed 投影回落，不能再低于已发送 target。新 target 同时受既有 Node current+120 边界限制；pipeline 只在 fail/dispose 清除时重置高水位，未改变500ms jump lease、单 in-flight/latest coalescing、Node late 判定或 pending=32预算。受控 RED/GREEN 覆盖了1935→1914、旧 decision 不 flush、matching decision 仅 flush latest、edge/state 同 target，以及极端 target 的120 tick cap。

此前 total-96 缺口已闭合：baseline diagnostic emitter 最多95条，close 是幂等并至多调用一次 terminal input summary，故同一 diagnostic callback 下总数静态至多96。更新后的 Node test 在 close 后检查总数≤96、baseline≤95、summary恰一条。它只影响 test-only diagnostic 输出，callback 失败仍隔离，未触碰网络协议、capture、取消或 cleanup。测试的 unavailable baseline 实际不会产生95条 stage event，所以上限主要由常量和幂等 close 证明；如需更强单测，可注入 stage emitter 命中第95条并断言 summary为第96条，但不是当前阻断。

## CI34227894490：完整 Chromium 已跨过输入/转头，当前失败为 placed mesh revision

只读复核 forced failure JSON、early/moving/turned三张原帧及 journey 断言。artifact source 是 PR merge bb45eebb0c2cfb3f907dab913bec5b09705cbc3d，不是后出的 d7f86ec，故不能验证本次 target 修复；按 root 提供的身份，该 tree 与本地当时 f4aaded 一致。环境回读为 managed Chromium channel=chromium、HeadlessChrome151、WebGL2 ANGLE Vulkan SwiftShader。

该 forced run 已通过 initial9、Pointer Lock、W、yaw、jump、break及placement前置交互。本人查看 early、moving、turned：三帧均为同一森林 HUD 的真实运行，moving/turned 显示视角和手持物变化；软件环境约1 FPS，不能作为性能结论。失败发生在生成 placed 稳定帧之前，故挖放可视化、保存、重连和重启均未获 CI 通过。

实际失败是 break-and-place 后5秒内 renderedRevisionAt(placedVoxel)仍为1，而 Authority chunk revision已为4。failure JSON 同时为 worldRevision4、loaded46、rendered25、readyBaselines43，没有输入 zero-distance 或 yaw=0 故障。它支持“权威 mutation 已推进而 presentation mesh revision 未及时结算”的新问题分类；不支持调 timeout、target lead、lease、画质或 seed。

下一轮 scheduler RED 合理，范围应限制在 queued 选择而不抢占 preparing/in-flight。当前 nextQueuedRequest 的 rank 为 base priority + floor((dispatchCount-enqueuedAtDispatch)/8)；老 streaming backlog每8次 dispatch 增一分，能压过后到 interactive/interative-fluid，与失败假设一致。最小 RED：建立老 streaming backlog、释放一个 slot后插入 interactive，证明旧排序先取 streaming。GREEN 仅改变 queued selection，使 interactive 在有界 dispatch 数内被选，同时在持续 interactive 到达时保证每固定N次仍派发 streaming，避免反向饥饿；并保留已有 priority promotion、failed/replacement/visibility barrier 语义。该确定性修复通过后仍需完整 Chromium 旅程拿到 placed、durable、reconnect、restart 的 source-bound JSON及原帧，才能准出。

### 独立审阅 Findings

未发现可证实的 P0/P1/P2 问题。覆盖限于 d7f86ec 输入/diagnostic delta 和 CI failure 归因；尚不存在的 scheduler 公平性实现未作准出。

## 4e63fb7：queued mesh 公平调度 delta 审阅

按固定 validation contract 对 d7f86ec..4e63fb7 的6文件只读审阅；未运行测试、browser、构建或 CI，未改源码、index 或工作树。实施者报告的9文件30项测试、typecheck、lint、Prettier 和 diffcheck 为已有结果，本人未复跑。

结论：无新增阻断。改动只把 nextQueuedRequest 对 queued Map 的选取移至纯 selectMeshRequest；prepare、active/inFlight、replacement、failed preparation、visibility barrier、worker settlement 和 cancel 路径没有改变，因此不会抢占或取消已 preparing/in-flight 的任务。priorityBypasses 随 beginScenario 清零；空队列和 oldest=preferred 均归零，避免跨场景或无竞争队列累积债务。

旧实现把每条 request 的 dispatch 老化直接叠加 rank，5条同龄 streaming 在17项 fluid 后均能高于后到 interactive。新选择固定基础顺序 interactive-fluid > interactive > streaming；当首条 oldest 被优先级请求连续绕过8次，第9次只选择一条 oldest，并重置 burst。RED/GREEN 精确覆盖“新interactive下一个派发”及“持续fluid时旧streaming最迟第9项派发”。这既避免整批 streaming 压过编辑，又保证 streaming 不会饿死；它不改变 request priority promotion、force remesh、failed/replacement 或 barrier 身份。

限制：这个确定性队列修复只解释 CI34227894490 中 Authority revision4、render revision1 的一个可检验调度路径，不证明完整 Chromium 旅程、5秒 rendered revision、placed稳定帧、durable、reconnect 或 restart 已恢复。root 的干净完整旅程仍是下一步所需证据。

### 独立审阅 Findings

未发现可证实的 P0/P1/P2 问题。

## 7274b27：native 与 managed full Chromium 软件图形的最终本地证据复核

本轮按固定 validation contract 只读复核 5a99e78 保存的两套 evidence、7274b27 Git tree、当前真实 Node dist hash 与10张原始 PNG；没有运行 browser、构建、Vitest 或 CI，也没有改源码、index 或证据。5a99e78 只保存12个 evidence 文件，运行 source 是其父 7274b27，故 evidence commit tree 不同属于预期，不破坏运行身份。

两份 JSON 均记录 sourceSha=7274b273fabee2fdb5bb5d43d043db23d6778d82、sourceTreeStatus为空、40个 sourceInputs。本人逐项以该 Git tree 重新计算39个版本化文件 hash，并对实际 apps/node-server/dist/node-server.js 计算 hash；native 与 software 两套均为40/40匹配，没有 source 或 dist 漂移。native identity 为本机 Google Chrome152/ANGLE Metal M3 Pro；software identity 为 playwright-managed channel=chromium/HeadlessChrome151/ANGLE Vulkan SwiftShader，且 initial、reconnect、restart三次连接身份一致。

两套真实完整 journey 的 JSON 均满足远端 Authority 链条。native initial/reconnect/restart 都是 loaded=rendered=readyBaselines=9；software 三阶段 rendered均为9，initial/reconnect多出已加载/ready的额外 streaming chunk，不改变必需3x3已 rendered 的结论。两套从初始位置均真实移动超过1，yaw分别由 -150.365 改至 -116.565 和 -198.465；jump权威 y 分别从18升至18.77及18.169999。break后 worldRevision 1→2，place后到3；placed voxel/type/revision 分别为[-1,20,-2]/2/2与[1,18,3]/2/3。两套手动重连保持旧 Node epoch、tick从420→569和1126→1495继续；重启后均获得新epoch并恢复放置 voxel。stop durable commit 分别为707与1839。

本人逐张查看 native 与 software 的 early、moving、turned、placed 四帧。两套 early/moving/turned 都是同一真实森林 HUD/Pointer Lock 场景，镜头方向在移动/转头后可见变化；native placed 显示瞄准处的放置泥土表面，software placed 清楚显示独立泥土方块及放置 HUD。没有加载遮罩、start-error或空场景。软件帧的低 FPS/高 frame time 只作为环境观察，不作性能结论。第五 restarted 原帧与 JSON 已保留，但本轮重点视觉复核覆盖 early/mid/turn/stable place。

结论：7274b27 具备两套有效、source-bound 的本地完整功能与视觉证据；其中 managed full Chromium+SwiftShader 也完成原完整 journey。根据 root 已报告，本机 native完整门禁为37 Vitest+2 Chromium通过（19.0秒），software browser两项通过（38.3秒）；本人未复跑。当前 CI34230070975/Linux终态仍待 root 核验，所以本地结果不能宣布 Linux CI、required gate 或PR17最终准出。

### 独立审阅 Findings

未发现本地 source binding、真实远端旅程或原始帧的阻断。

## 放置 revision trace WIP 与 CI34230070975：只读审阅

本轮只读审查未冻结 WIP 的8文件、现有 remote harness 安装边界和 CI34230070975 artifact；未运行 browser、构建或测试，未改源码、index 或 CI。CI Static/Build 已成功；managed full Chromium 的 source 477eae658ae5cb1b1135606f464bd4d28bed3293 在 break-and-place 仍以 expected chunk revision2、rendered revision1 超过既有5秒失败。该 source 早于本 WIP，failure JSON 的 renderTarget/renderTrace 为空，不能用它判断新诊断或提出具体产品修复。

诊断链路的行为范围正确：remote evidence 仅在 ?harness 且 RemoteAuthorityClient 的既有安装分支暴露；meshTraceAt 不发网络消息、不请求 Authority、不运行本地 Authority/Logic/Fluid、不改变 request priority、worker、render 或 input。setMeshTarget 只在挖掘/放置的现有等待前和失败结算时各读取一次，非逐帧；目标坐标只换算 chunk key，筛选该 key 对应 traceId，输出 events.slice(-64)。traceName 加在 exportChromeTrace 的已有 marks 上，因此未完成 trace 也可定位到目标；已有 traceId 链可带出 queue、prepare、worker、commit 和 scene/postrender marks。复用 world.telemetry 会刷新既有 gauge 值，但 snapshot 已有同一观察语义；按 root 澄清，这不改变世界、输入、调度或渲染产品行为，不构成阻断。

**P1：trace artifact 未对任意 span attributes 做输出 allowlist。** meshTraceAt 当前直接返回 Chrome trace 原始 event。MeshPreparationFailure 会把任意 Error.message 的前240字符放进 event.args.errorMessage；JourneyProgressDiagnostics 将 renderTrace 原样写进 /tmp failure JSON，未经过现有 journey 的凭据 redaction。当前样本不必然含凭据，但该新入口把未来/异常路径的任意内部错误文本带入可上传 artifact，违反本合同“不输出凭据”的边界。最小修复是在 meshTraceAt 将所选 event 映射为诊断所需 allowlist：name、cat、ph、ts、dur、tid，及仅 traceId/traceName；丢弃所有其它 args/attributes，尤其 errorMessage。这样仍能判定 queued/prepare/worker/upload/postrender，且不需要扩大 telemetry 或协议。

建议同时补一个小的确定性 coverage：目标 trace 超过64条时输出严格≤64，并证明含 attributes.errorMessage 的原 event 不出现在返回值。当前 telemetry test 仅断言 mark 有 traceName；root报告的 native 诊断57条及 postrender 可证明真实入口可读，但未覆盖64边界和净化。software 诊断在挖掘前失败且 mutation仍为0，只说明下一次 trace 必须覆盖挖掘等待前的目标，不能归因于显示结算。

### 独立审阅 Findings

[P1] trace failure artifact can include arbitrary internal error text. File: apps/web/src/app/world/remote-playable-evidence.ts. Trigger: target chunk trace contains MeshPreparationFailure or another attributed span. Impact: unredacted errorMessage reaches /tmp/CI artifact through journey diagnostics. Fix: map selected events to an allowlisted diagnostic schema before return; add the two bounded/sanitization tests above. Confidence: high.

## 2026-09-08 CI34232573762：软件图形兼容对照取舍（只读）

**完成状态：** 已审阅 source `9029108ee143d4f31782f37ce4a509ef92dab125` 的 CI 原始工件及本地未提交的 Low 对照接线；未运行浏览器、构建、CI 或性能采样，未修改版本库文件。

**已证实：** managed full Chromium + SwiftShader 已完成首个 3×3 rendered、真实 W 移动和真实 yaw 转头；在 jump 阶段的既有 5 秒断言失败，因而尚未到挖放目标、`renderTarget` 与 `renderTrace` 均为 null，不能用本次失败解释放置显示。失败轮询末次 Web y 为 `18.000001`，随后关闭前的同一权威状态为 y `18.103334`；输入汇总为 Web/Node 一致的 accepted 61、late 20、resync 20，`target-out-of-order` 为 0。指针锁、焦点和可见性均正常。原始 turned 帧 HUD 记录单帧 2457 ms、最近长帧约 1059 ms。这证明该 Linux 软件图形组合不能稳定在当前 5 秒交互窗口观察完整旅程；它不证明 jump edge、500 ms lease 或目标投影存在产品缺陷，也不是性能采样结论。默认 headless-shell 的首屏失败仍是独立、未解决的覆盖缺口。

**Low 对照结论：可执行，无新增阻断。** 仅在现有 forced full-Chromium/SwiftShader CI 步骤设置 `SEEDLANDS_WEB_NODE_QUALITY=low` 是受控的单变量兼容试验：viewport 1280×720、seed、真实键鼠、30 秒首屏、各 5 秒状态门槛、500 ms lease、Node fixture 和完整保存/重连/重启断言均保持。`journey-quality.ts` 通过实际启动页 `#quality` select 设置并断言 value；默认仍为 medium。成功 JSON、失败 progress 和各 connection graphics identity 都记录 requested quality，且 sourceInputs 已纳入 helper 与两份既有质量配置。Low 是既有产品配置（半径 1、关闭阴影、较小分辨率等），不是隐藏测试开关；首屏仍逐项要求 9 个 required chunks 已 rendered。建议使用新的、独立的 `/tmp` 输出目录，保留本轮 Medium/SwiftShader 失败工件。

若 Linux Low 完整通过（含错误认证图形身份），结论只能是“managed full Chromium + SwiftShader + Low 软件 CI 功能档位通过”；不得写为 Medium 修复、性能收益或默认 shell 通过。本机原生 Medium 的完整证据仍单独成立。若 Low 仍失败，应以失败阶段和已有 trace 继续定位，停止继续降画质、放宽时间、租约或输入投影。

**26850f6 P1：已闭合。** `captureRemoteMeshTrace` 只导出 name/cat/ph/ts/dur/tid 及 `{traceId, traceName}`，不再透传原始 span attributes。定向测试构造 70 个含 `errorMessage` 与任意 `other` 字段的事件，验证目标 trace 共 71 条时仅保留最近 64 条，且 JSON 不含两种敏感合成值。现有 `meshTraceAt` 仍仅由 harness 条件暴露；其 telemetry 读取沿用既有 snapshot 的 gauge 语义，没有输入、调度、渲染或世界 mutation。

**限制与剩余工作：** CI34232573762 未准出；本结论不替代下一次 Linux Low 的完整原始 JSON、5 帧、source-input hash、Node durable/reconnect/restart 记录及 CI 终态审阅。

## 2026-09-08 CI34235218286：Low 站位辅助失败的最小测试驱动修复（只读）

**完成状态：** 已审阅 `afe5e0cfca86ae954ef35de581e3b1c4061fce9e`（API 已核验 parents `840f4fb` + `aeaa9ce`）的 Low 工件和输入通路；未运行 CI、浏览器或测试，未修改版本库文件。

**可证实的失败范围：** Low 的 managed full Chromium/SwiftShader 已通过首屏、W、yaw 与 jump，在 `alignWithAimedColumn` 的第 24 次纠正后失败，尚未设置 mesh target。最后权威位置 `[2.233591,18.000000,0.427669]` 相对 aim `[2,17,0]` 的水平中心距离约 `0.276`，只超过现有 `0.25` 门槛；Web 在失败快照为 accepted 99/late 15，Node 关闭汇总 accepted 101/late 15，且没有 target-out-of-order。现有 helper 对每次真实两键只保持 35ms、release 后固定 sleep 70ms，完全未确认该次非中性 `input-state` 已发出、neutral 已发出、或对应 authority correction 已被 Web 消费。该 fixture 时序缺口是确定的；现有记录不能证明碰撞、目标投影、lease 或产品移动逻辑错误。

**最小可接受修复边界：** 只在 `alignWithAimedColumn` 的测试驱动中，以现有 Playwright WebSocket `framesent`/`framereceived` 和现有 C0 decoder 创建短生命周期观察器。每个纠正必须：

1. `keydown` 仍至少 35ms，并等待与该方向匹配的非中性 `input-state` 实际发出，记录其 client inputSequence；
2. 仅在该 sequence 的 `input-decision: accepted` 后 release；accepted 只说明 Node `receiveInput` 接受，不能当作 authority 已发布或 Web 已应用；
3. 等待后续 neutral `input-state` 发出及其 accepted decision，再等待 inbound `authority-state.correction.acknowledgedInputSequence >= neutralSequence`，且 correction 的水平 velocity 为零；随后以 remote evidence 的权威位置确认该 correction 已在客户端可观察，才开始下一次纠正。

Node 的 decision 与 authority-state 是不同消息：session 在 `await authority.receiveInput()` 后立即 enqueue input-decision，而 authority-state 由后续 publication enqueue；因此第 2 步单独不足。ack 比较应使用 Node 投影出的 **client** acknowledged sequence，不能假设 server sequence 等于 client sequence。若 observer 与 page 消费顺序不可由 Playwright 保证，最后一项需以 `expect.poll(evidence)` 读取对应 correction 的位置完成客户端可观察确认；不能把 frame-received 回调本身标为“已应用”。

观察器仅允许保存 `input-state` 的 sequence/是否非中性、input-decision 的 sequence/decision，以及 authority-state correction 的 acknowledged client sequence、位置和水平 velocity。不得保存或输出 handshake、access key、原始 frame、错误文本或其它 message payload；只在对齐期间 attach，成功、超时、异常和 page close 的 `finally` 都应 off 所有 socket/page listeners 并清空状态。observer 不发送帧、不调用产品 API、不影响 websocket 回调、世界、输入、调度或渲染。

保持 24 次上限、0.25 距离、Low 配置、500ms lease、后续断言和完整旅程不变。屏障必须有明确的、按 protocol/测试总时限受限的等待失败诊断，输出仅 allowlisted sequence/decision/ack/velocity；不要用无限 poll 或更大 lease/timeouts 掩盖未结算。RED 至少应复现“固定 35+70ms 后下一纠正先于 neutral correction”以及“accepted 不等于 applied”；GREEN 应要求同一 sequence 的 neutral accepted + correction ack + zero velocity，不能只断言 accepted。

**限制：** 这是一项 fixture 驱动的确定性修复建议，不证明下一次 Linux 完整旅程必过，也不构成产品移动、画质或性能结论。

## 2026-09-08 `2dabe70` 测试驱动 delta（静态只读）

**完成状态：** 通过静态复核；本段仅覆盖 `2dabe70` 的五个测试驱动文件，不构成全 PR 或 Linux 旅程准出。未运行浏览器、全套测试或 CI，未修改版本库文件。CI34235218286 的 static/build 成功、Chromium 失败状态保持不变。

**符合已确认的最小范围：**

- `alignWithAimedColumn` 仍保留最多 24 次、world-space 的 forward/right 基向量、实际 Playwright WASD、`0.25` 目标中心门槛和其后的所有挖放/保存/重连/重启断言。每次现在选择朝目标投影较大的单一真实轴键，`player-input-stream` 的同一 forward/right 公式证明 `expectedMovement` 与实际发送的 world-space `moveX/moveZ` 一致；没有伪造 DOM 输入。
- pulse 在 keydown 后观察同方向非中性 C0 `input-state` 的实际 `framesent` 与同 sequence 的 `input-decision: accepted`，且至少保持 35ms；release 后只接受该 movement sequence 之后的 neutral input，要求 neutral accepted、authority-state 的 client acknowledged sequence 覆盖 neutral sequence、水平 correction velocity ≤ `1e-6`，最后以 remote evidence 同 physics tick/同 authoritative position 确认 Web 客户端可见。它没有把 accepted 当作 applied。
- 整个 pulse 的 deadline 固定为 2s，不改变 500ms protocol lease、距离门槛、画质或后续测试等待；超时、socket close、page abort、evidence 失败都走 `finally` key-up 和 observer listener 清理。测试覆盖慢 sampling、错误 decision、旧 ack、非零 velocity、未反映到客户端、socket close、abort、timeout 与 allowlist failure。
- observer 只解码 ≤16KiB 二进制 C0 control frame，只保留 sequence、neutral/方向匹配、decision、correction 的 tick/client ack/position/velocity；不保留 handshake、raw frame、access key 或 decode/error text。它只附着当前 exact Node URL socket，并在成功、失败和 close 时 `off`，不会发送帧或触碰产品 world/input/scheduler/render。
- 新 helper、alignment 与其定向测试均在 journey `sourceInputs` 中，因而后续 JSON 可绑定该测试行为。

**结论：** 未发现阻断该测试驱动 delta 的静态缺陷。2 秒屏障是有界 fixture 结算条件，不能据此宣称下一次 Linux 完整旅程已通过；仍需冻结 source 的完整原始 CI/浏览器证据复核。
