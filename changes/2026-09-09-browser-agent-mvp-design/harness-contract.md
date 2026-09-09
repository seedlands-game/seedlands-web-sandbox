# DeveloperWorldHarness 与持续 REPL

## 两层合同

`DeveloperWorldHarness` 是可信开发端口；Headless 与 Browser 同时实现。`BrowserProductHarness` 组合前者并提供摄像机、Pointer Lock/键鼠、渲染帧、音频、GPU/性能、截图和视觉断言。共享的是世界语义与错误语义，不要求两个宿主返回同一 Worker/渲染诊断字段。

现有 `window.__seedlandsHarness` 可做过渡适配，逐步把世界方法转发到共享合同，避免一次改写所有历史 E2E。不得让迁移 alias 静默返回空对象/成功；宿主不存在返回 `WORLD_UNAVAILABLE`，纯浏览器能力在 Headless 不存在，也不伪装成功。

| 方法族（设计名）                     | 请求与结果要点                                                                                                                       | 权威边界                                                                               |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| `identity()`                         | worldId、seed identity、generatorVersion、checkpoint schema、epoch、worldRevision、commitSequence、physicsTick、simulationTime、mode | 单次一致快照；区分世界 ID 与一次加载 epoch                                             |
| `inspect.voxel/chunk/entity/actor()` | 显式目标/分页/上限；存在、未知未加载和无效参数分开；返回观察时 revision                                                              | 默认只读，不为 inspect 隐式生成世界；需要加载先显式 prepare                            |
| `scene.create/load()`                | 版本化夹具，经生产命令构造地形、物品/Actor；记录输入与内容 hash                                                                      | 只能在明确新建/重置世界操作使用；普通 RPC 不重建实例                                   |
| `command.submit/status()`            | commandId、幂等信封、结构化参数、接纳/结果/受影响 revision                                                                           | 世界写入只经生产命令/事务，不向 REPL 暴露可变 server/world 引用                        |
| `clock.pause/run/advance()`          | mode 为 paused/running/advancing；advance 输入 ticks 或 simulatedMs 的一种，返回实际各 lane 推进数                                   | 同一调度器；worldTime 是天时，不等于 simulationTime，不用改日照冒充物理推进            |
| `logic.observe/submit()`             | 明确 scripted/algorithmic 模式，取 observation、提交对应候选，报告 accepted/rejected/reason                                          | 开发脚本可操作可信 Logic 接缝，但仍经过 revision、物理与事务门禁；不暴露给游戏内 Agent |
| `action.get/list()`                  | Actor/Action ID、状态、结果、trace 游标；分页有界                                                                                    | 查询既有事实，不把 pending 当完成                                                      |
| `barrier()`                          | epoch、指定 frontier、种类、超时、是否要求保存 ACK                                                                                   | 等待指定因果边界，不等待“所有未来工作都为空”                                           |
| `trace.read/export()`                | 游标、数量、事件种类、因果 ID、缺口标记                                                                                              | 结构化事件；不导出凭据或模型隐式推理                                                   |
| `checkpoint.export/restore()`        | manifest、版本、完整性 hash、体素/Gameplay/Actor/终态/认知确认的一致切面                                                             | 复用 FrozenGameSaveSnapshot；验证候选后原子替换；restore 开新 epoch                    |

`inspect.actor()` 包括身体、需求、角色 inventory、当前 Action、控制源与开发 trace；它拥有调试全局视角，绝不通过 ActorWorldPort 返回给 NPC。

## 确定推进与 barrier

暂停握手必须先抵达 Authority 才返回：记录 commit frontier，禁止继续接收玩家运动/游戏 Agent 新意图，处理已接纳提交；暂停期间生成/存档可完成但不得偷偷推进模拟时间。恢复时清除旧输入租约，避免玩家键按下时 pause 后继续粘连。

`advance` 只在 paused 接受，串行执行。浏览器 Authority 关闭 wall-clock driver，在相同固定步长下推进；Headless 复用同一 scheduler。每个 tick 的 fluid/logic 候选有确定提交边界，未知 Chunk 按显式工作预算准备，无法准备时返回 blocked/error 与实际 frontier，不能吞掉时间债或将缺块当空气。运行中 `advance` 返回 `MODE_CONFLICT`，禁止双时钟。

三个 barrier 定义：

1. `committed(frontier)`：截至指定命令/输入序列产生的 Authority 事务已完成，返回 commitSequence/worldRevision；不保证渲染帧或尚未发出的模型结果。
2. `settled(frontier, lanes)`：在暂停或显式推进完成后，指定 frontier 引出的必要 Logic/Fluid/生成候选已 accepted/rejected/cancelled；不要把重复请求 observation 的正常调度当无限待排空队列。
3. `checkpoint(frontier)`：取得原子冻结 snapshot 并获当前 persistence adapter 的成功 ACK。必须区分内存 ACK 与可持久恢复的导出文件/IndexedDB ACK。

每个 barrier 绑定 epoch 和单调序列，超时有 `pendingWorkIds`、lane 状态和最后已完成 frontier；epoch 变化立即失败。不得以 `sleep(1000)` 或“画面看上去稳定”实现一致性。

## REPL 生命周期与 JSONL

初版继续使用现有脚本宿主与纯 core，不引入 Dedicated 网络/线程/文件服务。TTY 支持多行 JavaScript **可信开发脚本**，提供受限公开对象 `world`；脚本是开发者权限而非沙箱，不对普通 UGC 开放。每次 eval 在持久 JS 上下文运行，await 后回到同一个 world；由 Node 自带 REPL 或同类成熟执行设施做语言交互，不自写 JS 解析器。

JSONL 模式不 eval 任意字符串，只接受白名单结构化 RPC。调试端 JSONL 可调用 DeveloperWorldHarness，游戏 Agent 的 JSONL adapter 只能调用 ActorWorldPort，两种启动模式不能在连接内升级。

```json
{"protocol":"developer-world/1","id":"q1","method":"identity","params":{}}
{"protocol":"developer-world/1","id":"q2","method":"clock.advance","params":{"ticks":60}}
```

响应回显 id，具有 `ok/result` 或 `ok:false/error`，事件带独立 eventSeq；stdout 仅 JSONL，日志走 stderr。初始建议限额：单行 256 KiB，最多 32 排队请求，最多一个在途 mutation，查询返回最多 256 条、支持 cursor，单次 advance 上限 60 秒模拟时间，单次请求 wall-clock 上限 30 秒；较长推进由多条请求组成并允许取消。这些是工程保护值，不是测得最优参数。

创建：初始化 ports → create 一次 world → ready。运行/暂停/eval 均保持 worldId。`restore`/`reset` 是显式生命周期操作，成功后创建新 epoch 并清空旧 RPC/lease/脚本 Logic 响应；失败保留原世界。EOF/Ctrl+C 取消在途请求、释放 adapter/Worker/计时器，报告未导出状态；不把退出当成功保存。文件导出只在调用者明确选择目标后写入，拒绝覆盖未知文件；可用临时文件与原子 rename，工程 I/O 不进入 core。

恢复不是“修改当前 world 的几个属性”：先校验完整 bundle、版本、身份与引用，在隔离候选 runtime 中验证，再切换 owner。随机源状态、时钟累加器和 sequence 都进入可恢复合同；没有模型实时调用时，可在固定输入下比较确定性结果。

## Logic 脚本与游戏 Agent 分离

开发者在暂停世界显式切换 `logicMode=scripted`，为固定 Actor/epoch 绑定唯一开发控制租约，algorithmic fallback 不同时替其下发新目标；反射与执行校验继续有效。切回算法模式、恢复 checkpoint 或脚本退出时撤销 lease。

真实 Agent 的模型轮次不等于 Logic batch。模型先提交高层 Action 请求；短周期导航与运动仍由算法 Worker 产生短 TTL intent。禁止为模型把全局 Logic TTL 拉长，亦不允许模型直接写 `wish/velocity/position`。

## Headless / Browser 一致性矩阵

同一 fixture manifest、seed/generator、初始 checkpoint、动作脚本、逻辑候选及显式 tick 序列，分别在 Headless 和真实 Browser Authority Worker 执行。比较规范化世界 hash、Actor/Inventory、Action 终态、commit 顺序、事件原因与导出恢复结果；排除 wall-clock duration、Worker ID、frame/GPU 指标等宿主噪声。

至少包括：空推进、移动跨 Chunk、食物争抢、路径被编辑、死亡/中断、重复序列、旧 epoch、未知地形、存档恢复失败保留原世界。普通实时浏览器无法逐帧位相一致，不比较截图 hash 证明世界语义；必须切换到 Harness 显式推进模式。真正玩家输入与 NPC 呈现仍用 BrowserProductHarness 单独验收。

导出/恢复使用 [Agent 协议的版本化保存所有权](agent-protocol.md#版本化保存所有权)：拟议 FrozenGameSaveSnapshotV2 唯一包含 agentState，canonical/gameplay/agentState 同一次冻结 frontier；不得由两个 adapter 各自取“最新”再合成。非 Agent 旧存档按显式迁移为 agentState=null；恢复前校验完整 bundle，成功后的恢复中断生成新提交/epoch。
