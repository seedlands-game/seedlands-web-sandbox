# S2c 宿主身份接线证据

状态：切片集成，未代表完整 S2 或产品准出。Pack 组合身份由 S3 接入。

真实 GameplayRuntime 注入 EntityIdentityPort；Action/Combat 写 v2，恢复根据已保存 lifetime 绑定新 epoch。根任务补充以下可观察测试：

- 排队动作所属实体被移除后不能继续执行。
- 恢复同一实体 ID 后观察 identityRevision 更新；旧逻辑目标观察在执行前拒绝。
- 接受的物理意图捕获实体引用，物理实际执行再次复核并删除陈旧意图。
- AuthorityRuntime 原玩家会话在游戏状态原地恢复后不能继续接受旧输入或修改快捷栏；异步动作在准备前后复核 actor，攻击目标在准备后复核。

这组迭代先取得行为 RED，再运行相关 Authority/物理/动作测试；代表性集成运行 4 文件 20 项通过。没有并行运行全量 static 与 build，也不把这些局部测试等同于浏览器验收。

## 消费末个食物单位的接缝修复

新增实际 GameplayRuntime/ActorAuthorityGameplay 路径用例，食物 count 为 1。RED：消费成功删除目标后，完成阶段仍要求目标存在，抛出 `Action identity rejected: target-missing`；此前 count 为 2 的旧测试不能覆盖该路径。

修复在消费前用执行检查点复核 actor/target，完成阶段继续复核 actor，但允许本次效果合法消费掉目标。后续事实记录不回滚已发生的领域效果。更新后末单位消费、旧 Authority 规则以及 Action/Combat 身份恢复共 4 文件 20 项通过。

本期完整事务候选/提交/事件阶段属于 S3；这里没有把顺序式领域操作包装成任意跨资源事务。
