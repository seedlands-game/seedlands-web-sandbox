# Beta 1.7.3 配方来源静态审计

审计日期：2026-09-17。范围仅为 `D01–D57`、`H01–H93` 与 `S01–S10` 的来源语义；不运行、下载或分发原版，也不把重构源码候选当作运行时验收。

## 结论与证据等级

- **注册值：SOURCE_CANDIDATE_CONFIRMED。** 150 个工作台配方及 10 个熔炼登记项都能在固定提交 `740c583901e1ff1150e9ef37e37dab5bc0e4f807` 的反编译重构源码中逐项定位；工作台登记入口为 [CraftingManager 构造器](https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/CraftingManager.java#L17-L81)，熔炼表为 [FurnaceRecipes](https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/FurnaceRecipes.java#L14-L29)。
- **匹配与消耗：SOURCE_CANDIDATE_CONFIRMED。** 有形配方会遍历 3×3 所有平移位置并试镜像；空格外任何非空格均拒绝，非 `-1` metadata 必须相等，见 [ShapedRecipes.matches](https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/ShapedRecipes.java#L22-L74)。无形配方逐个移除匹配材料，位置不重要但多余物品会拒绝，见 [ShapelessRecipes.matches](https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/ShapelessRecipes.java#L20-L51)。
- **独立资料交叉核对：PARTIAL。** 固定 beta-wiki 的 [crafting 页](https://github.com/OfficialPixelBrush/beta-wiki/blob/8bcc41aee34334c2b916e7b500abe6853b4fd704/general/recipes/crafting.md) 确认工具、材料块、基础工作台/砂岩、蘑菇煲/曲奇及 metadata 规则，但其页面明确“Lots missing”；[smelting 页](https://github.com/OfficialPixelBrush/beta-wiki/blob/8bcc41aee34334c2b916e7b500abe6853b4fd704/general/recipes/smelting.md) 完整列出 10 输入输出及燃料候选。因此独立资料不能单独冻结所有 150 项。
- **非结论：** 没有原版 jar 方法级等价证明、固定夹具、RED 测试、Harness/产品运行或验收通过证据；本文件绝不将全局合同标为 `READY` 或 `PASS`。

记法：`id@meta×count`；省略 `@meta` 的输出/Item 输入由 `ItemStack` 构造器取 `0`。`*` 表示源码 `-1` wildcard，非“未知”。图样从上到下用 `/` 分隔；所有有形图样还接受水平镜像与 3×3 平移，除非图样本身镜像相同。

生成器 v6 修正了同名字段的命名空间碰撞：D09 的产出是 [`Block.brick` ID 45，四个原料是 `Item.brick` ID 336](https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/CraftingManager.java#L30)，不能把两个 `brick` 合并为 ID 336；`Block/Item` 的 doorWood、doorSteel、reed、cake 同名字段也按完整限定名解析。旧生成 JSON 的 D09 expected 和由其生成的夹具不可继承。

## 先修正的 helper 事实

`CraftingManager.addRecipe` 将 `Block` 符号包装为 `new ItemStack(block, 1, -1)`，而 `Item` 符号为 damage `0`；见 [登记归一化](https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/CraftingManager.java#L85-L135) 与 [ItemStack 构造器](https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/ItemStack.java#L9-L37)。故 helper 已显式补 `metadata: -1` 于如下全部 Block 输入：

- `H01,H02,H06,H07,H11,H12,H16,H17,H21,H22`：木板 `5@*`、圆石 `4@*`；
- `H45,H47,H49,H51`：铁/金/钻石/青金石块 `42/41/57/22@*`；
- `H52,H53,H54`：木板/圆石 `5/4@*`；
- `H55`：红/棕蘑菇 `40/39@*`；`H85`：沙 `12@*`；
- `H90–H93`：火 `51@*`。

每个上述 ID 的非默认 metadata 正例都是“同 id 且 damage=7 仍按图样匹配”；负例不能虚构为“同 id、非零 metadata 不匹配”，因为源码明确接受它。有效反例是错误 id、图样外多一格、或不合图样。例：`H01` 的三格 `5@7` 加两根木棍仍可合成；以 `6@7` 代替任一 `5@*` 则拒绝。`H55` 以 `39@7/40@1/281@0` 的任一登记顺序可合成，两个蘑菇同为 `39` 则拒绝。`H90` 的 `51@7` 在 matcher 层可合成，但该原始状态不是普通生存取得物，见下文可获得性边界。

## 逐 ID：直接登记 D01–D57

以下每行均来自 [CraftingManager L24–L80](https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/CraftingManager.java#L24-L80)；`B*` 为上述 Block wildcard，`I0` 为 Item damage 0，唯有煤炭/木炭、半砖和奶桶另列 metadata。

| ID  | 输出    | 图样与材料                                        | 范围/取得结论                                                                                                   |
| --- | ------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| D01 | 339×3   | `###`; 甘蔗 338                                   | 普通生存                                                                                                        |
| D02 | 340×1   | `#/#/#`; 纸 339                                   | 普通生存                                                                                                        |
| D03 | 85@0×2  | `###/###`; 木棍 280                               | 普通生存                                                                                                        |
| D04 | 84@0×1  | `###/#X#/###`; 木板 5@*、钻石 264                 | 普通生存                                                                                                        |
| D05 | 25@0×1  | `###/#X#/###`; 木板 5@*、红石 331                 | 按 [spec 范围裁决](spec.md#排除依赖的默认裁决供整份合同审核) 保留手动音符盒；电路触发排除，来源候选仍待最终审查 |
| D06 | 47@0×1  | `###/XXX/###`; 木板 5@*、书 340                   | 普通生存                                                                                                        |
| D07 | 80@0×1  | `##/##`; 雪球 332                                 | 普通生存                                                                                                        |
| D08 | 82@0×1  | `##/##`; 黏土球 337                               | 普通生存                                                                                                        |
| D09 | 45@0×1  | `##/##`; 红砖 336                                 | 普通生存                                                                                                        |
| D10 | 89@0×1  | `##/##`; 荧石粉 348                               | 登记存在；当前其他维度依赖排除                                                                                  |
| D11 | 35@0×1  | `##/##`; 线 287                                   | 普通生存，白羊毛默认 meta 0                                                                                     |
| D12 | 46@0×1  | `X#X/#X#/X#X`; 火药 289、沙 12@*                  | 普通生存材料；爆炸玩法另审                                                                                      |
| D13 | 44@3×3  | `###`; 圆石 4@*                                   | 普通生存；输出半砖 subtype 3                                                                                    |
| D14 | 44@0×3  | `###`; 石头 1@*                                   | 普通生存；输出半砖 subtype 0                                                                                    |
| D15 | 44@1×3  | `###`; 砂岩 24@*                                  | 普通生存；输出半砖 subtype 1                                                                                    |
| D16 | 44@2×3  | `###`; 木板 5@*                                   | 普通生存；输出半砖 subtype 2                                                                                    |
| D17 | 65@0×2  | `# #/###/# #`; 木棍 280                           | 普通生存                                                                                                        |
| D18 | 324×1   | `##/##/##`; 木板 5@*                              | 普通生存                                                                                                        |
| D19 | 96@0×2  | `###/###`; 木板 5@*                               | 普通生存                                                                                                        |
| D20 | 330×1   | `##/##/##`; 铁锭 265                              | 普通生存材料；当前红石相关玩法排除                                                                              |
| D21 | 323×1   | `###/###/ X `; 木板 5@*、木棍 280                 | 普通生存                                                                                                        |
| D22 | 354×1   | `AAA/BEB/CCC`; 奶桶 335、糖 353、蛋 344、小麦 296 | 普通生存；取出时奶桶返 325                                                                                      |
| D23 | 353×1   | `#`; 甘蔗 338                                     | 普通生存                                                                                                        |
| D24 | 5@0×4   | `#`; 原木 17@*                                    | 普通生存；原木 metadata 不决定输出                                                                              |
| D25 | 280×4   | `#/#`; 木板 5@*                                   | 普通生存                                                                                                        |
| D26 | 50@0×4  | `X/#`; 煤 263@0、木棍 280                         | 普通生存                                                                                                        |
| D27 | 50@0×4  | `X/#`; 煤 263@1、木棍 280                         | 普通生存（木炭）                                                                                                |
| D28 | 281×4   | `# #/ # `; 木板 5@*                               | 普通生存                                                                                                        |
| D29 | 66@0×16 | `X X/X#X/X X`; 铁锭 265、木棍 280                 | 普通生存材料；轨道机制另审                                                                                      |
| D30 | 27@0×6  | `X X/X#X/XRX`; 金锭 266、木棍、红石               | 红石机制排除                                                                                                    |
| D31 | 28@0×6  | `X X/X#X/XRX`; 铁锭、石压板 70@*、红石            | 红石机制排除                                                                                                    |
| D32 | 328×1   | `# #/###`; 铁锭 265                               | 普通生存                                                                                                        |
| D33 | 91@0×1  | `A/B`; 南瓜 86@_、火把 50@_                       | 普通生存                                                                                                        |
| D34 | 342×1   | `A/B`; 箱子 54@*、矿车 328                        | 普通生存                                                                                                        |
| D35 | 343×1   | `A/B`; 熔炉 61@*、矿车 328                        | 普通生存                                                                                                        |
| D36 | 333×1   | `# #/###`; 木板 5@*                               | 普通生存                                                                                                        |
| D37 | 325×1   | `# #/ # `; 铁锭 265                               | 普通生存                                                                                                        |
| D38 | 259×1   | `A / B`; 铁锭 265、燧石 318                       | 普通生存                                                                                                        |
| D39 | 297×1   | `###`; 小麦 296                                   | 普通生存                                                                                                        |
| D40 | 53@0×4  | `#  /## /###`; 木板 5@*                           | 普通生存                                                                                                        |
| D41 | 346×1   | `  #/ #X/# X`; 木棍 280、线 287                   | 普通生存                                                                                                        |
| D42 | 67@0×4  | `#  /## /###`; 圆石 4@*                           | 普通生存                                                                                                        |
| D43 | 321×1   | `###/#X#/###`; 木棍 280、羊毛 35@*                | 普通生存                                                                                                        |
| D44 | 322×1   | `###/#X#/###`; 金块 41@*、苹果 260                | 普通生存                                                                                                        |
| D45 | 69@0×1  | `X/#`; 木棍、圆石 4@*                             | 红石机制排除                                                                                                    |
| D46 | 76@0×1  | `X/#`; 木棍、红石 331                             | 红石机制排除                                                                                                    |
| D47 | 356×1   | `#X#/III`; 红石火把 76@_、红石、石头 1@_          | 红石机制排除                                                                                                    |
| D48 | 347×1   | `# /#X#/ #`; 金锭、红石                           | 普通生存                                                                                                        |
| D49 | 345×1   | `# /#X#/ #`; 铁锭、红石                           | 普通生存                                                                                                        |
| D50 | 358×1   | `###/#X#/###`; 纸、指南针                         | 普通生存                                                                                                        |
| D51 | 77@0×1  | `#/#`; 石头 1@*                                   | 红石机制排除                                                                                                    |
| D52 | 70@0×1  | `##`; 石头 1@*                                    | 红石机制排除                                                                                                    |
| D53 | 72@0×1  | `##`; 木板 5@*                                    | 红石机制排除                                                                                                    |
| D54 | 23@0×1  | `###/#X#/#R#`; 圆石、弓、红石                     | 红石机制排除                                                                                                    |
| D55 | 33@0×1  | `TTT/#X#/#R#`; 木板、圆石、铁锭、红石             | 红石机制排除                                                                                                    |
| D56 | 29@0×1  | `S/P`; 黏液球、活塞 33@*                          | 红石机制排除                                                                                                    |
| D57 | 355×1   | `###/XXX`; 羊毛 35@_、木板 5@_                    | 普通生存；睡眠机制另审                                                                                          |

## 逐 ID：helper 登记 H01–H93

下列矩阵直接转录 [RecipesTools](https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/RecipesTools.java#L4-L22)、[RecipesWeapons](https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/RecipesWeapons.java#L4-L22)、[RecipesArmor](https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/RecipesArmor.java#L4-L21)、[RecipesIngots](https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/RecipesIngots.java#L6-L16)、[RecipesCrafting](https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/RecipesCrafting.java#L4-L8)、[RecipesFood](https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/RecipesFood.java#L4-L7) 和 [RecipesDyes](https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/RecipesDyes.java#L4-L23)。每个斜线分隔 ID 都是独立登记项；排列次序为木/石/铁/金/钻石。

| ID                  | 输出；图样/无形材料                                                                         | 取得/版本边界                                                           |
| ------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| H01/H02/H03/H04/H05 | 270/274/257/285/278×1；`XXX/ # / # `，木板 5@_/圆石 4@_/铁 265/金 266/钻石 264 + 木棍 280   | 普通生存                                                                |
| H06/H07/H08/H09/H10 | 271/275/258/286/279×1；`XX/X#/ #`，同上                                                     | 普通生存；横镜像同样匹配                                                |
| H11/H12/H13/H14/H15 | 269/273/256/284/277×1；`X/#/#`，同上                                                        | 普通生存                                                                |
| H16/H17/H18/H19/H20 | 290/291/292/294/293×1；`XX/ #/ #`，同上                                                     | 普通生存；横镜像同样匹配                                                |
| H21/H22/H23/H24/H25 | 268/272/267/283/276×1；`X/X/#`，同上                                                        | 普通生存                                                                |
| H26                 | 261×1；` #X/# X/ #X`，木棍 280、线 287                                                      | 普通生存；横镜像同样匹配                                                |
| H27                 | 262×4；`X/#/Y`，燧石 318、木棍 280、羽毛 288                                                | 普通生存                                                                |
| H28/H29/H30/H31     | 298/299/300/301×1；帽 `XXX/X X`、胸 `X X/XXX/XXX`、腿 `XXX/X X/X X`、靴 `X X/X X`；皮革 334 | 普通生存                                                                |
| H32/H33/H34/H35     | 306/307/308/309×1；同四个甲型；铁锭 265                                                     | 普通生存                                                                |
| H36/H37/H38/H39     | 314/315/316/317×1；同四个甲型；金锭 266                                                     | 普通生存                                                                |
| H40/H41/H42/H43     | 310/311/312/313×1；同四个甲型；钻石 264                                                     | 普通生存                                                                |
| H44/H45             | 42@0×1 / 265×9；`###/###/###` 铁锭 / `#` 铁块 42@*                                          | 普通生存                                                                |
| H46/H47             | 41@0×1 / 266×9；`###/###/###` 金锭 / `#` 金块 41@*                                          | 普通生存                                                                |
| H48/H49             | 57@0×1 / 264×9；`###/###/###` 钻石 / `#` 钻石块 57@*                                        | 普通生存                                                                |
| H50/H51             | 22@0×1 / 351@4×9；`###/###/###` 青金石 351@4 / `#` 青金石块 22@*                            | 普通生存                                                                |
| H52                 | 58@0×1；`##/##`，木板 5@*                                                                   | 普通生存                                                                |
| H53                 | 54@0×1；`###/# #/###`，木板 5@*                                                             | 普通生存                                                                |
| H54                 | 61@0×1；`###/# #/###`，圆石 4@*                                                             | 普通生存                                                                |
| H55                 | 282×1；`Y/X/#`，红/棕蘑菇 40@_/39@_ 的两种次序 + 碗 281                                     | 普通生存；两条登记均需保留                                              |
| H56                 | 357×8；`#X#`，小麦 296、可可豆 351@3                                                        | 普通生存                                                                |
| H57/H58/H59         | 351@11×2 / 351@1×2 / 351@15×3；无形蒲公英 37 / 玫瑰 38 / 骨 352                             | 普通生存                                                                |
| H60/H61/H62/H63/H64 | 351@14×2 / @10×2 / @12×2 / @6×2 / @5×2；无形染料 (1,11)/(2,15)/(4,15)/(4,2)/(4,1)           | 普通生存                                                                |
| H65/H66/H67/H68     | 351@13×2 / @9×2 / @8×2 / @7×2；无形染料 (5,9)/(1,15)/(0,15)/(8,15)                          | 普通生存                                                                |
| H69/H70/H71/H72     | 35@0/@1/@2/@3×1；无形白羊毛 35@0 + 染料 351@15/@14/@13/@12                                  | 普通生存；羊毛/染料索引反转                                             |
| H73/H74/H75/H76     | 35@4/@5/@6/@7×1；无形白羊毛 35@0 + 染料 351@11/@10/@9/@8                                    | 普通生存；羊毛/染料索引反转                                             |
| H77/H78/H79/H80     | 35@8/@9/@10/@11×1；无形白羊毛 35@0 + 染料 351@7/@6/@5/@4                                    | 普通生存；羊毛/染料索引反转                                             |
| H81/H82/H83/H84     | 35@12/@13/@14/@15×1；无形白羊毛 35@0 + 染料 351@3/@2/@1/@0                                  | 普通生存；羊毛/染料索引反转                                             |
| H85                 | 24@0×1；`##/##`，沙 12@*                                                                    | 普通生存                                                                |
| H86                 | 359×1；`#/#`，铁锭 265                                                                      | 普通生存；横镜像同样匹配                                                |
| H87                 | 351@7×3；无形 351@0 + 351@15 + 351@15                                                       | 普通生存                                                                |
| H88                 | 351@13×3；无形 351@4 + 351@1 + 351@9                                                        | 普通生存                                                                |
| H89                 | 351@13×4；无形 351@4 + 351@1 + 351@1 + 351@15                                               | 普通生存                                                                |
| H90/H91/H92/H93     | 302/303/304/305×1；四个甲型同 H28–H31，火 51@*                                              | **登记存在但普通生存不可取得**；保留为排除/反例，不应实现为常规生存来源 |

羊毛逆映射还由 [BlockCloth.getDyeFromBlock](https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/BlockCloth.java#L21-L27) 的 `~dye & 15` 独立固定；H69 与 H84 分别覆盖两个端点。无形配方不能以镜像概念描述：任意 3×3 位置及材料排列都可，恰好一份每项且无额外物品才匹配。

## 容器余物、熔炼与 S01–S10

| ID  | 输入 → 输出                               | 来源语义与普通生存结论                                               |
| --- | ----------------------------------------- | -------------------------------------------------------------------- |
| S01 | 铁矿 15@任意 → 铁锭 265@0×1               | 普通生存；FurnaceRecipes 仅按 input item ID 查表，输入 metadata 忽略 |
| S02 | 金矿 14@任意 → 金锭 266@0×1               | 普通生存；同上                                                       |
| S03 | 沙 12@任意 → 玻璃 20@0×1                  | 普通生存；同上                                                       |
| S04 | 圆石 4@任意 → 石头 1@0×1                  | 普通生存；同上                                                       |
| S05 | 黏土球 337@任意 → 红砖 336@0×1            | 普通生存；同上                                                       |
| S06 | 原木 17@任意 → 煤 263@1×1（木炭）         | 普通生存；**输出 metadata 1**                                        |
| S07 | 生猪肉 319@任意 → 熟猪肉 320@0×1          | 普通生存；同上                                                       |
| S08 | 生鱼 349@任意 → 熟鱼 350@0×1              | 普通生存；同上                                                       |
| S09 | 仙人掌 81@任意 → 染料 351@2×1（仙人掌绿） | 普通生存；**输出 metadata 2**                                        |
| S10 | 钻石矿 56@任意 → 钻石 264@0×1             | 普通生存；同上                                                       |

`FurnaceRecipes` 的 key 是整数 ID，`TileEntityFurnace` 以 `input.getItem().shiftedIndex` 取 key，故 S01–S10 的输入 metadata 不参与选择；见 [FurnaceRecipes L15–L32](https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/FurnaceRecipes.java#L15-L32) 与 [TileEntityFurnace.canSmelt/smeltItem](https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/TileEntityFurnace.java#L149-L182)。每次完成需 200 tick；输出需同 ID 且未满堆，见 [updateEntity](https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/TileEntityFurnace.java#L105-L145)。

燃料为木质 Block 300 tick、木棍 100、煤（不区分 metadata）1600、熔岩桶 20000、任意树苗 100，见 [getItemBurnTime](https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/TileEntityFurnace.java#L185-L201)。**熔炉燃烧熔岩桶不返还空桶：**此类代码只递减燃料 stack，未调用 container-item API。相对地，工作台输出槽逐材料格减一后，若 `hasContainerItem()`，会放入容器余物；见 [SlotCrafting](https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/SlotCrafting.java#L37-L43)。因此 D22 的三桶奶各返一只空桶 325；`Item.bucketMilk` 的 `containerItem=bucketEmpty` 可见于 [Item 登记](https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/Item.java#L242-L256) 和 [milk bucket 初始化](https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/Item.java#L343-L353)。

## 可执行验收仍缺什么

本审计可导出的 RED 用例包括：有形镜像/平移与格外材料拒绝、无形乱序/多余材料拒绝、H69/H84 染料反转端点、D22 三空桶、熔岩桶燃料无空桶、S09 `351@2`、S10/S06 metadata、及所有 `@*` 的非默认 metadata matcher 正例。它们尚未被写入或执行，原因是本子任务无权改共享生成器、reference cases 或 Harness。原版方法级对照、固定初态/输入、Harness 执行和产品验收仍由总合同的后续门禁负责。
