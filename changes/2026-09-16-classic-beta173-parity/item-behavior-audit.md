# b1.7.3 非方块物品行为候选审计

日期：2026-09-17。范围是 `reference-cases.json` 的 I-256..I-359 与 I-2256/I-2257，共 106 项。此文件和 `item-behavior-candidates.json` 是实施前的夹具**候选**，不构成原版运行证据、验收通过或设计冻结。

## 结论与覆盖

- 共 106/106 项均有 ID、名称、范围、取得正/反前置（`排`/`存` 仅有可达性反例）、堆叠正/反例、耐久候选或不可耐久反例、余物候选、特殊状态、音画候选/GAP、保存候选及使用正/反例。
- 范围分布：`做` 99，`存` 4（锁链盔甲 I-302..305），`排` 3（铁门 I-330、萤石粉 I-348、红石中继器 I-356）。后两类没有被伪造为可取得的正向玩法行为。
- 生成物全部标为 `SOURCE_CANDIDATE_NOT_APPROVED`；固定重构来源仅是 `jacobo-mc/mc_b1.7.3_release@740c583901e1ff1150e9ef37e37dab5bc0e4f807`。该提交尚未获得官方 b1.7.3 JAR 字节码/反编译映射的独立闭环，因此不能提升为原版真值。
- 未运行、下载或分发原版；没有把重构 Java 源码复制入本仓。

## 可复核产物

`build-item-behavior-candidates.mjs` 从现有的 ID/范围登记表读取输入，生成稳定排序的 `item-behavior-candidates.json`。每一项有以下固定字段：

- `acquisitionFixture`：`做` 项为显式背包 seed 与缺失物品反例；`排`/`存` 是 `PROFILE_ACCESS_NEGATIVE_ONLY`。
- `stackFixture`：登记的最大堆叠数与 `max+1` 反例；后者明确未执行，不能被误读为已知运行时拒绝策略。
- `durabilityFixture`：耐久物品保留 `damage=0` 和边界反例；非耐久物品只给出拒绝耐久断言的负例。`ItemStack` 的 NBT 以及损坏阈值源码链接会逐项附上。
- `remainderFixture`：只把静态 `containerItem` 当作合成槽余物候选；汤、桶等普通使用替换仅由相应子类另行列出。
- `behaviorFixture`：每个条目都有一个正向与一个反向 fixture 候选、固定重构源码 URL 和专门的 `specialStateCandidate` / `audioVisualCandidate`。
- `persistenceCandidate`：普通物品是 ItemStack `id`/`Count`/`Damage` NBT 候选；地图另列 MapData 的世界侧状态候选。

## 已定位的行为族（候选数量）

| 行为族              | 数量 | 静态候选锚点与关键反例                                                                                                         |
| ------------------- | ---: | ------------------------------------------------------------------------------------------------------------------------------ |
| 基类无自定义使用    |   22 | `Item.java#L155-L205`；`onItemUse` 返回 false 候选                                                                             |
| 工具/剑/锄/剪刀     |   26 | `ItemTool.java`、`ItemSword.java`、`ItemHoe.java`、`ItemShears.java`；空气、非有效方块或不合资格目标反例                       |
| 盔甲                |   20 | `ItemArmor.java#L4-L19`；只证明构造的耐久/减伤候选，装备和受伤管线 GAP                                                         |
| 食物/汤/曲奇        |   10 | `ItemFood.java`/`ItemSoup.java`/`ItemCookie.java`；空堆叠反例；I-282 返回碗 281 候选                                           |
| 桶                  |    4 | `ItemBucket.java#L12-L99`；非源液体/非法目标反例；I-325 要求源方块 metadata=0；地狱水的 `random.fizz` + 8 个 `largesmoke` 候选 |
| 放置/实体/投掷/唱片 |   19 | 门、床、船、矿车、画、告示牌、种子、红石、方块物品、弓、蛋、雪球、鞍、唱片；均有地形/面向/库存反例                             |
| 变体与特殊状态      |    5 | 煤 I-263（metadata=1 是木炭）、染料 I-351（16 子值）、钓竿、地图、唱片                                                         |

## 逐项高风险候选

- I-282：汤的右键结果是空碗 281 候选，不能与 crafting `containerItem` 混为一谈。
- I-325..327、I-335：空桶只对 metadata=0 的水/岩浆源方块收集；牛奶桶是另一条右键替换路径；水在 Hell 的声音/粒子为候选，尚无渲染或音频执行证据。
- I-351：metadata 15 是骨粉使用分支，羊毛色转换和草地随机扩散必须后续以固定 RNG/world fixture 执行；其余 metadata 不应被虚构为同样的骨粉行为。
- I-358：物品损坏值兼作地图 ID 候选；MapData 的中心、scale=3 和 dimension 是世界侧保存状态，图像采样/像素输出仍是 GAP。
- I-2256/I-2257：只有空唱片机正例；候选辅助事件为 1005，唱片名字取注册参数 `"13"` / `"cat"`。音频内容、时长和混音均未验证。

## 不可越过的缺口

1. 没有官方 b1.7.3 客户端 JAR 的 SHA→字节码→该重构路径/方法映射。每一项均保留 `OFFICIAL_B173_JAR_TO_SOURCE_MAPPING_MISSING`。
2. 没有启动过原版或实现端，所有 fixture 均为 `FIXTURE_NOT_EXECUTED`；堆叠溢出、耐久断裂、实体同步、音画和保存读回都未被运行验证。
3. 许多跨类行为不能由静态注册或单个 Item 子类完整证明：盔甲装备/伤害、工具有效方块清单与破坏管线、钓鱼 RNG、地图采样、实体碰撞/同步、方块回调、GUI 与声音资源。这些条目显式留为 GAP，不能写进 APPROVED 合同。
4. `排`/`存` 条目只满足本阶段要求的 profile 可达性负例，不能据此推出产品禁用机制已经实现。

## 复现与静态验证

```sh
node --check changes/2026-09-16-classic-beta173-parity/build-item-behavior-candidates.mjs
node changes/2026-09-16-classic-beta173-parity/build-item-behavior-candidates.mjs
node - <<'NODE'
const x = require('./changes/2026-09-16-classic-beta173-parity/item-behavior-candidates.json');
if (x.counts.total !== 106) throw new Error('expected 106');
for (const e of x.entries) {
  if (e.candidateStatus !== 'SOURCE_CANDIDATE_NOT_APPROVED') throw new Error(e.caseId);
  if (!e.sourceLinks.length || !e.behaviorFixture.positive || !e.behaviorFixture.negative || !e.gaps.length) throw new Error(e.caseId);
}
console.log(x.counts, x.sha256);
NODE
```

这只验证生成器的输入覆盖和标记纪律；不验证 b1.7.3 原版或当前实现的行为。
