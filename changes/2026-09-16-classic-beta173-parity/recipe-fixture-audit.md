# 配方 fixture 候选审计

本文件对应 `recipe-fixture-candidates.json`，由 `build-recipe-fixture-candidates.mjs` 从当前 `reference-cases.json` 的 `R-D01–R-D57`、`R-H01–R-H93`、`R-S01–R-S10` 机械生成。生成器不联网、不运行原版、不读取 jar，也不会将候选提升为设计冻结或原版真值。

## 覆盖结果

| 类别                | 数量 | 候选内容                                                                                                 |
| ------------------- | ---: | -------------------------------------------------------------------------------------------------------- |
| 工作台配方          |  150 | 119 有形、31 无形；每项有工作站、正例输入、数量、产物、来源链接、负例与 metadata 控制。                  |
| 有形                |  119 | canonical 图样、平移/镜像标志、错误 ID、图样外物品（或明确无空格 gap）、metadata 控制、余物。            |
| 无形                |   31 | 精确多重集合、反序正例、多余材料反例、metadata 控制、余物。                                              |
| 熔炼                |   10 | 输入/产出 ID、数量、metadata、200 tick、燃料、输出槽约束、错误输入/输出槽/容量/metadata 反例。           |
| 容器余物            |    1 | `R-D22`：三奶桶取走蛋糕后候选余物为三空桶 `325×3`。                                                      |
| 全局 provenance gap |  160 | 全部保留 `OFFICIAL_JAR_METHOD_MAPPING_MISSING`、`FIXTURE_NOT_EXECUTED`、`NOT_A_DESIGN_FIXED_ASSERTION`。 |

所有 160 项的 `candidateStatus` 固定为 `SOURCE_CANDIDATE_NOT_DESIGN_FIXED`；这不是可执行测试结果、不是原版已证，也不改变 `reference-cases.json` 本身的状态。

## 逐字段来源映射候选（v16）

`recipe-fixture-candidates.json` 的 schema 3 另列出 160 项共 **678** 组 `candidateSourceBindings`：把 2418 个 `expected` 叶字段中的 **2266** 个映射到固定注册、匹配、槽位及工作站源码的**组合候选**；仍有 **152** 个容器余物叶字段明确未映射。背包 [2×2 容器](https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/ContainerPlayer.java#L12-L45)、[3×3 工作台容器](https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/ContainerWorkbench.java#L4-L40)与每条配方的图样/无形材料数联合才能支持工作站可用性，不是容器源码单独证明；UI 入口也须另审。空余物要核每种输入物的 `containerItem`，不能仅靠 `SlotCrafting` 的通用逻辑证明。`R-D22` 的三空桶尤其要联核奶桶注册、蛋糕输入和取出事务。所有映射的 `sourceBindingReview` 仍为 `PENDING`，不会写入父项的已审核 `source`；**这是定位工作量，不是 2266 项真值通过**。

先前 93 条 helper 配方把中文清单标签 `inventoryLabel` 放在 `expected` 中，却无原版行为含义，现从 expected 移出；配方名仍在 action/清单中。这减少了无意义的逐字段来源审核，不删任何配方或实际玩法预期。验证器逐条检查候选来源 URL 属于父项证据、工作站集合与配方尺寸/材料数一致、工作站定位指向正确容器、映射与未映射互不重叠且覆盖所有 expected 叶字段；配方正负控的内部一致性验证仍独立运行。

## fixture 语义

- 有形配方的 `positive.inputSlots` 是左上 canonical 摆放；`horizontalMirror` 和 `translationWithin3x3` 只是根据重构 [ShapedRecipes](https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/ShapedRecipes.java#L22-L74) 建立的候选，应在实现 Harness 中实际执行。
- 无形配方带有同一精确多重集合的反序正例；多余材料必须无产出，来自重构 [ShapelessRecipes](https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/ShapelessRecipes.java#L20-L51)。
- `metadataRule=EXACT_METADATA_RECONSTRUCTED_SOURCE` 通常用另一 metadata 作为拒绝例；但若另一条已注册配方会接收它，则必须按全表产物判断，不能断言“无输出”。`R-D26/R-D27` 的煤/木炭互换仍产四个火把，是正向变形控制。`ANY_METADATA_RECONSTRUCTED_SOURCE` 用同 ID 的 metadata 7 作为仍匹配的正例，不能伪造反例。此 wildcard 来自重构 [CraftingManager.addRecipe](https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/CraftingManager.java#L85-L135)。
- 14 个 canonical 3×3 图样已占满所有格（`D04,D05,D06,D12,D22,D43,D44,D50,D54,D55,H44,H46,H48,H50`），没有合法“图样外多一格”位置；JSON 明记 `GAP_NO_EMPTY_CELL`，这些项仍有错误 ID/metadata 控制，不能编造额外格反例。
- 工作台候选保留来源表的 150 个 3×3 工作台入口和其中 58 个 2×2 背包入口；这只表达当前候选表的工作站允许集合，不代表 UI/交互已实现。
- 熔炼统一选择煤 `263@0×1` 作为 1600-tick 候选燃料，覆盖一次 200-tick 烹饪；另列熔岩桶 `327×1` 20000 tick 且余物为空的候选。重构 [TileEntityFurnace](https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/TileEntityFurnace.java#L105-L201) 是该候选的唯一代码依据，不是官方 jar 对照。

## 人工审核例外与仍缺口

1. `R-D22` 的奶桶→空桶是唯一当前登记的工作台容器余物；候选由重构 [SlotCrafting](https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/SlotCrafting.java#L37-L43) 与 Item 登记推导，仍须实际取出输出槽验证。
2. 熔炼输入 lookup 只使用 ID；候选特意以 metadata 7 验证“同 ID 仍有相同产出”。`S06` 产物必须候选为木炭 `263@1`，`S09` 为仙人掌绿 `351@2`。输出容量控制从逐物品候选注册读取 max-stack：多数产物为 64，但 [Item.java 的熟猪肉/熟鱼注册](https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/Item.java#L337-L368)均走 [ItemFood 构造器](https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/ItemFood.java#L7-L18)，候选上限为 1；槽状态和 tick 边界仍需运行时验证。
3. 29 项没有 exact-metadata 材料可做 metadata 拒绝例，故记录为 wildcard metadata 的正例：`D13–D16,D18,D19,D24,D25,D28,D33,D36,D40,D42,D51–D53,D57,H45,H47,H49,H51–H54,H85,H90–H93`。此处“metadata 7 匹配”只是重构 matcher 候选，绝不表示它是普通生存可取得物。
4. `H87` 已固定为黑 `351@0` + 两份白 `351@15` → 浅灰 `351@7×3`；fixture 明确保留三个输入，避免再次把它错误转录为两黑一白。
5. 所有 case 都带来源链接，但 [provenance 审计](reference-provenance-audit.md) 已确认重构 Java tree 缺少官方 jar→方法的可核验映射。任何逐项 fixture 只有 `RECONSTRUCTED_SOURCE_CANDIDATE` 或 `RECONSTRUCTED_PLUS_COMMUNITY_CANDIDATE`，不可作为原版验收 oracle。
6. v6 的 150 条工作台夹具全表互撞检查发现 8 个错误的“无输出”断言：`R-D26/R-D27` 的 metadata 互换命中同产物火把配方；`R-D52` 第三块石头命中 `R-D14` 石台阶；`R-H61/H62/H66/H67/H68` 将首个染料 metadata 机械改为 0 或 1，命中另一个登记的混色配方。v7 将火把互换改为同产物正控、压力板的额外材料改为 ID 2、五项染料拒绝值改为 metadata 3。另修正 `R-S07/R-S08` 的满槽控制为单件上限。这些仍是重构来源候选，尚未证明官方 jar 等价。

## 验证命令

```sh
node changes/2026-09-16-classic-beta173-parity/build-recipe-fixture-candidates.mjs
node --check changes/2026-09-16-classic-beta173-parity/build-recipe-fixture-candidates.mjs
node changes/2026-09-16-classic-beta173-parity/verify-recipe-fixture-candidates.mjs
```

生成器在读取到非 160 项 recipe case 时硬失败。全表校验遍历 150 条工作台注册候选（有形平移/镜像与无形多重集合），检查 349 个正例（canonical、镜像、平移、替代图样与无形换序）和 405 个错误 ID/多余格/metadata 控制，另核 10 条熔炼的 50 个登记/负控，结果为 `positiveCollisions=[]`、`contradictions=[]`。此前还检查总数 `160 = 150 + 10`、`119 + 31`、每项来源链接/provenance gap、`D22` 空桶、`S09@2`、熔岩桶零余物和 `H87=0,15,15`。这些只证明候选表内部自洽，不是独立来源审查、Harness 或产品验收。
