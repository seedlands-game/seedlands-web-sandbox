# W01、W11、W16 剩余候选筛选

## 证据状态

以下结论读取正式 `evidence/p0-aa-summary.json` 及相应 `p0-profile-*.json`：固定源码为 `f2454937a4217d88420e1f21ac8ffda4e94847ea`，6 个场景各两次 A/A，单个 `--headless=new` Chrome、1920×1080、Medium、`analysisRevision: 2`。profile 的采样间隔为 1ms；数字是该窗口所有 CDP target 的 sampled active CPU，适合候选排序，不能直接当作 wall-clock 缩短或 FPS 收益。此前 `evidence/p0-headed-interrupted/` 只保留为历史诊断，不参与本文件的数值判断。

| 场景（每次 A/A）      | W01 CPU ms / 活跃 CPU                                    | W11 CPU ms / 活跃 CPU              | W16 CPU ms / 活跃 CPU                | 可用于的结论                                                         |
| --------------------- | -------------------------------------------------------- | ---------------------------------- | ------------------------------------ | -------------------------------------------------------------------- |
| 自然真实输入 30 秒    | 182.736 / 9082.325（2.01%）；152.107 / 7770.100（1.96%） | 360.485（3.97%）；242.723（3.12%） | 低于分辨率                           | W01、W11 都不是零成本，但不是主帧总成本。                            |
| 首次加载              | 234.161 / 6221.919（3.76%）；250.418 / 6228.482（4.02%） | 20.821（0.33%）；18.491（0.30%）   | 低于分辨率                           | W01 是加载路径的稳定可采样项。                                       |
| 流体编辑至可见，30 次 | 233.751 / 3334.244（7.01%）；217.007 / 3423.783（6.34%） | 72.706（2.18%）；81.454（2.38%）   | 低于分辨率                           | 流体全旅程也包含世界/地形重网格工作，不能把 W01 数字写成流体核收益。 |
| 16 角色 AI，30 秒     | 8.283（0.11%）；2.460（0.03%）                           | 732.168（9.92%）；748.517（9.72%） | 低于分辨率                           | W11 的不可迁移协议 gate 已占近半，完整 Wasm 超过三日线。             |
| 宏观地图，30 次       | 低于分辨率                                               | 10.087（1.17%）；11.277（1.17%）   | 433.464（50.20%）；508.208（52.54%） | W16 很热，但完整 macro 数学迁移超过三日线。                          |

Harness 中的 `navigationPlanCount`、`navigationExpandedNodeCount` 和 `perceptionLineOfSightCheckCount` 均为 0；它们属于旧 autonomy/perception telemetry，不能证明当前 `game-logic-worker` 的 `decideLogicIntents()` 没有执行 `nextStep()`。本筛选不依赖它们臆造每搜索次数：以下读取 gzip 原始 V8 call tree，按叶样本计 self、按子树累加 inclusive；inlining 使 `terrainSignature` 没有独立 frame，按其 source-map 的 28–39 行 leaf 样本单列并标明边界。

## W11：最终停止完整 Wasm

### 已定位的真实路径

`decideLogicIntents()` 先构造一次 `LogicTerrain`，然后每个 actor 的 `decideActor()` 再构造一个。现有 `validateTerrainWindowsOnce()` 已用 WeakMap 按同一 `terrainWindows` 数组引用缓存完整验证；同一 observation 的 16 actor 会复用该数组。它**仍会**为每个构造计算 `terrainSignature()`（object ID、`JSON.stringify`、`join('|')`），而每次从 Authority 收到的新 observation 是新数组，第一次构造仍必须走既有完整验证：所有已提供格形成 `"x,y,z"` Set 来检测重叠。这里不建议重复实现“每 observation 验证一次”，该行为已经存在；只说明它是 Wasm 无法消除的协议 gate。

每次 `sample()` 线性 `find` windows，写入 read Map，再按 `x + sizeX * (z + sizeZ * y)` 读 occupancy。`resolve()` 对 start/target 依次尝试高度 `[0,-1,1,-2,2]`；`clearBody()`、`walkable()` 按 body AABB、`floor`、`EPSILON=1e-6` 读取实际 body 格，不能缩为中心点。`nextStep()` 最多扩展 128 节点，邻居严格按 `[+x,-x,+z,-z]` 和 `[0,+1,-1]`，每轮将 `open.values()` 转为数组后按 `(f, g, cellKey.localeCompare)` 排序。目标选择的 LOS 则按 `ceil(distance / 0.25)` 每步调用同一 `sample()`，发生在 `nextStep()` 之前。

### 原始 call tree 拆分（AI 30 秒，a1 / a2，ms）

| 路径                     | self              | inclusive                   | 解释                                                                                                                                                          |
| ------------------------ | ----------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `validateTerrainWindows` | 343.837 / 71.830  | 343.837 / 418.661           | a2 的循环 body 被 V8 内联为 47 行的 `terrainWindow` leaf，故 self 很低而 inclusive 为 418.661。该验证、字段错误和重叠 gate 必须在 TS 协议边界保留。           |
| `terrainSignature`       | 约 7.596 / 3.802  | 不可从已内联 frame 独立求得 | 仅计 source-map 28–39 行 `terrainWindow` leaf；其 object-ID helper 已可能并入父 frame，不能把此数字误报为完整签名成本。每个 `LogicTerrain` 构造仍发生此工作。 |
| `sample`                 | 15.892 / 6.249    | 15.892 / 6.249              | 所有命名 `sample` 子树合计；部分 call site 被内联，故是可见下界。它同时维护 revision read Map 和 missing，不是纯 occupancy byte load。                        |
| `clearBody`              | 147.675 / 129.830 | 147.675 / 129.830           | 已包含被内联的 body 格循环；仍受实际 body AABB、`EPSILON` 和 unknown 提前返回约束。                                                                           |
| `nextStep`               | 184.565 / 132.349 | 367.039 / 317.224           | inclusive 含 neighbors、walkable、resolve、clearBody/sample；self 包含 JS `Map`、数组 materialization、排序和字符串 tie。                                     |
| `lineOfSight`            | 0 / 0             | 1.262 / 0                   | a1 只见一次 1.262ms 子树，a2 低于采样分辨率；不能把 LOS 作为可回收热点。                                                                                      |

验证 gate 的 inclusive 份额是 `343.837 / 732.168 = 46.96%` 与 `418.661 / 748.517 = 55.93%`。即使作对 Wasm 最有利的假设，把 W11 总量减去这个不可迁移 gate，语言内核也最多覆盖 388.331 / 329.856ms/30 秒（53.04% / 44.07%）；这仍包含 `sample` 的 TS read-set/missing 语义和 `nextStep` 的 JS sort/locale tie 维护，因而只是纯数值收益的**宽松上界**，不是可承诺节省。

短 `/tmp` Vite SSR 探针仅作接口下界，不是浏览器性能：以一个真实 32³ window（32,768 byte，y=8 实心地面）测得新 window 的 `LogicTerrain` 构造 3.387ms；一个 observation 中 top-level 加 16 actor 构造、复用同一 array/WeakMap 为 3.233ms；16 actor 的 `nextStep`/LOS 为 0.032/0.068ms；复制完整 occupancy 为 0.0029ms；生成、默认 `localeCompare` 排序并建 128 个 key 的最小 rank 表为 0.029ms。这个 Node/JIT 结果不能外推浏览器，却证明复制本身不是拒绝理由，也证明真实成本在验证和协议语义，不在一个裸 byte copy。

`localeCompare` 不能偷换为 `(x,y,z)` 数值排序：当前 `cellKey` 是默认 locale 的字符串契约，负号、位数和逗号使其结果与数值字典序不同，MoonBit/Wasm 也不能自行猜 Chrome 当前 ICU locale。若向 Wasm 移植完整 A*，TS 必须先为每次搜索所有可能入 open 的 key 建 rank；128 是已扩展节点上限，不是所有候选上限（每个节点最多尝试 12 个高度邻居），上述 128-key probe 只是必需 rank 工作的下界。为维持语义，接口还需按原 window 顺序输入坐标/尺寸/32KiB occupancy/revision、query 与 rank，输出 first step、missing/status、实际 read-window bitset；TS 仍保留 target 决策、intent、read revision gate 和 fallback。

**最终决定：root 可直接将 W11 标为“不迁移完整 Wasm”。** 不是因为代码复杂：完整契约的最低工作拆分为 ABI/arena + revision bitset/fallback（0.75–1 日）、现有 A*/body/LOS/unknown 的逐字段移植（1.5–2 日）、locale rank 覆盖所有候选与跨 locale 对等（1–1.5 日）、负坐标/边界/五种 body/read-set 的回归和 A/B（1–1.5 日），合计 4.25–6 日，超过已批准单项三日维护线。可回收的严格上界仅为 W11 的 44–53%，其中仍混入上述必须留在 TS 的 gate；没有维护 ROI。保留当前 TS；若未来单独批准产品层 TS 导航优化，它必须用原 `localeCompare` 逐结果对等，不能称 Wasm 实验收益。

## W01：最终不迁移

正式 headless 推翻了旧 headed AI 的“W01 实际占比低”判断：它在首次加载为 234.161 / 250.418ms，在 30 次流体可见旅程为 233.751 / 217.007ms，在 30 秒自然输入为 182.736 / 152.107ms。热点一致指向 `riverDescriptor`（55.964–101.494ms）、`valueNoise`（18.590–50.362ms）、并在加载额外出现 `riverDescriptorsNear`（37.135–42.498ms）、`distanceToSegment`（27.713–34.316ms）、`macroAt`、`hydrologyAt` 与 `lakeAt`。这些是 W01 自身的调用证据；加载和流体全旅程仍含其他工作，不能换算成最终用户时间节省。

`macroAt()` 的独立替换接口最少是批量 `(seed, generatorVersion, i32 xz[N]) -> packed macro[N]`，但完整结果含 region、连续地形/气候值、biome、hydrology kind/id/distance/waterLevel/direction/shoreDistance，以及全局 `riverDescriptorCache` 的冷热和 2,048 条清空行为。一次 raw geography 已有六次 `valueNoise`，每次四次 `hash/Math.imul`；`riverDescriptor` 还会搜索八个 `sin/cos` 方向、生成路径、用 `hypot` 采 corridor。只传离散最终地形值不是 W01 的可替换接口；保留 JS 三角函数回调则把每坐标跨 ABI，失去批量内核意义。

数值风险仍是实际停止线：跨 JS/Wasm 的 `sin/cos/hypot` 末位差异可能在最低河床、`round`、湿度/biome 与水岸阈值放大。缓存 key/id 与对象输出还需要额外字典编码、失效测试和回写语义。完整严格对等的最低拆分为 packed macro/hydrology ABI 与 cache 生命周期（1–1.5 日）、hash/value noise/raw geography 的 32-bit/f64 对等（1–1.5 日）、river/lake trig/path/corridor 和 v2/v3 分支（2–2.5 日）、边界/冷热 cache/负坐标测试与 A/B（1–1.5 日），合计 5–7 日。

`valueNoise_batch` 不是可落地的三日子核：它只覆盖 W01 的 18.590–50.362ms leaf，调用方仍要在 TS 中完成 river/lake 路径、对象和 cache，或为每次 raw geography 多次跨 ABI；两种都不能构成 `macroAt` 的独立替换。**最终决定：root 可直接将 W01 标为“不迁移”。** 正式数据证明它可采样，却不足以压过 5–7 日的数学、缓存和对象契约维护；W02/W03/W16 不把它当作前置。

## W16：最终不迁移宏观 Wasm

地图 30 次 headless A/A 的 W16 为 433.464 / 508.208ms，分别为该 profile 活跃 CPU 的 50.20% / 52.54%；任务 p50 为 81.9 / 98.5ms，变异约 20%，因此仍须报告分布而非单个均值。主要热点是 `hydrologyAt`（150.592 / 137.271ms）、`riverDescriptor`（127.126 / 149.907ms）、`macroAt`（32.151 / 87.051ms）、`valueNoise`（57.613 / 59.549ms）和 `lakeAt`（27.190 / 35.986ms）。这足以批准隔离实现与 A/B，不足以把主线程的卸载时间称为 MoonBit 加速。

完整 W16 Wasm 仍须实现同一 `macroAt`/hydrology/river cache 语义，另加 RGBA 色阶、分片取消可观察性、1,048,576 byte 输出和 Worker 消息。最低拆分为完整 W01 数学与 cache（5–7 日）、RGBA/层/颜色逐字节合同（0.5–1 日）、Worker/取消/复制和三组 A/B（1–1.5 日），远超三日线；主线程→Worker 的差值也只是 offload，不能归为语言收益。

`render_macro_pixels(seed, version, layer, xz region, rgba output)` 是唯一完整 ABI，但没有小于三日且仍能独立替换当前完整地图的子核；只迁 `mapColor` 会把主要 `hydrologyAt/riverDescriptor` 仍留在 TS。**最终决定：root 可直接将 W16 标为“不迁移宏观 Wasm”。** 81–98ms 地图任务的热点事实保留；未来若另有产品需求，可独立立项只做 TS General Worker offload，并单独量首片、完整地图、取消和主线程帧，但它不属于本次 Wasm 结论。
