# 双模式与公开网络边界审阅

由 root 维护。以下为实施准出检查，尚未通过；用户已批准本机单人完整闭环。

1. app 只依赖实际消费的会话接口，本地/远端实现保留同一输入与派生镜像约束；不能用继承 BrowserAuthorityClient 伪装后暗中创建本地世界。
2. Node 公开网络不可转发内部 RPC；每个入站动作有字段白名单、身份/版本/预算验证和明确调用目标。认证前不分配大基线；第二玩家与旧连接代次不能接管输入。
3. Web 远端 compute 只消费完整权威数据并派生网格，不能生成 canonical/流体/逻辑回传。每个碰撞/mesh owner 的完整 halo revision 与异步任务绑定，未齐全即等待或重同步。
4. capture/订阅/后续提交之间有因果屏障。旧基线不能覆盖新 delta，捕获期间变化不能漏过；队列溢出显式重同步或断开，不能静默丢事务回执。
5. input sequence、target tick、租期、中性输入、jump edge 与预测校正保持语义；世界持续运行，客户端菜单/断开不能暂停 Node。
6. 手动重连必须销毁旧 socket/owner/pending并换连接代次；重启后清预测和请求，不自动重放结果未知的挖放。保存 UI 只以 durable ACK 表示已保存。
7. WebSocket 与 C0 只是本轮实验入口。使用已有被验证的边界与原生库，明确限制，不手写不必要的网络底层协议，不绕过正式N2–N4采用决策。
8. 真正验收需浏览器真实输入与Node侧提交对应、浏览器关闭后Node继续、Node重启后的同目录恢复。静态/mock/仅frame发送不能替代。

## 接线前源码检查（2026-09-08）

以下是当前源码中的接缝与必须验证的条件，尚非实施通过记录。

- `node-authority-lane.ts` 在 publication 的 `try` 内直接调用订阅者；订阅者抛错会使整个 Authority lane 失败。网络订阅者必须自行收敛单连接编码、预算与 socket 异常；用发送失败用例证明 Node tick 持续。
- `DedicatedServerHost.performAction()` 的去重键固定为启动 epoch、playerId、`player-actions` 和 sequence。浏览器重连重置本地序号不能与旧连接冲突；映射或续接必须让重复请求返回原结果，未知结果不自动重放，新连接动作实际执行。
- `AuthorityRuntime.clearPlayerInput()` 已同时清移动输入与持续挖掘。网络断开应复用这个内部能力或明确有界租期，避免合成中性输入只清移动而遗漏 `breakAction`。旧连接的迟到清理不能影响新连接。
- Node Authority publication 可能携带 `resyncRequired`；这意味着保留的 commits 已经不完整，客户端不得继续把现有镜像当作已同步状态。基线期间缓存后续提交需要按 checkpoint 与 chunk revision 判断，publication 的 commit sequence upper bound 不能当成每条 commit 的精确因果序号。
- `game.ts` 目前无条件安装本地开发命令能力与 Logic observation；`game-runtime-controls.ts` 会写世界时钟，PlayerController 有 set-position 路径。远端会话必须在 UI/组合边界限制这些入口，不能把拒绝延后成未处理 Promise 或本地视觉假状态。
- `NetworkBaselineConsumer` 已有完整 halo、共享 preparation、collision、task-copy 租约及 revision 失效。远端调度必须把 worker 完成/失败/取消/退出都关联到 settle；释放 owner 后的结果不能被新 owner 接收。

待验收矩阵：协议越权与认证前预算；第二连接拒绝；重连序号与旧回调；捕获期间真实提交；publication 缺口；发送失败不杀世界；关闭时释放 capture/page/task-copy；真实浏览器动作和 durable 重启恢复。

## M1 草稿审阅待办

已在实施期间交给实施者，以下需要以最终源码与用例重新核对，不能将草稿问题视为最终缺陷或已修复。

1. 输入确认映射清理后仍保留单调的客户端 ACK 水位，不能在没有新确认的 publication 回到 -1；过期输入不得通过 clamp 变成新输入，jump edge 必须保留。
2. 动作结果缓存有界淘汰后，旧 requestId 只能返回旧结果或过期拒绝，不得重新分配 Authority sequence 再执行；在途动作不能被结果缓存淘汰。重复 interest ID 不得绕过 pending 计数。
3. 认证中连接占位与 unauthenticated 计数只结算一次；并发异步 readReady/readDiagnostics 不能绕过单玩家或前置预算。
4. close/cancel 收回每个 capture、projection/bundle、page 与发送任务；descriptor 入队失败也要覆盖 bundle 最外层 finally；迟到完成不得重新发布。
5. 公布的消息速率、动作速率、空间 interest、pending/队列/在途上限必须实际实施，不能只是 welcome 中的声明。
6. 第一轮 listener 隔离的 onFailure 自身抛错也要收敛；仅 dist 的真实 listen/hello 验证应覆盖 ws 与 ESM bundle 的运行时加载。

Web 接线追加检查：完整输入必须经 `authority-complete` source 的每任务租约接入，结果比较实际 task/result 的 halo、chunk、generator 身份；不能用当前 owner 的身份替旧结果背书。owner 需区分 pending/ready/stale，捕获到 descriptor 期间的提交必须被版本水位或因果屏障覆盖。运行期 receive 失败不能被握手已经 settled 的 catch 吞掉。WebSocket URL 必须解析后校验真实 hostname，禁止 userinfo/query/hash，不能以字符串前缀判定 loopback。客户端 pending、bufferedAmount 和 revision 水位同样需要可验证的上限与取消清理。

## Node 检查点独立审阅

Terra/high 按 `contracts/node-review.json` 审阅冻结 `b6ab3e0`，原始报告保存在 `/tmp/seedlands-web-node-playable/node-checkpoint-review.md`；未把后续工作区当作该 SHA 的证据，也未重复运行受草稿污染的测试。

- 基线与 publication 可交错，Node 节点尚无完整消费者侧因果保证。root 判定不必强制禁止网络 frame 交错，但最终 Web 消费者必须以 checkpoint/revision 水位证明旧 capture 不覆盖新提交，并覆盖 capture 后、descriptor 前和分页途中提交的确定性用例。此项在 Web 准出前仍待验证。
- session drain 等待 baselineTail，而现有 core capture 取消只置标记，仍等待所有 chunk preparation 完成；卡住的 capture 可能阻塞网络关闭并耗尽 runtime 30s stop deadline。实施者需要有界、可观测的取消/关闭结算及迟到结果清理测试。此项待修复复验。
- 已有 131 个 Node 测试与 dist-only hello 是基础证据，尚不能替代真实 WS 的错误认证、第二连接、超限/背压、清输入、动作幂等、取消及 durable checkpoint 测试。

## M2 首轮冻结审阅（51e97fa）

Terra/high 最终合同的首轮静态检查已完成，原始报告为 `/tmp/seedlands-web-node-playable/independent-validation.md`。此阶段不占用实施者的浏览器，也不把修改中的工作区当作冻结证据。

- 公开 C0 解码的版本与字段 allowlist、认证/单玩家边界经源码复核；远端组合只启用完整权威数据的派生网格路径，未发现新增的可复现阻断缺陷。
- Web per-chunk revision watermark 与 owner 失效处理已覆盖旧基线的拒绝路径；closedSignal 参与 baseline race 后，网络 drain 不再必须等待被阻塞的 capture 完成。旧 P1 的具体调用链已有针对性实现，最终仍需交错提交和阻塞 capture 的确定性实证。
- 首轮真实键鼠、保存、重连和重启旅程已通过实施者测试，但当时 JSON 指向 8cd0868 且缺少逐文件绑定，不能作为 51e97fa 的准出证据。ef71bfb 补入源文件绑定机制；最终必须重跑并核对源文件、原始帧、跳跃峰值、durable ACK 与停止日志。
- 51e97fa 的 CI 34194141726：Chromium regression 成功；Static verification 和 Package builds 同因预渲染启动页未更新失败。日志保存在 `/tmp/seedlands-web-node-playable/ci-34194141726-failed.log`，已交 Terra 归因。不能以此前 M1 的绿色 CI 替代本阶段准出。
