# Seedlands：质能守恒公理与 ECS / 动画架构调研

2026-09-07。讨论建议，不是实施 spec 或依赖准入决定。源码基线：main / `91d820b59263d9ba4d8b7930637f63f5ee9af47d`。本轮读取了项目源码、已安装 PlayCanvas 声明、候选库官方文档及 npm 元数据，并在内存中静态检查了 bitECS / Koota 已发布包的类型声明；未安装依赖、执行候选库、跑性能基准或修改项目代码。

后续用户已明确将服务端 ECS 作为 API v1 前的结构性工程提上路线；组件化方向已确定，具体库仍待有界验证。具体迁移范围、库与自有系统的分工、JS 包交付及工作包见 [玩法路线详细基线](playbook-roadmap.md)。本文保留选型证据与研究限制。

## 1. 世界公理确认

用户确认的异世界遵守质能守恒，但不将现实世界的熵增定律作为不可违反的全局约束：存在持续生效的界外律，将散相原质重新有序化。

工程上分别表达：

- 总量不变量：所有已纳入范围的原质转移与转换必须平衡。
- 状态与可用性：原质可处于束缚、流动、游离、散相等形态，能否被某种工艺使用取决于其状态及条件。
- 重整过程：界外律改变原质状态与有序程度，不给账本凭空增加原质。持续生效可以配置为有限速率，并可有地理和状态依赖；具体函数尚未确认。

由此可以有长期恢复，也可以有短期供能不足、局部枯竭和流量瓶颈。不能从这一公理推导出任意施法没有代价。游戏中的相干度/可用性可以作为可操作变量，不必在首版计算微观统计热力学熵；两者是否建立数学对应，需要额外定义。

这一公理属于异世界 playbook 的法则选择。引擎提供守恒校验、状态转换、恢复过程及不同模拟精度下的记账能力。

## 2. 判断：动画不要求 ECS，长期组合式实体值得采用 ECS

骨骼动画需要模型、骨架、动画片段、混合/状态图、挂点、蒙皮和表现 LOD。ECS 处理的是实体身份、组件组合、查询和系统遍历。两者解决不同问题，可以组合使用。

现有 PlayCanvas 2.21.4 已包含 AnimComponent 的状态图、多层混合、mask 与动画绑定，以及 SkinInstance 的骨骼矩阵调色板和蒙皮关联。当前不足主要是资产、接入与动作状态到表现的映射，不能仅凭动画复杂度宣布需要替换实体存储。

长期改造的理由来自插件路线：实体能力应由组件组合，而不是由固定的 player / npc / creature 分类与大量可选字段决定。PlayerController 和 AIController 可以驱动共有的生命、动作、装备、运动能力；工厂、投射物与掉落物按需要组合各自能力。

建议采用混合布局的 ECS 思路：领域控制状态仍优先清晰的对象结构；已测量的批量数值计算可用连续数组。ECS 不等于 SoA，SoA 不等于 TypedArray，也不意味着零拷贝或自动并行。

## 3. 当前源码的迁移接缝

| 位置                                                                                                                                                                                            | 已核实结构                                                      | 对设计的影响                                                                   |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| [entity-store.ts](https://github.com/seedlands-game/seedlands-web-sandbox/blob/91d820b59263d9ba4d8b7930637f63f5ee9af47d/src/server/gameplay/entity-store.ts#L48)                                | Map 持有实体；空间桶保存 ID；查询、快照等返回复制               | 可保留稳定 ID、生命周期与空间索引 facade，逐步拆组件；只换容器不会自动消除复制 |
| [gameplay-runtime.ts](https://github.com/seedlands-game/seedlands-web-sandbox/blob/91d820b59263d9ba4d8b7930637f63f5ee9af47d/src/server/gameplay/gameplay-runtime.ts#L33)                        | EntityStore 与 PlayerState 分开持有，用 entityId 连接           | 将实体与玩家状态映射到统一身份下，仍保留权威编排和 revision owner              |
| [actor-state.ts](https://github.com/seedlands-game/seedlands-web-sandbox/blob/91d820b59263d9ba4d8b7930637f63f5ee9af47d/src/server/simulation/actor-state.ts#L8)                                 | ActorState 再保存行为、目标、冷却、archetype                    | 能力组件化的接缝；先消除归属歧义，再考虑布局优化                               |
| [action-runtime.ts](https://github.com/seedlands-game/seedlands-web-sandbox/blob/91d820b59263d9ba4d8b7930637f63f5ee9af47d/src/server/simulation/action-runtime.ts#L33)                          | 动作实例与 actor 当前索引分离                                   | 动作系统可以消费组件；多轨道裁决与阶段语义仍需自有实现                         |
| [authority-session.ts](https://github.com/seedlands-game/seedlands-web-sandbox/blob/91d820b59263d9ba4d8b7930637f63f5ee9af47d/src/server/authority/authority-session.ts#L215)                    | 从实体构建物理输入，物理结果经 server.updateEntity 写回         | 物理临时状态不能成为第二份位置权威；保留唯一提交点                             |
| [gameplay-snapshot.ts](https://github.com/seedlands-game/seedlands-web-sandbox/blob/91d820b59263d9ba4d8b7930637f63f5ee9af47d/src/server/gameplay/gameplay-snapshot.ts#L8)                       | entities / players / simulation 有独立快照与关联校验            | 全面替换会触及版本迁移；ECS 内存快照不宜直接成为永久存档合同                   |
| [gameplay-entity-presenter.ts](https://github.com/seedlands-game/seedlands-web-sandbox/blob/91d820b59263d9ba4d8b7930637f63f5ee9af47d/src/app/gameplay/gameplay-entity-presenter.ts#L21)         | 权威派生实体映射为 PlayCanvas Entity 根节点；手动姿态与材质更新 | 保留表现投影边界，把手动 limb 更新替换为 anim 状态/参数接入                    |
| [entity-presentation-motion.ts](https://github.com/seedlands-game/seedlands-web-sandbox/blob/91d820b59263d9ba4d8b7930637f63f5ee9af47d/src/client/presentation/entity-presentation-motion.ts#L3) | 现有动作表现是 stride/bob 等数学姿态                            | 当前并没有验证过复杂骨骼动画负载，不能声称它已是性能瓶颈                       |

以上是静态结构证据，没有证明 query、clone、动画或 GPU 中哪个占主要运行时成本。

## 4. 候选库与当前发布状态

版本来自本轮 npm registry 实时读取，不能用 GitHub main 的新功能冒充已发布包能力。GitHub API 的提交时间读取遭遇 403 rate limit，未重试，因此不以最新提交日期评价维护状态。

| 候选     | 已发布元数据                                                | 官方能力与限制                                                              | 本项目判断                                                                                        |
| -------- | ----------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| bitECS   | latest 0.4.0，2025-12-06，MPL-2.0，无运行依赖               | 数值 ID、可自选组件存储、查询/关系；无强制系统调度；独立序列化模块          | 第一验证候选。适合保留现有 scheduler 与权威边界，内部按需要选 AoS/SoA                             |
| Koota    | latest 0.6.6，2026-04-09，ISC，无运行依赖；React peers 可选 | traits、关系、增删改追踪；schema 与 callback 对应不同布局；核心可脱离 React | 主要对照候选。类型与变更追踪便利；不能因名称中的 React 排除，亦不能把其 action 当成我们的权威事务 |
| Miniplex | latest 2.0.0，2023-07-16，MIT                               | 普通 JS 对象、组件属性和查询；不提供系统调度；持久/网络 ID 需应用管理       | 迁移现有对象模型较自然，可作轻量对照；长期数值计算仍需另配存储，不据发布日期单独判定停更          |
| Becsy    | npm latest 指向 0.15.5；另有 0.16.0 于 2025-03-02 发布，MIT | 丰富的读写声明、系统排序、组件存储与协程；指南明确多线程尚未实现            | 非首选。不能因多线程宣传采用；同组件类型跨并发 world 的限制亦需核查                               |
| ECSY     | latest 0.4.3，2025-04-13，MIT                               | 经典实体/组件/系统与查询实现                                                | 作为设计参考；本轮未发现足以优先于前两项的项目适配优势，不将“未入选”等同不可用                    |

官方来源：[bitECS](https://github.com/NateTheGreatt/bitECS)、[Koota](https://github.com/pmndrs/koota)、[Miniplex](https://github.com/hmans/miniplex)、[Becsy](https://lastolivegames.github.io/becsy/guide/introduction)、[ECSY](https://github.com/ecsyjs/ecsy)。

发布元数据：[bitECS 0.4.0](https://registry.npmjs.org/bitecs/0.4.0)、[Koota 0.6.6](https://registry.npmjs.org/koota/0.6.6)、[Miniplex](https://registry.npmjs.org/miniplex)、[Becsy](https://registry.npmjs.org/%40lastolivegames%2Fbecsy)、[ECSY](https://registry.npmjs.org/ecsy)。

### bitECS 需要理解的边界

0.4.0 发布包类型声明已确认有 createWorld、createRelation、withVersioning、asBuffer、observe、setComponent 和 createSnapshotSerializer。官网当前介绍允许对象与不同数组布局，不应沿用旧教程中“强制所有组件都是固定 TypedArray”的印象。

组件数据由调用方管理，直接修改数据并不自动获得 Seedlands 的 revision、权限、守恒或复制日志。实体 ID 有回收与版本机制，需要包装稳定身份；尤其不能把带版本位的句柄不加处理地作为固定长度 TypedArray 的裸索引。

独立序列化有助于打包数据，但不能替代版本迁移、可见性过滤、确认/重发、服务端授权及应用层协议。官方多线程文档明确没有显式多线程 API，结构变化仍需同步回 owner。[Intro](https://github.com/NateTheGreatt/bitECS/blob/main/docs/Intro.md)、[Serialization](https://github.com/NateTheGreatt/bitECS/blob/main/docs/Serialization.md)、[Multithreading](https://github.com/NateTheGreatt/bitECS/blob/main/docs/Multithreading.md)

### Koota 需要理解的边界

0.6.6 发布包类型声明已确认有 createWorld、trait、relation、createChanged 与 useStores。本轮未在发布类型声明中找到 createSnapshot 或 serialize，不能将其当作已经提供完整网络/存档方案。

官方文档的 Changed/onChange 依赖受控的 set/update 或显式 changed；嵌套对象/数组原地变更不是自动深度追踪。SoA 的 get 返回值与 AoS 的对象引用语义也不同。对权威状态仍需统一写入门与脏数据合同。[Koota 文档](https://github.com/pmndrs/koota)

## 5. 推荐架构与自研范围

建议逻辑关系：

```text
playbook / mods
    → Seedlands 组件 schema、查询、命令与系统注册合同
    → 权限 / 阶段 / LOD / 事务提交 / 存档与复制
    → 内部 ECS 存储与查询适配（优先验证 bitECS）
    → 权威结果的客户端投影
    → PlayCanvas 场景节点、anim、skin、VFX
```

自研 Seedlands 特有合同：命名空间、组件版本与 codec、稳定实体身份、权限与可见性、读写范围、命令缓冲与提交、规则系统与动作轨道、分频/模拟岛 owner、变更原因与诊断。优先复用实体分配、组件成员关系、索引和查询等通用实现。

插件不得直接依赖 bitecs/koota 的 world、eid 或可变底层数组。库的内部句柄与用户可见/持久化 EntityId 分开；库升级不应使所有插件和历史存档跟着重写。

多个权威系统的执行顺序、并行任务的读写集与提交顺序由 Seedlands 声明。ECS 迭代顺序不能直接决定伤害、争抢资源等有语义的优先级；结构变更应在明确阶段提交，避免遍历中增删带来的遗漏/重复。已有模型下单岛唯一写权限保持不变。

不是所有数据都要实体化：体素仍是紧凑 Chunk 数组；骨骼仍是 PlayCanvas 层级/矩阵；装饰粒子仍由粒子系统批量处理；原质场与区域账本维持适合的网格/聚合结构。库存同质堆叠无需为每粒材料创造 ECS 实体。需要独立行为、交互或持续身份的对象才优先实体化。

## 6. 动画性能的实际工作

需要测量可见角色数、每角色骨骼数、动画轨道/层数、混合成本、蒙皮与矩阵更新、draw call、材质/模型资源共享、投影同步以及 CPU/GPU 时间。ECS 可能减少玩法选择和数据遍历，不能消除这些工作。

后续动画 LOD 可对远处角色降低姿态求值频率、减少附加层与 IK、使用简化骨架/模型；近处保留完整表现。动作命中与过程事实继续由权威时间推进，不能因某角色不渲染就停止施法或资源消耗。

官方能力：[Anim Layer Masks](https://developer.playcanvas.com/user-manual/animation/anim-layer-masking/)、[Anim State Graph](https://developer.playcanvas.com/user-manual/animation/anim-state-graph-assets/)。这些支持不等于 Seedlands 已完成相应资产导入和运行时集成。

## 7. 正式选型前的有界验证建议

先冻结领域合同草案，再做当前 facade、bitECS、Koota 的相同工作负载对照；不先整体重写 server、client 与 presenter。

代表性样例：

1. 玩家与 NPC 使用同一动作/生命组件，不同控制来源；支持多轨道动作与临时效果。
2. 对象频繁出生/销毁、组件增删、库存与关系改变；检查句柄回收、查询期间变更、删除引用与错误命令无副作用。
3. 多个 world 的组件/存储隔离、保存恢复、旧 schema 迁移、客户端复制与实体 ID 重映射。
4. 分别模拟小规模近景角色、较大活跃实体集合和大量低频区域记录；不将全部远处 NPC 强制作为 60Hz 活跃 ECS 实体。
5. 浏览器 WebGL2 中测试同一组骨骼资产与动画层，独立测动画成本和 ECS/投影成本；Node 中测权威工作负载。

观测包含 p50/p95/p99 步耗时、分配/GC、内存、结构增删、复制 bytes/频率，以及接入代码、调试与迁移复杂度。固定算法、状态、实体规模、更新频率与功能，不能用只做 position += velocity 的跑分代表完整游戏。

先进行正确性准入，再比较总成本。若候选库需要大范围 fork、破坏唯一权威或维护两份可写真相，拒绝该适配方案。若基准没有明显速度优势，但组件组合和维护成本更好，仍可以因可扩展性采用；不得将这一判断宣传为性能优化。

本轮没有性能数值或实际迁移结果。本文保留 2026-09-07 的研究快照；具体采用何种库和迁移范围，以后续 spec 与项目内验证为准。
