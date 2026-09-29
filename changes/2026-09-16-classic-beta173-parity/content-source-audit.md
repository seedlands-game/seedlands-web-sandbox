# Classic b1.7.3 内容静态来源审计

审计对象：本 change 的 97 个方块（含空气）、106 个非方块物品、30 个实体/派生态及元数据变体登记。审计只覆盖本地提取器可以确定性读出的静态注册、构造参数和源码导航位置；不运行、分发或反编译原版 Jar，也不将重构源码当作已经验收的产品行为。

## 固定来源与定位方法

- 版本身份仍是 Mojang b1.7.3 元数据；行为候选固定到重构源码提交 [`740c583`](https://github.com/jacobo-mc/mc_b1.7.3_release/tree/740c583901e1ff1150e9ef37e37dab5bc0e4f807)。它只能作为待人工复核的源码候选，不能单独冻结合同。
- 方块注册逐行来自 [`Block.java` static initializer](https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/Block.java#L593-L699)。提取器为每个非空气 ID 写入 `staticRegistration.sourceLocation` 的原始行号；ID 35 的 `BlockCloth` 无 ID 构造参数，仍定位到其赋值行。
- 物品注册逐行来自 [`Item.java` static initializer](https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/Item.java#L274-L379)。每个物品现在保存原始构造参数、注册行和子类方法导航；导航不是“使用结果”。
- 实体命名注册逐行来自 [`EntityList.java` addMapping](https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/EntityList.java#L83-L106)。没有 `addMapping` 的玩家、鱼钩、鸡蛋、闪电和两种矿车派生态，明确标为 runtime-derived，不能由“未注册”推断为“不存在”。
- ID、名称和物品/方块元数据名称来自固定 beta-wiki 提交；取得性标记来自固定 RetroMC 修订。两者只承担各自表中写明的字段，不承担使用、掉落概率、碰撞或存档语义。

## 批量结果

| 对象        |                                          已机械核对 | 变体/例外                                    | 本轮未提升为已验证                                                        |
| ----------- | --------------------------------------------------: | -------------------------------------------- | ------------------------------------------------------------------------- |
| 方块        |                   96 个非空气注册；空气为 ID 0 特例 | 28 个有元数据夹具导航                        | 所有放置、碰撞、挖掘进度、掉落数量/概率、流体/随机 tick、声音、渲染和存档 |
| 非方块物品  |                 106 个注册、构造参数、堆叠/耐久候选 | 煤 2 值、染料 16 值；各子类方法导航          | 取得、容器余物、命中/破坏耗损、右键失败分支、投射物/实体结果、图标和恢复  |
| 实体/派生态 | 24 个 `addMapping` 名称/数值 ID；6 个派生运行时入口 | chest/furnace minecart 的 `minecartType` 1/2 | 合法生成、AI、AABB、移动、伤害、掉落、随机序列、声音、NBT 全字段和反例    |

提取器结构性验证结果为 `97 block / 106 item / 30 entity`；每个非空气方块和每个物品都有注册行，30 个实体都有源码方法导航。这个检查仅证明提取完整性，不证明游戏行为正确。

## 已纠正或收紧的提取口径

- 护甲耐久按 `ItemArmor` 的 `maxDamageArray[slot] * 3 << armorLevel` 记录；减伤值仅取槽位数组，不能把材质等级再乘到减伤值上。
- 工具材质字段只记录 `EnumToolMaterial` 的耐久、采掘级别、有效方块效率和基础伤害加成。武器实际命中值、正确工具矩阵和耐久耗损仍留在方法级夹具验收。
- 方块的 `explicitResistanceArgument` 是 `setResistance` 的调用参数，不宣称等于运行时最终抗爆值；`Block.setResistance` 自身有换算。
- `sourceBehaviorCandidate` 是文件/方法导航，并显式带有“未断言夹具结果”的状态。它不能因类存在而升级 `referenceStatus`。
- metadata 表把水/岩浆、火、作物、耕地、炉子、门、轨道、楼梯、告示牌、雪层、南瓜、蛋糕和活板门加入候选；每项备注了仍需单独执行的状态转换或负例。红石相关 ID 仍受本 change 的排除边界约束。

## 已定位的高风险跨版本项

- 牛的来源候选为 `EntityCow.getDropItemId` 与 `interact`：掉皮革、空桶变奶桶；本版本不得补入后期牛肉掉落。
- 羊的剪毛数量、颜色和耐久候选在 `EntitySheep.interact`；死亡未剪羊的掉落走 `dropFewItems`，两者不能合并成同一掉落规则。
- 鸡蛋孵化、TNT 80 tick 引信、史莱姆尺寸/NBT、狼驯服随机门槛只写作方法级行为候选，仍须固定 RNG、输入 trace 和保存/恢复反例。
- 箱式/动力矿车是 `EntityMinecart` 的类型值，不是额外 `EntityList` ID；验收要同时覆盖 `ItemMinecart.onItemUse` 和 `EntityMinecart` 的 NBT `Type` 路径。

## 仍阻止冻结的缺口

所有 233 个内容 case 继续保持 `PARTIAL_REFERENCE_GAP`：没有固定初态、随机种子/调用顺序、逐 tick 输入、期望 owner state/event、负例、存档恢复读回或 reviewer 签字。特别是下列模式不能由本审计解除：

- “注册有该 ID/类”不能推出普通生存可取得、可放置、可碰撞或可掉落。
- “表格写有 metadata 名称”不能推出全部 raw 值、相邻更新、无效值恢复或渲染面。
- “重构源码有一个方法”不能推出它与官方 b1.7.3 客户端逐方法一致。
- 红石、下界/末地和多人边界的条目即使有静态注册也不进入本轮玩法实施范围。

因此本文件的终态是 `SOURCE_CANDIDATE_REVIEW`，不是 `CONTRACT_PASS` 或开工许可。
