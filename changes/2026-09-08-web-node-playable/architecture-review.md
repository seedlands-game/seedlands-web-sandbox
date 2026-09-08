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
