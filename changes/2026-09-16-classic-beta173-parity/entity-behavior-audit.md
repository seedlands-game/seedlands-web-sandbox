# b1.7.3 实体行为候选审计

状态：`SOURCE_CANDIDATE_REVIEW / NO-GO`。本文件与 `entity-behavior-candidates.json` 是 30 个 E-* 父例的**源码导航和 fixture 设计**，不是原版行为通过记录，不能替代 Harness、原版执行、资产验证或产品验收。

## 来源与边界

- 候选源码固定为重构仓库 `jacobo-mc/mc_b1.7.3_release` 的 commit `740c583901e1ff1150e9ef37e37dab5bc0e4f807`；JSON 每个 `sources[]` 都是该 commit 的 GitHub blob 文件/方法/行链接。
- 该重构源码不是 Mojang 官方发布物，也未运行或下载原版 JAR；因此只可标为 `medium: fixed reconstructed-source method candidates`，不能称 b1.7.3 真值。
- `EntityList.addMapping` 的 24 个命名项仅作 numeric-id/class 导航。Player、FishHook、Egg、Lightning、MinecartChest、MinecartFurnace 没有该命名映射，明确标作 `runtime-derived`，不从“类存在”推断注册、可获得或完整玩法。
- `排/存` 是父清单范围边界：Ghast=排，Giant/Mob/Monster=存；其正例仅可做 identity/source fixture，不能被包装为普通单人生存行为。

## 覆盖计数

批量生成后共有 30/30 唯一 E-*：`做` 26、`存` 3、`排` 1。每例强制六个行为维度：spawn、AABB/运动、AI/交互、伤害/掉落、声音/动画、NBT 保存读取，共 180 槽；固定重构源码在**当前类直接定位**到 114 槽，66 槽没有当前类方法。v16 沿继承链逐方法补充导航：这 66 槽中另有 51 槽能定位到父类方法，15 槽整条链仍无对应方法；父类方法可能是默认空实现，绝不把 51 算成已证实行为或新的 expected。旧统计的 122/58 曾错误把 `setEntityDead` 计作生成、把 `attackEntityFrom` 计作 AI/交互；本版继续剔除。猪与苦力怕的 `onStruckByLightning` 是单列的雷击派生来源，不能冒充自然生成条件。Player、Giant、抽象 Mob/Monster 等不能因为继承 `getCanSpawnHere` 就被误报为普通自然生成。非空槽也只是**待执行的候选入口**，不表示断言已经存在。

每个记录均具备：

- `expectedCandidate.behaviorFocus`：该实体最小、可观察的候选行为；
- `methodCandidates`、`inheritedMethodCandidates`、`inheritanceChain`、`lightningDerivationCandidates` 与 `sources`：精确文件、方法、行；直接声明与父类默认/覆盖入口分开，雷击派生与自然生成分开；
- `fixture.positive` / `fixture.negative`：正反例的最小固定输入和 owner-state/event 读回要求；
- `gaps`：原版等价、固定 RNG/tick trace、负例执行、声音/动画采集和 NBT 读回的共同缺口。

## 逐项最小候选

以下均需把 JSON 指向的方法变成独立的固定输入、预期 owner state 与读回断言后才能关闭：

| E-*             | 最小候选 / 特别缺口                                             |
| --------------- | --------------------------------------------------------------- |
| Player          | 死亡/受伤/NBT；声音动画缺口。                                   |
| Item            | tick、受伤销毁、拾取、NBT；自然生成与声音缺口。                 |
| Arrow           | 发射/飞行、拾取、NBT；命中伤害缺口。                            |
| Boat            | 受伤破坏、骑乘、水上运动、NBT。                                 |
| Chicken         | living tick、掉落、声音、NBT；产蛋 timer/RNG 要固定 trace。     |
| Cow             | 奶桶交互、掉落、声音、NBT；AABB/运动缺口。                      |
| Creeper         | 雷击、攻击倒计时、死亡掉落、NBT。                               |
| FallingSand     | tick、携带方块 id NBT；落地放置/掉落缺口。                      |
| Ghast           | 排：生成/AI/掉落/声音仅作导航，不能开放玩法。                   |
| Giant           | 存：直接类没有定位到行为入口；父类可导航，自然生成仍为 GAP。    |
| Minecart        | rail tick、攻击、骑乘、NBT；声音缺口。                          |
| Mob             | 存：生物基类生成、死亡、AI、声音、NBT 候选。                    |
| Monster         | 存：敌对生物基类生成、攻击、受伤、NBT 候选；声音缺口。          |
| Painting        | 存活检查、移除、motive/direction NBT。                          |
| Pig             | 骑乘、掉落、雷击转换。                                          |
| PigZombie       | 生成、激怒、living tick、掉落、NBT。                            |
| PrimedTnt       | fuse tick/NBT；爆炸、方块破坏、声音缺口。                       |
| Sheep           | 剪毛/掉落、声音、颜色/剪毛 NBT。                                |
| Skeleton        | living tick、远程攻击、掉落、声音；直接 save/load 缺口。        |
| Slime           | tick、碰撞伤害、掉落、声音、Size NBT；分裂数量需固定 RNG。      |
| Snowball        | 发射/飞行、碰撞、NBT；命中效果 oracle 缺口。                    |
| Spider          | 攻击、掉落、声音；攀爬/骑手生成缺口。                           |
| Squid           | water/living tick、交互、墨囊、声音、NBT。                      |
| Wolf            | AI、攻击、驯服/坐下交互、声音、NBT。                            |
| Zombie          | daylight/living tick、掉落、声音；直接攻击与 NBT 缺口。         |
| FishHook        | 发射/飞行/tick、NBT；咬钩/拉回/战利品 RNG 缺口。                |
| Egg             | 发射/飞行、碰撞、NBT；孵化 RNG/数量缺口。                       |
| Lightning       | tick、目标影响、NBT；起火范围/传播缺口。                        |
| MinecartChest   | 复用矿车 tick/交互/NBT；库存及 type=1 owner/readback 缺口。     |
| MinecartFurnace | 复用矿车 tick/交互/NBT；fuel/push、type=2 owner/readback 缺口。 |

## 关闭门槛

任何一项不得因注册存在或静态类文件存在而关闭。每个拟纳入的行为至少需：固定输入（含 seed/RNG/tick）、源码候选/独立资料、具体 expected owner state 或事件、正反 fixture、实际执行读回，以及针对保存和视听的适当额外证据。原版 JAR 对照或等价的可授权 oracle 缺失时，维持 `NO-GO`。

## 可复核命令

```sh
node changes/2026-09-16-classic-beta173-parity/build-entity-behavior-candidates.mjs
node --test changes/2026-09-16-classic-beta173-parity/verify-entity-behavior-candidates.test.mjs
node changes/2026-09-16-classic-beta173-parity/verify-preflight.mjs
```
