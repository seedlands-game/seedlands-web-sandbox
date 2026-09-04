# 生存玩法与实体底座

**状态：** 已交付；用户已批准 SHA-256 `9f543542a401c159c77fde3a38f66126ba412689470090068b7f0536cf86c6e9`，实现与全部准出证据完成

## 背景与目标（Context & Goal）

Change 7 已在本地主分支提交 `863ff08`，建立了结构化 `ServerCommand`、capability seam、Node Headless CLI、浏览器 Debug Shell 和结构化 Harness 调用路径；插入的 Retained UI change 已在本分支提交 `7c46b73`，建立单一 Svelte 5 root、四分片 `UiBridge`、action port、六个 UI primitive、presentation lint 边界与低频 projection/telemetry。当前 `GameServer` 仍只持有 voxel、世界时钟和仅含 `id/kind/position` 的临时实体；浏览器直接把左/右键解释为免费且瞬时的 voxel 编辑，热栏只是四个材质按钮，玩家没有物品、生命、饥饿、掉落、合成、受伤或死亡状态。

本变更把现有 `Explore / Break / Place` 原型升级为第一个可重复验证的最小生存闭环：玩家采集 voxel，生成可见世界物品，拾取进入背包，消耗物品放置或合成工具，使用工具提高采集效率，并能进食、攻击、受伤、死亡和复活。所有 canonical gameplay state 与规则由 `GameServer` 持有；浏览器、Debug Shell、Headless Harness 和未来消费者复用同一结构化 API / Command，不拥有第二套业务规则。

## 范围与明确不做（Scope & Non-goals）

### 范围

- 建立消费者无关的 Entity Runtime：稳定 `EntityId`、类型、lifecycle、位置、spawn/despawn/get/query/update 授权入口；完整支持 `player`、`world-item`，并允许创建无 AI 的静止 `creature` 作为 combat foundation 验收目标。
- 建立正式 `PlayerState`：位置、20 点生命、20 点饥饿、24 格 Inventory、前 8 格 Hotbar、选中槽、alive/dead、攻击冷却和正在采集的动作状态。
- 建立独立字符串 namespace 的数据驱动 Item Registry，不把 `ItemId` 与数值 `VoxelId` 等同；首版物品为 `dirt-block`、`stone-block`、`wood-block`、`sand-block`、`berry`、`plank`、`wood-axe`、`stone-pickaxe`。
- 建立固定容量 Inventory：stack merge、空槽分配、原子 add/remove、contains、slot query、选择 Hotbar、满包拒绝；block/resource/food 上限 64，工具上限 1。
- 建立 voxel gameplay definition：可采集性、hardness、preferred tool、掉落与可放置 item 映射。Grass/Dirt 掉 `dirt-block`，Stone 掉 `stone-block`，Wood 掉 `wood-block`，Leaves 掉 `berry`，Sand 掉 `sand-block`；Air/Water 不掉落，Snow 首版不可采集。
- 建立服务端采集动作：`break-voxel` 开始或保持目标，`cancel-break` 取消；`GameServer.advanceGameplay(seconds)` 根据 hardness 与当前选中工具累计 canonical progress，完成时只经一次 `editBatch()` 把目标改为空气并生成一个 `world-item`。客户端按住左键维持采集，松开或换目标取消。
- 工具倍率：Hand 为 1×；`wood-axe` 对 Wood/Leaves 为 3×；`stone-pickaxe` 对 Stone 为 4×；非 preferred block 使用 1×。首版 hardness 秒数为 Grass/Dirt 0.35、Stone 2.4、Wood 1.2、Leaves 0.2、Sand 0.3。
- 建立世界物品 spawn/drop/pickup/despawn；玩家主动 pickup 或服务端 tick 自动拾取 1.5 格内物品，只有 Inventory 能完整容纳该 stack 才 despawn，满包不丢物。
- 建立生存放置规则：`place-voxel` 校验玩家存活、目标可替换、距离不超过 5 格、目标不与玩家 AABB 重叠、选中 stack 是可放置 block item；成功时同一服务端操作先验证完整，再消耗 1 个 item，并只经一次 `editBatch()` 放置。失败不消耗。
- 建立无形状 Recipe Registry：`wood-block -> 4 plank`、`3 plank -> wood-axe`、`2 plank + 3 stone-block -> stone-pickaxe`；合成检查输入和输出容量后原子提交。
- 建立 Hunger / Health / Damage / Death：alive 玩家每 120 个 gameplay 秒失去 1 hunger；hunger 至少 16 且生命未满时每 10 秒恢复 1 health 并消耗 1 hunger；hunger 为 0 时每 15 秒受到 1 starvation damage；`berry` 恢复 4 hunger但不超过 20。
- 建立最小 Combat：存活玩家对 3 格内 damageable entity 攻击，基础伤害 4、冷却 0.5 秒；攻击实体不存在、超距、攻击者死亡或冷却中均失败且不改状态。无 AI 的静止 creature 有 12 点生命，可由 admin/debug 命令生成并在死亡时 despawn；不实现追逐或反击。
- 玩家 health 到 0 后进入 `dead`，停止采集、攻击、放置、使用物品和自动拾取，将 Inventory 中所有 stack 作为 world item 掉在死亡位置并清空 Inventory；`respawn` 回到该世界记录的 spawn position，恢复 20 health、20 hunger 和 alive，不恢复掉落物。
- 扩展 Change 7 结构化命令与 Debug/Headless slash surface。Query：player state、inventory、entity、nearby entities、item/voxel definitions、recipes/craftable recipes。Player mutation：select slot、break/cancel、place、pickup、drop、use、craft、attack、respawn。Administrative：give/remove item、spawn/despawn entity、apply damage、heal、推进调试 tick。既有 `save` 同时保存 dirty Chunk 与 gameplay snapshot。浏览器/Headless 的 slash 默认以 `CommandSource.entityId` 为当前玩家，首版支持 `/inventory`、`/give <item> <count>`、`/health`、`/hunger`、`/damage <amount>`、`/heal <amount>`、`/spawnitem <item> <count> <x> <y> <z>`、`/spawn creature <x> <y> <z>`、`/craft <recipe>`、`/break <x> <y> <z>`、`/cancelbreak`、`/pickup <entity-id>`、`/drop <slot> <count>`、`/place <x> <y> <z>`、`/use`、`/attack <entity-id>`、`/respawn`、`/tick <seconds>` 和 `/nearby <radius>`；结构化 admin command 仍可显式指定目标实体。
- 将 gameplay executor/validation/handler 拆出独立模块；现有 `server-command-executor.ts` 保持编排、权限、结果和 observation 职责，不在其中复制 Inventory、Entity、Combat 或 Crafting 规则，也不得超过项目 500 有效行门禁。
- 建立 gameplay persistence port 与版本化 snapshot，至少保存 players、Inventory/Hotbar、health/hunger/lifecycle、world items、damageable creature、entity sequence 与 gameplay clock。浏览器 IndexedDB 与 Memory persistence 均实现该 port；旧版仅有 player position 的 metadata 迁移为满 health/hunger、空 Inventory 的新 PlayerState，Chunk snapshot 格式和 generator version 不变。
- 浏览器在现有 Svelte 5 `AppRoot` 与四分片 `UiBridge` 上扩展生命、饥饿、8 格 Hotbar、Inventory/Crafting、死亡 overlay、选中工具/物品、采集进度、target 与交互反馈；复用 `GameButton`、`GamePanel`、`GameSlot`、`GameTextField`、`GameOverlay`，必要时新增 change-scoped retained component，不恢复 `app-elements` 或任何 `innerHTML/textContent/hidden` 手写 Player UI。`E` 开关 Inventory/Crafting，`1–8` 选择槽。WorldItem 与静止 creature 只有轻量 PlayCanvas presentation entity，Server Entity 不等于 PlayCanvas Entity。
- Harness 暴露只在 `?harness=1` 存在的结构化 gameplay command / tick 入口并调用生产 executor/API；Headless 流程可完成 spawn player、give、break、pickup、craft、damage、save、reload、verify。

### 非目标

- 不实现 Creature/NPC AI、寻路、追逐、反击、社会模拟、Agent runtime、Simulation LOD 或 multiplayer networking。
- 不实现完整 GameMode、远程 ACL、账号系统或网络可信边界；继续复用 Change 7 的 `CommandSource` 和 capability seam，浏览器只拥有同进程本地玩家与 debug source。
- 不实现农业、烹饪、口渴、复杂营养、装备槽、护甲、耐久消耗、修理、附魔、技能树、魔法、任务、经济或完整科技树。
- 不实现 Minecraft shaped crafting grid、完整 Minecraft 命令语法、复杂连招、精细 hitbox、投射物或最终死亡/转生世界观规则。
- 不更改确定性世界生成、Chunk 尺寸、voxel 数值 namespace、greedy mesh、streaming、Chunk snapshot codec 或 generator version。
- 不把每个 Inventory slot/stack 建成 PlayCanvas Entity，也不把 Svelte/UiBridge presentation snapshot、相机或 slash 文本变成 canonical gameplay state；不新增第二个 Svelte root、通用全量 Game store或每frame UI mirror。

## 关键决策（Decisions）

1. **领域规则位于 `src/server/gameplay/`，`GameServer` 是聚合边界。** Item、Inventory、Recipe、Entity、Survival 等模块保持无 DOM、PlayCanvas、Worker 和 Node I/O 依赖；`GameServer` 组合它们并提供授权后的高级操作。`src/world/` 继续只负责确定性 voxel/world 纯逻辑，不反向依赖 gameplay。
2. **Entity Runtime 从 `game-server.ts` 的临时 Map 中抽离，但保留兼容入口。** 新 `EntityStore` 负责 clone/validation/id sequence/lifecycle 和空间 bucket；`createEntity/getEntity/updateEntity` 暂作兼容别名，Change 7 的 teleport 行为保持。新代码使用 `spawnEntity/despawnEntity/queryEntities/queryNearbyEntities`。
3. **PlayerState 是 player entity 的服务端组件，不复制位置。** player entity 的 position 是唯一位置；PlayerState 以 entity id 关联生命、饥饿、Inventory、选择和动作。每帧浏览器仍把真实碰撞后相机位置同步至 Server，但其他 gameplay 字段只能经服务端规则修改。
4. **Item 与 Voxel 显式映射。** `ItemId` 使用稳定 kebab-case 字符串；block item definition 可含 `placesVoxel`，voxel gameplay definition 可含 drop/hardness/preferred tool。两者通过 registry 查询，不依赖数值相等或数组下标偶合。
5. **Inventory 操作是 plan-then-commit。** 所有 add/remove/craft/pickup/death drop 在验证容量、数量和 stackLimit 后一次提交；返回 clone，外部不得取得可变 slots。失败不会出现部分扣除、部分输出或 world item 丢失。
6. **采集进度属于服务端 gameplay clock。** `break-voxel` 只声明/更新玩家目标，`advanceGameplay()` 才累计时间并完成 mutation；换目标、超距、死亡、目标 voxel 改变或 cancel 会清空进度。Headless Harness 通过同一 tick API 推进，不以 debug command 直接删除 voxel。
7. **一个完成采集对应一个 voxel transaction。** 完成时先解析掉落与实体容量，再提交一个 voxel mutation；commit 成功后生成 world item。若 voxel 已改变则不提交也不掉落。客户端只消费返回的 `WorldCommitResult` 做聚合 remesh。
8. **普通玩法和 admin 调试分权。** 玩家交互命令使用 mutation capability并由 `CommandSource.entityId` 绑定本人；`give/remove/spawn/despawn/apply-damage/heal` 使用 administrative capability。玩家 source 不得通过 payload 指定另一个 player id；本地 debug/headless admin 可以显式指定目标。
9. **Command 扩展采用薄适配。** `command-contract.ts` 合并 world 与 gameplay discriminated union；`gameplay-command-handler.ts` 负责 gameplay 命令的结构校验和对 `GameServer` 高级 API 的调用，主 executor 继续统一 authorization、异常归类、observation 和 `CommandResult`。slash parser 只解析人类调试需要的子集，不是领域合同。
10. **持久化是版本化服务端 snapshot。** `GameplaySnapshotV1` 只含 JSON-safe plain data，不含 PlayCanvas 对象、Map、计时器或派生 UI 状态。载入必须验证版本、唯一 entity id、有限位置、ItemId、stackLimit、slot capacity 与 health/hunger 范围；无 gameplay snapshot 时从旧 player position 创建默认玩家，损坏 snapshot 返回明确错误而不是部分恢复。
11. **保存失败保持可重试。** `save` 先捕获不可变 gameplay snapshot，再请求 persistence 保存并刷新 dirty Chunk；任一步失败返回 execution error，未成功持久化的 Chunk 继续 dirty，内存 gameplay state 不回滚也不伪报已保存。首版不承诺跨多个 IndexedDB transaction 的崩溃级原子性，snapshot 内带 revision 便于后续 checkpoint 升级。
12. **浏览器表现层按 entity id reconcile，GUI 扩展现有 retained 合同。** 独立 presenter 对 world-item/creature 创建、更新和销毁轻量 PlayCanvas Entity；player camera 不重复创建。`Game` 将权威 PlayerState/Inventory/target/break/death 结果投影成不可变小型 snapshot：生命、饥饿、选中槽与 8 格 Hotbar 进入 `hud`；target、采集进度与短时反馈进入 `interaction`；Inventory/Crafting 开关、24 格内容、可合成配方与死亡 overlay 进入 `shell`。Debug 继续不超过 4Hz；health/hunger/inventory/recipe/death 仅在权威 revision 或可见值变化时发布，采集进度最高 20Hz，任何 gameplay UI 都不得按渲染帧全量发布。Svelte component 只消费 presentation contract 并通过 action port 发送结构化意图，不 import `GameServer`、`World` 或 PlayCanvas，不另存 canonical gameplay 对象。
13. **死亡规则明确为临时玩法规则。** 掉落全部 Inventory、清空动作并允许复活只服务当前 Gameplay Foundation；不代表最终 severe injury、true death 或 reincarnation 设计。
14. **Change 8 作为一个审核合同分阶段实现。** 实施顺序为领域值对象 → Entity/Player 聚合 → interaction/survival → command/headless → persistence → client presentation/UI。任何 Scope、规则数值、持久化格式、命令权限或 Acceptance 的实质变化都使批准 hash 失效。

## 行为（Behaviour）

- **Given** 一个空 24 格 Inventory，**When** 添加相同 stackable item，**Then** 先补满既有 stack 再使用空槽；数量超过总容量时整个操作失败且 slots 不变；工具永不堆叠。
- **Given** 合成输入足够但输出无容量，**When** 执行 craft，**Then** 输入不扣除；成功时输入扣除与输出增加在一个领域提交中可见。
- **Given** player/world-item/creature entity，**When** spawn、move、query nearby、despawn，**Then** id 唯一、返回 defensive clone、空间索引随位置更新、despawn 后查询不到；Server Entity 不引用 PlayCanvas 类型。
- **Given** 存活玩家在 5 格内按住采集有效 voxel，**When** gameplay clock 达到当前工具对应时长，**Then** voxel 只经一次 `editBatch()` 变为空气并生成正确 world item；提前松开、换目标、越距、死亡或 voxel 被别人改变时不产生掉落。
- **Given** world item 在玩家 1.5 格内，**When** 自动或显式 pickup 且 Inventory 可完整容纳，**Then** stack 加入后实体 despawn；满包时两者均不变化。
- **Given** 玩家持有可放置 block item，**When** 目标合法，**Then** 一次消费与一次 voxel commit 同时成功；无物品、越距、非 replaceable target 或与玩家 AABB 重叠时不消费、不修改世界。
- **Given** 玩家持有 wood/stone，**When** 按 registry 合成 axe/pickaxe，**Then** 配方原子执行且选中工具改变对应采集倍率；未知配方或资源不足结构化失败。
- **Given** alive 玩家，**When** gameplay clock 推进，**Then** hunger、自然恢复和 starvation 使用固定 accumulator，长 dt 与等总量小 dt 得到相同结果，并且数值始终夹在 0–20。
- **Given** 玩家使用 `berry`，**When** hunger 未满，**Then** 消耗 1 个并恢复最多 4 hunger；满 hunger、死亡或未持有时不消耗。
- **Given** 攻击者和 damageable target 在 3 格内，**When** 冷却结束后 attack，**Then** 造成 4 damage 并启动 0.5 秒冷却；冷却中、超距、死亡或非法目标不造成伤害。
- **Given** 玩家生命降到 0，**When** damage resolve，**Then** lifecycle 变 dead、动作清空、Inventory 全部生成 world-item 后清空；dead 玩家不能交互。`respawn` 后回到 spawn position、满生命和饥饿，原掉落仍存在。
- **Given** query-only source，**When** 查询 player/inventory/entity/definitions/recipes，**Then** 返回只读结构化数据且 revision/state 不变化；尝试 mutation/admin command 在读取目标状态前被拒绝。
- **Given** player source，**When** payload 尝试控制其他 player，**Then** handler 使用 `source.entityId` 或拒绝，不能横向修改；admin source 可按合同显式指定目标。
- **Given** 浏览器、Node Headless 或 Harness，**When** 执行同一 gameplay structured command，**Then** 都经过同一 executor/GameServer rule；slash、键鼠和按钮只负责适配。
- **Given** 已保存的 GameplaySnapshotV1，**When** 新 GameServer 载入，**Then** player/entity/inventory/health/hunger/lifecycle/world item 与 gameplay clock 精确恢复；旧 position-only metadata 创建默认 PlayerState；损坏 snapshot 不部分恢复。
- **Given** 浏览器进入世界，**When** 采集、靠近掉落、打开 Inventory、合成、选择物品并放置，**Then** 单一 Svelte root 中的 HUD、Hotbar 和 overlay 经 UiBridge 小型投影与 Server snapshot 一致，world item presenter 按 entity id reconcile，刷新页面后持久化状态恢复；未变化分片、Hotbar DOM 节点与 crosshair 不重建，静止状态不产生逐帧 gameplay UI publish。
- **Given** Inventory/Crafting 或 Debug Shell 获得焦点，**When** 输入 WASD、1–8、E、P、T、M、F3/F4，**Then**文本输入所需按键不泄漏到移动或 gameplay shortcut；关闭面板后控制恢复且不自动请求 Pointer Lock。

## 测试设计（Test Design）

- `tests/server/item-inventory-recipe.test.ts` 在实现前预期 RED：覆盖 registry namespace/mapping、stackLimit、merge/split/add/remove/contains、满包原子性、工具单格、三条 recipe、资源不足和输出无容量回滚。
- `tests/server/entity-player-runtime.test.ts` 在实现前预期 RED：覆盖四类 entity identity/lifecycle、防御性 clone、移动空间索引、nearby query、PlayerState 默认值、非法 snapshot 和旧 position migration。
- `tests/server/survival-gameplay.test.ts` 在实现前预期 RED：覆盖 break progress/tool multiplier/cancel/stale target、一次 world transaction + drop、pickup 满包、place consume/碰撞/距离、hunger/heal/starvation、food、attack/cooldown、death drop/禁用交互/respawn。
- `tests/server/gameplay-command-persistence.test.ts` 在实现前预期 RED：覆盖 gameplay query/mutation/admin command 分类和 source 绑定、slash 子集、Headless 完整 loop、GameplaySnapshotV1 save/reload、旧 metadata migration、损坏 snapshot 与保存失败。
- `tests/app/gameplay-ui-projection.test.ts` 在实现前预期 RED：覆盖权威 gameplay snapshot 到 `hud` / `interaction` / `shell` 的分片映射、8 格 Hotbar、24 格 Inventory、craftable/death/break state、defensive projection，以及相同可见值的稳定 identity / coalescing 合同；测试不加载 DOM、Svelte、PlayCanvas 或 GameServer runtime。
- `changes/2026-09-04-survival-gameplay-entity-foundation/e2e/survival-gameplay.spec.ts` 在实现前预期 RED：真实浏览器先确认仍为单一`#ui[data-ui-runtime=svelte5]`，再覆盖生命/饥饿/8格Hotbar、按住采集、掉落可见、靠近拾取、E面板、合成、放置、静止creature攻击、damage/death/respawn、刷新恢复、retained node identity及输入焦点隔离。
- `changes/2026-09-04-survival-gameplay-entity-foundation/midscene/survival-gameplay.yaml` 在实现前定义可见语义：HUD 不遮挡世界，生命/饥饿/Hotbar/采集反馈层级清楚，Inventory/Crafting 可读，world item/creature 可辨认，死亡与复活反馈明确。
- Headless 流程由 Vitest 启动 `pnpm --silent server:headless -- --seed survival-headless --json`，通过上述 slash adapter 驱动同一结构化 command/tick 完成 loop；非法命令后继续，不能加载 DOM/Canvas/PlayCanvas。
- Harness 性能记录至少包括 entity/world-item 数量、nearby candidate/returned 数、Inventory 操作数、gameplay event 数、snapshot bytes、client presented entity 数与既有 UiBridge publish/stale/coalesced/DOM commit 指标；不设跨机器浏览器硬阈值，但结构断言 nearby query 不扫描无关空间 bucket，静止 gameplay HUD 不得退化为每 frame publish，采集进度 publish 不超过 20Hz。
- 现有 `tests/e2e/` 继续作为浏览器 baseline；本 change E2E 不自动提升为长期基线，交付时如需提炼必须另行通过独立 Sol/xhigh 评审门禁。

## 验收与证据（Acceptance & Evidence）

- [x] **Vitest：** Item/Inventory/Recipe 的 registry、容量、原子性和三条最小配方全部通过。
- [x] **Vitest：** Entity/PlayerState 的 identity、lifecycle、空间查询、clone 隔离和 snapshot validation/migration 全部通过。
- [x] **Vitest：** 采集、掉落、拾取、放置、工具倍率与一次 world transaction 不变量全部通过。
- [x] **Vitest：** hunger、自然恢复、饥饿伤害、食物、attack/cooldown、death drop 和 respawn 规则全部通过，并证明长短 tick 等价。
- [x] **Vitest：** gameplay command 分类、capability、source entity 绑定、错误结构、slash 适配与 query 不变性全部通过。
- [x] **Vitest：** gameplay UI projector 正确分片 HUD、交互和 overlay，产物与 canonical 对象隔离，未变化可见状态可 coalesce。
- [x] **Vitest：** Memory gameplay persistence 完整 roundtrip，旧 metadata migration、损坏数据 fail closed、保存失败可重试。
- [x] **Vitest / Manual supplement：** Node Headless 在无浏览器环境完成 spawn/give/break/pickup/craft/damage/save/reload/verify；TTY 只作补充。
- [x] **Playwright-change：** 单一Svelte root中完成资源闭环、合成/放置、真实左键 combat、death/respawn、刷新恢复、retained node identity、可见entity reconcile和输入焦点隔离；3/3 通过。
- [x] **Playwright-baseline：** 现有浏览器核心回归通过；既有 world edit、streaming、碰撞、存档、F3/F4 和 Debug Shell 无回归；9/9 通过。
- [x] **Harness：** 输出entity/world-item/inventory/query/event/persistence/presentation与UiBridge指标；nearby query只访问相关空间bucket，静止HUD无每frame publish且stale update为0。
- [x] **Midscene：** Survival HUD、8 格 Hotbar、Inventory/Crafting、world item、静止 creature、交互/死亡反馈清晰且不重叠、不截断；3 个任务全部通过。
- [x] **Static：** `pnpm verify:static` 通过，`src/world/**` 行覆盖率为 95.70%，server/world purity、kebab-case 和 500 行门禁保持通过。
- [x] **Build：** `pnpm build` 通过。
- [x] `git diff --check` 通过。

## 任务与当前状态（Tasks & Current State）

1. [已完成] 已读取用户提供的 Change 8 需求、AGENTS 约定、README、Change 7 任务与交付 spec、当前源码、测试、Harness 和 Git 状态。
2. [已完成] 已确认Change 7本地`main` commit `863ff08`，并先按用户顺序完成Retained UI / UiBridge底座，本分支commit为`7c46b73`。
3. [已完成] 已选择 Breaking flow：本变更新增 Entity/Player/Item/Inventory/Combat 公开合同，改变持久化格式、客户端交互语义并跨 server/client/app/worker/scripts/tests。
4. [已完成] 已建立本合同、五个 Vitest RED、三个 Playwright-change RED 与 Midscene 可观察预期。基于 retained commit `7c46b73` 执行 `pnpm exec vitest run tests/server/item-inventory-recipe.test.ts tests/server/entity-player-runtime.test.ts tests/server/survival-gameplay.test.ts tests/server/gameplay-command-persistence.test.ts tests/app/gameplay-ui-projection.test.ts --reporter=verbose --no-file-parallelism --maxWorkers=1`，5 个 test file 均因规划中的 `src/server/gameplay/*`、`memory-game-persistence` 或 `gameplay-ui-projector` 尚不存在而加载失败，符合预期 RED。执行 `SEEDLANDS_E2E_PORT=4211 pnpm exec playwright test changes/2026-09-04-survival-gameplay-entity-foundation/e2e --workers=1 --reporter=line`，3 个 Chromium 用例分别在生命 meter、采集 progressbar 与 `/give` parser 处失败；单一 `#ui[data-ui-runtime=svelte5]` 前置断言已通过，证明 RED 命中 Change 8 缺口而非 retained root 回归。
5. [已完成] 已按交付后的Svelte/UiBridge合同修订GUI scope、浏览器RED、Harness指标和presentation边界；旧审核hash保持失效。
6. [已完成] 用户批准精确 spec SHA-256 `9f543542a401c159c77fde3a38f66126ba412689470090068b7f0536cf86c6e9` 后开始修改生产代码。
7. [已完成] 已按领域值对象 → Entity/Player → gameplay → command/headless → persistence → retained browser presentation顺序实现并跑至 GREEN；补充真实准星左键攻击适配，避免只以 Debug 命令代替玩家行为。
8. [已完成] 静态检查、构建、change/baseline浏览器、Harness、Midscene 与交付快照全部完成；位于 `codex/survival-gameplay-entity-foundation` 功能分支，按约定创建本地语义化 commit，不 push。

## 交付快照（Delivery Snapshot）

本变更在 Retained UI 底座 commit `7c46b73e5d8a429f8bdf8a5f108fa82e9a0d4bb3` 上完成。主要交付路径如下：

- `src/server/gameplay/`：Item、Inventory、Recipe、PlayerState、EntityStore、voxel gameplay definition 与统一 GameplayRuntime。
- `src/server/game-server-gameplay.ts`、`src/server/commands/`、`src/server/persistence/`：GameServer 聚合 facade、结构化命令与 slash adapter、GameplaySnapshotV1 与 Memory persistence。
- `src/client/browser-chunk-persistence.ts`、`src/worker/persistence-worker.ts`：浏览器 IndexedDB gameplay snapshot 保存与恢复。
- `src/app/browser-gameplay.ts`、`src/app/gameplay-entity-presenter.ts`、`src/app/player-controller.ts`：服务端规则到浏览器输入、轻量实体表现和 UiBridge projection 的适配；准星左键会优先攻击未被 terrain 遮挡、3 格内的 creature，否则继续采集 voxel。
- `src/app/ui/`：生命/饥饿 HUD、8 格 Hotbar、24 格 Inventory/Crafting、完整可读物品名、采集反馈、死亡与复活 overlay；保持单一 Svelte 5 root。
- `scripts/`、`tests/` 与本 change 的 `e2e/`、`midscene/`：无头闭环、Gameplay Harness 指标、领域测试、真实浏览器行为和视觉语义验收。
- `README.md`、`README.zh-CN.md`：同步当前玩法能力、键鼠操作、调试命令与静止 creature 限制。

真实准出证据：

- `pnpm verify:static`：通过；28 个 Vitest file 通过、2 个按环境跳过，163 个 test 通过、4 个跳过；`src/world/**` 行覆盖率 95.70%；Svelte diagnostics 0 error / 0 warning。
- `pnpm build`：通过；主 JS 约 2,116.95 kB，gzip 约 559.10 kB，仍有既存的 Vite 大 Chunk warning。
- `SEEDLANDS_E2E_PORT=4211 pnpm exec playwright test changes/2026-09-04-survival-gameplay-entity-foundation/e2e --workers=1 --reporter=line`：3/3 通过；包括采集投影不超过 20Hz、真实左键击杀 creature、死亡/复活与刷新恢复。
- `SEEDLANDS_E2E_PORT=4211 pnpm test:e2e`：长期 baseline 9/9 通过；本 change 用例未提升或复制进长期基线。
- `SEEDLANDS_E2E_PORT=4211 pnpm harness`：通过，关联 browser run id `27c41708-ddcf-41c4-a696-92f9e9bd9acb`；unit/build/browser E2E/browser benchmark/world mutation 均为 PASS。Node gameplay 样本为 3 entities、1 world item、1 creature、8 个 nearby bucket、3 candidates/3 returned、2 次 Inventory operation、5 个 gameplay event、890 bytes snapshot。浏览器样本 `staleUpdateCount=0`、`coalescedUpdateCount=31`、`presentedEntityCount=0`，并输出全部 UiBridge publish/DOM commit 指标。
- `VOXEL_SANDBOX_URL=http://127.0.0.1:4211/?harness=1 pnpm exec midscene changes/2026-09-04-survival-gameplay-entity-foundation/midscene/survival-gameplay.yaml --dotenv-override`：HUD/背包、采集/合成、战斗/死亡/复活 3 个任务全部通过。采集进度的精确定时由 Playwright 断言；Midscene 负责持久可见的层级、辨识度和可读性。
- `git diff --check`：通过。

已知限制：creature 仍是无 AI、导航、追逐和反击的静止 combat foundation；死亡/复活规则是临时玩法规则；主 bundle 尚未拆分。首次聚合 Harness 曾受极短 Macro p95 样本的环境波动影响，使用同一浏览器证据重跑即通过，最终完整准出运行也直接通过。默认只创建本地 commit，不 push。
