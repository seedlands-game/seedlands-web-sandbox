# Classic 排除项依赖闭包与普通生存负例候选（v16）

本表覆盖当前 38 个 `排` 父项；逐案 setup/trigger/expected 与来源见 [机器可读候选](exclusion-dependency-candidates.json)。这是**范围偏离的候选设计**，不是原版行为不存在、来源等价或开工批准。31 项属红石电路边界，7 项属其他维度边界；保留材料/玩法必须另验。

| case    | 排除原因          | 阻断路径                             | 被排依赖/产物 | 必须存活的保留项                                |
| ------- | ----------------- | ------------------------------------ | ------------- | ----------------------------------------------- |
| B-023   | REDSTONE_CIRCUITS | EXCLUDED_PRODUCT_UNOBTAINABLE        | R-D54         | B-054                                           |
| B-027   | REDSTONE_CIRCUITS | EXCLUDED_PRODUCT_UNOBTAINABLE        | R-D30         | B-066、E-Minecart                               |
| B-028   | REDSTONE_CIRCUITS | EXCLUDED_PRODUCT_UNOBTAINABLE        | R-D31         | B-066、E-Minecart                               |
| B-029   | REDSTONE_CIRCUITS | EXCLUDED_PRODUCT_UNOBTAINABLE        | R-D56         | I-331                                           |
| B-033   | REDSTONE_CIRCUITS | EXCLUDED_PRODUCT_UNOBTAINABLE        | R-D55         | I-331                                           |
| B-034   | REDSTONE_CIRCUITS | INTERNAL_EXCLUDED_STATE              | B-029、B-033  | I-331                                           |
| B-036   | REDSTONE_CIRCUITS | INTERNAL_EXCLUDED_STATE              | B-029、B-033  | I-331                                           |
| B-055   | REDSTONE_CIRCUITS | RETAINED_MATERIAL_PLACEMENT_DISABLED | 项目直接排除  | I-331、B-073、B-074、B-025、R-D05、R-D48、R-D49 |
| B-069   | REDSTONE_CIRCUITS | EXCLUDED_PRODUCT_UNOBTAINABLE        | R-D45         | I-331                                           |
| B-070   | REDSTONE_CIRCUITS | EXCLUDED_PRODUCT_UNOBTAINABLE        | R-D52         | I-331                                           |
| B-071   | REDSTONE_CIRCUITS | EXCLUDED_PRODUCT_UNOBTAINABLE        | I-330         | B-064                                           |
| B-072   | REDSTONE_CIRCUITS | EXCLUDED_PRODUCT_UNOBTAINABLE        | R-D53         | I-331                                           |
| B-075   | REDSTONE_CIRCUITS | INTERNAL_EXCLUDED_STATE              | B-076         | B-050                                           |
| B-076   | REDSTONE_CIRCUITS | EXCLUDED_PRODUCT_UNOBTAINABLE        | R-D46         | B-050                                           |
| B-077   | REDSTONE_CIRCUITS | EXCLUDED_PRODUCT_UNOBTAINABLE        | R-D51         | I-331                                           |
| B-087   | OTHER_DIMENSIONS  | OTHER_DIMENSION_INACCESSIBLE         | 项目直接排除  | B-049、B-051、I-259、E-PigZombie                |
| B-088   | OTHER_DIMENSIONS  | OTHER_DIMENSION_INACCESSIBLE         | 项目直接排除  | B-049、B-051、I-259、E-PigZombie                |
| B-089   | OTHER_DIMENSIONS  | OTHER_DIMENSION_INACCESSIBLE         | R-D10         | B-049、B-051、I-259、E-PigZombie                |
| B-090   | OTHER_DIMENSIONS  | PORTAL_CREATION_DISABLED             | 项目直接排除  | B-049、B-051、I-259                             |
| B-093   | REDSTONE_CIRCUITS | INTERNAL_EXCLUDED_STATE              | I-356         | I-331                                           |
| B-094   | REDSTONE_CIRCUITS | INTERNAL_EXCLUDED_STATE              | I-356         | I-331                                           |
| I-330   | REDSTONE_CIRCUITS | EXCLUDED_PRODUCT_UNOBTAINABLE        | R-D20         | B-064                                           |
| I-348   | OTHER_DIMENSIONS  | OTHER_DIMENSION_INACCESSIBLE         | B-089         | B-049、B-051、I-259、E-PigZombie                |
| I-356   | REDSTONE_CIRCUITS | EXCLUDED_PRODUCT_UNOBTAINABLE        | R-D47         | I-331                                           |
| E-Ghast | OTHER_DIMENSIONS  | OTHER_DIMENSION_INACCESSIBLE         | 项目直接排除  | E-PigZombie                                     |
| R-D10   | OTHER_DIMENSIONS  | DISABLED_CRAFTING_OUTPUT             | B-089         | B-049、B-051、I-259、E-PigZombie                |
| R-D20   | REDSTONE_CIRCUITS | DISABLED_CRAFTING_OUTPUT             | I-330         | B-064                                           |
| R-D30   | REDSTONE_CIRCUITS | DISABLED_CRAFTING_OUTPUT             | B-027         | B-066、E-Minecart                               |
| R-D31   | REDSTONE_CIRCUITS | DISABLED_CRAFTING_OUTPUT             | B-028         | B-066、E-Minecart                               |
| R-D45   | REDSTONE_CIRCUITS | DISABLED_CRAFTING_OUTPUT             | B-069         | I-331                                           |
| R-D46   | REDSTONE_CIRCUITS | DISABLED_CRAFTING_OUTPUT             | B-076         | B-050                                           |
| R-D47   | REDSTONE_CIRCUITS | DISABLED_CRAFTING_OUTPUT             | I-356         | I-331                                           |
| R-D51   | REDSTONE_CIRCUITS | DISABLED_CRAFTING_OUTPUT             | B-077         | I-331                                           |
| R-D52   | REDSTONE_CIRCUITS | DISABLED_CRAFTING_OUTPUT             | B-070         | I-331                                           |
| R-D53   | REDSTONE_CIRCUITS | DISABLED_CRAFTING_OUTPUT             | B-072         | I-331                                           |
| R-D54   | REDSTONE_CIRCUITS | DISABLED_CRAFTING_OUTPUT             | B-023         | B-054                                           |
| R-D55   | REDSTONE_CIRCUITS | DISABLED_CRAFTING_OUTPUT             | B-033         | I-331                                           |
| R-D56   | REDSTONE_CIRCUITS | DISABLED_CRAFTING_OUTPUT             | B-029         | I-331                                           |

特别边界：`I-331` 红石粉保留为音符盒、指南针、时钟和地图材料，但不得铺设 `B-055`；`B-049` 黑曜石、`B-051` 火、`I-259` 打火石仍可普通使用，完整框架点火不生成 `B-090`。发射器的手动容器、红石火把照明、动力/探测轨被动形态也随主电路功能整体排除，仍待用户在全合同审核门确认。

每项仍缺：独立来源裁决、穷尽的可取得路径、精确 seed/初态/tick 输入/负控、保留项正控和 reviewer。生成器与校验器只能保证这 38 个 ID 的图边存在及范围分类自洽；不能证明游戏里确实不可达。
