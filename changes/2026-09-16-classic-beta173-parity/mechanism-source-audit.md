# b1.7.3 机制来源静态审计（M01–M36）

审计范围是 `mechanics.md` 的 129 个机制子项。只读取固定重构源码提交
`740c583901e1ff1150e9ef37e37dab5bc0e4f807` 和固定 wiki 提交
`8bcc41aee34334c2b916e7b500abe6853b4fd704`；没有运行、分发或提取原版
jar/assets。重构源码只是可定位的候选证据，不是官方字节码或最终玩法 oracle。

## 结果

- 110 项已有一个受固定源码方法/分支/常量约束的**局部**事实，生成器写为
  `PARTIAL_REFERENCE_GAP`；每项仍没有固定初态、RNG、逐 tick 轨迹、负例、
  存档恢复与 owner 审查，因此不能称为已冻结或可执行。
- 19 项没有、也不应伪造为 b1.7.3 玩法 expected，现已补项目条款候选并单列为
  `PROJECT_CONTRACT_CANDIDATE_REVIEW`：`M01-02..04`、`M24-04`、`M30-01`、`M30-04`、
  `M32-02`、`M32-04`、`M34-01..04`、`M35-01..03`、`M36-01..04`。
  它们是 Seedlands 的 Harness/治理/性能，或独立原创资产、音频和人审工作。
  它们已有[项目 expected 与负例候选](project-contract-expected.json)，仍须 owner 审核、固定夹具/设备或人工签署；绝不能用原版 Java、原版素材或项目实测反推。
- 本轮没有把任何机制升级为 `CONTRACT_PASS`、没有固定 fixture，也没有执行
  Classic runtime。整份 comparator 仍不是 READY。

## 可复核定位簇

| 机制面                   | 固定源码定位                                                                                              | 本轮能诚实绑定的局部事实                                                                           | 仍不能省略的反例/夹具                                                             |
| ------------------------ | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| 世界/生成                | `WorldInfo`, `World`, `ChunkProviderGenerate`, `WorldChunkManager`, `WorldGen*`                           | seed/WorldInfo NBT 字段、区块高度、生成调用点、地牢尝试和群系装饰入口                              | 同 seed 的坐标样本、噪声/RNG 调用顺序、旧档与失败地形                             |
| 区块/碰撞/挖放           | `Chunk`, `World`, `Block`, `BlockStairs`, `PlayerControllerSP`, `ItemBlock`, `ItemDoor`                   | AABB/台阶组合碰撞、破坏进度路径、放置/激活路径                                                     | 射线端点、metadata、遮挡、未加载边界、失败后状态不变                              |
| 液体/光照/火/天气        | `BlockFlowing`, `BlockFluid`, `BlockFire`, `Explosion`, `World`, `WorldProvider`                          | 水/岩浆调度常量候选、火雨分支、爆炸阶段、雨雷 timer、24000 tick 天体角                             | 相邻更新顺序、跨区块、RNG、爆炸射线、视觉/audio 观察                              |
| 移动/伤害/库存/合成/熔炉 | `Entity*`, `Container`, `SlotCrafting`, `TileEntityFurnace`                                               | 移动/伤害分支、护甲算法、库存 NBT、2×2/3×3/消耗、200 tick 烹饪                                     | 输入逐 tick、容器余物、无敌帧、死亡/恢复；熔炉消耗 lava bucket 后不自动返空桶     |
| 刷怪/AI/战斗/随机方块    | `SpawnerAnimals`, `EntityMob`, `Pathfinder`, `EntityCreature`, `BlockCrops`, `BlockFarmland`              | 亮度刷怪门槛、A* 路径字段、狼传送距离、80 random ticks、作物/耕地分支                              | 生物上限/群组、同分路径、门/水/落差、RNG、加载边界                                |
| 载具/工具物品/地图       | `BlockRail`, `EntityMinecart`, `EntityBoat`, `TextureCompassFX`, `TextureWatchFX`, `ItemMap`              | 轨道邻接形态入口、载具各自物理路径、罗盘出生点、时钟天体角、地图持久化入口                         | 速度/碰撞、坐骑 NBT、像素色表、渲染时间                                           |
| UI/渲染/声音             | `GuiMainMenu`, `GuiSelectWorld`, `GuiCreateWorld`, `GameSettings`, `GuiIngame`, `Render*`, `SoundManager` | Beta 菜单/世界入口、HUD 状态来源、渲染/第一人称路径、音乐初始随机等待及随后 `nextInt(12000)+12000` | 视口/输入设备、画面和原创音频的人审；不倒灌 Beta 1.8 的旋转全景，也不复用原版资产 |
| 存档                     | `WorldInfo`, `SaveHandler`, `ChunkLoader`, `Entity`, `InventoryPlayer`                                    | world/chunk/entity/item 的 NBT 字段和 session-lock/临时替换路径                                    | 中断、腐坏、原子性、兼容错误和端到端 readback                                     |

## 复现本轮静态检查

1. 将固定源码仓库 `main` checkout 到上述提交；确认 `World.java` 的世界 tick、
   `TileEntityFurnace.updateEntity`、`SoundManager.playRandomMusicIfReady` 与
   `GuiMainMenu` 菜单/背景路径。
2. 运行总账生成器，检查 mechanism 分布为
   `PARTIAL_REFERENCE_GAP=110`、`PROJECT_CONTRACT_CANDIDATE_REVIEW=19`。正式
   `reference-cases.json` 已由总账集成步骤重生；此审计本身未改写它。
3. 对生成器执行 `node --check` 及 `git diff --check`。这只是语法/补丁卫生，
   不是原版运行证据或合同通过。
