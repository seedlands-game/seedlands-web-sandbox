# NPC 持续行为与持久认知重构

状态：Active，A/B/C/Factory 已通过主要体验验证，最终工程门禁与PR收口。2026-09-09 用户明确停止旧完善工作，授权实现「评估 NPC Agent 架构改进方案」最终确认方案；本合同将其落地，不再沿旧单目标修补路线。旧 PR #26 转回 draft，基线 2ea8b5cb1e4c27f1acba8ffbd6a36bcd0ab7fa4c 完整保留。独立分支 codex/npc-behavior-workspace。

## 需求与技术路线

- 体验：零 LLM 时 NPC 仍可长期按既定模式生活并多次完成目标；模型改变持续策略；三实例各有独立且会遗忘的经历。
- 硬约束：一 NPC 一棵生效树/一个行为 owner；危险、自保、职业与人格偏好均在树中可修改；引擎只保留物理、物品、权限和执行预算。模型不直接 patch 状态。
- 持久认知：AGENT/SOUL 运行态只读；SOUL 为人格起点；MEMORY 仅授权 pro 流程发布；窗口从第一条消息持久化，完整归档仅系统可读，不可恢复遗忘。
- 模型：只选 flash/pro；供应商/凭据/排队/配额/重试归 LiteLLM Proxy 首选本地 Docker；Bifrost 仅在具体阻断后启用。上层传输重试关闭，不另建供应池。
- 复用：Mistreevous 首选准入，复用 Action/导航；LangChain 标准 createAgent/messages/tools + LangGraph PG saver/store；Deep Agents backend/memory 按权限适配。
- 非目标：账号、多租户、云部署/边缘、多副本、Dedicated、LOD、离线追赶、World AI、任意宿主代码插件。不能将当前问题简化为网关/数据库独立交付。
- 证据：完整原方案见 approved-proposal.md，用户最新覆盖点为 LiteLLM 首选、边缘延后。本次显式实现授权覆盖以上已确认合同；保留安全与不可逆操作边界，不额外请求重复确认。

## 行为和协议

每角色持有正式树 definition/revision、目标/进度、稳定 node ID、运行技能状态和 monitor episodes。节点 SUCCESS/FAILURE/RUNNING；技能启动一次、跨 tick 继续、可抢占取消/清理、动态障碍有界重规划。无效树/旧身份/旧树版本原子拒绝；热更新保留兼容未变活动，替换分支取消。树重建与技能恢复不得重放物品、伤害或发言。禁止树外 flee/日程接管已树控角色；普通演员按明确迁移合同保留兼容。

树主动 RequestRejudge 与活跃时间兜底独立。默认 180s，可配 60–600s；逻辑回合接受时刷新 timer generation。工具修正、网关 attempt、Pro 压缩不刷新。忙碌只留一个合并请求，episode 边沿去重，暂停保存剩余活跃时间；身体不等模型。按行为版本/身份校验异步提交，不对每次身体移动做全量观察 CAS。

局部环境包含身体/库存/昼夜、实体/POI、当前完整树和运行节点/Action/等待/目标进度、coverage。receivedThrough / includedThrough / compactedThrough 分开；持续收取世界事件并持久确认，分页冻结高水位，丢失范围明确展示。物品前后值来自 Authority 提交，不能推测因果。

每角色工作区绑定可信 world/timeline/actor/incarnation；数据库模拟 /AGENT.md /SOUL.md /MEMORY.md /behavior/current.json，系统保留 sessions 归档。窗口稳定前缀+追加 Human/AI/Tool，多轮错误修正后才结束，所有失败保存。128K 总上下文，112K 软阈，预留修正和输出；MEMORY 4K token估计及16KiB双上限。仅 Pro 冻结窗口整理，有界失败保留旧窗口，硬阈暂停认知，绝不规则摘要/Flash代写。发布 commit + manifest 处理 DB/世界恢复，不把两个系统冒充同一事务。

本世界连接复用三个角色通道；实例图、文档、cursor、timer、tree/blackboard隔离。固定出生包先过 A/B/C，随后接 pro Factory 标签+SOUL/MEMORY/初始树；创建幂等，不重新抽签恢复角色。

## 实施前测试设计与准出

### 准入 E / G（不算产品验收）

E：固定 Mistreevous 发布版本；三实例隔离、无全局注册、注入 dt/随机、RUNNING 单 Action、guard 抢占/取消、树重建+技能恢复、热更新；若需私有 hydrate/改库核心则停止并比较 XState，不能直接自建通用 BT。
G：固定 LiteLLM 镜像/版本；flash/pro 标准工具完整多轮与必要扩展字段、三请求实际后端全局并发 2（不是各部署2）、队列最多32/有界截止/取消、429槽外等待其他请求可推进、别名后端替换、无多层传输重试。故障只用受控 provider。准入环境不使用真实密钥，不导入未准入生产依赖。

### A：先证明固定树

- 正式入口安装固定出生包和树；至少3个模拟昼夜、3次完整补给循环、跨夜停留再恢复巡游，有限初始资源不得旅程补给、重生或换树。
- 2026-09-10 用户修订验收：默认用确定性时间推进覆盖多日生命周期，配合显式模型触发和短浏览器交互。检查树 hash、早/中/晚状态、权威位置/库存/饥饿/节点/Action 回执，不以持续移动代替目标完成。60 分钟真实时间仅用于独立的定时器、泄漏或漂移诊断，不再阻塞本次交付。
- 动态障碍同技能重规划，目标被拿走后失败恢复，不可达/无食物可明确等待/搜索；改变受击分支得到不同反应；抢占清理，存档恢复不重复物品/伤害。
- 所有新增世界能力同时通过 Headless/Browser DeveloperWorldHarness，不向认知暴露全局 inspect。

### B：单 Agent

- E/G和A通过后正式接真实flash/pro；局部观察/日志/整棵树正确进入追加窗口。
- 精确双触发时序、同tick合并、慢请求、暂停/恢复、工具非法树反馈修正、预算耗尽保留旧树。
- PG从首消息持久化，跨重启消息/工具ID无损；Pro-only/归档不可读、记忆双上限、冻结尾部、失败保留、旧档新timeline不泄漏未来记忆。
- 标准模型对象与工具回路复用框架，保留薄世界提交合同；真实模型策略安装后必须产生可观察世界后果。

### C：三 Agent

同世界同服务/共享网关，三独立工作区/上下文/树，慢A不阻B/C；实际后端并发/429/取消/终态及物品争抢守恒。世界不停，晚到结果不污染回档。真实体验不能用三进程或三个假fixture日志冒充。

### Factory / 可玩交付

固定包通过后接有限可追溯标签生成，出生两阶段接纳与失败恢复；UI让用户直接看到角色当前活动、树运行分支、认知触发/等待与文档/记忆。提供可启动的 PG/Gateway/Agent/Web 环境和清晰入口。静态与build分别执行，受影响浏览器/E2E明确记录；只有所有阶段通过才宣称完整方案交付。

## 初始状态 / RED

旧版只有固定goal枚举，无正式树更新/虚拟工作区/无损journal与网关，两秒慢调用连续性测试不能证明A的长期生活。先按E/G取得可执行准入结果，再为A定义失败fixture并实现。原版实际60分钟旅程已完成采样但未通过当时计数断言；原始证据保留。修复版重跑于用户调整验收后主动取消，不记作通过。当前按确定性多日与短浏览器验收。详见 tasks.md / estimates.md；每阶段维护真实状态，不以旧PR绿色工程门禁证明本需求。

## CI 当前合同迁移

旧单目标NPC E2E属于被本方案替代的历史change。CI的伙伴集成步骤改为`pnpm test:npc-behavior`，覆盖当前固定树、三昼夜快进、三角色与PG恢复；真实模型及60分钟诊断必须显式opt-in，不在无凭据CI中调用供应商。旧测试与旧命令保留为Delivered历史，不因旧断言与新单树合同冲突而恢复树外强制安全控制。其他玩家/世界/物理/存档门禁继续保留。

H1回归暴露原始world checkpoint恢复后，伙伴回调重复设置应用输入暂停，world.clock(run)后输入仍锁定。移除伙伴回调对应用暂停的越权写入：Authority checkpoint拥有世界暂停；应用存档导入显式管理自己的UI暂停；伙伴回调只退役认知连接并切换时间线。原始Pointer Lock与WASD断言不改，保留RED失败。

## Delivery Snapshot

实现及当前本地证据见[交付记录](delivery.md)。长期baseline已更新为单树持续生活、持久工作区与flash/pro网关；旧单目标合同明确被新合同替代，不修改旧证据来伪装通过。当前change用例在CI显式执行，尚未提炼为tests/e2e长期基线。PR与人类体验审核状态以交付记录为准。

## CI首次回执与fixture预算修正

PR #29 首次CI 34392519474的静态与构建通过，21项浏览器基础回归中loading用例首轮因总30秒超时、重试5.17秒通过，严格flaky门禁正确拒绝。独立分诊确认总预算截断HUD单独声明的30秒；只将该用例总预算设50秒（资源ready15秒+HUD30秒+交互余量），不改HUD期限与可见性/Chunk断言，不宣称已证明首轮慢启动的唯一原因。当前change记录这次历史fixture适配，旧失败证据保留。

本地完整回归复现同一失败，并获得首轮trace：世界初始化后再次导航到同URL、Vite连接日志出现两次，页面回到开始菜单。网络中新增mistreevous预打包请求。新增冷缓存受控对照：A为当前Vite配置+--force，B只增加core嵌套mistreevous的optimizeDeps.include；同loading seed/画质/浏览器/30秒HUD期限，检查首次进入世界不刷新且HUD可见。此为功能稳定性对照，不宣称启动性能收益。

冷缓存对照已通过：A补预打包触发reloading且导航2次；B预声明依赖后导航1次且首次加载通过。配置仅作用开发依赖优化，采用[Vite官方include合同](https://vite.dev/config/dep-optimization-options#optimizedeps-include)；生产构建独立回归。全流程失败与重试证据不删除。
