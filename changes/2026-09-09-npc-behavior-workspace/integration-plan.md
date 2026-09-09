# 实施分界与验收约束

## A 的现有 owner 迁移

`AutonomyRuntime` 仍负责时钟、身体需求、Action/Combat/导航与 Character 容器。树执行属于 Character 世界域（通用角色概念，不引入 Agent/provider）。`CharacterGoalRuntime` 现有固定高层 goal 执行应被树+技能取代/迁移，不能在其前面再插一层并留下两个仲裁者。

`recordAttacked()` 对树控角色仅记录可感知受击/威胁事实；不先设置 flee、暂停目标、启动固定三秒自保。树可选择逃跑、反击、继续原活动或放弃。普通非 Character 生态演员的兼容由显式分支保留，不能让这条兼容路径接管树控角色。

`Logic chooseGoal()` 对树控角色只能把当前 Authority Action 的 path waypoint 转成物理 wish；没有 Action 则 hold。这个低层路径执行放在原始生态威胁/日程选择之前，禁止从这条路径重新选择生活目标。Actor 中只保存由 Character owner 派生的执行权投影，存档恢复不信任客户端输入投影。

持续移动复用 ActionRuntime.updatePath，重规划保留 Action 身份；检查 path step 失效与实际停滞，按技能预算重试。既有 tickAuthorityActorRules 的几何完成是动作事实，不应替树决定后续职业/危险取舍。攻击复用 CombatRuntime，不能另写瞬时伤害捷径。拾取/食用必须在正式提交点产生日志前后值，保持库存和世界物品守恒。

新角色默认固定完整树；旧 intent 入口如需保留，只能翻译成唯一树的一次正式替换，不运行旧控制器。旧 checkpoint 以明确迁移规则恢复为等价树和有界技能状态；不能静默忽略未完成动作、重抽人物或复用未来记忆。

## A 的局部测试与长时旅程

- 单元：树结构/预算/节点权限、hot swap、保存/恢复、一次技能多tick不重放、重规划/抢占/物品争抢、可编辑受击策略。
- 真实Headless：同时跑Authority/Logic/Physics，不能只调用advanceGameplayRules并用wish冒充身体位移。此前平地fixture只验证规划与输入接纳的限制不再作为A的可替代证据。
- Browser：正式可玩世界、真实角色身体和完整树；至少60分钟连续运行，固定初始资源/树hash，记录实际模拟时钟而非墙钟推断昼夜。动态障碍等故障旅程与无干预长时主旅程分别保存。
- 三昼夜使用世界默认时间推进；测试可快速推进显式模拟时间，但不得只修改时间标签。需求饥饿和昼夜同时推进，物品供给预先固定，不能每次饿了测试脚本补食物。
- 短旅程通过后先开始A长时运行；并行B代码可准备，但不能在A失败时拿模型补救并宣称通过。性能采样另外持锁，本功能旅程不宣称FPS/内存收益。

## B / C 的接线

core 的受限 Character/行为合同由声明exports暴露；世界级 DeveloperHarness 在Headless与Browser一起支持。上层WS认知协议才包含角色通道、运行/窗口/模型状态；core不依赖认知协议。

一个世界连接复用三个绑定角色；每个角色有独立LangGraph thread/可信workspace key/窗口/journal/scheduler。全局模型供应在LiteLLM闭环，上层模型对象只有flash/pro与标准消息。PG保存文档/窗口、框架checkpoint/store及发布manifest，不拿模型返回值直接覆盖World状态。

Root负责正式跨层合同、Web可玩入口/诊断、长时Browser与总集成；明确世界实现与认知实现的文件所有权后再派发。使用agent-work-routing完整合同，所有实现进入此新worktree，17c1旧任务与试玩进程不改动。
