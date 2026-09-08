# 独立验收当前状态

最新审阅源码为25b59fe，PR17仍未准出。CI34213458251的Static verification和Production build通过；Chromium初始同步仍未完成9个必需区块。已到达和已校验的分页数量一致，digestingTransfers为0。加载时渲染竞争是待预注册对照验证的假设，尚不能称为已定位的根因或已采用的优化。

以下保留各个源码检查点的审阅及其证据限制；早期未验项目只以明确记录的后续检查结论覆盖。

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
