# Seedlands AoS / SoA、导航、物理与碰撞传输只读审计

## 审计边界与可复现性

- 审计时间：2026-09-06（Asia/Shanghai）。
- 代码目录：`/Users/chlorinec/.codex/worktrees/moonbit-wasm-20260906/voxel-sandbox-foundation`。
- 审计时 `HEAD`：`36a0022657d2c14053f1575814f9fd148df0d0c6`。工作树另有根负责人正在进行的规范与测试改动，但本文涉及的 `src/server/authority`、`src/server/logic`、`src/server/gameplay/entity-store.ts`、`src/server/simulation`、`src/physics`、所列 `src/client` 和 Worker 文件，相对 P0 冻结提交 `f2454937a4217d88420e1f21ac8ffda4e94847ea` 无差异。因此可以用冻结产物的 P0 profile 辅助判断热点，但不能把一次 profile 当成因果证明。
- 方法：静态调用链审计，加一组不启动浏览器的 Vite SSR / Node V8 序列化尺寸探针。探针源码归档在 `experiments/aos-soa-size-probe.mjs`、`experiments/entity-size-probe.mjs` 与 `experiments/collision-delta-size-probe.mjs`，本次已经产生的原始输出归档在 `evidence/*-raw.json`；本次归档没有重新执行探针。探针中的 `v8.serialize(...).byteLength` 是可复现的对象图尺寸代理，不是 Chrome structured clone 的 wire bytes，也不是 V8 heap 分配量。TypedArray 的 `byteLength` 与 `.slice()` 拷贝量则是精确值。

## 结论

“AoS 导致导航/物理反复复制”只对一部分链路成立，不能概括全部成本：

1. **权威物理确实在每个 60 Hz tick 反复深拷贝 AoS 实体。** `EntityStore.query()` 对每个实体执行 `clone()`；物理写回时 `update()` 经 `move()` 产生一次被丢弃的 clone，随后又返回一次被丢弃的 clone。在实体数量稳定、本 tick 没有增删实体且没有 recovery queue 额外读取的普通浏览器 Authority tick 中，代码路径为 `4N + 2P` 次 `GameplayEntity` clone（`N` 为该 tick 的全部实体数，`P` 为存活玩家候选数），还未计入向量、身体、碰撞箱和接触对象。发生拾取/despawn、外部 spawn/despawn 或 recovery 时必须按各次查询的实际集合另计，不能套用同一个 `N`。这个判断属实。
2. **权威物理本身没有因为 AoS 跨 Worker 来回复制。** `stepBody()` 与 `VoxelCollisionWorld` 都在 Authority Worker 内同步执行。其另一项问题是：底层 Chunk 已是 `Uint16Array + Uint8Array`，但每次格子读取会包装成对象，再为每次碰撞查询重新构造 `Collider[]` / `FluidVolume[]`。这是重复装箱与重建，不是 structured clone 或 TypedArray 全量复制。
3. **浏览器 Logic 观察存在两跳 structured clone。** Authority Worker → main → Logic Worker；返回 intent 也走 Logic Worker → main → Authority Worker。occupancy 的 `Uint8Array` 两跳都使用 transfer list，不复制底层 buffer；但 entities、actors、POI、action 与 intent 的 AoS 对象图每跳都会 structured clone。
4. **导航搜索没有跨线程反复深拷贝搜索节点。** 搜索发生在 Logic Worker 内；主要成本是每次观察对最多 32,768 格构造字符串 `Set` 做校验、每次采样线性 `.find()` terrain window、最多 128 次扩展中反复 `[...open.values()].sort()`、字符串坐标 key 和 Node 小对象。这里应称 AoS/字符串分配与算法数据结构成本。
5. **数据平面已有大量 SoA / packed TypedArray，但 SoA 不等于零拷贝。** Chunk、fluid、occupancy、mesh、mutation buffer 已经是 TypedArray。`.slice()` 必然复制；没有 transfer list 的 `postMessage` 会复制 TypedArray buffer；有 transfer list 只是转移所有权，仍未消除上游快照构造和接收端为保留多份所有权所做的复制。

## 1. 权威物理：精确调用链与 clone 次数

### 1.1 每个 physics tick

调用链：

`authority-worker.ts:99-116 tick()` → `AuthorityRuntime.wake()` → `AuthoritySession.wake():141-167` → `stepPhysics():215-327`。

正常的 `AuthorityRuntime` 注入了 `queryPickupTargets`。在实体集合于 tick 内稳定、没有 spawn/despawn 且 recovery queue 没有额外读取的普通 tick 中有：

| 步骤           | 源码                                                                                      |                    clone 数量 | 说明                                                                                                            |
| -------------- | ----------------------------------------------------------------------------------------- | ----------------------------: | --------------------------------------------------------------------------------------------------------------- |
| 读取物理实体   | `authority-session.ts:219` → `GameServer.queryEntities()` → `EntityStore.query():157-159` |                           `N` | `map(clone)`；每个 clone 复制对象、position、可选 velocity/stack                                                |
| 读取吸引目标   | `authority-session.ts:220` → `authority-runtime.ts:126-130`                               |                           `P` | `queryEntities({type:'player'})` 先 clone 玩家，随后又构造 target 与 position                                   |
| 写回每个实体   | `authority-session.ts:314-321` → `EntityStore.update():107-125`                           |                          `2N` | `update()` 调 `move()`；`move():128-135` 返回的 clone 被忽略，然后 `update()` 再返回 clone，也被 Authority 忽略 |
| 拾取后状态查询 | `processPickups():350-388`                                                                |                           `N` | 再次 `queryEntities().sort()`                                                                                   |
| 拾取后目标查询 | `processPickups():353`                                                                    |                           `P` | 再次完整玩家 query + target 映射，以使用更新后位置                                                              |
| **合计**       |                                                                                           | **`4N + 2P` / 普通稳定 tick** | 不含 recovery queue 的 `getEntity()` clone；tick 内增删实体时各步骤的 `N/P` 不再相同                            |

60 Hz 下仅这条物理链为 **`240N + 120P` entity clone/s**。此外，在满频且 Logic 连续请求时：

- 20 Hz gameplay view：`AuthorityRuntime.view():428-437` 再 `queryEntities()`，即 `20N/s`；
- 最多 20 Hz Logic observation：`buildLogicObservation():460-470` 再 `queryEntities()`，即 `20N/s`；
- 最多 20 Hz intent 接收校验：`receiveLogicIntentBatch():251-288` 再 `queryEntities()`，即 `20N/s`。

因此浏览器完整稳定态上界为 **`300N + 120P` 次显式 `GameplayEntity` clone/s**。这是 clone 调用数，不等于分配对象数；一个 clone 还会生成 1 个实体对象、1 个 position 数组、可选 velocity 数组与 stack 对象。写回还额外创建 canonical position/velocity 数组，身体求解另建 `BodyState`、`Contact` 等对象。

为展示数量级，探针采用“1 玩家、3 actor、1 world-item”的初始生态形状，即 `N=5,P=1`：若该集合在普通 tick 内稳定，物理链为 22 clone/tick、1,320 clone/s；加满频 view/Logic/intent 校验为最多 1,620 clone/s。这里是固定构造示例，不代表每个真实世界或 P0 场景都恰有 5 个实体。

### 1.2 纯逻辑尺寸探针

探针用真实 `buildLogicObservation()`，实体样式与协议一致；下列 entity proxy 是对一份实体集合逐个 `v8.serialize` 后求和。单体示例：player 108 bytes、actor 194 bytes、world-item 176 bytes。

| 场景                                      |   N | entity 集合 proxy | 物理 `4N+2P` 对应 proxy/tick |  60 Hz proxy/s |
| ----------------------------------------- | --: | ----------------: | ---------------------------: | -------------: |
| 初始生态形状（3 actor + 1 item + player） |   5 |             864 B |                      3,672 B |    220,320 B/s |
| 64 actor + 64 item + player               | 129 |          23,854 B |                     95,632 B |  5,737,920 B/s |
| 512 actor + player                        | 513 |         100,017 B |                    400,284 B | 24,017,040 B/s |

这些数字只用于显示增长阶数。实际 heap 分配量可能更大或更小，并会因 hidden class、字符串复用与 GC 改变；本次没有采集 heap allocation。它们没有计入排序数组、Map/Set、位置写回、身体和碰撞对象，所以不能当作总内存带宽，也不能据此推断实际 heap 大小。

### 1.3 碰撞读取不是全量复制，但反复对象化

`stepBody():250-281` 对每个身体每 tick 调用：

- `querySolids`：接触探测前 1 次、sweep 0–4 次、接触探测后 1 次、sensor 1 次，即 **3–7 次/body/tick**；
- `sampleFluid`：初始与最终各 1 次，即 **2 次/body/tick**；湿格还会读取上方一格。

每次 `VoxelCollisionWorld.querySolids():42-77` 都新建 `Collider[]`、字符串 id 和嵌套 AABB/Vec3；`sampleFluid():79-105` 同样新建 `FluidVolume[]`。每个格子都调用 `peekLoadedVoxel():5-18`，它虽然从 Chunk 的 `Uint16Array` / `Uint8Array` 直接取值，却返回新的 `{voxel, chunkKey, revision, fluid?}` 对象。`VoxelCollisionWorld` 每 tick 只缓存 revision 与 touched chunk key，不缓存格子或 collider。因此同一身体前后接触、sweep、sensor 很可能重复读同一格并重建对象。

这条链没有 `postMessage`、`structuredClone`、TypedArray `.slice()`；不能说“物理数组因 AoS 跨线程反复复制”。可以准确地说：**EntityStore 的 AoS 快照被反复深拷贝，碰撞格数据则从 SoA backing 被反复装箱成 AoS 临时对象。**

## 2. Logic 观察与导航

### 2.1 每个已交付 observation 的复制链

Logic 由 `game.ts:197` 首次请求，之后 `browser-worker-session.ts:51-55` 在每批 intent 返回后再请求；Authority 只在 gameplay lane 到期且请求标志为 true 时发布，默认最多 20 Hz；`BrowserLogicClient` 还限制一个 in-flight 并只保留一个 latest pending。

Authority 内构建：

1. `AuthorityRuntime.buildLogicObservation():460-470`：`queryEntities()` 对全部 entity clone 1 次；`simulationSnapshot()` 对 actor、POI、action 各 clone 1 次。
2. `logic-observation-builder.ts:103-164`：
   - entity 再投影为新的 `LogicEntity`，position/velocity 各建数组；
   - actor state 再显式 `structuredClone(actor)`；
   - POI snapshot 再显式 `structuredClone`；
   - occupancy 新建并逐格填充 `Uint8Array`；上限 32,768 cells。
3. `authority-worker.ts:153-162`：Authority Worker → main，AoS 外壳 structured clone；所有 occupancy buffer 使用 transfer list。
4. `browser-logic-client.ts:79-86`：main → Logic Worker，再 structured clone AoS 外壳；同一批已到 main 的 occupancy buffer再次 transfer。
5. `game-logic-worker.ts:50-56` 返回 AoS `LogicIntentBatch`，没有 transfer；Logic Worker → main structured clone 1 次。
6. `browser-worker-session.ts:51-55` → `BrowserAuthorityClient.sendLogicIntents():357-364`：main → Authority Worker 再 structured clone 1 次。

因此每个已交付 observation：

- entity 数据经历 query clone、LogicEntity 投影、两次消息 clone；
- actor/POI 至少经历 simulation snapshot clone、builder 显式 clone、两次消息 clone；
- action snapshot 先 clone，选出的 active action 随两个消息 hop clone；
- intent 对象图有两个消息 hop；
- occupancy buffer 只创建/填充一次，两个 hop 都转移所有权，**没有发现 buffer 字节复制**。但它不是端到端零拷贝，因为它仍需从 canonical world 逐格读取并填充；两跳还会 clone window wrapper、origin/size 数组等元数据。

### 2.2 observation 探针尺寸代理

| 构造场景                 | entity/actor/POI | terrain windows | occupancy 精确 bytes | observation V8 proxy | 去 terrain 后 proxy | intent batch proxy |
| ------------------------ | ---------------- | --------------: | -------------------: | -------------------: | ------------------: | -----------------: |
| 初始生态形状             | 5 / 3 / 5        |               1 |                1,386 |                3,645 |               2,105 |                757 |
| 中型集中                 | 33 / 16 / 8      |               1 |                3,360 |               14,517 |              10,532 |              3,584 |
| 64 actor + 64 item，集中 | 129 / 64 / 16    |               1 |                7,168 |               49,411 |              40,100 |             14,048 |
| 同上，分散跨 Chunk       | 129 / 64 / 16    |              19 |               31,948 |               75,701 |              40,548 |             14,048 |
| actor 上限形状，集中     | 513 / 512 / 64   |               1 |                7,168 |              221,575 |             205,481 |            112,126 |

AoS 外壳经过两跳，所以“去 terrain 后 proxy”可近似看成每批发生两次同阶序列化工作；不能简单把 occupancy 也乘二当复制字节，因为它是 transfer。反向 intent proxy 同样经历两跳。

### 2.3 导航的实际热点

`decideLogicIntents():262-274` 先构造一次 `LogicTerrain`，随后每个 actor 又构造一个；同一 Worker、同一 observation 数组身份下，WeakMap 可避免同批内重复全量校验。但新的跨线程 observation 获得新的对象身份，不能跨批命中。

- `validateTerrainWindows():43-74` 对最多 32,768 个 cell 生成 `${x},${y},${z}` 并加入 `Set<string>`，用来检查 window overlap。
- `LogicTerrain.sample():101-120` 每格用 `terrainWindows.find(...)` 线性找窗口。分散场景可达约 19 个窗口，协议只给总 cell 上限，没有小常数窗口上限。
- `nextStep():140-189` 的节点是 `{x,y,z,g,f,parent:string}` AoS；最多 128 个扩展。每轮 `[...open.values()].sort()` 复制引用数组并全排序，tie-break 还重建坐标字符串。
- `chooseGoal()` 对 entity AoS 多次 `filter/find`；`nearest()` 用 `[...entities].sort()`，复制的是引用数组，不是 entity 深拷贝。

冻结 P0 的 16 角色 AI 两个 30 秒样本与静态判断一致：W11 为主要 Logic 成本，`validateTerrainWindows`/逐 window 校验、`nextStep`、`clearBody` 均进入热点；Authority 侧 `createTerrainWindow`/`buildLogicObservation`、`EntityStore.clone`、native `encode` 与 GC 也被采到。该证据说明优化值得做，但 A/A 单对不足以给收益置信区间。

## 3. 碰撞镜像、mesh、fluid 与 sparse delta 的真实复制

常量：`CHUNK_SIZE=32`，每 Chunk canonical 为 `32^3 * 2 = 65,536 B`，fluid 为 `32^3 = 32,768 B`，合计 **98,304 B/Chunk**。

### 3.1 collision baseline request

`AuthorityCollisionBaselineClient.synchronize()` → request → `authority-worker.ts:237-251` → `readLoadedCollisionBaseline():4-26`：

1. Authority 从 canonical source `.slice()` voxel 与 fluid：98,304 B；
2. Authority → main 使用 transfer list：不复制 buffer；
3. main 在 `authority-collision-baseline-client.ts:77-78` 再 `.slice()`：98,304 B。

每次 available baseline **精确复制 196,608 B**。第 2 份并非所有权所必需：到达 main 的两个 buffer 已归 main 独占，当前没有再转移，能直接用 typed view 放入镜像，省 98,304 B。

### 3.2 generated canonical 被 Authority 接纳并进入镜像

`BrowserAuthorityClient.acceptWorkerCanonical()` → `acceptAuthorityCollisionBaseline():147-179`：

- `new Uint16Array(result.canonical).slice()`：65,536 B；
- 调 `accept(canonical.slice())` 前无条件再复制：65,536 B；即便 `matchesPreparedVisibilityCanonical()` 直接返回 true，这份参数仍已求值和复制；
- `preparedFluid.slice()` 或 `legacyFluid(canonical)`：32,768 B。

合计 **163,840 B** typed data 构造。若需送 Authority，第二份 canonical 用 transfer；若 prepared canonical 已匹配则不送。接收的 `result.canonical` 本已由 main 独占，可直接作为本地镜像；只有确需 Authority 接纳时再复制一份。按当前代码路径计算，该方案预期少一次 65,536 B 显式复制；这是静态字节账，不是已实现或实测收益。

### 3.3 worker-first mesh preparation

`prepareServerWorkerMeshInput():70-87` → Authority transfer → `acceptAuthorityMeshPreparation():10-44` → `BrowserAuthorityClient.prepareWorkerInput():247-265` → `createWorkerFirstDispatch():112-167`：

- Authority 对 materialized center 和每个 materialized overlay 各复制 98,304 B；随后 transfer 给 main；
- main 为 collision mirror 再复制 center 98,304 B；
- 每次 dispatch 从 preparation cache 对 center 与每个 overlay 再 `.slice()` 98,304 B，随后 transfer 给 compute worker。

若有 center 和 `O` 个 materialized overlay，每任务显式 TypedArray copy 为：

`98,304*(1+O) + 98,304 + 98,304*(1+O) = 294,912 + 196,608*O bytes`。

- `O=0`：294,912 B，恰好等于 P0 保存场景计数的每 task 输入量；
- 理论 `O=26`：5,406,720 B/task；实际只包含已 materialized 邻居。

这些复制主要由跨 Worker 所有权与持久 preparation cache 造成，不是因为数据是 AoS；数据已是 dense typed arrays。

### 3.4 fluid

`FluidTransactionAuthority.requestFluidWork():332-358` 对每个输入 Chunk `cloneChunk()`，98,304 B；Authority → main 的 `fluid-work` 没有 transfer list，因为 Authority lease 要保留快照用于候选验证，所以 structured clone 再复制 98,304 B/Chunk；main → fluid Worker 使用 transfer，无 buffer copy；Worker 内 `computeFluidCandidate():101-105` 又 `cloneChunk()` 以便原地求解，再复制 98,304 B/Chunk。

因此 4/5 Chunk 任务在进入求解前分别复制 **1,179,648 / 1,474,560 B**。冻结 P0 实测 submitted bytes 为约 463–468 KB/task，正好处于 4 Chunk 的 393,216 B 与 5 Chunk 的 491,520 B 之间；该计数只记一次任务输入体积，不是三轮 copy 总量。

Worker 收到的 buffer 已是独占，Authority 仍持有自己的 lease snapshot，因此 compute 可在收到的数组上直接变换并用单独的 write set 产出，不必再 clone 全部 Chunk。按当前代码路径计算，这个方案预期少一次 **98,304 B/Chunk/task** 显式复制，同时保持 Authority 校验副本；尚未实现，也没有实测端到端收益。

### 3.5 sparse collision delta

世界 mutation 输入已经是 `WorldMutationBuffer` SoA：`Int32 x/y/z + Uint16 value = 14 B/mutation`。commit 在 `world-transaction-commit.ts:262-271/384-396` 转成 AoS `{index,voxel,fluid}`；Authority → main structured clone 后，`applyAuthorityCollisionCommit():201-238` 直接原地更新镜像，没有全 Chunk copy。

Node V8 proxy：1/8/64/192/1024/32768 cell 的完整单 Chunk commit 分别为 233/443/2,123/6,221/32,653/1,065,103 B。若 packed 为 `Uint32 index + Uint16 voxel + Uint8 fluid`，纯 payload 分别为 7/56/448/1,344/7,168/229,376 B。单格编辑的绝对开销很小，盲目一律改 SoA 会增加 envelope 与适配复杂度；适合做按 cell 数阈值切换的 hybrid protocol。

## 4. 已是 SoA 的部分，以及为什么不能宣称零拷贝

已是 packed/dense 数据平面：

- canonical voxel：`Uint16Array`；fluid sidecar：`Uint8Array`；
- Logic terrain occupancy：`Uint8Array`；
- mesh position/normal/uv/color/index 等 TypedArray；
- `WorldMutationBuffer`：分离的 `Int32Array coordinates` 与 `Uint16Array values`；
- Wasm linear memory 中的各批量 layout。

仍不能宣称零拷贝：

- `.slice()` 总是新分配并复制；`new TypedArray(existingBuffer)` 只建 view，`new TypedArray(existingTypedArray)` 会复制，必须逐点区分；
- `postMessage(message)` 未给 transfer list 时，structured clone 会复制 TypedArray buffer；
- `postMessage(message, transfers)` 不复制该 buffer，但发送方 buffer 会 detach；如发送方必须保留快照，就要在此前产生第二份所有权；
- main 作为 Authority 与 Logic/Compute 的中继时，AoS wrapper 每跳仍会 structured clone；
- SoA 只改变 layout；从 canonical 逐格填 occupancy、构建 halo、验证 revision、为写入保留隔离副本等工作不会自动消失。

## 5. 修复方案与优先顺序

### P0：先消除已证实、低风险的冗余复制

以下减少量均为根据当前 `.slice()` 与 buffer 长度计算的预期显式复制减少量，不表示已经修复，也不是实测 CPU、GC 或内存收益。

1. **拆开 EntityStore 的公开 copy contract 与 Authority 内部批量端口。** 保留 `get/query/update` 对外返回 clone 的安全语义；新增只在 server/authority 边界可用的 `readPhysicsFrame()` / `commitPhysicsFrame()`：一次按稳定 id 排序把 id/type/config index 与 position/velocity 打包到 TypedArray，求解结束批量写回且不返回 entity clone。
2. **先做一个小的 TS 控制组。** 把 `move()` 的内部 mutation 抽成不 clone 的私有函数，`update()` 不再制造被忽略的第一次 clone；Authority 增加 void/batch update，避免第二次被忽略的返回 clone。把 tick 初次/末次实体状态和 pickup target 都放入同一 physics frame，`processPickups` 使用求解后的 frame，保持“拾取用更新后位置”的现有语义。预期将 `4N+2P` clone/tick 降为一次有界 pack 与零返回 clone，而不是泄漏 EntityStore 内部引用。
3. **直接接管已转移的 collision baseline buffer。** baseline request 到 main 后用 `new Uint16Array(payload.canonical)` / `new Uint8Array(payload.fluid)` 入镜像，不再 `.slice()`；预期每 Chunk 少 98,304 B 显式复制。
4. **generated canonical 只保留必要的两份所有权。** main 将收到的 result view 直接作为 collision mirror；仅在确需 Authority 接纳时复制一份并 transfer。prepared-match 快路径不再构造第二份 canonical，预期每次少 65,536 B 显式复制。
5. **fluid Worker 原地使用收到的 task-owned数组。** 保留 Authority lease snapshot，删除 Worker 内 `cloneChunk()` 全量副本，预期每 Chunk/task 少 98,304 B 显式复制。

### P1：Logic transport 与导航 TS 结构控制组

1. 定义 `LogicObservationV2`：小型控制头仍可 AoS；热数值字段打包为 entity id table + bodyKind/flags/revision arrays + `Float64Array position/velocity`。terrain occupancy 保持 `Uint8Array`。intent 同样提供 packed 数值批次；动作 union 可保留稀疏控制对象。
2. 通过 main 创建并转交 `MessageChannel`，让 Authority Worker 与 Logic Worker 直连数据端口；main 只保留生命周期、错误与诊断控制端口。这样 observation 与 intent 各从两次 structured clone 降为一次。若暂不直连，也要让 V2 typed buffers 在 main 仅 relay transfer，避免重新 materialize。
3. `LogicTerrain` 构造时按 Chunk key 建 `Map`，`sample()` O(1) 命中当前每 Chunk 唯一 window；window overlap 校验改为有界 window pair 的整数区间相交检查，避免每批最多 32,768 个字符串和 Set entry。
4. 搜索节点改为 numeric cell id / parent index 与预分配数组，open set 用保持当前 `f,g,lexicographic cell` tie-break 的稳定 heap，或先用无分配线性最小扫描。作为 **TS 等算法 A′ 控制组** 单独测，不把算法结构收益记到 Rust/Wasm。
5. `decideLogicIntents` 预建 `entityById` / 当前 actionByActor，减少每 actor 的 `.find()`；缓存 `actionFor()` 结果，避免 `logic-decision.ts:258` 同一函数调用两次。

### P2：物理 batch kernel seam，而不是逐 body 跨 ABI

1. 以一个 tick 为单位准备 packed `PhysicsFrame`：稳定 entity index、position/velocity、body config index、input、flags；Rust/Wasm 一次处理整个 batch并返回 output arrays，同 tick 完整提交。不能逐 body 调 JS world callback。
2. 近场碰撞数据应一次准备成 packed cell/box window，或让 kernel 直接按 Chunk typed arrays + origin/revision 读；先用 W08 profile 判断“重复 `peekLoadedVoxel` 装箱 + collider 构建”占比。不要为了 SoA 把低密度 query 变成更大的无条件窗口复制。
3. 两两角色推离当前是 `O(C²)` 扫描。角色规模增长时先加 TS spatial broadphase 控制组，再评估 kernel；算法复杂度收益不能记为语言收益。

### P2：大 sparse delta 的 hybrid packing

小编辑继续 AoS；超过预注册阈值时使用可 transfer 的 indices/voxels/fluids 三个 TypedArray。Authority 发布后不再需要这份 delta，可直接 transfer；main 原地应用。阈值必须由 1/8/64/192 等真实分布 A/B 决定。

## 6. 建议的验收与观测

1. 正确性：固定 seed、实体 id 排序、相同输入轨迹，逐 tick 比对 position/velocity/grounded/contact、拾取结果、intent、read revision、terrain unknown 行为；Rust/TS 都需同一 corpus。
2. clone 指标：在受控 profiler build 记录 `entityCloneCount`、`physicsFrameBytes`、`logicControlBytes`、`transferredBytes`、`copiedBytes`，区分 `.slice`、structured clone、transfer；禁止把 `submittedBytes` 直接叫 copy bytes。
3. 性能：以 run 为样本做 A（现状）/A′（TS 结构优化）/B（packed Rust/Wasm）平衡顺序；报告 Authority/Logic 各自 active CPU、GC、p95 physics cost、frame p95 与内存峰值。现有 P0 每场景只有一对 A/A，只可定位，不能形成收益置信区间。
4. 回归门禁：baseline buffer 在 transfer 后必须验证发送方 detach 与接收方所有权；错误 revision、过期 lease、Logic pending coalesce、未知 Chunk fail-closed 都要保留。

最终判断：**需要修，但不是“把所有对象改成 SoA”这一件事。最高确定性的浪费是 EntityStore 热路径 clone、Logic 两跳 AoS structured clone、terrain 校验/搜索分配，以及 baseline/generated/fluid 中可明确删除的一轮 TypedArray copy。权威物理 solver 当前没有跨 Worker AoS 复制；它更适合通过 tick 级 packed frame 与碰撞窗口进入未来 batch kernel。**
