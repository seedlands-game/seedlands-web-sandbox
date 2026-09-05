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
