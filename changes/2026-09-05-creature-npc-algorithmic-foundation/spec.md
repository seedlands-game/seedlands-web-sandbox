# 生物与 NPC 算法底座

**状态：** 已交付；Breaking flow 的合同、RED→GREEN、浏览器语义验收与全部本地准出已完成

## 背景与目标（Context & Goal）

Change 8 已以本地提交 `a27dc8e5817143bce3282f3347bd51dbb0c3f84c` 交付 Entity、Player、Item、Inventory、Survival、Combat、Crafting、结构化 Command、Headless 与 retained gameplay UI，但 creature 仍是只能由 Debug 命令创建和攻击的静止目标。父合同 `changes/2026-09-05-playable-world-mvp/spec.md` 要求在进入 Change 10 Agent Runtime 之前，玩家无需 Debug 便能自然遇到至少一类被动生物、一类夜间敌对生物和一类有简单日程的非模型 NPC。

本变更建立完全运行在 GameServer 的确定性 Algorithmic Runtime：observer-scoped perception、POI、预算化 voxel ground navigation、可查询/中断的异步 Action、Needs 与分频行为选择，并让三类 actor 通过同一正式能力自主移动、进食、逃跑、追逐、攻击或按日程访问 POI。未来 Agent 只替换高层 intent selection，不重写感知、移动、Action、战斗或交互执行。

## 范围与明确不做（Scope & Non-goals）

### 范围

- 将 Entity Type 扩展为 `player`、`world-item`、`creature`、`npc`，可选 `archetype` 为 `grazer`、`night-stalker`、`settler`；Actor simulation state 独立保存 needs、behavior、target、home/work/food POI、active 状态和当前 Action，不把 PlayCanvas 对象写入服务端。
- 建立 `PoiRegistry`：稳定 `PoiId`、`home/work/food/camp` 类型、位置、注册、移除、单体查询、observer-scoped nearby query、防御性 clone 与 snapshot restore。
- 建立 `PerceptionRuntime.observe(observerId)`：从 canonical EntityStore、voxel 与 POI 得到结构化 `entity-seen`、`threat-seen`、`food-seen`、`poi-seen`、`attacked`、`action-completed/failed/interrupted` Observation；包含距离和 Line of Sight，不输出 prompt 文本，不读取相机或 render visibility。
- 建立 `GroundNavigator`：voxel surface A*、四向地面移动、上/下一级、solid/净空校验、跨 Chunk 坐标、到达、不可达、预算耗尽；默认单次最多扩展 384 节点。运行中的路径下一节点失效时最多重算 3 次，随后 Action 明确失败，不穿墙、不无限搜索。
- 建立统一 `ActionRuntime`：稳定 `ActionId`、`move-to/wander/attack/flee/eat/idle/go-to-poi`、actor/target、pending/running/succeeded/failed/interrupted、开始/完成时间、reason/result 与当前 path。`startAction` 会中断 actor 的旧 Action；`queryAction` 和 `queryActorAction` 返回 clone。
- Simulation scheduler 固定为 movement 10Hz、perception 0.5 秒、behavior 1 秒、needs 5 秒。长 tick 被切片，和等总量短 tick产生等价的规则结果；浏览器帧率不改变决策频率。
- `grazer`：基础生命 12、速度 1.6、饥饿增长；饥饿时寻找 10 格内 berry world item，到达后经正式 world-item despawn/consume 入口进食；发现 hostile 或被攻击后逃跑；死亡掉落 berry，不实现繁殖。
- `night-stalker`：基础生命 16、速度 2.2；只在 18:00–06:00 主动感知 12 格内 alive player，追至 1.7 格内每 1 秒造成 2 damage；目标死亡、脱离范围或白天后终止追逐并返回 wander/home；死亡掉落 stone-block。
- `settler`：基础生命 20、速度 1.4；06:00–18:00 前往 work POI，夜间返回 home POI，饥饿高时先访问 food POI并恢复需求，发现 hostile 时逃离；无 LLM、对话、交易或任务。
- Simulation active area 以 alive player 为锚，48 格内 actor 才执行高频模拟；超出范围保留状态但标为 inactive。自然内容与管理入口的 retained actor 上限为 512；性能压力档记录 10/100/500，1000 请求必须被有界拒绝或只作纯查询压力，不让所有探索实体永久活跃。
- 建立确定性 starter ecology/content：首次创建世界且没有 simulation snapshot 时，在初始玩家附近 16 格内寻找合法 surface，注册 home/work/food/camp POI，生成一只 grazer、一只 night-stalker、一名 settler和可取得 berry；用小型 stone/wood 标记形成可辨认营地，不改变 generatorVersion、基础世界生成或 Chunk codec。恢复存档不重复生成。
- 将 GameplaySnapshot 升级为 V2，保存 actor state、POI、Action sequence/status、needs、位置、生命、目标、simulation clock 与当前 0–24 小时 worldTime；V1 明确迁移为空 simulation并保留旧的默认时钟语义，损坏 V2 fail closed。需要持久存在的 starter actor/NPC 全部恢复，不复制，继续世界不把昼夜重置为 09:30。
- 扩展 GameServer 与 Structured Command：observer-scoped observation/POI/action/path/reachability query；start/interrupt action；spawn actor；register/remove POI；既有 spawn/despawn、damage、save 与 tick 复用。player/agent source 不得借 payload观察或控制其他 actor，本地 developer/system/admin capability 可显式指定。
- Human Debug/Headless 增加最小 `/summon <grazer|night-stalker|settler> <x> <y> <z>`、`/observe [entity-id]`、`/entity action <entity-id>`、`/entity move <entity-id> <x> <y> <z>`、`/entity stop <entity-id>`、`/path <entity-id> <x> <y> <z>`、`/poi nearby <entity-id> <radius>`；slash 只作薄适配。
- Browser presenter 对三类 actor 使用不同颜色、轮廓、标签和轻量步行动效，并按服务端位置平滑表现；不另存 canonical path/needs。自然出生内容进入现有 UiBridge/Harness presented entity 投影，不创建第二个 Svelte root或重写父任务 UI 主题。
- Harness 输出 active/retained actor、perception、LOS、behavior evaluation、navigation、expanded node、repath、Action completion/failure/interruption、simulation time 与 presentation 数量；变化继续受现有 UI publish 频率约束。

### 明确不做

- 不实现 LLM、AgentServer、Agent Harness、Context Compiler、prompt、NPC memory、生成式对话或 Agent ACL；不建立 `AgentMoveTo` 等第二套能力。
- 不实现飞行、游泳、攀爬、复杂 parkour、完整 navmesh、动态人群避让、门、车辆或跨世界导航。
- 不实现繁殖、完整生态、农业、经济、社交、职业生产链、任务、Settlement simulation、Region/World Agent 或 Simulation LOD。
- 不重写 terrain generator、Chunk 尺寸、voxel 数值、mesh、渲染管线、游戏 Shell、音频、灯光、反射或后处理；与父任务约定的 `Voxel.Lantern=9` 不在本分支抢占。
- 不把 Midscene、Debug 命令或测试专用 teleport 当成无 Debug 黄金旅程通过；父 change 的 30–60 分钟完整试玩和 60 分钟设备稳定性仍由最终集成验收。

## 关键决策（Decisions）

1. **Simulation 是 Gameplay 聚合的一部分，但位于独立纯逻辑模块。** `src/server/simulation/` 不依赖 DOM、PlayCanvas、Worker 或 Node I/O；GameplayRuntime 只提供 Entity/Player/WorldItem/Combat callback 与 snapshot 编排，避免继续膨胀为单体。
2. **Entity 与 Actor State 分离。** EntityStore 继续持有 identity/type/position/health/archetype；AutonomyRuntime 用 entity id 关联 needs、behavior、Action 和 POI refs。位置仍只有 EntityStore 一份真相。
3. **Action 是正式异步语义边界。** 行为选择、Debug、Headless 和未来 Agent 都调用同一 `startAction`；movement hot path可直接更新 EntityStore，但完成/失败/中断必须落回 ActionRuntime 并产生 Observation。
4. **导航按当前 voxel surface 即时规划。** 首版不生成全局 navmesh；A* 只访问搜索包围范围内的 voxel，每节点验证脚下 solid 与两格净空，允许一步高差。预算耗尽与不可达分开返回，动态失效按有界次数重算。
5. **感知先空间裁剪再 LOS。** Nearby 使用 EntityStore bucket；只对范围内候选做 voxel ray sample，不能退化为 actor 两两全量扫描。普通 actor和 agent source 都以 observer identity 进入接口。
6. **分频用 accumulator 而非依赖 frame。** Movement 0.1 秒、perception 0.5 秒、behavior 1 秒、needs 5 秒，长 dt 拆分后与短 dt 保持相同调度序列；每个 simulation tick 有 actor 和 pathfinding预算。
7. **自然内容是版本化 gameplay 初始化，不是基础生成器。** `starterEcologyVersion=1` 随 GameplaySnapshotV2 保存；同一 seed/初始位置产生相同 POI/actor布局，旧存档迁移不自动改造已有世界，避免静默改变基础 terrain 解释。worldTime 与 gameplay snapshot 一起保存，载入时先恢复 Server 时钟，再同步浏览器环境表现。
8. **实体激活有界。** 48 格外 actor 不运行 movement/perception/behavior；保留上限 512，starter 内容固定三 actor。未来可替换为 Chunk streaming/Simulation LOD，但当前 API 已区分 retained 与 active。
9. **玩家伤害继续走 Change 8 正式规则。** hostile 不直接写 health；passive死亡和 world food consumption 经 GameplayRuntime callback 生成/移除正式 world item，避免第二套掉落与背包逻辑。
10. **视觉只解释服务端状态。** presenter根据 archetype与前后位置选择颜色、朝向和步行 bob；Svelte hidden semantic nodes暴露 label/id/type/archetype/behavior供可访问性与浏览器验收，不能驱动规则。

## 行为（Behaviour）

- **Given** observer 与 candidate 在范围内，**When** 中间无 solid voxel，**Then** 返回带距离的 `entity-seen`；超距或 LOS 被阻挡时不返回。threat/food/POI 只由 observer-scoped observation 派生。
- **Given** 起点与终点位于合法 surface，**When** 规划经过平地、一步台阶或 Chunk 边界，**Then** 得到相邻合法节点组成的 path；两格高墙、无落脚点、超预算分别返回明确失败且不修改实体。
- **Given** running move Action，**When** 下一节点被正式 world edit 阻挡，**Then** 最多重算 3 次；新路可达则继续，同一目标不可达则 `failed`，不穿越 solid、不永久 running。
- **Given** actor 已有 running Action，**When** 新 Action 被接受或显式 stop，**Then** 旧 Action 记录 `interrupted` 及 reason，新 Action拥有不同稳定 id；query 返回 defensive clone。
- **Given** hungry grazer 与可见 berry，**When** simulation推进，**Then** 选择 eat/move Action、到达 berry 后从 world移除并降低 hunger；发现 hostile 或收到 attacked stimulus 时转为 flee。
- **Given** 夜间 hostile 可见 alive player，**When** simulation推进，**Then** chase、重规划并在合法距离/冷却内通过正式 damage入口攻击；白天、LOS/范围丢失或玩家死亡后终止追逐。
- **Given** settler 与 home/work/food POI，**When** 日夜或 hunger跨阈值，**Then** food优先于日程、threat优先于food，完成后恢复 day-work/night-home；失败 Action 有明确结果且下一低频 decision 可恢复。
- **Given** actor 距全部 alive player 超过 48 格，**When** simulation推进，**Then** needs时间仍以低成本记账或冻结为合同值，但 movement/perception/behavior不执行，active metric下降；回到范围后从保存状态恢复。
- **Given** 首次新世界，**When** 玩家生成，**Then** 同 seed与spawn生成相同 starter POI、三类 actor与营地标记；保存刷新后 id、位置、health、needs、POI、Action sequence、worldTime与初始化版本恢复且不重复，夜间保存后继续仍为夜间。
- **Given** player/agent source，**When** query/control payload 指定其他 entity，**Then** 在读取 observation/action前拒绝；developer/system source可以显式调试。所有失败返回结构化 error且不部分更新。
- **Given** 浏览器正常进入世界，**When** 玩家在附近探索并切换至夜晚，**Then** 无 `/summon`、`/give`、`/tp` 也能看到三类可辨实体移动，settler在POI间行动，night-stalker追击并造成真实伤害；切世界后旧 presenter和simulation状态不串入。

## 测试设计（Test Design）

- `tests/server/poi-perception.test.ts`：预期 RED；覆盖 POI CRUD/clone/nearby、observer identity、range、LOS、threat/food/POI observation和空间候选预算。
- `tests/server/ground-navigation.test.ts`：预期 RED；覆盖平地、上/下一级、solid避障、替代路径、不可达、预算耗尽、跨 Chunk和动态阻断重算输入。
- `tests/server/action-runtime.test.ts`：预期 RED；覆盖 stable action id、pending→running→succeeded/failed、替换/显式 interrupted、clone、snapshot roundtrip与非法恢复。
- `tests/server/autonomous-actors.test.ts`：预期 RED；使用纯 GameServer fixture覆盖grazer寻食/逃跑/死亡掉落、night-stalker夜间追击/攻击/白天停止、settler food/day/night/threat优先级、长短 tick等价、48格active boundary与512上限。
- `tests/server/simulation-command-persistence.test.ts`：预期 RED；覆盖observer-scoped query/action、admin spawn/POI、slash薄适配、V1→V2迁移、V2与worldTime roundtrip、损坏 snapshot fail closed、无浏览器 Headless三 actor完整流程。
- `changes/2026-09-05-creature-npc-algorithmic-foundation/e2e/autonomous-world.spec.ts`：预期 RED；真实浏览器不使用 summon/give/tp，验证新世界自然出现三类 semantic presenter、位置随 simulation改变、NPC日夜POI行为、键盘调到夜间后 hostile产生真实生命下降、刷新不重复和世界切换无残留。
- `changes/2026-09-05-creature-npc-algorithmic-foundation/midscene/autonomous-world.yaml`：预先定义白天营地/被动生物/NPC、夜间敌对生物/危险反馈、三类轮廓和动效可辨的视觉语义；Midscene不证明路径算法或攻击数值。
- `scripts/run-harness.mjs` 增加 10/100/500 actor采样与1000有界拒绝，分别记录 perception/navigation/behavior/simulation耗时、expanded nodes、repath、Action结果、active/retained actor、snapshot bytes；不设置跨机器硬阈值。
- 当前 `tests/e2e/` 继续作为长期 baseline；本 change用例不自动提升，缺少独立 Sol/xhigh评审时 fail closed保留在 change目录。

## 验收与证据（Acceptance & Evidence）

- [x] **Vitest：** POI与observer-scoped perception的range、LOS、threat/food/POI和clone不变量通过。
- [x] **Vitest：** voxel ground navigation的平地、一步高差、障碍、重算、不可达、预算与跨 Chunk通过。
- [x] **Vitest：** Action状态、替换/中断、结果、snapshot与防御性查询通过。
- [x] **Vitest：** grazer、night-stalker、settler的需求与优先级、移动、进食、逃跑、攻击、日程、死亡掉落通过，长短tick等价。
- [x] **Vitest：** active boundary、retained上限、分频和候选预算保持有界。
- [x] **Vitest / Headless：** 三类 actor流程、Structured Command权限、slash、V1迁移、V2 roundtrip与损坏恢复fail closed通过。
- [x] **Playwright-change：** 无spawn/give/tp的自然内容、三类entity reconcile/移动、日夜NPC/hostile、真实玩家伤害、刷新/切世界通过；2/2通过。
- [x] **Playwright-baseline：** 现有长期浏览器基线9/9通过且未加入重复旅程。
- [x] **Harness：** 10/100/500与1000边界输出simulation/perception/navigation/Action/active/snapshot/presentation指标；1000请求在512上限有界拒绝，未见全量两两候选或无界寻路。
- [x] **Midscene：** 三类实体、营地/POI、日夜行为和危险反馈清楚可辨，无明显重叠、截断或voxel伪装；2个任务通过。
- [x] **Static：** `pnpm verify:static`通过，world purity、500行、kebab-case及`src/world/**`行覆盖率≥80%。
- [x] **Build：** `pnpm build`通过。
- [x] `git diff --check`通过。

## 任务与当前状态（Tasks & Current State）

1. [已完成] 已读取 AGENTS、Change8交付、父MVP合同、用户提供的Change9路线文档、当前GameServer/Entity/Command/Persistence/Harness与browser presenter。
2. [已完成] 已在Change8提交上建立`codex/creature-npc-algorithmic-foundation`分支，向父任务同步接口和不重叠边界。
3. [已完成] 已选择Breaking flow；用户批准实现合同SHA-256 `9f543542a401c159c77fde3a38f66126ba412689470090068b7f0536cf86c6e9`，随后执行RED→GREEN和全部准出；交付阶段只回填实际证据，未实质改变已批准范围与行为。
4. [已完成] 建立本合同、五组Vitest、Playwright-change与Midscene预期；实现前以缺失模块和命令取得5组预期RED。
5. [已完成] 按POI/Perception→Navigation→Action→Autonomy→Command/Persistence→自然内容→Browser表现顺序实现。
6. [已完成] 静态、构建、change/baseline浏览器、Harness和Midscene准出；已补齐交付快照，独立本地commit在本文件最终落盘后创建，不push。

## 交付快照（Delivery Snapshot）

- **生产路径：** 新增`src/server/simulation/`下POI、感知、地面导航、Action、Actor状态、自主调度与starter ecology；新增`src/server/gameplay/gameplay-snapshot.ts`并升级持久化；扩展Entity、GameplayRuntime、GameServer、Structured Command与slash；扩展browser presenter、UiBridge semantic projection、Harness和中英文README。
- **RED：** 首次运行五组新增Vitest时，因simulation模块、snapshot V2和新增command contract尚不存在而按预期失败；随后以相同测试合同完成实现。
- **GREEN：** `pnpm verify:static`通过，33个测试文件通过、2个跳过，183个测试通过、4个跳过；总行覆盖率95.89%，Svelte检查0错误0警告。`pnpm build`通过。
- **浏览器证据：** `pnpm exec playwright test changes/2026-09-05-creature-npc-algorithmic-foundation/e2e`为2/2通过；`pnpm test:e2e`为9/9通过。需求用例继续保留在change目录，未申请提升为长期基线。
- **Harness：** 最终关联run id为`695342e0-4cc9-45a5-9afa-321b7f422809`，`browserE2E=PASS`、`browserBenchmark=PASS`。1.1秒采样中，10/100/500个retained actor分别耗时132.59/975.50/1398.80ms，active为3/60/427，行为评估为3/60/427，导航规划为2/42/298，LOS检查为20/1958/17990；500档扩展1196个节点。1000请求在512 retained上限拒绝，没有扩大永久活跃集合。
- **自然内容与恢复：** `starterEcologyVersion=1`使用`living-world-autonomy`命名空间，从canonical `terrainHeight(seed,x,z)`附近有界搜索安全surface；创建三类actor、四类POI、berry、小营地与一棵确定性小树。V2保存simulation与worldTime；V1迁移为空simulation，恢复V2不重复starter内容。
- **视觉证据：** `pnpm exec midscene .../autonomous-world.yaml`的2个任务通过；被动四足、夜间敌对轮廓、settler人形与右侧小标签可辨。视觉采样只使用受控spectator camera，规则与无Debug自然旅程由Playwright-change独立证明。
- **已知限制：** 首版为四向surface A*、一步高差、48格active area与512 retained上限；不包含游泳、飞行、动态人群避让、LLM/Agent、对话交易或完整生态。跨设备60分钟稳定性与父change的完整长时游玩仍属于最终集成验收。
- **提交：** 本地独立commit与本交付快照一同创建；SHA通过父任务同步，不在文件内自引用；不push、不发布。
