# Classic b1.7.3 合同版本审核：v16 全范围候选，开工 NO-GO

审核日期：2026-09-18。**可追踪的全范围登记已建立，但整份开工合同仍为 `NO-GO / REJECT_FREEZE`，Classic 产品验收 `NOT_RUN`。** 这里审的是“能否按固定 expected 开始实施”，不是声称游戏已经实现。没有运行原版或 Seedlands Classic 浏览器 Harness；静态来源候选、生成器通过、分母齐全都不是玩法通过。

## 版本变化

v6→v7 修复了配方候选夹具的全表语义冲突，并非增加范围：旧版 8 个“应无输出”负控实会命中其他登记配方，另有 2 条熟食熔炼的满槽数量误用 64（候选上限为 1）；两条煤/木炭火把元数据切换仍出同样火把，一条压力板多放石头会变成石台阶，五条混色染料改元数据会命中另一登记配方（其中灰色与粉色均有）。v7 将这些控制改成与全表一致的正/负预期，`recipe-fixture-candidates.json` 的 schema 升到 2，新增独立于生成器的 160 条配方一致性校验，现对工作台 349 个正向控制（含镜像/平移/替代图样/无形换序）与 405 个负向或 metadata 控制、熔炼 50 个登记/负控检查，结果为 0 正例冲突、0 控制冲突。旧 v6 fixture 预期不得继承；这只证明固定重构来源候选表内部一致，未证明与官方 jar 等价。`case-design.md` 示例此前误写 `referenceCaseSetVersion=5`，也同步改为 7。

v7→v8 只收紧**开工前合同门禁**，不增加玩法分母，也不把候选升级为事实：新增逐案/开放状态族/六项整份合同门的结构校验与反例测试，已批准状态必须同时有来源定位、裁决、reviewer、完整声明式夹具及摘要、断言/负控，排除项要有依赖闭包与普通生存不可达负例；六门的批准还要审核产物摘要。profile 分清 `REFERENCE_READY/NO_GO` 合同决策与未来 `PASS/FAIL/…` 单案运行结果。校验只能防止空壳误放行，**不能认证来源真实性或审阅者身份**。所有 1140 行和 8 个开放族仍待审，六门仍 `PENDING`，所以升版不改变 `NO-GO`。旧 v7 的快照与以后任何运行证据均不自动继承。

v8→v9 改变排除项的审核语义并纠正可导致错实现的玩法机制候选：38 个 `排` 父项新增[逐项依赖闭包、普通生存不可进入负例及保留玩法正例候选](exclusion-dependency-audit.md)，涵盖红石电路 31 项、其他维度 7 项。它们不要求实现被排玩法；未来批准时审核 `exclusion.expectedScopeEffect`，原版玩法 `expected` 可为 `null`。新增[67 项 M14–M33 固定源码逐项复核](mechanism-play-source-review.md)，并用 `sync-mechanism-source-review.mjs` 把纠正后的候选、精确源码行链接同步到父总账和机制验收表，预检拒绝两者再次漂移；撤销「和平模式由 World.tick 清理敌对生物」「狼远距或寻路失败任选其一传送」「钓鱼随机 loot」「基类 Entity NBT 保存乘骑链接」「SaveHandler 已保证 session lock/原子写」等过宽或错误主张。仍只有固定重构源码候选，**未取得官方 jar 等效、逐案完整夹具或 owner 审核**。本次不增减 522/618/8 分母，六门仍待审，v8 快照不可继承。

v9→v10 是**世界机制 expected 的实质纠偏**，不增减分母。42 项 M02–M13 现由 `mechanism-world-candidates.json` 单源同步到父总账与 `mechanism-acceptance-audit.md`，`verify-preflight.mjs` 拒绝再次漂移。固定重构源码显示：本版装饰由 `ChunkProviderGenerate.populate` 内联而非不存在的 `biome.decorate`；矿物尝试遗漏的青金石 Y 是两个 `nextInt(16)` 之和；地牢怪物/loot 由 `WorldGenDungeons` 选择而非普通 `SpawnerAnimals`；主世界初始出生搜索只接受 `getFirstUncoveredBlock` 返回砂的坐标，不能泛称“安全方块”；门/床/牌没有证明底层写失败会原子回滚，画的无效表面甚至返回 true 但不扣物；右键方块优先级在 `PlayerController` 而非 `PlayerControllerSP`；流体传播先尝试下流，再按固定方向侧流；光衰减用实际 opacity，单次 lighting 队列最多处理 499 而非 500；雨/雷计时不能共用同一个开启区间。另用 [`audit-source-anchors.mjs`](audit-source-anchors.mjs) 对固定重构提交做只读链接核查：初查发现 12 个越界，现对 201 个源码文件、1209 个去重行锚点重查为 0 越界/0 读取失败；世界机制同步还会清掉父项中过期的重构源码引用。**行号有效只证明定位可达，不能证明该行支持断言。**上述均是候选源码的静态复核，不是官方客户端等价或运行验收；所有审核、夹具与六门继续待定，旧 v9 预期不可沿用。

v10→v11 纠正实体源码导航的错误归类，不增减玩法与案例分母：旧 `entity-behavior-candidates.json` 把 `setEntityDead`（销毁）算进生成槽，把 `attackEntityFrom`（受伤）算进 AI/交互槽，令“有方法定位”虚高。现在自然生成槽只接受 `getCanSpawnHere`，猪/苦力怕的 `onStruckByLightning` 单列为雷击派生；30 个实体的 180 个行为维度中，已定位候选从 122 降为 **114**，明确空槽从 58 增为 **66**。预检拒绝这些错误方法再次进入错误槽。v11 重新核查 201 个源码文件、1206 个去重行锚点，结果为 0 越界/0 读取失败；数量减少不表示行为被删除。它仍只是源码导航，不是 114 条完整 expected 或官方客户端证明；v10 的实体覆盖结论不可继承。

v11→v12 修复方块候选的**方法归属**：旧生成器只看当前类，某一类槽无自有方法便整个回退到 `Block` 基类，既漏了跨层继承，也可能掩盖同槽其他方法的实际 override。现按每个方法名沿类→父类链选择最近的声明，并记录 `inheritanceChain`；例如 B-059 小麦的 `canPlaceBlockAt` 应指向 `BlockFlower`，不能指向 `Block`。方块候选 schema 1→2，预检及反例测试检查继承链和该回归样本。97 个方块、五类 480 槽的 394/86 定位计数恰好不变，但链接语义和数量变了；v12 再核查 203 个源码文件、1216 个去重行锚点，0 越界/0 读取失败。v11 的方块源码归属不得继承。这仍是固定重构源码导航，不是官方原版等价或逐块完整 expected。

v12→v13 给实体源码导航补真实继承链，但不把父类默认方法冒充特定实体玩法。30 个实体的 180 个维度中，本类直接方法仍为 114 槽、直接空槽 66；其中 **51** 槽在父类找到方法候选，**15** 槽整条链未找到。`EntityPlayer`、`EntityGiantZombie` 等非普通自然生成对象不得因为基类 `getCanSpawnHere` 被误计为普通生成；骷髅、牛等的父类生成判定只作导航。实体候选 schema 1→2，预检及反例测试检查直接/继承/雷击派生分离。v13 对 205 个源码文件、1228 个去重行锚点核查为 0 越界/0 读取失败，仍未证明语义或官方 JAR 等价；v12 的实体“空槽”解释不能继承。

v13→v14 撤回 M15-01 的过宽 expected：旧文把“无饥饿值”挂在未固定版本的 Fandom 页面上，固定重构源码 `ItemFood.onItemRightClick` 只直接支持“手持堆叠减 1，调用 `heal(healAmount)`”。无饥饿系统、所有食物恢复量和冷却仍是待独立确认的合同目标，不再冒充这条源码已证明的事实。同步器会删除旧 Fandom 和过期的重构源码链接，并把候选、父项、验收表的 expected/定位一起同步；预检拒绝再漂移。另加机器可读合同 URL 钉版校验，当前 1315 个唯一来源 URL 均符合固定提交/修订或官方版本元数据规则；这仍不等于内容真实或原版等价。205 个源码文件、1228 个去重行锚点检查仍为 0 越界/0 读取失败。案例分母和实施范围未变，v13 的 M15-01 候选不能继承。

v14→v15 将 160 条工作台/熔炼的 `expected` 拆到字段叶子，并在[配方候选夹具](recipe-fixture-candidates.json)中为其中 2058 个叶子登记 470 条固定重构源码**候选定位**；另有 360 个叶子（工作台/炉的使用场所及制作余物）明确留空，不能靠配方注册或共用槽位代码推断。删除 93 条仅供人工识别、并非玩法断言的 `inventoryLabel` expected；标签仍保留在操作/库存描述中。配方候选 schema 2→3，新增独立叶子覆盖、证据链接归属和遗漏检查。这是审核准备的定位索引，`sourceBindingReview=PENDING`，不表示来源逐项支撑 expected，更不表示固定重构源码与官方客户端等价。522/618/8 分母、六门状态和未来功能范围不变；v14 配方夹具与快照不得直接继承。

v15→v16 补上全部 150 条配方的工作站候选定位：固定重构源码的背包容器为 2×2、工作台容器为 3×3，二者调用同一配方匹配器；逐条再与配方图样或无形材料数联合判断。现在配方共 **678** 组来源候选，覆盖 2418 个 `expected` 叶字段中的 **2266** 个；余下 **152** 个均为容器余物（149 个空数组叶子和蛋糕三空桶的 3 个叶子），须核每种材料的容器项注册与取出事务。新增校验会拒绝配方图样与工作站集合矛盾，也会拒绝工作站来源指错容器。此为**组合推导候选**，没有独立审阅、官方客户端等价或运行证据，不能把 208 个新定位算作 208 个通过。分母、预算范围及六门审核状态未变；v15 快照不可继承。

| 类别         |  v3 | v16 登记与审核结论                                                       |
| ------------ | --: | ------------------------------------------------------------------------ |
| 方块         |  97 | 97 父项 + 346 有限变体；逐块完整行为未封板                               |
| 非方块物品   | 106 | 106 父项 + 153 有限变体；使用/耐久/地图未封板                            |
| 实体/派生态  |  30 | 30 父项 + 119 有限变体；AI/轨迹/掉落未封板                               |
| 工作台配方   | 150 | 150；输出、形状、材料元数据及余物有静态候选，逐条审核未完成              |
| 熔炼         |  10 | 10；输入/输出、元数据匹配和 200 tick 有静态候选，燃料/槽位完整轨迹未封板 |
| 机制子项     | 129 | 110 项局部参考 expected，19 项项目合同 expected 已写候选、未审核         |
| 有限逐行分母 | 522 | **1140** = 522 父项 + 618 子变体；另有 8 个开放状态覆盖族                |

v4→v5 是来源复核触发的实质变更，不是改名：补上树苗/树叶 raw 3 与 11 各 2 项、四种流体 raw 8–15 共 32 项，方块子变体由 302 增为 338；修正 44 个耐久族的临界值（`rawDamage=maxDamage` 才是再受 1 点伤害前的最后未破状态）；将音符盒的下方材料与实际声音事件 key 分开，并把蜘蛛骑士来源指向 `SpawnerAnimals`。这些值仍是[固定重构源码](reference-provenance-audit.md)的候选，未证明官方 jar 等价。[变体来源审计](variant-source-audit.md)保留逐处来源与剩余夹具缺口。

v5→v6 也改变了合同语义：P5 从错误的“关闭后新建空白 context”改为每 run 独立持久化 profile、同目录同 origin 重开，以便真的验证 IndexedDB 存档；配方解析改用 `Block./Item.` 完整符号，修正 D09 的 `Block.brick` 输出 ID 45、`Item.brick` 输入 ID 336，并避免门、甘蔗、蛋糕等同名注册项互相覆盖；补登记木门上半块 8 个 raw 状态和 EntityItem/Arrow 的 10 个有限边界，分母 600→618；床的 occupied 位明确是睡眠后的状态转移。生成器还修复了 Markdown 表格格式化后机制行无法被再次解析的问题。上述均仅是[固定重构源码](reference-provenance-audit.md)候选与 Harness 设计修订，尚未取得官方等价证明或 owner 签署。

[固定环境](harness-profile.json)现为 `classic-b173-singleplayer-v16`、`scenarioVersion=16`、`referenceCaseSetVersion=16`；[父项 JSON](reference-cases.json)的 `schemaVersion=3`，[变体 JSON](variant-cases.json)的 `schemaVersion=2`，[方块行为候选](block-behavior-candidates.json)与[实体行为候选](entity-behavior-candidates.json)的 `schemaVersion=2`，[配方候选夹具](recipe-fixture-candidates.json)的 `schemaVersion=3`。[整份候选快照](contract-snapshot.json)记录所有合同文件的 SHA-256，后续修改可用 `node changes/2026-09-16-classic-beta173-parity/build-contract-snapshot.mjs --check` 检出漂移；**快照只锁字节身份，不表示审核通过**。宿主、tick、浏览器后端请求值与 P0–P4 目标未变；P5 的持久化重开方式已按上文修订。profile 仍为 `DESIGN_ONLY_NOT_EXECUTABLE`。`verify-preflight.mjs` 仅验证 ID、分母、版本、逐案/整份审核声明的结构完整性和来源 URL 固定性；它不能证明链接内容真实、来源与官方客户端等价、预期值正确或体验相同。旧版本没有可继承的运行证据。

严格预检还检查 [profile 中六项全合同审核门](harness-profile.json) 是否逐项 `APPROVED`：范围偏离、原版对照、逐案 expected/夹具、Harness 设计、原创音画参照和性能环境阈值。当前全部 `PENDING`，必须由真实审查与证据关闭，不能以改 JSON 值代替审查；这也防止只将 1140 行案例状态机械改为 ready 就获得误报。

v7 编制的补充候选已沿用到 v16 身份并纳入结构预检：[方块 97 项](block-behavior-candidates.json)、[物品 106 项](item-behavior-candidates.json)、[实体 30 项](entity-behavior-candidates.json)、[配方/熔炼 160 项](recipe-fixture-candidates.json)、[世界环境机制 M02–M13 共 42 项](mechanism-world-candidates.json)、[玩家/玩法机制 M14–M36 共 83 项](mechanism-play-candidates.json)，另有 v16 [排除依赖 38 项](exclusion-dependency-candidates.json)。这些是父项的来源与夹具设计附件，**不另加覆盖分母、不把候选提升为 `DESIGN_FIXED`**。预检目前报告 `noExpected=0`，仅表示每个父项至少绑定了局部/项目/排除范围候选，不表示 1140 项有完整黄金 expected。

## 来源与证据限制

1. [Mojang b1.7.3 元数据](https://piston-meta.mojang.com/v1/packages/44f6969326bd45aa00dcd3c4ca3a7c05ebb24c04/b1.7.3.json)固定**版本 ID**与客户端 SHA-1 `43db9b498cb67058d2e12d394e6507722e71bb45`，不证明方块/物品 ID、配方、物理和音画。发布时间 UTC 2011-07-07T22:00:00Z 与其他时区的 7 月 8 日表述不改变身份。
2. [Technical Beta Wiki 方块](https://github.com/OfficialPixelBrush/beta-wiki/blob/8bcc41aee34334c2b916e7b500abe6853b4fd704/general/blocks.md)、[物品](https://github.com/OfficialPixelBrush/beta-wiki/blob/8bcc41aee34334c2b916e7b500abe6853b4fd704/general/items.md)、[掉落](https://github.com/OfficialPixelBrush/beta-wiki/blob/8bcc41aee34334c2b916e7b500abe6853b4fd704/general/drops.md)与 [RetroMC 固定修订](https://wiki.retromc.org/index.php?title=B1.7.3_data_values&oldid=9822)支持身份及部分元数据/掉落候选。Wiki 自称内容不全；RetroMC 的 `343l` 误植已局部纠错。方块元数据页立式告示牌重复值 8、轨道方向文字疑似笔误，不能整表当黄金。
3. [固定提交的重构 Java](https://github.com/jacobo-mc/mc_b1.7.3_release/tree/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src)供静态查注册与算法；**重构 Java 与官方 jar 逐方法等价未证明**，可能有人为修补。没有执行、分发原版，也没有将原版资产或代码导入产品。多数证据链接只到文件，逐条审核还须定位方法、分支、异常条件及独立旁证；[来源可信度审计](reference-provenance-audit.md)独立记录该风险。
4. [配方 Wiki](https://github.com/OfficialPixelBrush/beta-wiki/blob/8bcc41aee34334c2b916e7b500abe6853b4fd704/general/recipes/crafting.md)缺项；[重构注册](https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/CraftingManager.java)与 helper 是候选，不能以[同期论坛](https://www.minecraftforum.net/forums/minecraft-java-edition/survival-mode/234338-crafting-help)的笼统叙述代替逐格核对。v2 曾误报染料元数据冲突：绿色染料为 2、羊毛颜色顺序相反；此误报撤销。
5. 纠正跨版本污染：[EntityCow](https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/EntityCow.java)掉落皮革、可用空桶取奶，不能倒灌后期牛肉。矿石生成尝试、液体 tick、TNT 引信、熔炉进度、A* 等虽有局部候选，不构成完整 seed→逐 tick 黄金轨迹。

## 1140 行及开放状态族的真实状态

[父项总账](reference-cases.json)与[变体总账](variant-cases.json)记录 ID、范围、局部 expected、证据链接、未定项、审查状态和夹具占位；[19 行项目合同候选审核队列](reference-worklist.md)逐条列出已绑定但未审核的 expected。当前离线结构校验结果：

- `SOURCE_CANDIDATE_REVIEW` **150**：工作台配方的静态候选，逐条来源和行为待复核。
- `PARTIAL_REFERENCE_GAP` **353 父项 + 618 变体**：父项由 97 方块、106 物品、30 实体、10 熔炼、110 机制构成，只有部分事实；变体只有状态候选，没有完整行为轨迹。
- `PROJECT_CONTRACT_CANDIDATE_REVIEW` **19**：Harness、原创体验、性能与工程 expected 及负例已绑定[项目条款](project-contract-expected.json)，尚未审核/固定夹具；不应向 Minecraft 原版求这些项目值。
- `openEndedNotFixed` **8**：告示牌文字、容器内容、地图状态、邻接更新、世界生成、实体 AI、玩家动作、感知体验已有[分区草案](open-ended-coverage.md)，仍缺来源裁决、预注册具体样本和已审核边界夹具。
- `REFERENCE_READY` **0**；固定逐案夹具 **0**；Classic 实际执行 **0**；原创资产体验签署 **0**。

1140 行均为 `ownerReview=PENDING`、`fixture.status=NOT_FIXED`、`executionStatus=NOT_RUN`。没有逐案初态摘要、RNG 序列、输入 tick、逐字段结果和负控，即使有源码链接也**不是已审核的黄金测试**。618 个有限变体现在独立占行，但仍只写了 `variantState`，不能用其存在冒充逐变体行为 expected。本次结构校验实际运行在 macOS Darwin 25.5.0/arm64、Node 24.21.0、pnpm 11.25.0；它不是合同要求的 Ubuntu 24.04/Node 22.12.0 BrowserProductHarness，更不是玩法或性能验收。

## 冻结和实施的下一道门

这里的“下一道门”是**整个 Classic 合同的一次性开工审核**，不是先做 `P0/P1` 等局部合同后就批准实施。资料工作可以按主题推进，但只有所有纳入内容、变体和共用机制满足下列条件，才可提交完整版本给用户确认。

1. 按 1140 行的 `unresolved` 补齐逐项行为、掉落概率、保存和音画 expected；先审核 19 项本项目合同候选，再审核 150 项配方候选和 953 项内容/机制局部事实。8 个开放状态族补来源化分区、边界和负例。矛盾来源记录裁决，不从 Seedlands 输出反推原版 expected。
2. 为每案写[完整夹具格式](case-design.md)并经 owner 审核。概率预注册样本/容差；音画使用合法同期参照、原创资产来源和指定评审者，不能直接复用原版贴图/音效。无法找到可信参照就保留缺口，最终不得宣称“完全一样”。性能设备/阈值仍 `NOT_SET`。重构源码只能先作为候选；对无法独立确认的原版行为，必须由用户显式接受其作为代理对照的误差风险，或维持 `NO-GO`。
3. 之后才另立实施 change，逐案取得可执行 RED；Kernel 零改动，确需修改先出 ERROR 缺陷报告待用户审批；stdlib WARNING 逐处记录，Playbook NORMAL，Web/资源/工程另列。恢复 Classic 测试、浏览器 Harness 和 CI 须修订测试边界并实测。

**裁决：`PREPARATION_REVIEWED / REJECT_FREEZE / NOT_RUN`。** v16 是本轮待补证的固定工作身份，不是已审核的 1:1 真值冻结或实施许可。范围、场景、来源、expected 或准出语义改变要提高相应版本并重审分母。长期 docs baseline 此次不更新：仍是 Proposed change，未通过产品/架构冻结。
