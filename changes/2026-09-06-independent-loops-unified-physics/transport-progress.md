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

## A7 浏览器失败复审

主线首次真实浏览器矩阵发现 60Hz/50ms、120Hz/150ms、revision 变化和岸边跳跃旅程的本地身体仍可能报告与世界重叠；30Hz/0ms 通过。保持原 `colliding=false` 与连续轨迹断言，不把真实失败改成容差。

只读审计发现两个可独立复现的时序缺陷：

1. `PlayerController` 每次快照校正都新建 `VoxelCollisionWorld`，但 `LocalPlayerPrediction` 在该世界执行任何查询之前就读取 `revisionVector()`，得到空集合。已有未确认帧会被错误判为“当前碰撞镜像缺失”，反复重置预测。
2. `set-player-position` 事务回执只返回 `{ moved: true }`。Harness 或重生传送在回执后重置预测，但客户端下一帧仍可能从传送前的 `latestSnapshot` 初始化；入站延迟和乱序会扩大该窗口。

补充 RED：`local-player-prediction` 使用全新但拥有相同已加载 revision 的碰撞世界校正时必须保留历史；`browser-authority-client` 收到传送事务携带的权威快照时必须立即发布并推进快照门，随后到达的传送前快照必须拒绝。实现只同步现有 Authority 状态，不在客户端伪造位置或放宽碰撞。

实现后，碰撞世界可按快照涉及的 Chunk key 直接读取已加载 canonical revision；传送事务回执携带同一 Authority 时刻的完整快照，并复用普通快照的顺序门。定向 Vitest 共 5 个文件、37 项通过，受影响 ESLint、源码 TypeScript、测试 TypeScript 与 `git diff --check` 通过。60Hz/50ms、120Hz/150ms、revision 变化和岸边跳跃的真实浏览器复验仍由主线执行，因此本阶段只记录已证明的时序修复，不把浏览器准出标为通过。

A8 浏览器可靠暂停等待不能以 UI 对话框出现代替 Authority 确认；Harness 的 Authority 投影补充权威快照 `paused`，需求用例可先等待它变为 `true`，再检查物理 tick、游戏时间、流体提交和输入释放均冻结。

浏览器频率矩阵还暴露一个与延迟强相关的诊断偏差：`PlayerController.isColliding` 使用私有 `1e-7` 阈值，而统一物理解算使用 `COLLISION_EPSILON=1e-6`。测试先锁定规则：静止接触和小于统一 epsilon 的数值回退不能报告重叠，超过 epsilon 的真实穿入必须报告重叠。当前实现对半个统一 epsilon 的回退预期 RED。

RED 实测在半个统一 epsilon 的回退处把 `false` 报成 `true`。实现删除独立阈值并直接复用物理核心 `overlapDepth`；诊断仍读取 prediction 的双精度 physical body 或 Authority body，不从 PlayCanvas 单精度渲染矩阵反推物理。相关 3 个文件、28 项 Vitest 与受影响 ESLint、源码及测试 TypeScript、`git diff --check` 通过；最终浏览器频率矩阵仍待主线复验。

## A7/A8 真实浏览器阻断复审

`c0a4e46` 生产包在开启入站重复/乱序后，新世界启动收到重复 `authority-bootstrap-needed`，客户端会并发提交两个相同 safe-spawn 计算；其中一个会在启动失败清理时以 `epoch-switch` 结束，并由现在的可靠 fatal 路径暴露。RED 要求同一 bootstrap `requestId` 无论重复到达几次，只启动并回送一次计算。

同一轮暂停用例确认事务回执到达，但 Harness 的 `authority.paused` 持续为 `false`。Authority 停钟后不再自然发布新快照，而 pause/resume 回执只有布尔值；客户端因此无法观察已确认的冻结状态。RED 要求控制回执携带该停钟时刻的 Authority 快照，同一 physics/commit/ack 版本只要 `paused` 状态发生变化仍可通过快照门；完全相同的重复回执继续拒绝。

RED 实测 3 项失败：重复 bootstrap 调用两次计算、暂停状态变化被快照门判为 duplicate、暂停回执未发布快照。实现增加单次 bootstrap 身份协调器；相同 requestId 重放直接复用，第二个不同身份 fail closed。pause/resume Worker 回执携同一停钟时刻快照，客户端先校验布尔与快照一致再发布；快照门只把同版本且同 paused 状态判为重复。Browser 客户端、控制状态、传送和 Authority Session 共 4 个文件 24 项通过，受影响 ESLint 与源码 TypeScript 通过。测试 TypeScript 仅被并行流体优先级测试对已变更接口的 4 项调用阻塞；最终启动/暂停浏览器复验仍待主线执行。

## A7 权威碰撞镜像发布

### 审计结论与合同

生产 `performAction` 的放置、连续挖掘完成和异步流体提交虽然已经在 Authority 生效，但 Browser 的碰撞查询仍只读取网格任务完成后写入的 `meshCache`。网格队列是表现层派生工作，不能承担物理事实发布；真实浏览器已观察到放置成功、库存扣除且世界 mutation 前进后，客户端五秒仍把目标体素读为空气。

决定由每个结构提交携带按 Chunk 分组的稀疏权威碰撞增量：`previousRevision`、`revision` 以及各局部 `index` 的最终 `voxel` 与 `fluid`。客户端只在本地 revision 精确等于 `previousRevision` 时原位应用；重复或更旧增量忽略，revision 有缺口、结构提交缺增量或本地无基线时使该 Chunk 保持未知并请求权威基线。网格完成只能安装不旧于当前镜像的基线，不能回滚更高 revision。

### RED 测试设计

- `tests/client/authority-collision-mirror.test.ts`：合法体素与流体增量原位更新；重复增量幂等；revision 缺口和缺失增量失效缓存并请求基线；旧网格不能覆盖新碰撞镜像。
- `tests/client/browser-authority-client.test.ts`：真实 `gameplay-action` 回执和异步 `authority-snapshot` 提交在 Promise 完成或快照发布前更新同一个生产查询源，不等待 `acceptWorkerCanonical`。
- `changes/2026-09-06-independent-loops-unified-physics/e2e/authority-transport.spec.ts` 与主线跳搭/连续挖掘旅程：放置或破坏确认后，目标体素和 revision 立即可见，预测身体按新地形碰撞；由主线浏览器独占阶段执行。

预期 RED：当前客户端没有权威碰撞增量模块，`performAction` 与流体快照提交只触发重网格，旧 `meshCache` 保持不变。

RED 实测：纯模块导入失败；补上合同后，生产客户端两项接线仍失败，`gameplay-action` 放置后体素保持 Air，异步流体提交后流体仍为空。

客户端实现已把所有响应与快照携带的提交先应用到统一碰撞镜像，再发布表现层结构事件或完成事务 Promise。连续增量同时推进 canonical、fluid 与 Chunk revision；缺失或跳跃增量使旧缓存失效并触发基线请求；网格基线安装会拒绝回滚更高 revision。纯模块、生产 action 与异步流体共 3 个测试文件 15 项通过，受影响 ESLint、源码与测试 TypeScript 通过。Authority 端精确增量生成由同一变更的服务端接线继续完成；未携带增量的旧结构提交会安全失效缓存，不宣称即时镜像已完整准出。

独立竞态复审补充：若 revision 缺口先删除缓存，而更早已由服务端接纳的旧网格回执随后才抵达，只比较当前缓存会因 `undefined` 重新安装旧基线。RED 必须锁定“旧接纳请求发出 → 新提交造成缺口失效 → 旧成功回执抵达”的顺序；碰撞镜像需保留独立的最低 revision 水位，直至相关异步基线请求完成，不能把缓存对象本身当作唯一版本记忆。

该竞态 RED 实测在旧回执抵达后错误安装 revision 5。实现增加与缓存对象分离的最低 revision 水位和在途基线计数：缺口记录 revision 6 后，旧成功回执只能完成协议请求，不能重新开放旧碰撞数据；显式 Chunk 释放会在在途请求结束后清理水位，避免随探索无限保留。服务端 `e624924` 已让单编辑、通用/唯一批编辑和流体提交发送同一精确增量。服务端与客户端共 4 个文件、19 项定向用例通过，源码和测试 TypeScript、受影响 ESLint 与 `git diff --check` 通过；真实跳搭、连续挖掘和流体浏览器旅程仍由主线复验。

## A7 可转移消息重复投递

真实 30Hz 重复/乱序浏览器启动在 bootstrap 后以 `An ArrayBuffer is detached and could not be cloned` 失败。受控传输当前对入站重复直接复用同一个 `MessageEvent`；首次 Logic 观察处理会把 terrain `occupancy.buffer` 转移给 Logic Worker，第二次投递因此拿到已 detached 的同一缓冲区。故障路径延迟出站消息时也直接闭包捕获原消息，未在调用边界取得独立所有权。

RED 在 `tests/client/authority-transport.test.ts` 使用真实 `structuredClone(..., { transfer })`：首次入站消费者转移缓冲区后，重复副本仍必须完整且对象独立；出站含 transfer 的消息排队后，即使调用者随后转移原缓冲区，Raw Worker 最终仍必须收到完整副本。普通无故障产品路径保持原生直接转移成本。

碰撞镜像另有独立卸载竞态：网格接纳请求在途时卸载 Chunk，迟到的成功回执不能重建已经释放的镜像；后续真实的新加载仍必须能安装新基线。RED 以“请求开始 → 卸载 → 旧回执 → 新代际请求”的完整顺序锁定，不用永久墓碑阻塞重新加载。

入站乱序还必须把“运动快照状态”和“提交事件流”分开判序：较新的无提交快照先到后，较旧快照携带的唯一结构提交仍要按 `worldRevision` 一次性消费，但不能回退玩家运动状态。重复快照中的相同提交不能再次触发碰撞更新或重网格。

RED 实测三类失败：重复入站的第二份缓冲区已 detached；延迟出站闭包引用的原缓冲区已 detached；卸载后在途旧基线错误重建缓存。乱序快照携带的唯一提交也被运动快照顺序门整体丢弃。实现后，Harness 在投递前同步建立独立副本，普通无故障路径仍直接使用原生传输；碰撞基线以卸载代际校验安装资格；提交流以 `worldRevision` 单独去重和补序。正式定向 4 个文件 26 项通过，两项独立竞态复核用例通过。真实 30Hz 重复/乱序启动仍须由主线用生产浏览器包复验。

## A7 权威准备快照提前发布

岸边旅程持续出现 `authority-resync`：Authority 的 `prepare-mesh` 已返回中心 Chunk 的完整 canonical、fluid 与 revision，但客户端只把它保存为网格输入；碰撞镜像要等网格计算完成并再次接纳后才安装。高频流体修订会持续让网格结果过期，导致首次或缺口恢复基线长期饥饿，玩家诊断一直把近场视为未知。

RED 要求初始 `mesh-prepared` 回执一完成，生产 `getVoxel` 与 `getChunkRevision` 就能读取该权威快照；revision 缺口失效后，新的 `mesh-prepared` 同样立即恢复碰撞基线，不等待 GPU/网格结果。卸载代际仍必须阻止迟到 prepare 回执复活已释放缓存。

RED 实测初始 prepare 后 `getVoxel` 仍返回 Air。实现把请求开始时的碰撞基线代际绑定到 prepare 回执，在回执完成 Promise 前复制并安装权威 canonical、fluid 和 revision；网格派生计算继续使用独立副本。初始加载、缺口恢复和卸载后迟到回执三条生产用例均通过，碰撞事实不再依赖网格任务是否赶上流体 revision。

首次真实浏览器复验进一步确认：30Hz/0ms 重复乱序已通过；60Hz/50ms 移动时 Authority 身体与镜头位置一致且没有穿入，但跨过 Chunk 边界后身体覆盖格的客户端 revision 全为 `null`，`VoxelCollisionWorld` 按未知即阻挡报告假碰撞，预测反复以 `collision-history-missing` 重置。此时该 Chunk 仍排在网格 streaming 队列中，尚未发出 prepare，因此仅提前消费 prepare 还不足以保证物理近场。

新增 RED 要求：每个已接受的 Authority 运动快照都核对其物理活跃 `chunkRevisions`；本地缺失或落后时立即请求权威碰撞基线，同一 revision 在请求完成前只发一次，不能等待表现网格排队。请求失败或收到更高 revision 后允许有界重试。

实现增加专用只读 `request-collision-baseline` RPC：Authority 只复制已驻留且不低于请求 revision 的 canonical 与 fluid，不加载、不生成、不增加 mesh pin；客户端以 snapshot 物理 read-set 驱动该请求。旧本地数据在水位补齐前保持不可读但暂存，以便乱序迟到的连续 delta 仍可补齐；请求明确 unavailable 后，下一份快照会重试。客户端、服务端合同与 runtime 共 4 个文件 22 项定向用例通过，源码和测试 TypeScript、受影响 ESLint 与 `git diff --check` 通过；真实浏览器复验待本提交生产构建后执行。
