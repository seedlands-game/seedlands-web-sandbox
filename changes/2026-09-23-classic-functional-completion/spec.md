# Classic 功能闭环、统一光照与 Mod 唱片

状态：实施中 / Breaking；用户已于 2026-09-24 明确批准现有目标与执行安排。

日期：2026-09-23

唯一协调目录：changes/2026-09-23-classic-functional-completion/
唯一总负责人：Paseo `4decc58b-bca7-4d00-a0ca-392fc5532f10`。本轮授权不是对历史任一 SHA-256 的追认；后续以本文、`architecture.md`、`tasks.md` 与 `execution-state.md` 的当前内容为实施和恢复依据。
TAKEOVER-01 公共实施负责人 / 唯一 Git writer：Paseo `954ef059-b17c-4842-bf46-5ebc1807b38e`。总负责人负责派工、建模和准出，不代替 TAKEOVER-01 执行 Git 写入。

## 目标与分层

让 Classic 已注册内容从“存在于 registry 或内部 runtime 测试”变成玩家可从真实浏览器输入使用、得到可见反馈、保存并恢复的能力；统一自然光、方块光与实体/手持物的受光语义；交付一张由 Classic Mod 打包、可在唱片机播放的音频唱片。

- Kernel 不增加 Classic 玩法概念，只保留现有身份、注册、授权、事务、调度、版本与窄端口。
- stdlib 提供由配置驱动的交互、装备、结构、攀爬、路线、载具、媒体播放状态和纯光照算法，不识别 Classic item/voxel/species/track ID。
- Classic/Mod 持有具体内容、规则参数、资源映射、曲目、获得方式和 render profile。
- Web runtime 持有浏览器输入/HUD、预测、renderer、Web Audio、Pack media I/O 与失败反馈，只消费已提交投影/事实。

## 当前事实

- 当前注册 194 个物品。按唯一主 capability 统计：place=80、mine=15、melee=5、consume=10、till=5、fluid-container=3、ranged=1、armor=16、无 capability=59。注册或纯 runtime 测试不等于玩家可用。
- BrowserGameplay.useTarget 当前只打开 station，useHeldItem 只 consume；AuthorityAction 缺少多数交互入口。两格结构、装备、流体、投射、农业、物种/生活技能、导航和车辆 runtime 多数是入口孤岛。
- 门无开关/完整碰撞，梯子无攀爬，轨道无四个弯角，车辆不进入正式 Authority entity projection，玩家与车辆位置存在双 owner 风险。
- 本轮此前运行四个既有 integration files / 16 tests 并通过，只是历史 control，不是新实现 GREEN。
- 方块光由 per-chunk cache/3D texture 持有；自然光是全局 sun+ambient。地形/水把 block light 加到 dEmission，实体另以 0.72 增 emission，手持物未接入；质量档切 tone mapping。
- record-13、record-cat 与 jukebox 只有内容/材质/配方。设置中的旧“本地参考曲”是 GlobalAudio.importReference → MusicPlayer 的内存 AudioBuffer，导入后立即替换当前音乐且不持久化；用户已明确取消这类自定义能力，本 change 必须让该上传/替换入口及专属状态和测试退场。内置合成音乐、master/music/sfx/ambience 音量与普通音效保持原语义。
- Pack 构建会摘要并复制 manifest.resources；现有 presentation loader 单文件上限 1 MiB 且只处理图像/GLB，不能承载 2,976,045-byte MP3，也不得为音频放宽它。
- docs/ci-testing.md 的 2026-09-20 条款已恢复 Classic Headless、Production build 和唯一 Chromium；09-16 冻结仅是历史段。

## 完整内容行为矩阵

矩阵覆盖当前 194 项；每族都要有后端 owner、真实入口、表现、保存与测试。原材料不伪造右键用途。

| 内容族        | 代表/数量                                    | 完成合同                                                                               |
| ------------- | -------------------------------------------- | -------------------------------------------------------------------------------------- |
| 普通单格放置  | place=80 中非状态结构                        | 真实右键、原子扣物、碰撞/unknown/stale 拒绝、可见 mesh；registry 逐项不得 unclassified |
| 采集与近战    | mine=15、melee=5                             | 正式 break/attack、品质/掉落/耐久；补 wood-sword 耐久                                  |
| 食物与余物    | consume=10                                   | 生命/饥饿、满包原子；蘑菇煲返 bowl、奶桶返空桶                                         |
| 农业          | till=5、种子、作物、骨粉                     | 锄地、种植、成长、收割、满包和恢复；Classic 配置具体作物                               |
| 流体容器      | 桶、水桶、熔岩桶                             | 取/倒流体、挤奶、余容器；多桶和满包不吞物                                              |
| 远程/投掷     | 弓、箭、雪球、鸡蛋                           | 瞄准/发射、弹药/耐久、命中/遮挡/孵化和恢复；复用唯一 Projectile owner                  |
| 装备          | 16 件护甲                                    | 四槽穿脱/交换、减伤、耐久、满包、死亡策略、恢复与 HUD                                  |
| 生物交互      | 剪刀、桶、骨、染料、鞍                       | 剪羊、挤奶、驯狼/坐下、染羊/骨粉、骑猪；距离/LOS/lifetime                              |
| 环境/便携实体 | 打火石、TNT、画、钓鱼竿                      | 空气点火、已放置 TNT 原子引信、画锚点/掉落、投钩/收杆/奖励/耐久                        |
| 导航          | 地图、指南针、时钟                           | 选中时显示权威地图/方向/相位；地图探索恢复；不拿全局 MacroMap 冒充                     |
| 状态结构      | 门、床、活板门、梯子                         | 门两格/任一半开关/碰撞/联动破坏；床使用/重生；活板门切换；梯子上下攀爬                 |
| 路线/载具     | 三类轨、三类矿车、船                         | 直线/四角/坡、部署、呈现、乘坐、控制、碰撞、安全下车、箱车/燃料和恢复                  |
| 状态方块      | 告示牌、蛋糕、音符盒                         | 文本编辑/校验/渲染/恢复；蛋糕分片；音高切换/触发/恢复                                  |
| 唱片          | record-13、record-cat、jukebox               | 一张旧 ID 绑定 Mod 曲目；插入/播放/取出/破坏/退出停止；恢复/失败反馈                   |
| 合法材料/弹药 | 纸、锭、煤、木棍、线、羽毛、燧石、火药、箭等 | 保持合成/燃料/掉落/弹药；无行为返回 item-no-interaction，不伪造用途                    |
| 差异          | redstone-dust 与复杂红石                     | 本轮仍为材料/配方；coverage 标 OUT_OF_SCOPE，不写 PASS                                 |

16 dyes 需覆盖羊染色/既有配方，不能作为原料整体跳过。record、载具和鞍进入专属机制，不重复归普通 dispatcher。

### 194 项显式扫描闭包

下列五组由当前 overworldItems 机械枚举后唯一分配：总数 194、并集 194、去重后 194、missing=[]、extra=[]。状态含义不是永久分类，而是本 change 的 RED 基线与完成判据。

| 状态            | 数量 | 当前缺口与完成判据                                                                                          |
| --------------- | ---: | ----------------------------------------------------------------------------------------------------------- |
| 已正常          |   96 | 当前正式入口已覆盖其唯一预期用途；本轮保持 owner、真实入口、表现、保存不回归，并在最终矩阵逐项标 GREEN 证据 |
| 入口未接        |   53 | 已有 capability 或后端 runtime，但 Authority/Web 正式入口、投影或 UI 未闭环；完成需真实输入可达且失败原子   |
| 行为缺失/不完整 |   21 | 仅注册/放置、缺状态机、余物、结构、载具或媒体行为；完成需本 spec 对应行为、保存和产品证据                   |
| 纯材料/弹药     |   23 | 不新增普通右键；完成需配方/燃料/掉落/弹药引用闭包和 item-no-interaction 反例                                |
| 明确非目标      |    1 | redstone-dust 保持材料；复杂红石另立合同，不计本轮 PASS                                                     |

已正常（96）：golden-apple、cookie、dead-bush、wool-block、red-flower、red-mushroom、bricks、bookshelf、mossy-cobblestone、pumpkin、jack-o-lantern、lit-furnace、redstone-ore、lit-redstone-ore、slab、wood-stairs、cobblestone-stairs、torch、fence、sandstone-slab、wood-slab、white-wool、orange-wool、magenta-wool、light-blue-wool、yellow-wool、lime-wool、pink-wool、gray-wool、light-gray-wool、cyan-wool、purple-wool、blue-wool、brown-wool、green-wool、red-wool、black-wool、glowstone-block、lantern、dirt-block、stone-block、wood-block、sand-block、berry、apple、bread、raw-porkchop、cooked-porkchop、raw-fish、cooked-fish、plank、cobblestone、glass、gold-ore、diamond-ore、iron-block、gold-block、diamond-block、sandstone、stone-bricks、gold-pickaxe、diamond-pickaxe、stone-axe、iron-axe、gold-axe、diamond-axe、stone-sword、iron-sword、gold-sword、diamond-sword、wood-shovel、stone-shovel、iron-shovel、gold-shovel、diamond-shovel、wood-axe、stone-pickaxe、workbench、chest、furnace、raw-iron、wood-pickaxe、iron-pickaxe、wool、obsidian、sapling、flower、mushroom、sugar-cane、cactus、gravel、lapis-ore、clay-block、ice、snow-block、lapis-block。

入口未接（53）：wood-hoe、stone-hoe、iron-hoe、gold-hoe、diamond-hoe、bucket、water-bucket、lava-bucket、bow、leather-helmet、leather-chestplate、leather-leggings、leather-boots、iron-helmet、iron-chestplate、iron-leggings、iron-boots、gold-helmet、gold-chestplate、gold-leggings、gold-boots、diamond-helmet、diamond-chestplate、diamond-leggings、diamond-boots、compass、clock、map、flint-and-steel、painting、snowball、white-dye、orange-dye、magenta-dye、light-blue-dye、yellow-dye、lime-dye、pink-dye、gray-dye、light-gray-dye、cyan-dye、purple-dye、blue-dye、brown-dye、green-dye、red-dye、black-dye、wheat-seeds、shears、bone、milk-bucket、egg、fishing-rod。

行为缺失/不完整（21）：wood-sword、mushroom-stew、sign、wooden-door、cake、note-block、jukebox、trapdoor、ladder、record-13、record-cat、minecart、chest-minecart、furnace-minecart、boat、saddle、bed、rail、powered-rail、detector-rail、tnt。

纯材料/弹药（23）：paper、brick、clay、book、sugar、cocoa-beans、wheat、gold-ingot、diamond、charcoal、stick、coal、iron-ingot、leather、bowl、string、feather、flint、ink-sac、rotten-flesh、gunpowder、slimeball、arrow。

明确非目标（1）：redstone-dust。

## 核心行为合同

### 通用交互与装备

- 每世界冻结 ItemInteractionRegistryV1：binding id、item/capability selector、trigger（self/voxel/entity）、operation id、presentation key。Classic 声明具体 ID/目标/产物/数值。
- Authority 新增通用 interact intent，目标只允许 self、voxel hit/adjacent 或 entity lifetime reference，并带 `expectedSelection: { inventoryRevision, modeRevision, creativeCatalogRevision, selectedSlot }`；客户端不能提交 item、operation、binding 或 rule ID。
- 稳定解析顺序：target definition → selected item binding → generic place → held/self。Authority 先完整比较 expectedSelection 四项，再按当前权威 mode 选择 survival inventory 或 creative catalog，并重查存活、距离、LOS、Chunk freshness、entity lifetime。Creative 交互不消耗物品，也不产生 bucket 等余物。
- use-inventory 兼容保留并内部转 consume。协议 copy/validator/authorization/preparation/receipt/projection 同步。
- 四 equipment slots 纳入正式 inventory pointer transaction。Classic 冻结死亡时装备与 inventory/cursor 一起掉落并清空；失败不部分提交。
- 既有农业、流体、投射物、物种、生活技能、导航、环境和 final-entity runtime 改收 policy/config/operation，不向 stdlib 增加 Classic switch。

V2.0 公共 spine 冻结 `equipment-spine-contract.md`：复用 ECS actor 的唯一四槽 armor owner，扩展现有
inventory-pointer target/origin、完整 actor/Authority/network projection 与纯 death inventory settlement
候选/participant。该阶段只要求公共 copy/validate/projection 与候选接口 GREEN，并保留真实 registered
equipment action、armor-only revision 及三条 death producer 的可执行 RED；不安装 Classic policy、不改
combat armor 规则、不提前实现 UI。

V2.1b revision 子片冻结 equipment-revision-contract.md：prepared entity mutation 以规范化后的四槽
armor 与既有 inventory/cursor 共同决定单一 inventoryRevision；实质变化一次事务只加一，等价空槽、
同值 clone、selectedSlot-only、拒绝与 stale 均不增加。本片不实现 equipment pointer、death 或 combat 行为。

V2.1a-host 子片冻结 equipment-station-host-contract.md：station context 的 registered pointer host 必须把
既有候选的完整 equipment 与 bag/cursor 放进同一 prepared actor replacement；纯 actor 变化不推进 station
revision，失败不部分提交。该子片不改变 pointer 规则或 Classic 内容。

GIT-21 组合门禁只集成已准出的 spine、pointer、revision 与 station host：重叠源码以各子片最终 delivery
身份覆盖，`mod-api.ts` 仅取 equipment exports。隔离 staged tree 必须证明 pointer、revision、station 与公共
copy/projection 合同 GREEN；共享 equipment 行为保持 `2 passed / 1 failed`，唯一 death settlement RED 留给
I2.2。该组合准出不安装 death policy，不证明 UI、combat armor、V4 restore 或完整 V2。

V2.1c combat 子片冻结 `equipment-combat-contract.md`：registered combat 在既有 ruleset 产出合法正伤害且
目标为 survival 时，按命中前四槽通用 `armor` capability 计算减伤，并让每件带 durability 的已装备物品
承受一次损耗；health 与完整 armor replacement 由同一 prepared entity transaction 提交。破损物品在本次
命中仍贡献减伤后清槽，armor 实质变化只使共享 `inventoryRevision` 增加一次并使旧 pointer stale。miss、
零伤害、creative 免疫、无效目标、授权拒绝、prepare 后 actor component/lifetime stale 与放弃候选均不得
部分写 health、armor、revision 或 committed fact。该子片不改变 ruleset/difficulty/death settlement、公共
协议、Classic ID、UI 或存档格式；真实 death armor 清算仍保留给 I2.2。

V2.2a Web UI 子片冻结 `equipment-web-ui-contract.md`：浏览器只投影 Authority 已提交的四槽 armor，并在
survival 背包或任意已打开 station 中以明确的头盔/胸甲/护腿/靴子槽显示与 bag 一致的图标、数量、tooltip
和耐久。装备槽 click、Shift quick-move 与数字键 hotbar 继续走唯一 inventory-pointer queue；distribute 不把
equipment 当目标，collect 不以 equipment 为 source。每个出队动作仍读取最新 inventory/station revision，并
绑定发起时 actor/station identity；失败不写 UI 第二状态或伪造装备。纯 creative catalog 不自行开放装备权限。
本片不改变 stdlib/protocol/Classic content、combat/death policy、坐标、timeout 或 Harness。

V2 canonical equipment fixture 子片冻结 `equipment-journey-contract.md`：在完整 V1 后、C4 前，以真实 UI
创造放置固定 3 原木、3 石块、4 铁块资源带，再切回生存经真实采集、拾取、合成取得四件铁甲与额外头盔；
覆盖四槽 click/Shift quick-move、错槽完整零变、occupied swap、脱穿与关闭结算。C5 在原 V1 media/门恢复
校验后，使用同一 Authority 的窄只读 equipment snapshot 验证 runtime/actor 双身份换代及 bag/cursor/armor/
durability/revision 精确恢复，再以新 identity 继续一次真实 pointer 操作。不得以 creative catalog 直接给物、
Harness 写状态、生产 action、teleport/setView、随机 fallback、第二路线或新增 timeout 代替玩家路径。当前
canonical 无确定纯键鼠致死入口，因此实战耐久、死亡掉落与重生 Browser 证据保持 `NOT OBSERVED`；本 smoke
不代表 16 件护甲或 194 项矩阵全部完成。

V2 canonical equipment fixture Close-02 修复三个已定位的夹具缺口：固定资源带的每一格必须先在 survival
沿同一 approach 真实行走，再经正式 UI 切 creative 选择/放置，并在 voxel readback 后切回 survival 等待 Authority
physics tick 前进且 grounded/non-colliding；equipment-origin close 的提交等待必须保持 runtime epoch 与 actor
identity；C5 必须把 C4
之后、实际保存前的 equipment snapshot 以 `before.v2EquipmentPreSave` 写入既有 restore evidence，恢复比较使用同一
baseline。不得修改坐标、timeout、瞄准预算、V1 路线或生产 oracle；本收口仍不提供 Browser、实战耐久、死亡掉落
或重生证据。

Browser-13 在 V2 前暴露 V1 门出口侧 lower center 被 upper 遮挡：真实 eye
`[71.475830078125,32.60000228881836,0.502830982208252]` 指向 lower center 的射线在门东侧平面仍位于 upper
voxel，180 次校正只能观察 `[70,32,0]`，lower click 未发送。V1 door exit face 子片必须复用同一
`ClosedDoorProbePlan.normalAxis/direction` 推导出口侧正交 adjacent；穿门仍走原 `[lower.x+1.5,lower.z+0.5]`
目标，但使用已审阅的 `.06/.08/80ms` 参数，并在真实 client/Authority 均 grounded、non-colliding 且越过完整
target voxel 出口边界后，保留 upper 真实关闭，再以 lower+exit adjacent 的同轮 exact target/face 读回发送右键。
不得增加路线、timeout、180 aim 预算或修改生产 ray/aim；V2、Media 与 C0-C5 顺序不变，确定性/static GREEN 不等于
Browser GREEN。

Browser-14 唯一 canonical attempt（窗口 `f7a53699-300d-429c-a308-8c48399036df`）在 lower exit-face
尚未触达前失败：收紧路线的 `walkTo` 已返回一个满足 fresh ack、grounded 且 non-colliding 的 snapshot，fixture
随即再次采样，并把该新 snapshot 的 client `onGround/colliding` 当作 Authority readiness 断言。第二次采样的组合条件
瞬时为 false；trace 未记录具体哪个字段为 false，稍后 failure attachment 又恢复为 `onGround=true`、
`colliding=false`，不得倒填或猜测失败瞬间。门 entry retreat 与 exit traverse 必须各以对应 `walkTo` 返回 snapshot
作为 tick/ack baseline，再用既有 `waitForSnapshot` 等待并返回同一个 snapshot：该 snapshot 的 client 必须 grounded、
non-colliding，client player 与同轮 `serverPlayerPosition` 必须同时越过既有完整门体素边界，physics tick 必须严格前进，
ack 只需不倒退。成功后的 readiness 与双位置证据只能读取这个匹配 snapshot；这仍只是同一次观察中的 client/server
投影，不是两 owner 原子事务或独立 Authority readiness。不得增加 timeout、路线、aim 预算、Browser attempt，或修改
`walkTo`/Harness runtime/生产 observability；lower exit-face、V1 Media、V2、C0-C5 顺序与断言保持。

Browser-15 唯一 canonical attempt（窗口 `129ac7e8-effb-44a0-a011-3a8f56076510`）已让完整 V1 test step
真实返回，并通过 10 格 V2 resource strip 放置；随后首个原木采集前，`mineResources` 从 strip 东端以默认 `KeyW`
走向西端 `resource.approach`，被 `reachedRouteTarget` 的方向性越界规则提前接受。`mineVoxel` 因仍离 target 太远而
推导西侧 `[77.2,2.5]` 补位，直线路径经过已放置资源；真实 `KeyS` 脉冲把 player x 推到约 `81.32` 后沿资源
侧面漂移并耗尽既有 15 秒 route budget，尚未进入 aim 或 left mouse down。V2 resource route 子片必须只在 V2
fixture consumer 内使用固定外侧 corridor（现有 approach z=`-0.5`）和按当前 snapshot x 方向选择的 `KeyW/KeyS`：
每个资源先从 corridor 到声明 approach，采矿前同轮 client/server 均须到达窄 `.06/.08` 域、client grounded 且
non-colliding、physics tick 前进、ack 不倒退，且双方到 target center 的距离都在既有 `2.5..4.5`；采矿/拾取后
沿已清空格退回同一 approach 再横移。workbench 往返也经同一 corridor waypoint。不得改 scenario 坐标、通用
`walkTo`/`mineVoxel`、路线/aim 算法或任何 timeout；V1、V2 pointer、C0-C5 与 restore 顺序不变。

V2 resource route Close-02 进一步拒绝 `reachedRouteTarget` 穿越方向上的无界 acceptance：client 与
`serverPlayerPosition` 都必须位于 waypoint x 的 `±0.45m` 有限邻域，且 z 继续满足 `<0.08m` corridor。`0.45m`
与既有 `mineVoxel` approach tolerance 一致，覆盖 80ms pulse 在 player 最大 4.5m/s 下的 0.36m 位移，并在 2m
resource 间距与 player half-width `0.32m` 下为下一 resource 的扩张 AABB 留出 0.73m。若一次 `walkTo` 越过有限域，
V2 wrapper 必须在同一固定 waypoint 上根据新 snapshot 重算 `KeyW/KeyS` 并继续真实输入纠正；所有微段和最多
20 秒的 readiness poll 共用原 45 秒 deadline。测试必须覆盖 client/server 各自远越界、Browser-15 斜线和整个有限
邻域的膨胀 AABB 安全，不能只验证理想端点。路线、scenario、通用算法与预算保持。

V2 resource route Close-03 修正 Close-02 对真实 driver 的过宽假设：`walkTo` 的循环与按键只由 client player 的
`reachedRouteTarget` 驱动，不能用 server projection 选择方向或假定再次调用 `walkTo` 会推动 server。方向始终由最新
client position 决定；client 仍在有限域外，或虽在有限域内但尚未完成当前方向 crossing 时，才对同一 waypoint 继续
真实 `walkTo`。client 已在有限域且完成 crossing、仅 server 尚未进入有限域时，必须在同一 45 秒总 deadline 内经
既有只读 `waitForSnapshot` 等待双方严格 arrival 合同，单次等待最多 `min(20s, remaining)`；未追平或耗尽 deadline
稳定失败，不发送无效纠偏输入、不 fallback。Close-02 的双方有限域、fresh tick、ack 不倒退、client readiness、完整
邻域 AABB、路线与预算均保持。

Browser-16 的完整 trace 纠正初步诊断：失败 leg 从 server x=`98.4630739258` 到 `85.8325211929`，53/53 个
`KeyS+Space` pulse 的匹配落地 snapshot 均产生负向位移，总计 `12.6305527329m`；Authority 尾部 256 样本只覆盖
末段 `1.35m`，不能据此称此前停滞。真实问题是每次约 85ms 输入后都等待完整跳跃落地，使 pulse 起点间隔约
`751..901ms`，加上初始约 2.45s 视角校正后，固定 `19.9630739258m` leg 无法在既有 45 秒预算内完成。V2
equipment route 的既有固定平面 route 因此必须以 `jump=false` 调用通用 `walkTo`；坐标、方向、`.06/.08/.45`、
80ms pulse、20s poll、45s deadline 与通用 driver 均不变。确定性测试必须经 `PlayerInputStream`、
`InputCommandBuffer` 和 `stepBody` 对照 jump/ground 行为，并验证 V1→V2 交接、workbench 放置/打开/回收、资源放置、
三批采集和 pickup/retreat 的全部固定 leg 由 scenario floor 支撑且不穿未清障碍。该测试只证明 fixture/物理模型合同，
不证明新 Browser 旅程通过。
测试模型中的每个 80ms pulse 还必须显式经 `PlayerInputStream.release()` 发出 neutral command，并等
`InputCommandBuffer.consumeForTick()` 确认该 release sequence 且 `stepBody` grounded 后才可开始下一 pulse；不得连续
签发 pressed command、直接 reset buffer、手工置 grounded，或用 issued sequence 代替 Authority consumed ack。固定 60Hz
测试时钟只是可控调度合同，不作为浏览器墙钟或性能保证。

V2 death-combat producer 子片冻结 `death-combat-contract.md`：registered combat 构造时从当前 composition
解析一次无状态 death inventory policy capability。非致命命中继续走 I2.1c 的 health+armor replacement；致命
命中按真实 actor kind 构造 source 与 post-hit settlement components，并把 health/lifecycle、bag、cursor、
crafting、armor、drop、NPC intrinsic drop 合并到一次 death settlement series participant。composed 缺策略须
稳定返回 `death-inventory-policy-unavailable` 且 resolve/combat/entity/effects 零提交；legacy uncomposed 调用必须
显式选择兼容路径。本片不安装 Classic policy，不接 Needs/Vitals/Autonomy 其他 death producer。

V2 direct Vitals death 子片冻结 `death-direct-vitals-contract.md`：`GameplayRuntime.applyDamage` 仍先执行难度与
通用 armor policy，但 post-hit armor 必须作为 Vitals 的 proposed components，与 health、needs、四容器 death
settlement 进入同一 prepared entity participant；不再在成功后另写 armor。致命 player 同时预备既有
`prepareDeaths([id])` effects，entity/effects 全部 validate 后才首次写入。composed 缺 death policy 稳定
`death-inventory-policy-unavailable` 且零提交；nonfatal 正常，uncomposed legacy 显式保留。本片只处理 player
direct damage/legacy needs facade，不改 registered combat、Needs schedule、非 player producer 或 Classic policy。

V2 registered Needs death 子片冻结 `death-needs-contract.md`：Needs port 从当前 composition 显式接收一次解析的
death policy mode。无死亡批次维持既有单一 entity series；只允许 player `alive→dead` 进入 policy candidate，有死亡
时全部 survivor replacement 与 death candidate 必须进入同一次 public mixed settlement series，并与一次
`prepareDeaths(ids)` effects 在任何 apply 前全部 validate。composed 缺 policy 首次致死整批返回
`death-inventory-policy-unavailable`；player despawn 在没有 prepared membership owner 前稳定 fail-closed，不遗留
`GameplayRuntime.players`。本片不改变非 player health/lifecycle、Classic policy、Vitals/Combat 或 Autonomy owner。

### 结构、攀爬、路线和载具

- StructureDefinitionRegistryV1 声明 part offset/role、state voxel variants、transition、支撑/碰撞和单次 drop owner。多格 voxelEdits 稳定排序；准备全部 Chunk，await 后重算，再一次提交 world/inventory/state/drop/receipt。
- 旧 storage ID 不重解释；新状态使用追加的 Pack-owned stable variants。旧门只在可唯一识别合法 pair 时整批升级，孤立/歧义 fail closed。
- ClimbSurfaceRegistryV1 只描述面、接触厚度与速度；Authority physics 仍是位置单 owner，Web 只预测已加载范围。
- RouteDefinitionRegistryV1 描述 family、directed edges、曲线/坡度。车辆用 cell＋entry edge＋segment progress，正确处理四角、双向坡和 unknown frontier。
- TransportRuntimeV2 使车辆成为 Authority 可见、有 lifetime 的 entity/component；mounted 关系双向唯一，mounted player 停止独立 walking 写位置。
- Classic 声明具体门/梯/轨/车/船。sample:modular-world 用同 API 声明非 Classic 三格 panel、climb surface、corner guideway 和 pod/raft。

### Mod 唱片与 Web 音频

上传 MP3、自定义 BGM、用户 Blob 持久化合同已取消；既有“本地参考曲”替换能力也必须退场，不能与唱片并存。

- 保留 record-13、record-cat、jukebox identity；record-13 绑定 seedlands:to-far-shores。唱片获得方式不是用户指定项，本轮冻结为复用现有正式创造目录：该目录由完整 item registry 投影，玩家可选择 record-13 放入创造快捷栏。不得为赠送唱片新增 starter loadout 或改存档，Web 也不得绕过现有创造模式 action 直接注入。生存模式的自然掉落不是本轮完成唱片播放旅程的前置；未来需要时由 Classic loot 另立合同。
- 实现阶段仅复制 /Users/bytedance/Downloads/_sorted/media/overworld/Lifeformed × Janice Kwan — To Far Shores.mp3 到 playbooks/classic/assets/audio/to-far-shores.mp3；保留原件。复制前后核对 bytes=2976045 与 SHA256=3c69ae745727607de266898ab68a92c7c75f7f08e27daf0c6cec463f7bd119c9。产品只依赖相对路径/manifest；ASSETS.md 登记“用户提供，许可 unknown”。
- stdlib MediaPlaybackModuleV1 定义资源引用、单槽设备状态、insert/eject/activate/stop/switch 和已提交事实；无 DOM/AudioContext，不识别 jukebox/唱片 ID/歌名/bytes。
- Web 用独立、受 packs.lock 摘要保护的 media loader；不放宽图像/GLB loader。Web 负责 decode/output、gesture gate、普通全局音量、暂停、失败反馈与释放，只消费已提交状态/事实。
- 删除设置页“本地参考曲”的文件选择/移除入口、GlobalAudio.importReference/removeReference 及 import epoch/reference snapshot 字段、MusicPlayer 的 reference buffer/source/import/remove/替换播放分支，并删除或改写只保护该旧能力的 reference-audio-lifecycle tests。保留内置合成音乐播放、shared AudioContext、world begin/end、master/music/sfx/ambience 音量、普通 SFX/ambience 及其测试；唱片音频接入现有 music bus，不复用旧 File/AudioBuffer 替换 API。
- 保存 slot、track id、playing intent、revision；不保存 Blob/URL/AudioBuffer/cursor。恢复显示 resumePending，合法手势后从曲首恢复。取出、破坏、切换/关闭世界和 dispose 都停止释放。
- 缺失/摘要不符在替换世界前拒绝；decode/play 失败可见但不伪造 authority stop、不损坏 slot/inventory。

### 统一光照

- 复用 per-chunk block-light owner，不退回相机 64³ 唯一体积。stdlib flood 只接 semantics/callback；移除 Classic voxel fallback。
- 本轮保留 R8 block level，不做 RGB flood/WebGPU。Pack profile 声明 blockLightTint、surface self-emission、environment keyframes、固定 tone mapper/exposure；Classic 与 sample:modular-world 给出不同配置。
- 同一 per-chunk residency/revision owner 增加 sky-visibility R8；unknown fail-dark，编辑立即 invalid，重建后原子发布，dispose 释放。
- 线性空间只合成一次 received light = visible sky radiance + block irradiance；self emission 只给光源表面。terrain/water/actor/world-item/viewmodel 共用 SurfaceLightingSample；UI icon 不参与。
- quality 只改阴影/反射/分辨率，不切 tone mapper/exposure。参数由 WebGL2 pixel readback RED 与真实浏览器矩阵冻结，不以源码或单图验收。

## 兼容、失败与非目标

- seed+generatorVersion、旧 voxel 0–88、item ID、Classic pack id、旧 Chunk bytes不重解释。Gameplay V4 只加 optional/versioned child state；旧档缺字段为空，完整校验后一次安装。
- unknown/unloaded 不等于 Air/无光/断路成功；失败不扣物、不耗耐久/燃料、不推进 sequence。stale、满包、碰撞、越距、遮挡和 decode 失败有稳定可见原因。
- voxel 写只经 World.edit()/prepared commit；多格、inventory、equipment、entity、media device、drop 不能先后双写。
- 不做复杂红石、维度、RGB flood、WebGPU/GPU compute、LOD、离线追赶、World AI、Node Dedicated、全仓 ECS/renderer/physics 重写。
- 不部署 production main，不改 DNS/域名/权限/凭据，不自动合并。
- 不触碰既有 dirty：.github/workflows/ci.yml、README.md、README.zh-CN.md、apps/web/index.html、package.json、两个 unrelated changes 目录和两份 browser report。

## 最小纵向切片、RED 与真实验收

不能先完成全部公共 spine 再到产品。当前授权下的首个实施里程碑固定为 V1 Slice，只抽取三条旅程共同需要的最小接口：

1. 普通 use：玩家从正式创造目录取得 water-bucket，以真实右键倒水，再用 bucket 收回；验证通用 interact intent、Classic item binding、inventory＋world 原子提交和可见反馈。
2. 两格门：玩家取得 wooden-door，真实右键一次原子放置两格，点击任一半开/关且碰撞同步；验证 bounded multi-edit、structure definition、Chunk preparation 和 mesh/collision projection。
3. Mod 唱片：玩家取得 record-13 和 jukebox，插入后播放 Pack MP3，取出/破坏/离开世界停止；同时旧设置 reference upload 已不可见且旧替换 API 已退场；验证 media state/fact、Pack resource 和 Web Audio 生命周期。

V1 只新增上述消费者需要的 ItemInteractionDefinition、StructureDefinition、MediaTrack/MediaDevice 和 interact/projection/checkpoint 字段；不提前加入 equipment、climb、route、transport 或 lighting 字段。sample:modular-world 只以最小 test fixture 注册一个 click conversion、两格 panel 和 fake media device，证明 V1 无 Classic switch；它不是第二产品，也不进入浏览器旅程。

V1 的 unit/integration GREEN 后立即串行生成一次临时 production artifact，用唯一浏览器线路/Cua 走完 water-bucket、door、record 三旅程和保存重开。该证据是早期架构验收，不替代最终完整矩阵；任一旅程失败先修复 V1，不继续扩展其余领域。后续按实际消费者逐步扩展同一接口，并在普通交互/装备、structure/transport、lighting 三个领域完成时各做一次有界浏览器 smoke；最终只保留一次全量 release artifact 作为交付身份。

V1 早期浏览器验收只通过现有 `?harness` BrowserProductHarness 增加三项只读 oracle：当前 Authority voxel geometry clone、postrender PlayCanvas material mesh 摘要、以及 Media controller projection/已转交 batch 与 GlobalAudio playing 的并列快照。它们没有写口、不是新 owner，不以 descriptor 证明渲染、不以 fact forward 证明 playing；完整签名、epoch 与唯一 scenario 约束见 `v1-harness-contract.md`。

V1 canonical 旅程在创造目录取得并完成水桶放/收后，必须先通过正式背包 UI 切回生存模式，并从既有只读 snapshot 观测 `onGround && !colliding`，才可继续向门位置发送真实移动输入。Browser-05 窗口 `319d5d90-396a-4e4d-84f9-caaccf4fdabb` 是该顺序缺口的 RED：玩家已到门 approach 的 x/z，但创造飞行中的 `Space` 使其停在 y=34.7 且 `onGround=false`。本 fixture 修正不得使用 teleport、world command、直接 mode 调用、Harness 新写口、放宽 `walkTo` 落地条件、修改坐标/地形/超时或删减既有门、媒体、C4/C5 与保存恢复断言；静态检查只证明 fixture 接线完成，最终 GREEN 仍须新 identity artifact 上的唯一 canonical Browser 复验。

Browser-06 source `5d52330fa58d315e9e10b1298e1bdc65e2321898`、artifact `a91a3528abc9b8154f16e48fd0bf41be8c834bb3226e389fbb7550245b5a1f02` 已通过 C0-C3、water place/pick、正式 UI 切生存、落地与门前移动，但真实木门右键在 Structure dispatcher 返回 `blocked`，world revision `141` 不变。命中为 `[70,30,0] -> [70,31,0]`，floor Stone `[69,30,0]`；Harness `serverPlayerPosition=[67.35381531679855,32.600001,0.6452957045056721]` 按源码已加 `PLAYER_FEET_OFFSET=1.6`，对应 Authority body `[67.35381531679855,31.000001,0.6452957045056721]`。`V1-STRUCTURE-FACE-CLOSE-01` 必须在 Structure dispatcher 与 registered host 初次/最终重验两层统一使用由已校验正交 hit/adjacent 推导的共享面内偏 `1e-6` LOS endpoint，保留 adjacent-center LOS、双 center 距离、ownCells、targetable/loaded、授权、selection、support/occupancy 与原子事务；详细 RED/GREEN 见 `structure-face-contract.md`。服务端定向 GREEN 不替代新 artifact 上的唯一 Browser-07，不能据此宣称门、Media、save 或产品可玩。

Browser-07 窗口 `e28f49a7-1346-4b0d-ae03-d324449ca752` 已证明两格门提交、descriptor 与双 Chunk 闭门薄轴 mesh 到达，但 fixture 错把 developer world owner epoch `…:world:0` 当作 Browser Authority runtime epoch `…:1`。V1 pre-save mesh/media 与 post-restore media 必须从既有 `mediaSnapshot().worldEpoch` 取得一次严格非空的同域 baseline；存在 audio snapshot 时 `audio.epoch` 必须精确相等。恢复后 runtime baseline 必须不同于 pre-save baseline，同时保留 developer `world.identity()` 前后不等的独立换代断言及所有 media revision、resumePending、last batch、audio phase、mesh vertex/index/epoch 断言。不得截断字符串、剥后缀、硬编码 scenario epoch、每次从被测 mesh 重取期望值、降级为仅非空或新增 production API；静态完成不等于 Browser GREEN，仍须新 artifact 上的唯一 Browser-08。

Browser-08 窗口 `8c83c1ed-9482-464c-a2b0-89f70e52b78e` 已完成完整门旅程，但在唱片机 support `[76,30,2]` 的真实鼠标瞄准中耗尽 180 次校正，末尾 target-card 在 `[75,30,2]` 与 `[75,30,3]` 间振荡且尚未发送右键。V1 fixture 的瞄准闭环必须以现有只读 `snapshot.player`（已经是 camera/eye）和 `snapshot.viewAngles` 为误差基准，复用有界角度校正；有 adjacent 时从正交 hit/adjacent 推导命中侧共享面内点，无 adjacent 时保持 voxel center。成功仍要求同次观察的 target-card 精确 target 与 Harness aimed target 精确 target，并在有 adjacent 时要求 adjacent 精确相等。不得增加 180 次预算、timeout、随机搜索、坐标/approach、写 Harness 或旁路真实 PointerLock；确定性控制测试与静态检查不替代新 artifact 上的唯一 Browser-09。

Browser-09 窗口 `c95e4fa0-e195-4c43-88e5-1f011dbee53e` 在门 support/lower 的真实 PointerLock 瞄准、两格放置、closed descriptor 与双 Chunk mesh/epoch 通过后，于关闭门碰撞 oracle 失败。实际门 voxel `93` 的 collision 为 local x `[0.8125,1]`、z `[0,1]`；player half-width `0.32`，权威轨迹 x 精确停在理论接触面 `70.4925`，但旧 fixture 沿当前斜视角持续 `W` 1.5 秒，z 从 `0.719995` 滑到 `1.320614` 后绕过门边，最终 x 断言误报。闭门验收必须先用现有真实键盘路线对齐门面中部，再用真实 PointerLock 将 `W` 方向校正为门法向；以实际 descriptor、player AABB 和 Authority `serverPlayerPosition` 判定接触面、安全横向区间、有效推进、fresh ack 及持续阻挡。必须拒绝 Browser-09 滑边轨迹、无碰撞穿越、零推进、横向越界和旧 ack；不放宽 x 阈值、不改地形/坐标/1.5 秒总 pulse 预算，不以 descriptor 存在代替真实阻挡。fixture 和确定性回归通过不等于 Browser GREEN，仍需新 identity artifact 上唯一 Browser-10 继续 jukebox/media/C4/C5/save。

Browser-10 窗口 `af18e91d-2d06-48f5-8350-1b95eadbe25d` 已用 Authority `serverPlayerPosition`、safe corridor、fresh ack 和 6 ticks 持续停靠关闭 Browser-09 的闭门 oracle RED。probe 结束时 eye 在 upper cell `[70,32,0]` 且 target-card 可稳定精确命中 upper，随后 fixture 却强制以无 adjacent center 方式重新获取 lower `[70,31,0]`，180 次后仍只命中 upper，`interactionAttempts=13` 未增加且未发送 toggle 右键。首次 toggle 应显式对 upper 执行既有 exact target readback 和真实 PointerLock/右键；之后穿过已开门后用 upper 关闭、再用 lower 打开的断言必须保留，因此仍覆盖上下 half。不新增动态 half fallback，不改 production/ray/aim/oracle/坐标/timeout/180 次预算。fixture 和静态检查通过不等于 Browser GREEN，真实首次 upper toggle、open/traverse、后续 upper/lower、jukebox/media/C4/C5/save 须由新 identity 上的唯一 Browser-11 验证。

Browser-11 窗口 `192d22bd-b0b2-4290-bfbf-3de62e2c9b86` 已关闭 lower/upper 目标选择问题：接触位可精确观察 upper `[70,32,0]` 并发送真实右键。但该 eye 位于薄门的完整 upper voxel cell 内，生产 `traceVoxelTarget` 在 origin cell targetable 时返回 `adjacent=null`；Web secondary interaction 因而在 Authority 分派前进入裸 `无法放置` fallback，门保持 `[93,94]`、`worldRevision=142`。closed probe 通过后必须复用同一个 `ClosedDoorProbePlan.approach` 和已审阅的 `.06/.08/80ms` 真实键盘路线退回近侧，确认 player/server 均 grounded、无碰撞且退出目标完整 voxel，再由 plan 法向与方向推导 upper 的近侧正交 adjacent；只有同轮 target-card、Harness target 和生产 ray adjacent 精确匹配时才发送真实右键。不得仅换 half、增加 180 次预算、合成 observed adjacent、teleport/set-view、修改生产 ray/交互或复制第二套路线；后续上下 half、mesh/collision/revision/traverse、jukebox/media/C4/C5/save 断言保持。确定性/静态通过只证明 fixture 路线闭合，真实 GREEN 留给新 identity 上唯一 Browser-12。

Browser-12 唯一 canonical attempt（窗口 `2401a5ed-b68b-48c7-93f5-138046e9629a`）已在 `87e64e0b244a971540227b2d829b950362797816` 的冻结 production artifact 上通过：Playwright `2 passed / 0 failed / 1 skipped`、无 retry，C0-C5、water-bucket 放收、门两格/碰撞/开关/穿越/上下 half、jukebox/record、media projection 与 headless audio phase、保存恢复、续播/eject/离开世界释放均完成，`pageErrors=[]`、`failedResponses=[]`。恢复前后 Authority 门 `[95,96]`、jukebox `67`、world revision `146` 保持，Authority world epoch 从 `...:1:world:0` 换代为 `...:2:world:0`。该结果只准出 V1.9 早期 canonical browser 门禁：非 Classic smoke 仍是既有 skip，Cua/人类听觉未运行，性能为 `NOT_MEASURED`，完整 194 项矩阵、V2-V4、全量 deterministic/Classic headless、CI/review/preview 均未验收。近接触薄门 origin-cell `adjacent=null` 的 production 限制也未修；本轮证明的是 canonical fixture 通过真实键盘回退后可执行。

每个 IMPLEMENT 先在实际 owner 取得 RED：registry/assembly；interact protocol/transaction；194-item no-unclassified matrix；装备与各物品族原子正反例；门/梯/轨/车；media state/pack digest/Web output；synthetic lighting/WebGL2 readback。sample:modular-world 必须是不加载 Classic 的实际替代配置。

协调者串行运行 package.json 声明的 format/path/lint/typecheck、定向 owner tests、受影响 deterministic、Classic headless、一次 production build 和唯一 Chromium。当前 Cua/Jev 路由从真实键鼠验收全部物品/结构/载具旅程、保存重开、音频启停/失败与昼夜/林下/室内/遮挡/跨 Chunk 光照；runtime 调用、source grep、HTTP 200 或单图都不能替代产品证据。

本轮及后续例行功能更新默认在验收、commit、push、PR 后继续交付 Cloudflare Pages PR preview：live check seedlands-web-sandbox、pr-<PR号> 和权限；复用 Chromium 验收的同一 apps/web/dist；读回 terminal success、deploymentId、唯一 URL、稳定 alias、commit/source/artifact identity，并校验页面、Worker、Wasm、Pack、MP3 字节。旧 migration 的 401/DNS 是历史快照。权限不足标 INFRA_BLOCKED；不创建项目、不改 production branch/DNS/域名/权限/凭据。

## 工作量与预算（修订版）

| 阶段                                     | 复用依据                                                                               | 传统正常 / 保守 |        AI 活跃正常 / 保守 |
| ---------------------------------------- | -------------------------------------------------------------------------------------- | --------------: | ------------------------: |
| V1 slice：interact＋门＋唱片＋早期浏览器 | 复用现有 Authority request、block commit、Structure/Environment、AudioMixer、Pack lock |     6–9 / 13 PD |              20–30 / 40 h |
| 普通交互与装备完整矩阵                   | 复用既有 capability、armor ECS、projectile/crop/species/life/navigation runtimes       |    9–14 / 20 PD |              30–46 / 60 h |
| 其余结构、攀爬、路线、载具               | 复用 voxel model、physics、vehicle/rail checkpoints；位置单 owner 仍是高风险改造       |   12–18 / 27 PD |              36–54 / 72 h |
| 统一光照                                 | 复用 per-chunk block-light cache、现有 shader/material 和 worldTime                    |     6–9 / 13 PD |              20–30 / 42 h |
| 集成、完整浏览器、PR、preview            | 复用唯一 Harness/artifact 与既有 Cloudflare migration                                  |     5–8 / 12 PD |              18–30 / 42 h |
| 总计                                     | 不重复计算 A0 调查；含旧 reference 退场                                                |   38–58 / 85 PD | 124–190 / 256 h aggregate |

估算置信度为低到中等（约 55%）：194 项多数复用已有后端，但公共 prepared transaction、vehicle position owner、Pack descriptor 和真实浏览器修复量尚未用 V1 实测校准。四 worker 并行、公共文件与测试/browser 串行时，当前关键路径正常 58–82h，保守 112h；按保守剩余量只加一次 20% buffer，建议连续墙钟 135h。V1 结束后用实际 changed files、RED/GREEN 往返、浏览器返工和 usage 重估，若偏差超过 25% 先更新本文再进入下一域。请求配置固定 provider=traex model=gpt-5.6-sol/max/xhigh thinking=xhigh。Paseo snapshot 完整 model ID 与 runtime 归一化 gpt-5.6-sol/thinking=xhigh 分开记录；max 未被 runtime 独立回显。tokens、credits/API 费率/美元、额度分母与占比均 unknown；不伪造、不创建 Goal、不因本次修订扩预算。

GIT-21 Equipment Core 组合、推送与 V2 BUILD01 是已准出子片的窄交付增量：传统正常
0.5–1 PD，AI 活跃正常 4–6h、保守 8h。该增量不改变上表完整产品总预算；credits、API 等价费用、
费率、额度分母与占比仍为 unknown。

## 阶段与项目门禁

### Restore owner 关闭条件

- GameServer 成功 restore 替换 GameplayRuntime 后，world commit adapter 必须在每次准备和提交时解析当前 KernelStateOwner，不得继续调用已经 dispose 的构造期 owner。
- restore 前已经创建的 prepared world edit/batch 保留其捕获的 epoch、revision、Chunk 与 metadata owner；成功 restore 后必须判 stale 且零写，不能被透明重绑到新世界。
- restore 失败不得替换 Gameplay、Kernel owner、Chunk 或现有 prepared 操作的新鲜度；失败前创建的合法 prepared edit 仍可按原 owner 提交。
- 可执行 RED 是 gameplay-mining-progression.test.ts 的“restores actual half-finished mining...”真实保存/restore/继续挖掘路径；GREEN 后补直接 prepared edit/batch 与 fluid 在成功/失败 restore 边界的定向回归。

1. A0：架构与实施分层已完成并获用户批准；历史 SHA 只作当时快照，不再作为当前实施前置。
2. V1：只做 interact＋water-bucket、两格可开关门、唱片/旧上传退场及其最小 fixture；每个 checkpoint 的 done_when 见 tasks.md。立即用临时 production artifact 串行跑真实浏览器，失败不扩面。
3. V2：在已验证 spine 上完成普通交互/装备矩阵，并做领域 browser smoke。
4. V3：完成其余 structure/climb/route/transport，并做领域 browser smoke。
5. V4：完成统一 lighting 与 WebGL2/browser 视觉矩阵。
6. V5：协调者完成全量静态/定向/save/non-Classic/pack digest、交叉评审和唯一 release artifact。
7. V6：只暂存本 change/治理增量，commit/push/PR 读回，再部署同一 release artifact 的 PR preview；夹带 dirty 或权限不足则精确阻塞。

本 change 改公开契约、存档子状态、渲染管线和跨模块 owner，仍按 Breaking 管理。用户已明确批准当前目标和执行安排，因此不再重复请求历史 hash/IMPLEMENT；这不等于虚构用户曾审核某一 SHA。真实越界、权限变化、不可逆外部写入或架构重开条件仍须停止并只向唯一总负责人报告。

## Delivery Snapshot

V1.9 早期 canonical browser 门禁已由 Browser-12 单一 production artifact/单一 Chromium attempt 通过；water/lava bucket、两格门、record/jukebox、Media 公共/Pack/Web 组合根与保存恢复的本阶段证据见 `execution-state.md`。该结果不替代后续完整 194 项矩阵、V2/V3/V4、Lighting 生产渲染、全量 deterministic/Classic headless、Cua/人类听觉、CI/review 或 PR preview。近接触薄门 origin-cell `adjacent=null` 的 production 限制保留待 root 裁决；旧 4 files / 16 tests 仍只作此前 control。
