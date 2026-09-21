# Classic 初版：设计与可玩交付

状态：Active / 实施中。基线 fba4486；功能分支 feat/classic-beta173-playable。承接 2026-09-16 Beta 1.7.3 v16 的全范围清单。

## 用户结果与新授权

2026-09-20 用户要求自主检查基线、完成设计并推进到 Seedlands 引擎上的完整 Minecraft 初版；此前阻塞不再阻止推进，记录供后续优化。尽可能不运行原版；必要时优先 Web 或静音/headless，避免干扰电脑。

本轮授权取代旧 change 的整份合同 hash 审核、全来源/夹具先审完才施工、Kernel 另行审批及性能/资产评审者待定等施工前置条件。保留权限、单权威、数据兼容、来源诚实和原创资源要求。缺失实现不是优化完成，未执行不是 PASS。不自动合并、改变远端权限或采购。

## 范围

完整目标沿用 Beta 1.7.3 主世界单人 Survival：地形/洞穴/矿物/群系、采集建造、工具、合成冶炼、库存容器、生命食物护甲、昼夜天气、流体火爆炸、生物、农业、钓鱼、驯服、轨道/矿车/船、特殊物品、死亡重生、保存恢复、完整菜单输入和原创音画。红石电路、多维度、联机继续排除。

功能完成度按原 522 父项、618 有限变体、8 开放状态族登记；精确原版等价度另记差异。可用功能的原版细节差异可以留作优化；缺失功能保持 TODO 并继续实施。不能把既有 16 体素/19 物品原型或首日流程称作全范围完成。

## 决策

1. 增量扩展现有 Kernel/stdlib/Classic/Web，复用事务、世界、Chunk Mesh、Worker、物理、工位和 IndexedDB。
2. EaglerPorts 仅作必要时外部参照；本次 live API 列表没有 b1.7.3，其他版本不能充当精确 oracle。嵌入另一个完整运行时不能证明 Seedlands 引擎，不采用该实现路线。
3. 旧数字 palette 保留，新内容追加稳定 ID；原版 ID 仅作 referenceId。生成改动用新 generatorVersion；未知内容/保存身份先拒绝，不静默转换。
4. 本地构建/测试低优先级串行；Vitest 1 worker；Chromium headless、mute-audio、单 context、960×540、Low 画质。功能运行不宣称性能收益，结束关闭进程。
5. 恢复唯一 apps/web/tests/e2e/classic-runtime.spec.ts，生产构建后登记 source/lock/file digest，再运行 preview；Headless 和真实键鼠证据分别记录。CI 增加实际产品作业，不修改远端保护。

## 行为与验收

- 空背包进入世界，通过有限资源完成木材→工作台/木镐→石料/煤铁→冶炼/铁镐→箱子/建造；真实库存扣除、耐久更新，缺料/越距拒绝。
- 挖放的正式 Authority 状态、掉落/库存和 Chunk 画面一致；取消/旧 epoch 不写回。
- 保存后重新打开同源世界，体素、库存、工具、容器、时间及熔炼中间进度恢复，不重复初始物品。
- 食物恢复生命；玩家无自动饥饿消耗，满血/非法操作不扣物品；死亡掉落与合法重生。
- 夜间敌人正常移动攻击，庇护阻挡，玩家可反击；农业/火/流体/运输/特殊物品按 design 的状态机实现并持久化。

## 测试设计与 RED

基线 production build 已 PASS（macOS/Node 24，不是 Linux CI）。源码明确缺失多数内容、农业/火/运输、Beta 食物规则和活跃 E2E。新行为在实际 owner 最低充分边界先 RED；逐阶段记录命令与结果。

先恢复有限资源成长与保存 Headless 用例建立 control；唯一浏览器线路从真实按钮与键鼠进入、移动、挖放、背包/合成、保存重开。Harness 只初始构造和读取，不能中途代操作。计数、启动或截图单独不证明旅程。

后续定向测试覆盖状态机、失败原子性、随机边界、保存、资源守恒和异步新鲜度。精确来源审查不作为施工门槛；未测行保持 NOT_RUN。

## 任务

- [x] 基线、旧合同、源码、EaglerPorts 核对。
- [x] 新授权、全范围设计与预算登记。
- [ ] 生产身份、Headless、静音 E2E 和 CI。
- [ ] design S1–S7 全部纳入功能实现。
- [ ] 全范围游玩和保存证据；差异账没有未实现必需项。
- [ ] 静态检查、commit、推送及 PR。

## Delivery Snapshot

尚未交付；build 不能代表产品验收。旧候选 PENDING/NOT_RUN 不改 PASS。长期 docs 更新本次验证边界；架构和产品路线不变。证据见 evidence.md，覆盖见 coverage.json，预算见 estimates.md。

## 续作：本机输入隔离（2026-09-21）

用户实测此前 Chromium Pointer Lock 抢占本机鼠标，作为观察 RED。当前 macOS 验收使用系统 Chrome 强制 headless，CI使用锁定Playwright配套Chromium headless；禁止headed/PWDEBUG和外部可执行路径覆盖。此前专用Headless Shell缺Pointer Lock，配套151在macOS触发锁限流，均有失败记录，系统Chrome153已通过。输入继续走真实页面Pointer Lock和Playwright键鼠，退出释放锁。单浏览器/静音/单worker运行，不启动原版Minecraft。

验收：选项违规在启动产品旅程前明确失败；正常线路记录 Headless userAgent、Pointer Lock 生效、转向与移动结果，并完成原有 C0–C5 断言。用户鼠标没有被抢占属于用户可观察项，自动化只证明使用配套 Chromium 的无窗口模式及真实页面输入路径。

## S0 CI 恢复合同

每个 PR/main push 保留现行静态与 Kernel/stdlib 选择器，另执行明确的 Classic Headless 五项合同、一次 Production build，再让 Chromium job 下载同一 apps/web/dist（含隐藏 manifest）并校验前后身份。产品任务本阶段全量执行，不引入可降低覆盖的 selector。固定实际 checkout SHA；浏览器安装来自锁定 Playwright，使用 channel=chromium/headless/mute-audio/1 worker。上游失败不得伪装成功，不新增部署或权限。新增 tsconfig.classic-tests.json 检查当前唯一 E2E、配置与五项 Headless 合同。CI 自身未远端执行前记 NOT_RUN。

原09-16设计目录带contract-snapshot.json逐字节摘要（交接时已有27处漂移，不能称为通过快照），作为本轮对照原文保留，不格式化重写它的冻结文件。现有七个格式差异文件按精确路径加入.prettierignore（沿用旧冻结合同的做法），只为该目录保留START-HERE.md名称例外；生产/测试源码检查范围不变。本轮新spec与实现仍遵守格式和命名规则。

## S0 Logic 恢复运行

真实C4显示NPC有效路径与terrain窗口完整、驱逐计数为0，但Logic提交计数停在夹具的确定性推进。BrowserAuthorityDeterministicAdvance在推进中接收最后回执时不安排下一次观察，恢复clock run也未启动观察请求。AuthorityRuntime.resume必须重新请求一次Logic观察，让后续回执驱动链继续；不更改地形驻留、过期意图检查或控制owner。回归覆盖暂停推进耗尽最后请求后resume的新观察及真实NPC移动/完成。

## S4b 弓箭与权威投射物合同

Classic 新增弓、箭、线、羽毛、燧石及其取得/合成入口；弓是不可堆叠耐久物品，发射必须持有弓与至少一支箭。投射物由 stdlib 每世界实例 owner 持有，记录稳定 projectile id、发射者、位置、速度、伤害、剩余寿命和逻辑 tick；客户端只提交发射意图和表现已提交快照，不负责命中或伤害。

推进使用固定逻辑步长和稳定 id 顺序。每步先求从旧位置到新位置的连续线段，取最早的体素或存活 actor 命中；同距离时体素遮挡优先，不能穿墙伤害。actor 命中只经正式 vitals/armor 伤害入口提交一次，随后销毁；体素命中、超出寿命或离开有界世界同样销毁。非法方向、非有限数值、自己命中、无箭、旧 revision 与重复发射均拒绝且不扣物品/耐久。

checkpoint 在同一 gameplay frontier 保存 projectile 高水位和全部在途投射物；恢复后继续推进，不重复扣箭或伤害，旧 projectile id 不重用。RED 覆盖缺箭原子拒绝、命中/遮挡/超时、稳定顺序、护甲减伤以及中途 checkpoint 恢复；GREEN 后再接 Classic pack、物品资源、Headless 合同和唯一浏览器回归。未实现浏览器瞄准/动画/音效时只记 Headless 部分完成，不把弓箭条目标为完整产品 PASS。

## S4c 主世界物种 profile 合同

Classic 的鸡、牛、猪、羊、鱿鱼、狼、僵尸、骷髅、蜘蛛、苦力怕与史莱姆使用独立稳定 archetype，不借用 grazer/night-stalker 名称伪装。stdlib 的 profile 显式声明 disposition（passive/neutral/hostile）、生命、导航、感知、初始行为、近战定义和掉落；协议、保存、命令与身体几何消费同一受支持 archetype 集合。旧 grazer/night-stalker/settler 身份继续可恢复。

每个物种至少验证注册闭包、合法生成、差异生命/体型/掉落和被动或敌对观察；没有独立状态机的物种（苦力怕爆炸、骷髅远程、史莱姆分裂、狼驯服、羊剪毛、鱿鱼水生）只能记 PARTIAL_IMPLEMENTED，后续对应机制完成前不得写完整 PASS。

## S4d 难度与重生点合同

难度是每世界权威状态，取 peaceful/easy/normal/hard，带单调 revision 并进入 checkpoint；非法值和旧 revision 拒绝。敌对伤害按 0/0.5/1/1.5 倍率结算，和平模式切换候选列出并清退所有未被驯服的 hostile actor，不能残留在途攻击。床使用只允许存活生存玩家在安全位置更新其既有 ECS spawnPosition；失败不移动玩家、不扣床。死亡后仍经正式 respawn 使用该点，保存恢复不丢失。

## S4f 确定性刷怪合同

刷怪候选由 seed、逻辑 tick、位置、难度、光照、群系、距最近玩家和当前类别数量共同决定；不使用宿主随机或墙钟。hostile 在 peaceful 禁止，要求低光且距玩家至少 24；passive 要求日间亮度与合法地表。每类和全局上限先检查，权重按 profile 表稳定抽样，群组偏移由同一哈希生成并稳定排序。失败不消耗序列。持久实体和已驯服实体不参与距离消失；其余远离玩家超过 128 格才可清退。

## S4g 敌对物种专属机制合同

骷髅的远程攻击复用世界唯一 ProjectileRuntime，不创建第二套弹道或绕过正式伤害结算；发射位置和方向由权威实体位置计算。苦力怕点燃后以稳定实体 identity 关联 Environment TNT，引信保存恢复，到期爆炸后清退原实体。史莱姆尺寸进入 SpeciesState；尺寸4/2的史莱姆死亡后在原位置按稳定偏移生成两个下一尺寸实体，尺寸1不再分裂。所有入口拒绝错误物种、死亡/过远目标和重复触发，失败不改变实体、投射物或环境状态。

## S3d 熔岩与流体混合合同

追加稳定 Voxel.Lava 与 Voxel.Obsidian，不重排旧 palette，旧 generatorVersion 字节不变。流体种类由 voxel id 表示，既有 Uint8 sidecar 继续只保存 source bit 与 level 1–8，因此旧水存档无需迁移。水与熔岩接触的候选按坐标稳定排序：熔岩源变黑曜石，流动熔岩变圆石；同一批多邻居不能重复写。传播与混合必须使用 Authority read-set/expected cell 校验，旧 epoch、stale chunk 或未知边界不提交。

## S3e 天气、火与爆炸合同

环境状态由每世界实例 owner 持有并随 gameplay checkpoint 保存：天气为 clear/rain/thunder、剩余秒数、revision 与逻辑 tick；转移只使用 seed+tick 哈希。火记录位置、剩余寿命与传播 tick，只有 Classic 标记的可燃方块邻位可被点燃，雨且可见天空时熄灭。TNT 记录稳定 id、位置、引信与威力；到期按坐标稳定产生有界球形方块候选和距离衰减的实体伤害/击退。

环境 advance 只产候选，不直接写 Chunk；GameServer 经 editBatch/正式伤害入口提交。未知 Chunk 延迟，方块 revision 变化使候选失效，不跨过 World.edit。连续点燃/链爆有单 tick 上限，失败不部分提交。

## S3f 权威光照采样合同

光照查询是只读派生，不另建权威方块状态。天空光由 worldTime 的确定曲线和从目标格至世界顶的已加载遮挡计算；任何未知格返回 unknown，不能当作明亮或黑暗。方块光在有界半径内扫描 Glowstone/Lantern/Fire/Lava，按 Manhattan 距离衰减并取最大值。最终 light=max(sky,block)，范围0–15。方块提交后下一次查询立即反映新值，不保存可陈旧缓存。浏览器太阳/雾继续消费 worldTime，权威刷怪消费该采样结果。

## S3g 植被与树苗合同

V7 在 V6 地形之上追加坐标哈希决定的草、花、蘑菇、甘蔗和仙人掌；先完成地形/水邻接与群系前置，再按固定盐采样，查询和 Chunk 顺序不影响结果。V2–V6 逐字节冻结。树苗是可放置内容，成长只在下方泥土/草、5×7×5 所需格已加载且无阻挡时生成 Wood/Leaves batch；空间不足保持树苗不变，失败不部分生成。

## S3i 地牢与刷怪笼合同

V8 在 V7 输出之后按64×64水平 region 选择至多一个地下地牢中心，中心高度/房间尺寸/入口朝向与箱子位置仅由 seed+region 决定。房间内部为空气、边界为圆石，单入口保持连通；中心刷怪笼和角落箱子使用追加稳定体素。V2–V7 字节冻结，TS/staged/Rust逐字节一致。

刷怪笼在非 peaceful、玩家16格内、光照7以下且类别未达上限时尝试生成其配置物种，固定20秒间隔；战利品以 dungeon id+箱子索引确定，堆叠与槽位有界。刷怪笼/箱子状态随已有 station/entity checkpoint 保存；未加载区域不推进，不后台全图扫描。
