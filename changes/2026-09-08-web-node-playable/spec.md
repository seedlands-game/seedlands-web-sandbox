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
