# S3 剩余机制闭环

依据：已批准 D4/D5/D6 与 T07/T12；一次只读独立 Sol/xhigh 机制复核。此文细化当前实现，不新增产品范围，不表示审阅已替代运行验收。

1. 原始执行来源：现有 principal ID 是宿主别名，新增由当前宿主策略显式映射的稳定 subject。持久来源保存 subject、Pack/module 来源与原始 actor lifetime；本机 epoch 只在运行时绑定。即时调用、Combat 当前 step 与 buffered step 分别保留其真实来源。恢复后按当前策略重授权；缺失映射、撤权或来源不匹配则取消，不能借恢复调用者或管理员继续。旧无来源的在途动作确定性取消。
2. 单一逻辑时间：复用 ModuleLifecycle 成为内核逻辑时钟，支持每次显式推进和 interval 两类 cadence；默认 needs/combat 通过注册系统运行，移除注册后不再调用旧隐式路径。新世界激活允许 start，恢复只安装已验证 schedule，不重复 start。保存前有界排空派生队列，无法达到空 frontier 则拒绝保存。
3. Ruleset：与 actor mode 分离，记录 definition ID/version/revision；S3 保持不可变。默认 Ruleset 为 needs/damage/place 注册规则，模式切换观察同一规则 revision。规则增加明确 before/after 阶段：before 生成冻结 effective input 或拒绝，operation 形成候选，after 验证/补充候选；事实区分原始输入与 effective input。
4. 有界原子协调：只准入本期 ECS、Combat/action、掉落实体与体素 owner。所有候选先校验身份、版本、schema 和容量，再执行无失败的同步 apply；只成功提交一次 revision 和 facts。GameServer 协调体素计划与 ECS 计划；不能用顺序调用或任意 I/O 回滚假装原子。
5. 同 frontier 恢复：V4 增加 Ruleset 与模块 schedule，要求 schedule.time 等于 gameplayTime，ID/order 与 composition 一致。临时候选完成全部验证再安装；坏快照不替换当前 owner。当前 V4 尚未对外发布，继续完善 V4；承诺迁移的旧输入仍为 V1–V3。

决定性 RED：默认注册是真实消费者而非 descriptor；0.4 秒后恢复再走 0.6 秒等价于连续 1 秒且不重跑 start；Browser/Headless 不同 alias 的同 subject 延迟动作保持授权来源；同世界生存/创造 Ruleset 不串改；致死或库存加体素联合提交在最终 apply 前失败时全部状态、版本和 facts 不变。

按来源合同、生命周期合同、规则阶段与实际 owner 集成分配互斥路径。先验证各自合同，再由主任务统一真实宿主接线和冻结验收。S4 实际工位、成长与 S5 替代 provider 继续依赖此闭环；不能跳过以标记 S6。

补充同次复核的系统来源裁决：采用显式 actor/system 执行联合。system 绑定独立宿主 service principal 与准确 system/lifecycle ID，没有原始 actor，只运行 world target 的 system operation；actor operation 不能用 system principal。调度 Combat 只推进待命中状态，真正伤害在提交后按保存的 actor durable origin 独立重授权。不得拿某个玩家、管理员或虚构实体填充系统原始角色，也不在本期增加 entity cadence。新增 execution-kinds RED 验证种类隔离、无 actor 的系统上下文、伪造 system ID 与管理员借用拒绝。
