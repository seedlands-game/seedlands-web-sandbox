# Node 公开网络检查点独立审阅

审阅对象：`b6ab3e03069eceddd00d5ee9d62d9bf439c28f0a`（`origin/codex/web-node-playable` 同一 SHA）。所有源码证据均以 `git show b6ab3e0:<path>` 读取；未把共享工作区中未提交的 Web/Node 草稿作为审阅对象。本检查点尚未完成 Web 连接和完整游玩闭环，不能据此声称功能验收。

## P1：基线与后续 publication 没有不可交错的因果屏障

### 可复现触发

1. 已认证会话发送合法 `interest-update`，让 `captureBaseline()` 获得一个主块及 26 个 halo 的快照；descriptor 的 `authorityCheckpoint` 记录此刻的 revision/commit 水位。
2. 在 descriptor 或任一 baseline page 发送期间，权威侧发生一次提交（例如同一已认证会话的 `player-action`，或 Fluid/Logic 的普通提交）。
3. Authority publication listener 立即将 `authority-state` 入同一个 socket 的发送链；它没有 baseline id、capture checkpoint 或“等待 bundle 完整”的门禁。该 state/delta 因此可插在 descriptor/page 流中。

### 冻结源码证据和影响

- `apps/node-server/src/node/server/node-playable-network-session.ts:230-313` 在 capture 后逐页 `await enqueue()`；每个 page 都是独立发送，没有在发送 bundle 时冻结或缓存 publication。
- 同文件 `206-227` 的 `publish()` 可在上述任意 await 间调用 `enqueue('authority-state', …)`；`371-477` 也允许 `player-action` 与 interest capture 并发处理。
- `packages/game-core/src/server/protocol/network-reference-baseline-types.ts:74-87` 的 descriptor 带 `authorityCheckpoint`，但 `packages/game-core/src/server/protocol/network-reference-world-commit-presentation.ts:237-246` 明确把每条 commit 的 `causalCommitSequence` 投影为 `null`，只给 publication upper bound。

这违反本 change 的“capture/订阅/后续提交连续衔接”合同：接收端不能从网络会话获得一个已证明的“基线完成后才应用哪些提交”的屏障。若它即时应用前到的 delta，稍后旧 baseline page 会覆盖它；若它一律丢弃，则会漏掉 capture 后提交。需要在 Node session/protocol 形成明确的 capture checkpoint + deferred publication/按 chunk revision 可验证结算，或把相同保证实现为可测试的消费者契约；仅依赖发送时序不够。

缺失测试：真实 Node+WebSocket（或 session 级）测试应在 capture 后、最后一页前注入提交，断言 wire 顺序/水位让消费者可以唯一地保留该提交并完成 27 块基线；还应覆盖 publication retained-commit overflow 的 `resyncRequired` 与正在传输的 bundle 的交互。

## P1：关闭中的 capture 不能中断等待，可能阻塞服务端优雅关停

### 可复现触发

1. 发送一个空间合法但尚未加载、需要 27 块准备的 `interest-update`，使 `sendBaseline()` 停在 `await authority.captureBaseline()`。
2. 立刻关闭浏览器或对 Node 发 SIGTERM。
3. session `close()` 发出取消但不终结原 capture await；`whenDrained()` 仍等待 `baselineTail`。网络服务器的 `close()` 又在停止 socket/HTTP server 前等待它。因此只要任一准备请求迟迟不结算，关停一直被该已断线会话拖住，外层 30 秒 deadline 最终会走失败退出而非已确认 durable shutdown。

### 冻结源码证据和影响

- `apps/node-server/src/node/server/node-playable-network-session.ts:167-176` 仅 fire-and-forget `cancelBaselineCapture()`；`230-313` 的 `sendBaseline()` 继续等待同一 capture，`503-509` 的 `whenDrained()` 等待 `baselineTail`。
- `apps/node-server/src/node/server/node-playable-network-server.ts:186-203` 在关闭 HTTP/WS 前 `await session.whenDrained()`，没有 session shutdown budget。
- `packages/game-core/src/server/dedicated/dedicated-baseline-capture.ts:87-99, 147-164` 的取消只是设置 flag；在 `Promise.allSettled(prepared)` 返回前不会结算 capture，也没有把 cancellation signal 传到已发出的 chunk 请求。
- `apps/node-server/src/node/server/node-server-runtime.ts:188-195` 只有外层 runtime stop 的 30 秒 race，因此这里会转成失败路径。

这使一个已经断开的本机客户端能够留下被 retain 的 capture/准备工作并影响世界的正常关停，不满足“取消/关闭实际释放资源”的边界。修复应让关闭能取消并从 session 的 drain 预算中脱离未完成 capture（同时确保 capture owner/references 最终收回），或为 capture/网络关闭加入可观测的有界期限与确定的失败清理。

缺失测试：使用可控的 Authority lane，让 `captureBaseline` 卡住；关闭 socket 后断言 cancel 被调用、session/server shutdown 在预算内结算、HTTP listener 关闭，且迟到 capture 完成不会再送 descriptor/page 或重新占用 active session。

## 已核查且未发现缺陷的边界

- C0 decode 并非仅做 envelope cast：`packages/game-core/src/server/protocol/network-c0-codec.ts:99-118` 依方向调用 `isPublicInboundMessage()`；后者在 `network-message-semantics.ts:267-324` 实施严格字段 allowlist、session ref、动作类型、坐标、序号和 interest key 校验。因此 `createSession` 中的类型断言本身没有绕开公开 allowlist。
- `node-playable-network-server.ts:73-79` 精确比对 Origin 与路径，并限制 8 个未认证升级；`:104-107` 校验 transport 与 constant-time key；`:107-137` 用 `active || attaching` 拒绝第二连接。CLI parser 在 `node-server-options.ts:42-57` 限定 127.0.0.1/::1、有效端口和精确 http/https origin。
- `node-playable-network-session.ts:316-368` 的 action requestId 高水位和 256-entry receipt cache 阻止缓存淘汰后的旧 id 重新执行；`:371-420` 输入序号/目标 tick/过期检查、`:488-500` frame 与速率上限；`:140-164` 发送队列/bufferedAmount 上限。以上是静态审阅结论，仍需真实进程负向验证。
- `node-authority-publication-listeners.ts:6-21` 已隔离 listener 及其 `onFailure` 异常，单个网络 consumer 抛错不会直接杀 Authority lane。

## 验证证据缺口（不重复现有全套）

已有同 SHA 证据为 131 个 Node 测试和 dist-only 的 listen + 合成口令 hello/welcome smoke。冻结提交的 `tests/server/network-playable-protocol.test.ts` 只覆盖 codec allowlist 的三个纯协议例子；`scripts/verify-web-node-playable-dist.mjs` 只覆盖正确 Origin/key 的成功路径。仍缺少真实 WebSocket 的错 Origin/key/version、第二连接、非法/超限 frame 后正常连接、速率/背压、关闭清输入、capture 取消、动作重复/淘汰、checkpoint durable 与 Authority publication 发送失败测试。

## 合同 reportFields 回填

- 完成状态：完成；发现以上两个 P1，建议在继续 Web 闭环前修复或明确升级其协议/停止语义。
- 提交和推送：未进行任何 Git 写入；审阅基线为已推送 `b6ab3e0`。
- 变更：只新增本报告；未修改生产源码、测试、合同、Git index 或提交。
- 验证结果：冻结源码静态调用链审阅完成；未运行工作区测试/构建，因为工作区已含未提交后续草稿，运行结果不能归因于冻结 SHA。
- 限制：未读取 `.env` 或任何真实凭据；未进行真实 Web 完整闭环、性能采样或公网测试。
- 剩余工作：修复 P1 后，以新的冻结 SHA 做真实 Node+WebSocket 负向和取消测试；随后由独立最终验收覆盖 Web 输入、重连、持久化恢复和浏览器 E2E。
