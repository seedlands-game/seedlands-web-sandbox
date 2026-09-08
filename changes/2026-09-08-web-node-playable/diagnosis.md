# Web 连接 Node 的本机单人完整闭环

状态：Active。类型：Breaking。用户已在确认单世界、单玩家、本机连接、手动重连与完整游玩/保存闭环后明确要求“从当前分支切继续迭代，按完整闭环推进，定期 commit+push”；该直接授权覆盖本合同的实现，不重复索取同范围 hash 许可。

## 起点与交付目标

从 codex/node-monorepo@3c727f7 新建 codex/web-node-playable，并继续以 codex/node-monorepo 为 PR #17 的堆叠 base。PR #15 的冲突与 main 整合由用户在另一台设备处理；本任务不改动 #15、不切换 #17 的 base，也不自动合并任何 PR。

交付真实浏览器连接本机 Node 世界，能移动/跳跃、挖块/放块，关闭浏览器后世界继续运行，手动重新连接与 Node 重启后恢复已保存修改。原本地世界可继续游玩。连接成功或静态首帧不能替代完整闭环验收。

## 范围与决策

- 三包方向保持 Web/Node → game-core；共享会话消费接口按真实 app 调用提取，Node/Web 不互引。Web 远端模式不启动本地 Authority、Logic、Fluid 或持久化写者，只保留输入/预测、派生镜像与网格/渲染计算。远端 canonical、流体、NPC 与世界规则由 Node 拥有。
- 显式启用实验网络入口，默认且本轮只允许 loopback。选择现有 WebSocket/T0 + C0 raw binary 参考适配，permessage-deflate 关闭；版本化为实验合同，正式 wire/transport 采用和 N2–N4 性能决策不在本轮完成。避免临时原型路径或 V8 私有序列化进入产品。
- 一个 Node 进程一个世界和一个玩家控制租约；第二个认证连接明确 SERVER_FULL，不能共享玩家控制。接入必须校验精确 Origin、访问口令与版本；口令通过首条有界握手消息提交，不进入 URL、日志或永久浏览器存储。配置通过显式口令文件路径，工具不得读取用户真实口令；自动化只用独立合成测试凭据。非 loopback、TLS/公网部署均排除。
- 公开协议使用字段和动作 allowlist，只允许握手、玩家输入/游戏动作、受限 interest/碰撞查询、心跳、回执与保存当前状态请求。禁止把内部 AuthorityRequest 或任意方法名转发到 Node：不允许 world-edit、set-player-position、调时间、暂停世界、seed/存档路径、canonical/Fluid/Logic 上传、任意 server-command、dispose 或客户端自报权限。
- 复用完整权威 baseline 投影/分页/重组/consumer 和 task 副本结算。网格收到完整主块与 halo 后才计算，远端缺块不得退为浏览器生成。interest 验证空间、key 数、版本和资源预算；入站 frame、队列、基线在途及 pending 请求均有界，取消和失效实际释放资源。
- 首次基线与后续提交通过订阅/序号屏障连续衔接，不能丢掉捕获期间的提交。输入、快照、动作回执、基线和异步结果均绑定 serverEpoch/sessionId 及相应 revision/sequence；过期结果拒绝。权威持有的 buffer 不因网络/Worker transfer detach。
- 玩家输入/预测保持当前序号与服务器 tick 校正；远端客户端只允许一个 `input-state` 在途，并以单一 latest 槽覆盖其后的常规采样，收到匹配回执才发送最新状态。目标 tick、租期与 jump edge 只在真正发送时投影；合并期间的短按 jump 在原租期内保留一次，过期、resync、断线或失败后不得复活。未知或旧回执不能释放新在途输入。500ms 输入租期失效清零移动/跳跃和连续破坏；菜单、失焦和离开主动发中性输入。远端菜单不会暂停 Node 世界。断线必须可见且停止操作，不自动创建本地世界。
- 远端启动先把玩家脚下层的 3×3 可玩区提升为首屏优先级；同 key 已进入普通 streaming 队列时只升级原请求，不复制工作。单 Worker 下这 9 个完整网格必须先于其余未开始的 streaming 请求派发，同时其它高度层继续有界流送，避免合法空网格让“首个可见网格”永久等待。首屏完成仍以每个必需 key 已 postrender 为准，不要求非空三角形；精确 chunk 高度边界按玩家脚下层计算。
- Harness 首屏超时时必须用有界匿名诊断区分 Node baseline tail/capture/projection/send 与 Web descriptor/page/ready 进度；Web 页进度分开记录到达与完成校验的计数、字节和首末时间，并汇总 reassembler active/digesting/reserved 状态。只记录前 12 个 Node 请求、最多 96 条事件及前 9 个 Web 请求，不记录 chunk key、请求 ID、bundle 身份、口令、口令文件或消息帧。诊断失败不得改变会话与原超时结算。
- 手动重连使用新连接代次和完整同步，清理旧 socket、预测、碰撞、缓存 owner 与 pending。未知结果动作不自动重发；同连接重复事务保持既有幂等语义。跨 Node 重启新 epoch，不承诺跨重启 exactly-once。保存确认必须区分已执行与已 durable；关闭浏览器本身不承诺最后一个未确认动作已落盘。
- UI 保留 Svelte 单 root/UiBridge：启动页选择本地/连接 Node，远端地址与口令、连接/取消、阶段与错误、手动重连/返回、服务端世界信息。服务器 seed 不可编辑。禁止前端表面标记远端但仍写本地世界。
- 不做多人、账户系统、自动重试租约恢复、局域网/公网/WSS部署、存档导入导出、Rust/Node-API/WebGPU、最终 codec 采用或性能收益宣称。保持原世界算法、存档 payload、WebGL2 与 Wasm 默认/TS 控制路径。

## 行为、RED 与验收设计

| Given / When                                                   | 必须观察到的结果                                                                              |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 从未实现网络的起点用真实浏览器连接 Node                        | 首个可执行 RED；不能由假的连接状态或 mock socket 自证                                         |
| 启动 Node 并选择远端模式                                       | 身份/版本通过后完整同步与实际首块 postrender；世界身份来自 Node；无本地权威与存档写者         |
| 真实 Pointer Lock 移动、跳跃与挖放                             | Node 接收输入/动作并产生权威结果；浏览器镜像和画面跟随；不经 Harness 远程管理员 edit 绕过协议 |
| 跨 chunk 移动/编辑，基线捕获同时发生提交                       | 按 revision 衔接、无缺块生成回退/陈旧碰撞；队列与 buffer 所有权有界                           |
| 菜单/失焦/关闭页面/主动断开                                    | 输入租约清零、旧连接资源释放；Node tick 与世界继续；菜单不暂停服务器                          |
| 保存确认后重新连接、重启 Node 再连接                           | 同一数据目录中已 durable 的方块修改恢复；新 epoch 全量同步、旧回复拒绝                        |
| 取消连接后迟到 welcome、旧 baseline 或动作回执                 | 不重新进入游戏、不修改新世界、pending 全部终结                                                |
| 慢 Authority 阻塞首条输入，同时客户端继续 60Hz 采样            | 网络至多一条输入在途、仅保留最新状态；恢复后不突发旧采样且短按 jump 只在原有效期内发送一次    |
| 单 Worker 已排入完整半径后等待远端首屏                         | 脚下 3×3 已有请求升级并先于其余未开始项；合法空网格计完成，其他高度层继续流送且取消仍生效     |
| 错口令、Origin、版本、第二玩家、非法/超限 frame 或内部管理请求 | 明确拒绝，不触达世界写入、不扩权、不泄漏口令；拒绝后正常用户仍可连接                          |
| 运行原本地世界和默认/wasm=off路径                              | 当前回归继续通过，不引入远端依赖或本地保存退化                                                |

测试分层：Vitest 负向协议/状态机/资源和幂等；真实 Node 进程与真实 WebSocket 验证 admission、故障、租约、保存恢复；本 change Playwright 经真实 UI 与输入完成完整闭环并记录 Node 权威侧和浏览器消费侧证据。可在 Node 测试夹具本地准备固定地形/物品，不公开测试管理 RPC。确定性 UI 采用 Playwright；本次无视觉改版或性能目标，不将功能耗时当正式性能样本。必要时读原始帧补场景判断。

基础检查分别执行 pnpm verify:static:ci、pnpm build:web、pnpm build:server、pnpm verify:node-isolation、原 Chromium regression 及当前 change 专项；新命令必须先落入 package.json。独立验收冻结源码后复核，缺口只做有界补验。不改写 Delivered 历史图片或证据，不以跳过失败测试准出。

### 首屏绘制竞争非生产实验

CI 已证明 Node 完整发送 baseline，而页面进入 mirror 前逐步变慢；已进入 mirror 的 page 校验只需约 0.1–0.5ms。加载期间连续 3D 绘制是否竞争浏览器消息调度仍是假设，先按 `render-contention-experiment.json` 做单轴、可丢弃实验，不直接改产品。A 保持现有连续绘制；B 只在远端 loading 阶段关闭 `autoRender`，每 100ms 用 `renderNextFrame` 执行真实绘制，保持 update/rAF、网络、Worker、mesh attach 与 postrender。ready 时恢复连续绘制并强制一帧验证真实 postrender；失败或关闭时恢复可恢复状态，app 销毁后准确记录 postrender 不可观察，不强制 render 或伪造完成。

正式批次固定为 `AAABBA`：首两个 A 只验证同一 30 秒失败模式，timeout 是右删失，不能当真实 ready 时间或用于速度倍率；第 3/6 个 A 是顺序稳定性对照。两个 B 必须均在 24 秒内完成脚下 9 个 rendered revision、恢复连续绘制并产出真实原始帧，才得到相对失败截止至少 6 秒的保守余量。任一正确性/画面/SwiftShader 身份失败，A 未复现，或 B 未过固定余量，都停止且不产品化。正式批次由现有 Chromium CI job 在全部原门禁之后独占 benchmark window 执行，Terra 担任 `seedlands-performance-validator` 审阅冻结输入、原始结果与准出，root 通过已授权 push 触发；实现者只做非计时功能自检。CI 接线仅限当前功能分支的一次诊断批次，原失败门禁保留失败状态，完成后移除临时步骤；失败结果与原始帧一并保留。

CI `34219596804` 的正式 `AAABBA` 中 A/B 全部在约 8–11 秒 ready，A 未复现既有 30 秒失败，按固定停止线终止 `autoRender` 候选，不改产品绘制调度，也不从该批次计算或宣称性能倍数。同一 run 的原 Active 完整旅程仍按默认图形启动在 30 秒失败；实验唯一显式环境差异是 Chromium 使用 `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`，原 gate 没有回读 renderer identity。

下一步只做图形环境正确性兼容对照：同一 Linux/base/seed、完整 Pointer Lock 键鼠、挖放、保存、关闭重连及 Node 重启旅程和 30 秒门槛保持不变，分别记录默认启动与显式 SwiftShader 的真实 WebGL2 renderer、vendor、version 和 browserVersion。Playwright 只在测试环境变量明确开启时增加与停止实验完全相同的 3 个 Chromium 参数；默认启动不变。identity probe 在点击前 arm，以临时 rAF 等待 PlayCanvas 创建真实 `Application.graphicsDevice`，首次读取后立即停止并缓存；成功或 Application 已销毁的失败路径均读取该缓存，连接结算时清除未完成 rAF。它不提前调用 `canvas.getContext`、不改变 render 状态或逐帧采样，并将身份放入成功 JSON 或失败诊断。显式 SwiftShader 对照若任一原断言失败、不是 WebGL2、未回读 SwiftShader 或不能完成原始最终帧，即判兼容失败；通过只说明该图形环境可完成原旅程，不代表性能改善。RED 为当前旅程 JSON/失败诊断没有图形身份，且没有独立测试开关可复现实验启动参数。

### movement-window 输入对账诊断

CI `34222361251` 中默认与显式对照实际都回读为 SwiftShader；显式对照通过首屏与 Pointer Lock 后，按住 W 5 秒仅产生约 0.01964 的水平权威位移。现有失败证据无法分清浏览器是否发送了非中性输入、Node 是否按 late/resync 拒绝或输入在接纳后才因碰撞停止，因此先补对账，不改变 target tick、500ms lease、Node late 规则、30 秒门槛、移动距离、seed、质量或 CPU/图形参数。

诊断只在远端 Harness 的既有 `initialSyncDiagnostics` 与 Node E2E 的 `SEEDLANDS_E2E_PLAYABLE_DIAGNOSTICS=1` 下启用，生命周期随单个连接创建和释放。Web 记录 sent/匹配与忽略 decision/accepted/late/resync 累计值，以及最多 16 个非中性输入的 target tick、发送时 snapshot tick、snapshot 接收后 elapsed、moveX/Z、发送到匹配 decision 的耗时和结果；neutral idle 不占 16 项窗口。Node 只在会话结束输出一份累计 input summary，包含 accepted/late/resync 等 decision 计数、最多 16 个非中性输入的 target/current-at-admission/expiry/move/decision 和最近权威位置，不逐输入写 stdout。两端均不记录 URL、口令、ref、frame 或内部写入口；诊断回调失败不得影响会话。

完整旅程从 initial connect 起维护当前 stage，并在 W 前后写独立 `/tmp` progress；任一后续失败写 failure JSON，包含 initial/current 权威与呈现位置、physics tick、ground/view/aim、`interactionBlocked`、Pointer Lock/focus/visibility、已缓存 graphics identity 和 Node 日志。RED 为现有 W 失败只能看到位移断言，Web/Node 都没有可对账 input summary，且最终 JSON 之前不会保留进度。GREEN 用确定性 accepted/late/resync 时钟夹具核对计数和延迟，以超过 16 个非中性输入证明有界，并用真实错误/正常浏览器流程证明失败前已保存阶段证据。CI 观察以同一完整旅程原断言为准：若 W 失败，必须能判断非中性输入是否发出、其 target 与 admission tick、decision 及失败时两侧位置；取得这些证据前不修改 lead 或放宽 late。

CI `34226402889` 已记录同一连接的投影 target tick 从 `1934` 回退到 `1913`，随后又从 `1927` 回退到 `1904`，Node 均判定 `target-out-of-order`。RED 用受控时钟先让旧 snapshot 的 elapsed 投影较高 target，再模拟更新 snapshot 重置 elapsed；匹配 decision 刷出的 latest state 会得到更低 target。修复只在每个远端连接内保留已真正发送的 target 高水位，使后续投影不低于它，同时把生成值限制在 Node 公开会话现有的 `current + 120` future gate 内；不增加 RTT lead、不放宽 late、不改变单 inflight/latest coalescing，也不让旧 decision 推进高水位。jump edge 仍只在原 500ms lease 内随对应 state 同 target 发送，过期后不能因单调保护复活。GREEN 需证明 snapshot elapsed 重置后 target 不回退、极端 command target 不越过 120 tick 边界、旧 ack 不 flush、匹配 ack 只 flush latest，并保留既有 jump 到期用例。

### 完整 Chromium headless 兼容对照

CI34226402889 的 forced 旅程已取得真实移动，但 camera-turn 的 yaw 差为0；Linux实际运行的是 Playwright 默认的 chromium-headless-shell，本机则显式使用完整系统Chrome。已核对安装版 Playwright 1.62.1 的 getExecutableName 分支及[官方浏览器文档](https://playwright.dev/docs/browsers#chromium-new-headless-mode)：channel=chromium 选择完整Chromium的新headless，未指定channel的headless使用独立shell。相同renderer/version字符串不能证明这两个可执行产品相同。

下一有界对照只给原forced兼容旅程增加 channel=chromium，1280×720、既有Medium配置、真实键鼠、截图、30秒首屏与全部状态断言不变；原default gate保持，尚不采用为CI最终配置。不修改产品行为或降低画质。图形身份新增configured channel、executable source及实际browser user agent，失败继续保留input/阶段对账。GREEN必须完成完整旅程及认证失败缓存用例，不能以仅首屏或仅转向通过准出；失败则记录实际失败阶段再决定，禁止盲目重跑。

### 近场编辑网格调度公平性

CI `34227894490` 的完整 Chromium 旅程已通过 W、转向、跳跃、挖掘与放置的权威/镜像更新，但放置 chunk 的 rendered revision 在 5 秒内仍为 `1`，未达到权威 revision `4`。调度器当前把 `floor((dispatchCount-enqueuedAtDispatch)/8)` 直接叠加到每条请求的优先级；同批旧 streaming 积压老化两个等级后，会一起排在新 interactive 编辑前。RED 以单 Worker、多个旧 streaming 和受控 dispatch 推进复现：插入 interactive 后不能先清空整批旧 streaming 才派发编辑。

GREEN 采用有界公平选择：平时按 `interactive-fluid > interactive > streaming` 派发；连续绕过最老请求达到固定 burst 上限时，只允许一个最老请求让行，随后恢复基础优先级。这样新 interactive 最多受一次已到期公平让行影响，不会被整批同龄 streaming 压住；现有“持续 interactive-fluid 时旧 streaming 最终被调度”仍必须通过。不取消准备、不改网络、渲染画质、lease、5 秒门槛或请求身份；这是正确调度边界，不作为吞吐或性能收益声明。

### 放置显示结算的已有 trace 对账

CI34230070975 中 target回退为0，但放置后权威revision2、render revision1的5秒等待仍失败。公平调度RED/GREEN不证明整个显示链已闭合。下一诊断复用已有World的Chrome trace导出，经远端专用只读evidence API返回：为trace mark附上既有trace名称，使未完成的chunk trace也能关联到放置chunk；旅程记录挖掘或放置坐标/预期revision、等待前和失败时的该chunk最近64条事件、计数以及已存在的队列快照。不新增逐帧观察器、网络日志、写RPC、时序或产品调参。RED为现有failure只有最终revision、没有该chunk在queued/prepare/worker/upload/postrender的确切停点；GREEN以已有telemetry测试验证未完成trace仍有chunk名称，并用真实旅程验证字段。保留5秒及全部原断言，不把诊断时间当性能采样。

## 阶段与保存

- [x] M0：合同、预算、接口接缝审阅与可执行 RED；提交并推送。
- [x] M1：Node 接入/有界协议与 Web 远端同步、真实首块；提交并推送，并更新余量。
- [x] M2：输入/挖放/保存/断线与手动重连、Node 重启恢复完整闭环；提交并推送。
- [ ] M3：本地模式回归、独立验收、文档及 PR；最新 HEAD 必要 CI 成功、无冲突、ready for review。

每个稳定阶段及时保存，不等额度接近耗尽；实现者拥有源码/配置/测试/执行记录，root 独占 estimates.md、architecture-review.md 与 contracts/。git index 同一时间只有一方操作。长等待使用有截止时间的原生 wait/watch，pending 静默。持续推进到完整闭环，不在首帧节点结束任务。

## 预算与交付快照

见 estimates.md。正常关键路径 6–10h，保守 12h×120% 向上取整预留 15h；时间与费用不是平台硬上限，不自动创建 goal/购买/reset。阶段重估与实际缺失字段据实记录。

交付时更新长期 README、代码地图、会话/协议与目录规则的实际接线，原因是双模式产品入口已形成跨 change 的稳定边界。原 Dedicated 大合同中的公网和正式性能部分仍 Active；最终证据及限制回填 execution.md/delivery.md。

## PR17 目标分支更新接入（2026-09-08）

诊断提交 e6c5b3e 推送后，PR17 因目标 codex/node-monorepo 已推进至 21d6e37 而出现合并冲突，GitHub 未创建新的 PR CI。用户负责另一台设备上的 PR15；本任务只在 PR17 分支合并已推送的目标提交，不修改 PR15 或其分支。保持 Node 唯一权威、现有30秒首屏合同与完整本地/远端玩法，接入新底座的资产加载和持久化修复。

可执行 RED：git merge-tree 报告 ci.yml、game.ts、code-map.md 三处冲突，PR17 mergeable=CONFLICTING。GREEN：三处保留双方功能；本地静态、两端构建及受影响浏览器路径通过，PR17恢复可合并并获得最新CI。旧4cf截图仅作为旧源码旅程证据，接入新资产后重新取得真实远端旅程，不将旧图当成更新后的视觉验收。

目标随后切换为 main@ddffbcb（底座 squash 合入）。已核对其树与本分支已包含的 21d6e37，仅 CI context 名称恢复为 Production build 及上游交付记录不同。以 21d6e37 为内容参照应用这两项精确差异并记录 main 合并父提交，保留全部 PR17 增量；不用旧目录历史重放整个迁移。PR17 后续以 main 为 base 验收。此步没有产品源码变化。

修正后的原生 GPU 诊断旅程两项通过（19.2秒，仅功能执行记录）。放置目标[-1,20,-2]映射chunk -1,0,-1，取得57条相关事件，包含 prepare/worker/commit/visible-postrender；队列与transaction标量均可读。原始记录 /tmp/seedlands-web-node-playable/trace-name-native/，运行时工作树有诊断改动，只证明诊断接线有效，不替代7274冻结交付记录。

独立审阅确认 queue 读取沿用既有 snapshot 的 gauge 刷新语义，无产品行为写入；同时指出原 Chrome span args 可含任意 errorMessage。已把新 meshTraceAt 的事件输出改为字段白名单，丢弃其它 attributes。可执行 RED 证实合成错误文本会泄漏到结果，GREEN 两文件7项通过，并检查负坐标映射、目标trace关联、71条总计只保留最近64条；受影响ESLint和测试typecheck通过。该收紧在新诊断的正式Linux取证前提交，不移除原始失败阶段信息。
