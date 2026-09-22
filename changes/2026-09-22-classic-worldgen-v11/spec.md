# Classic worldgen v11 与出生体验

状态：Draft，等待阶段 1 准出后进入 RED/实施。该 change 属于 Breaking：改变新世界的基础体素与首次出生位置；v2–v10 世界和已有玩家位置必须保持原样。

## 意图与成功体验

Classic 新世界首次进入时，玩家应看到层次清楚的森林或地表，而非紧贴树干、被低平树冠压住，或在视野中被高密度重复植物填满。目标是更接近经典 Minecraft 的可读出生体验：能立刻看出地面、树干、天空与前进方向，且自然装饰不过度争抢注意力。

## 硬约束

- 基础世界仍由 `seed + generatorVersion` 唯一确定。
- 新实现版本为 v11；v2–v10 的 chunk bytes、存档恢复、worldId 和已有玩家坐标不变。
- 编辑仍只经既有权威路径；worldgen 只提供基础 canonical。
- 不改变 PlayCanvas/WebGL2 后端，不引入 LOD、离线追赶或 World AI。
- 出生搜索必须只读世界、固定遍历/排序、稳定 tie-break；不能为了出生清空地形。

## 当前 RED 与根因

- `reports/2026-09-22-classic-completion/phase1-browser/after-load-timeout.png`：推荐森林的树冠低且连续，树干距离近，草/花/蘑菇密度高。
- `reports/2026-09-22-classic-completion/phase1-browser/final-creative-world.png`：另一 seed 出生为大面积沙地与重复绿色块，缺少清晰层次；是否属于同一 worldgen 候选需多 seed 量化。
- `packages/stdlib/src/world/voxel.ts`：森林树源阈值固定为 `0.968`，四格树干与最多 5×5、四层叶冠；v10 及以前共享该规则。
- `packages/stdlib/src/world/vegetation.ts`：普通森林/平原高草阈值 `0.82`，森林另叠加蘑菇与花。
- `packages/stdlib/src/server/gameplay/safe-spawn.ts`：只按固定环顺序找可站立列，不评分邻近树干、头顶树叶、开阔扇区或短距离通路。

## 技术假设与候选

### A：现状 v10

- 树源与植物阈值不变；树形固定。
- 出生为第一个满足地面/头顶空气的固定候选。

### B：v11 候选

- 仅 `generatorVersion >= 11` 使用更稀疏的森林树源与更高/分层的经典树形。
- 仅 v11 降低森林重复高草密度；花/蘑菇仍保持稀有且可辨。
- 新玩家出生在现有安全条件之上，对固定候选集合计算开阔度、近树距离和短通路评分，按分数与稳定坐标 tie-break 选择。
- 初始视角朝向评分最高的水平开放方向；只作用于新玩家首次进入。若现有权威/协议没有安全落点，位置改善先交付，朝向作为独立可撤销切片。

不采用：修改 v10 阈值；加载后客户端清树/清草；随机重试 seed；为出生点写地形。这些都会破坏确定性、旧世界或权威边界。

## 行为合同

- Given 任一 v2–v10 seed/chunk，When 使用对应版本生成，Then chunk bytes 与变更前完全一致。
- Given 同一 seed/v11/chunk，When 多次、不同加载顺序或同步/Worker 路径生成，Then bytes 完全一致。
- Given 预注册多 seed 样本，When 比较 v10 与 v11，Then v11 的树冠覆盖、近出生树干、装饰占比与开阔通路达到预注册门槛；不以单张好看截图通过。
- Given 新 v11 世界，When 选择出生点，Then 位置可站立、干燥、有足够头部空间，并从固定候选中按稳定评分选出；不产生世界 edit。
- Given v10 存档或已有玩家，When 重开，Then 继续 v10 和原玩家坐标；UI 明确显示版本。

## 实施前测试设计

1. 冻结至少 24 个 seed，覆盖 forest/plains/wet/dry/cold/mountain 与推荐 seed。记录 v10/v11：出生坐标、地表 biome、半径 8/16 内树干数、叶块遮顶比例、植物数、可通行方向数。
2. v10 chunk hash 回归：现有代表 hash 加森林/植被/出生附近 chunk。
3. v11 确定性：同步 `makeChunk`、Classic provider、Worker staged path byte-equivalent。
4. 出生评分反例：近树、低顶、单侧通路、水边、高山、无可用列；固定 tie-break。
5. 存档/选择：`new-current` 创建 v11；`continue-v10` 精确恢复 v10；旧记录不被迁移。
6. 浏览器：agent-browser 隔离会话分别进入推荐 forest 与至少三个不同 biome，保存首帧、转头和短距离移动录像；主线程目视。

## A/B 判定

这是用户已感知的视觉与初始体验问题。A 为 v10，B 为 v11，样本单位为固定 seed。唯一主指标：出生点半径 8 内至少一个连续 6 格可通行水平扇区的 seed 比例。次指标：半径 8 树干数、视线上半部叶块遮挡比例、半径 8 植物数。否决项：任一 v10 byte 回归、v11 非确定、出生不安全/进水/写世界、任一 biome 大面积失去其标志性植被。门槛与样本清单在看 B 结果前写入 `experiments.md`。

## 工作量与预算重估

传统工程量 3–6 PD。Agent 活跃 10–20 小时；关键路径正常 8–14 小时、保守 20 小时，20% buffer 后 24 小时。计划使用 Terra/high 实施与验证、Luna/high 只读审计、阶段末一次 Sol/xhigh 集成审阅。token/credits/API 等价/账户额度分母当前不可得，记 `unknown`；沿用总 Goal 的 4,000,000 token budget，不另建 goal。

## 任务状态

- [ ] 冻结 seed corpus、指标与否决线。
- [ ] 取得 v10 control 与 RED。
- [ ] 实现 v11 树形/密度，保留 v10。
- [ ] 实现版本化出生评分与可选初始朝向。
- [ ] 静态、确定性、存档和 agent-browser 实机验收。
- [ ] 独立审阅、Delivery Snapshot、提交推送。
