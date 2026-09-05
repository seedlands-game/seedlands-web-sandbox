# A7 客户端预测与受控传输实施记录

## 目标与边界

本阶段落实已批准 spec 的 A7：生产 `BrowserAuthorityClient` 与玩家控制器必须在 0/50/150ms 受控延迟、重复及乱序消息下保持输入和事务一次性，并以 Authority 的 `physicsHz` 固定步预测本地玩家。只在明确 Harness 会话开启故障注入；普通产品使用同一端口包装但延迟为零。

本阶段不部署网络服务，不在主线程创建第二个 `GameServer`，不预测库存、掉落、流体或其他实体，也不修改 Authority Session、GameServer 与持久化。

## 审计结论与决定

- 当前生产玩家预测已经复用 `stepBody()`，但控制器固定写死 60Hz；Authority 启动与 ready 没有频率握手，30/120Hz 会按错误步长重放。
- `BrowserAuthorityClient` 当前会把同 epoch 的重复或倒序快照重新交给控制器；旧快照可回退 ack、位置和碰撞版本。
- `PredictionBuffer` 单元模块会校验历史 revision，但控制器重放时未证明当前近场碰撞镜像仍与该 revision 一致。
- `blur`、失焦和销毁目前只清本地按键，未通过直接输入通道立即发出全零持续状态，延迟期间可能继续使用旧移动状态。
- 请求只有 requestId 配对而没有超时；Worker 无响应时 Promise 可无限保留。

决定增加一个可独立测试的本地玩家预测运行时，统一固定步输入、预测历史、权威重放、revision 失配重同步和安全表现偏移。增加 Authority 快照顺序门与端口级 Harness transport；事务序列仍由生产客户端唯一分配，故障注入只改变投递时间和重复方式，不重写消息内容。

## 行为与失败路径

- Given Authority 以 30/60/120Hz 启动，When 相同墙钟输入由 30/60/120fps 渲染分片提交，Then 每个物理步只产生一个递增 sequence/target tick，预测步数由物理频率决定，落点符合预先固定容差。
- Given 快照重复、倒序或来自旧 epoch，When 客户端接收，Then 不回退 ack、tick、commit 或预测状态，并记录拒绝原因。
- Given未确认输入引用的 Chunk revision 已不在当前碰撞镜像，When Authority 快照到达，Then 清空历史并显式重同步，不使用新地形重放旧输入。
- Given 小位置误差，When 表现偏移衰减，Then 只移动镜头表现且预测物理身体保持权威重放结果；若偏移位置与固体相交则立即清零，不跨墙插值。
- Given blur、页面隐藏、死亡或世界退出，When 中断输入，Then 立即发送新的全零持续状态并清空本地按键边沿。
- Given受控 transport 配置为 0/50/150ms、重复或乱序，When 投递输入、快照和事务回执，Then消息内容与事务键不变；普通非 Harness 配置拒绝启用故障。
- Given请求超过有界超时或客户端销毁，Then对应 Promise 明确拒绝、计时器释放，迟到回执不能复活请求。

## RED 测试设计

- `tests/client/local-player-prediction.test.ts`：30/60/120Hz 固定步与渲染分片等价、revision 缺失重同步、小误差偏移与墙体立即校正、输入中断零状态。
- `tests/client/browser-authority-client.test.ts`：生产客户端拒绝重复/倒序/旧 epoch 快照，请求超时和销毁后迟到回执有界。
- `tests/client/authority-transport.test.ts`：Harness-only 0/50/150ms、重复与乱序投递；普通路径零延迟且不允许故障配置。
- `changes/2026-09-06-independent-loops-unified-physics/e2e/authority-transport.spec.ts`：准备真实键鼠延迟、输入中断、乱序重复和事务一次性的浏览器旅程，由主线在独占浏览器阶段执行。

预期 RED：频率握手、生产预测运行时、受控 transport 与快照顺序门尚不存在；现有客户端会重复发布倒序快照，请求无超时。

## 当前状态

### 实际 RED

- `tests/client/local-player-prediction.test.ts` 与 `tests/client/authority-transport.test.ts` 初次执行因生产模块不存在而失败。
- `tests/client/browser-authority-client.test.ts` 新增顺序与超时用例后 2 项失败：重复/倒序快照均被发布，请求在预期上限后仍未结束。
- 延迟目标 tick 审计进一步发现：固定提前 2 tick 在 150ms 双向受控传输下会永久成为迟到输入；薄墙反例也证明只检查表现偏移终点不足以证明路径安全。
- 世界编辑接线审计发现同一 Authority 提交同时经 `onCommit` 与 `World.edit*()` Promise 返回路径消费，导致统计和重网格工作重复。

### 实施结果

- Authority 启动/ready 显式协商 30/60/120Hz；本地玩家预测按该频率固定步推进，并把已知受控双向延迟换算为目标 tick 提前量。
- 预测历史同时校验权威 revision 和当前近场碰撞镜像；缺失历史时清空重同步。表现偏移只作用于镜头，并用统一物理 swept-AABB 可达性检查整段路径。
- 生产客户端增加 epoch/tick/commit/ack 顺序门、输入决定顺序门、请求超时/销毁注册表、立即拒绝已销毁请求，以及可观测拒绝计数。
- Harness transport 对 0/50/150ms、事务重复和跨一帧真实乱序提供受控注入；启动、bootstrap 和 transferable 消息不重复，普通产品会话拒绝故障配置。
- blur、页面隐藏、暂停、死亡和退出均走生产控制器全零输入；暂停前先发布中断输入。
- 世界编辑回执先更新已缓存 canonical/revision，再完成 Promise；结构提交只由 Authority `onCommit` 消费一次。
- `authority-transport.spec.ts` 已准备真实 30/60/120Hz 键盘移动、全零输入停止、服务端实际位移、重复事务、快照逆序拒绝及 revision 变化不穿墙旅程。

### GREEN 证据

- Vitest 定向：11 个文件、59 项通过，覆盖生产客户端、预测、传输、输入流、浏览器配置、单一提交路由与 Authority 推进。
- ESLint：本阶段全部变更源码、测试与 change E2E 通过。
- TypeScript：源码与 `tsconfig.test.json` 均通过。
- Playwright-change：用例已完成，按主线浏览器独占安排待执行；此项尚不记为通过。

阶段：生产实现与确定性验证完成，等待主线真实浏览器准出。

## A8 会话控制与故障闭环

### 审计结论与设计

- 当前 `pause-authority` / `resume-authority` 是无 `requestId`、无事务键、无回执的单向消息。UI 会立即切换状态，却无法确认 Authority 是否执行；重复投递也没有可证明的一次性边界。
- Worker 请求超时只拒绝单个 Promise。Authority Worker 已崩溃或会话控制已失联时，客户端仍继续接受旧快照、保留 `isReady=true`，界面只显示四秒反馈，随后继续展示无法前进的陈旧世界。
- 失焦与页面隐藏已有真实输入释放路径，但必须保持“先发送全零输入，再请求暂停”的顺序，且暂停失败必须进入同一故障闭环。

决定把暂停与恢复纳入同一个 `session-control` 幂等事务流，使用递增 sequence、`requestId` 和显式 `{ paused }` 回执。受控重复投递复用同一事务身份；乱序或迟到回执只按 `requestId` 完成原请求，不能改变新的会话意图。控制请求拒绝或超时视为 Authority 会话失联：客户端只触发一次 fatal、拒绝新请求并忽略后续快照。游戏立即释放输入、销毁失效运行时并进入带错误信息且可重新进入世界的界面，不继续展示陈旧世界，也不在主线程启动替代 Authority。

### RED 与验收用例

- `tests/client/browser-authority-client.test.ts`：暂停/恢复必须共享递增事务流并等待配对回执；重复、倒序和旧 epoch 回执不能重复完成或回退；控制超时只触发一次 fatal，之后 `isReady=false`、新请求立即拒绝、迟到快照忽略。
- `tests/client/shell-controller.test.ts`：运行时 fatal 必须从游玩态进入保留错误的可重试菜单；在启动未完成时 fatal 不能被迟到的成功结果重新覆盖为游玩态。
- 既有 `tests/app/player-input-gates.test.ts` 继续证明 `blur` 与 `visibilityState=hidden` 会清空按键；浏览器 `authority-lifecycle.spec.ts` 已覆盖 Worker 阻塞与世界重启，本阶段不复制该旅程。
- 浏览器故障旅程由现有 `authority-lifecycle.spec.ts` 扩展“故障后错误界面可见、陈旧世界已销毁且可重新进入”断言，避免新增一条重复启动与重启的高成本用例；由主线在独占浏览器时执行。

预期 RED：生产协议中的暂停/恢复没有 `requestId` 与事务字段，客户端方法返回 `void`；`ShellController` 没有运行时失败入口，迟到的启动完成会无条件恢复为 `playing`。

### 实施与 GREEN

- 暂停/恢复现使用 `session-control` 事务流，Worker 仅在 Authority 执行后返回配对 `{ paused }`；重复消息复用事务收据，重复或乱序回执不会重复完成请求。
- 控制回执非法、明确拒绝或超时都会把客户端锁定为 fatal。fatal 只发布一次；`isReady` 立即变为 false，新请求立即拒绝，后续快照与迟到回执不再进入表现层。
- `Game` 保持先释放输入再请求暂停。运行时 fatal 会通知 `ApplicationShell`，后者把状态转为带错误信息的可重试菜单并销毁原 Worker、世界和表现资源；启动期间迟到成功也不能重新把失效世界发布为 `playing`。
- RED 实测为 4 项失败：暂停请求缺事务、暂停返回 `void`、两项 `ShellController.fail` 不存在。实现后 `browser-authority-client`、`shell-controller`、`player-input-gates` 共 23 项通过；受影响 ESLint 与源码 TypeScript 通过。
- 测试 TypeScript 当前只被并行 A12 尚未创建的 `src/worker/compute-worker-entry-lifecycle.ts` 阻塞，本阶段文件没有其他诊断。浏览器现有生命周期用例的扩展与执行交还主线统一完成，因此不记为本代理通过。
