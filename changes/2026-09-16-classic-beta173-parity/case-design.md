# Classic 逐案夹具与 expected 冻结格式（v16 设计，未执行）

本页规定未来如何把[522 项父总账](reference-cases.json)与[618 项有限变体及 8 个开放状态族](variant-cases.json)的事实候选变为可执行黄金测试。当前 1140 行的 `fixture.status=NOT_FIXED`、`executionStatus=NOT_RUN`；以下结构是**提交/审核标准**，示例中的 `null` 不代表原版值。项目治理、性能和原创音画项可用自己的合同或人审替代原版数值 oracle，但必须留证，不能计成原版行为通过。

## 一案的不可缺字段

```json
{
  "caseId": "R-D01",
  "profileId": "classic-b173-singleplayer-v16",
  "referenceCaseSetVersion": 16,
  "referenceStatus": "SOURCE_CANDIDATE_REVIEW",
  "expected": null,
  "evidence": [{ "uri": "固定版本链接", "supports": "候选字段" }],
  "source": [
    {
      "uri": "固定版本链接",
      "methodOrSection": "方法或表格定位",
      "supports": "仅对此字段负责",
      "supportedExpectedPaths": ["/本来源支持的expected叶字段"],
      "evidenceLevel": "待审核来源类别"
    }
  ],
  "sourceConflictResolution": null,
  "unresolved": "待补全的字段与来源冲突",
  "review": { "ownerReview": "PENDING", "confidence": "UNREVIEWED", "reviewerId": null, "reviewedAt": null },
  "fixture": {
    "status": "NOT_FIXED",
    "seed": "classic-b173-acceptance-v1",
    "generatorVersion": "classic-b173-overworld-v1",
    "difficulty": "normal",
    "worldTimeTick": 0,
    "weather": "clear",
    "loadedChunks": null,
    "initialBlocks": null,
    "initialEntities": null,
    "initialInventory": null,
    "initialOwnerStateDeclaration": null,
    "rngAlgorithmAndState": null,
    "inputEventsWithTicks": null,
    "observationTickWindow": null,
    "negativeControl": null,
    "fixtureDigest": null
  },
  "assertions": {
    "expectedOwnerStateByTick": null,
    "expectedEventsInOrder": null,
    "expectedRenderOrAudioEvidence": null,
    "saveResumeCheckpoint": null,
    "probabilityPlanOrNotApplicable": null
  },
  "executionStatus": "NOT_RUN"
}
```

纳入项的 `null` 字段必须先填具体内容，或写 `{ "status": "NOT_APPLICABLE", "reason": "…" }` 并经审核，不能让测试运行时从当前 Seedlands 状态反推 expected。空数组可表示经审核的显式空集合；纳入项 `expected` 必须有具体字段，排除项则由 `exclusion.expectedScopeEffect` 承担范围预期；`unresolved` 必须清空。`fixtureDigest` 按 [校验脚本](verify-design-ready.mjs)的递归键排序 JSON，对 fixture 除自身摘要外的全部字段计算 SHA-256；改动初态、seed、RNG、版本或输入 trace 后必须重算。逻辑 tick=50ms。先固定 case 及来源审核，再在独立实施 change 写 RED 测试。浏览器真实玩家旅程只通过键鼠进行，fixture 写入仅发生在场景开始前；同一 trace 的权威提交、Worker 完成、postrender 消费各有回执。失败要保留首轮证据，重试不能抹掉失败。

## 开工合同与产品执行的字段边界

`REFERENCE_READY` 是开工前的**设计审查状态**，不是 `CONTRACT_PASS`。此时应有规范化的**声明式**初态、输入 tick/动作、参考算法或逐字段预期、负控、来源所支持的确切字段、来源冲突裁决及 reviewer；夹具摘要可由声明文件本身计算，不需要 Seedlands 已经运行。不存在的引擎 API、尚未生成的生产 `dist`、浏览器回执、实际状态摘要、原创资产和人审签署不能伪填为已有。实现 change 才写 RED/GREEN 并取得运行证据。

v16 的结构门禁要求：任何父项/有限变体一旦把 `referenceStatus`、`review.ownerReview` 或 `fixture.status` 之一升为已批准，就同时校验来源定位、冲突裁决、审阅者与时间、初态/输入/观察窗口、负控、断言和声明摘要；不能只改状态字符串。`做/存/核` 项须有逐字段 expected，并让每个 expected 叶字段通过 JSON Pointer 映射到来源。`排` 项**不**需要实现其原版玩法：原 `expected` 可为 `null`，改审 `exclusion.expectedScopeEffect`（禁用且普通生存不可达）、排除理由与来源、依赖闭包（或无依赖理由）、普通生存负例及保留玩法正例；[38 项候选](exclusion-dependency-audit.md)尚未批准。开放状态族一旦升为已固定，必须有非空维度、等价分区、边界/负例、覆盖理由、审阅信息和分区摘要。结构校验不认证审阅者身份、不抓取来源正文，也不能证明分区真正穷尽；这些仍需独立审查。

每个顶层 ID 的 `expected` 至少按下表拆字段；一个字段写“复用 Mxx 的已审核规则”时必须引用**具体 M 子项和参数**，不能只写标题。适用变体在该顶层 ID 下有稳定子例 ID、各自前置状态和结果；不适用项用 `NOT_APPLICABLE + 来源/理由`。`排` 项改用排除依据、依赖闭包和「普通生存不得进入」负控，不要求实现被排除玩法。

| 种类           | `做`/相关 `存` 项必须冻结的预期维度                                                                                                         | 必须能失败的反例                                                       |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| 方块 `B`       | ID/meta/取得；放置与邻块更新；选择/碰撞/AABB/遮挡/光；硬度×工具×时间/耐久；掉落数量/概率；交互与 random/scheduled tick；音画状态；保存/恢复 | 错面或占位失败仍扣物、错工具掉高级矿、拆灯残光、无效 metadata 被当合法 |
| 物品 `I`       | ID/meta/取得链；堆叠/耐久；使用前置与对世界/实体/库存结果；容器余物；图标/手持/声音；保存/恢复                                              | 错目标仍耗物、耗损漏记、额外物品被合成、被排物从生存取得               |
| 实体 `E`       | 注册/派生来源；合法生成/消失；AABB/移动/寻路/目标；交互与伤害/抵抗；掉落与 RNG；动画/声音；NBT/恢复                                         | 暗亮或难度不合法仍刷、穿墙、目标失效继续攻击、死亡重复掉落             |
| 工作台 `R-D/H` | 2×2/3×3 可用性；每格 ID/meta/wildcard/形状/镜像/平移或无形 multiset；输出 ID/meta/数；单次原子消耗与余物                                    | 少/多/错材料或错 meta 却合成、重复取出、蛋糕桶不返还                   |
| 熔炼 `R-S`     | 输入 ID/meta 匹配；燃料种类与燃烧 tick；200 tick 进度/中断/重启；输出 ID/meta/数量及槽容量；燃料与输入消耗；保存/恢复                       | 无燃料、输出满或异种仍产出；存档后复制产物；熔岩桶错误返桶             |
| 机制 `M`       | 触发事件/调用时序、输入坐标/状态/RNG、逐 tick owner 字段或确定性规则、边界与概率计划、观察层和恢复                                          | 每项至少一条反向条件；随机项不能以单次成功当分布通过                   |

视觉、音频、键鼠手感与性能中的 `M24-04/M30/M31/M32/M35` 允许用原创资产规范、固定画面/事件、独立评审和设备/A/A 方案作为**项目** expected；不能把重构 Java 的资源调用误称视觉真值。`M01/M34/M36` 的 expected 是版本/证据/分层门禁自身，非 Minecraft 算法。当前总账的 `PROJECT_CONTRACT_CANDIDATE_REVIEW` 记录这类已编写、尚未审核和固定夹具的项目候选。

## 最小示范：如何继续补，而非宣称已完成

| case      | 已有局部候选及定位                                                                                                                                                                                                     | 还要锁定的输入/输出/反例                                                                                                                                                                                 |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `R-D01`   | [CraftingManager.java](https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/CraftingManager.java) 的 `###` 横排三甘蔗→纸 3           | 2×2 与 3×3 各固定格位、输入数和余物；偏移是否允许；少一根、竖排及错物必须拒绝；库存变化/输出只发生一次。逐条人工核对后才批准 expected。                                                                  |
| `B-035`   | [BlockCloth.java](https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/BlockCloth.java) 的 0–15 色候选                               | 对每个 meta 分开造前置块/背包，固定放置、挖掘、自掉落色值、保存恢复；错误色/越界 meta 负控；16 种原创纹理各有人审证据。                                                                                  |
| `E-Cow`   | [EntityCow.java](https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/EntityCow.java) 的空桶→奶桶、皮革且无牛肉候选                  | 固定成牛位置/生命、玩家手持及死亡原因/RNG，按 tick 断言库存与掉落实体；非空桶、重复交互及“不得掉牛肉”负控；AI/生成/碰撞/音画另案或子例。                                                                 |
| `M18-01`  | [TileEntityFurnace.java](https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/TileEntityFurnace.java) 的 200 tick 烹饪与燃料时长候选 | 明确 tick 0 三槽、各燃料和点火边界；逐 tick 进度/燃料/输出、停火与存档恢复、无燃料/输出已满/重放负控。输入输出仍逐 `R-Sxx` 验证。                                                                        |
| `M21-02`  | [路径说明](https://github.com/OfficialPixelBrush/beta-wiki/blob/8bcc41aee34334c2b916e7b500abe6853b4fd704/entities/pathfinding.md) 提供三维 A* 候选                                                                     | 固定几何、AABB、实体起终点、门/水/熔岩和同分节点顺序，登记每 tick 路点/运动/目标失效后的重算；穿墙、永久卡死负控。仅说“A*”不能作为黄金轨迹。                                                             |
| `M30–M32` | 代码可定位资源事件与渲染路径，不能代替同时期感知参照                                                                                                                                                                   | 取得使用权清晰的同期画面/声音参考，固定视角/状态/光照与可见步骤，登记纹理密度、轮廓、色板、帧节奏、UI 动线、材质/生物/环境声及静默比例，原创资源溯源并由用户指定评审者签署；缺参照保持 `REFERENCE_GAP`。 |

随机生成、掉落和 AI 的单 seed 确定性样本与分布验收分开：预注册种子集、样本量、统计量、容差和拒绝线；未有依据不得临时编造阈值。性能另按[性能执行窗口](../../docs/performance-execution.md)固定机器/驱动做 A/A 与 A/B，当前 `NOT_SET`。所有纳入项必须有正例、能失败的反例、owner 状态和保存/恢复或不适用理由；人审与自动化不可互代。
