# MoonBit 内核成本审计

状态：只读审计；不含性能结果，不改变已批准合同。工时是实现、对等、回退和维护测试的估计，不是日历承诺。

## 统一 ABI 成本

Wasm 线性内存不能直接借用任意宿主 `ArrayBuffer`。因此输入必须写入 Wasm Memory，输出必须复制至宿主可持有或可 transfer 的 TypedArray；对象、字符串、Map、回调和权威状态不能进入 ABI。下表的字节数计入复制，不删除现有共同 Worker 消息成本。

| 编号 | 最小独立接口与数据边界                                                                                          | 数值语义/维护风险                                                                 | 估计与结论                                                                      |
| ---- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| W01  | `macro_batch(seed, version, i32 xz[N]) -> packed macro[N]`；TS 保留缓存和编排。                                 | `Math.imul`、无符号位、负坐标、f64/三角函数、河流 descriptor。                    | 4–6 日；先通过数学对等，否则不派生 W02/W03/W16。                                |
| W02  | `make_chunk(seed,cx,cy,cz,version, edits) -> u16[32768]`。                                                      | W01、负坐标 overlay、edit 原数组覆盖次序。                                        | 3–5 日（不含 W01）；依赖 W01 已对等。                                           |
| W03  | `fill_halo(canonical, overlays, fluid) -> u16 halo[39304], u8 fluidHalo[39304], u32 revision`。                 | halo 外回退 W01、FNV `Math.imul` 次序、水默认 `0x88`。                            | 2–4 日；输出固定 117,912 B，宜同 W04 复用工作区。                               |
| W04  | `mesh_solid(u16 halo, params) -> packed mesh streams`。                                                         | greedy mask/AO/quad 对角线/材质与索引逐数组一致；输出大小无小上界，需容量状态码。 | 4–7 日；强候选，但超过普通 3 日维护阈值，先用容量协议降险。                     |
| W05  | `mesh_water_and_models(halo, fluidHalo, data) -> streams`。                                                     | 水位、台阶面、透明类别、灯笼模型、输出顺序。                                      | 2–4 日；没有自然独立边界，应作 W04 内分支计时，避免重复维护。                   |
| W06  | `batch_and_compact(stream descriptors) -> compact streams`。                                                    | 类别固定顺序、颜色 material 改写、float16 特殊值、u16/u32 index 阈值。            | 2–3 日；可独立，先量全部输入/输出回拷。                                         |
| W07  | `fluid_candidate(packed chunks, frontier, cleanup) -> packed candidate`；TS 保留 lease/read-set/提交。          | 未知块 `needsRescan`、有序 write/frontier、源水位 bit、负坐标。                   | 3–5 日；每 Chunk 输入至少 `u16[32768]+u8[32768]=98,304 B`，先做 TS 等布局控制。 |
| W08  | 见下节。                                                                                                        | 见下节。                                                                          | 当前不进首批实现；P0 后再判。                                                   |
| W10  | `occupancy_from_voxels(u16[C]) -> u8[C]`；TS 先验证窗口。                                                       | 见 W10/W11 节。                                                                   | 1.5–2.5 日；首批推荐。                                                          |
| W11  | `terrain_query_batch(windows, occupancy, queries) -> results + read-window bitset`；TS 仍选目标/提交。          | 见 W10/W11 节。                                                                   | 2.5–4 日；P0 热点与等算法 TS 对照前不实施。                                     |
| W14  | `encode/decode(codec, u16[32768], procedural?, fluid?) -> bytes/status`。                                       | 三 codec 选择、little-endian、varint 损坏、fluid CRC。                            | 3–4.5 日；仅迁连续纯 codec。                                                    |
| W15  | `crc32(bytes) -> u32`。                                                                                         | `>>>` 无符号与 voxel little-endian 顺序。                                         | 0.5–1.5 日；可做工具链烟雾核，64 KiB 以下很可能被复制抵消。                     |
| W16  | `render_macro_pixels(seed, layer, dimensions) -> rgba[4N]`；TS 保留 Canvas/分片/cancel，并加 TS Worker 控制组。 | W01、颜色 round/clamp、不可中断同步调用。                                         | 3–5 日；512² 输出即 1,048,576 B，不能把 offload 算作语言收益。                  |

## W08：实际调用与停止结论

`AuthoritySession.stepPhysics()` 每个 60 Hz tick 先按实体 ID 排序，逐个执行目标选择和 `stepBody()`；随后角色两两按顺序 `separateBodies()`，后续 pair 观察前一个 pair 已更新的位置，最后才写回。`stepBody()` 包含初始接触、初始流体、最多四轮 sweep、最终接触、sensor、最终流体；掉落物目标还可触发最多八个可达性 sweep。因此它不是可并行的 `stepBody[]` map。

`VoxelCollisionWorld` 的每次查询逐格读取 loaded voxel、生成未知块 blocker、生成方块或灯笼 AABB、读取上方水位决定 surface，并记录 revision/active keys。JS 回调会随 sweep 放大跨界；只传已生成 collider/fluid arrays 又保留了关键 TS 查询、对象创建和扫描成本。

真正独立的同步接口至少需要：有序 body/input/config-kind records、有序 pickup targets/cursors、不可变 packed loaded-chunk voxel+fluid+revision 快照、未知块策略；输出 next body、grounded、有序 contact/sensor 的 collider index、selected targets、touched revisions/keys 和 requested unknown keys。TS 再映射稳定 contact ID、做 pickup 事务与最终提交。每 collider 至少 6 f64 AABB（48 B）加位/索引；每 fluid 至少 AABB、流速、surface（约80 B）。当前没有唯一 collider/fluid/active chunk 的固定上限，P0 前不能证明单实例低于 32 MiB。

逐 tick 对等还涵盖 `COLLISION_EPSILON=1e-6`、f64、`Math.hypot`、collider 字符串排序、命中 tie-break、contact point、sensor 排序、unknown 阻挡，以及 `LocalPlayerPrediction` 回放。只移 Authority 会形成两份浮点物理；同时移预测又扩大加载、回退、校正和测试范围。

完整实现估 6.5–10 日：ABI/峰值保护 1–2 日，体素/流体纯快照重演 2–3 日，有序 bodies/pickup/pair separation 1–2 日，预测复用/逐 tick 对等 1–2 日，另加故障前整批不提交验证。这超过 `ab-plan.md` 的 W08 五日停止线和普通单项三日维护预算，原因是可核对的调用/数据边界，并非主观地把物理排除。

只有 P0 同时证明以下事实才重开 W08：纯数值 CPU 在扣除 `VoxelCollisionWorld` 查询/对象构造后仍覆盖完整 ABI 两倍成本；packed snapshot、collider、fluid 和输出峰值小于 32 MiB；等布局 TS 控制组仍不过价值门槛；整批同步调用可证明 trap 前无 Authority 写入并可从同 revision 快照重跑 TS。

## W10/W11：真实路径与建议接口

W10 在 Authority 的 20 Hz gameplay tick 发生：`terrainBounds()` 按 chunk 合并 actor 周围 `x/z ±8, y -2..+4`，`createTerrainWindow()` 逐格读 loaded voxel；任意未知格、chunk key 不符或 revision 不一致便省略整窗。成功的 `Uint8Array occupancy` 才由 `BrowserLogicClient` transfer 至 Logic Worker。最小 W10 核只能分类已验证的 u16 staging；不得移动 unknown/revision gate。

占据索引严格为 `x + sizeX * (z + sizeZ * y)`；predicate 是 `collisionBoxesForVoxel(voxel).length > 0`，灯笼也占据。`C<=32768` 时，Wasm 输入 copy 是 `2C`，输出复制到可 transfer 新 buffer 是 `C`，满窗口必须计 98,304 B；原路径只分配并 transfer `C`。这使 W10 保持纯整数、单输出、无反向权威写，适合作为第一条产品 ABI。

### W10 非生产成本探针

已用 `/tmp` 的 Vite SSR 脚本导入生产 `collisionBoxesForVoxel`，在同一 `x + sizeX * (z + sizeZ * y)` 次序运行 loaded/key/revision gate。现有支路为 gate 后直接调用该生产 predicate 并写 occupancy；候选支路为 gate 后收集 `u16` staging、`u16` copy-in、`u8` copy-out，**故意不执行分类内核**，所以它是 raw offset/length ABI 的乐观下界，不能当作 Wasm 成绩。每项为九个批量样本的中位数：

|      C | 现有 gate + predicate + output | staged + copy-in/out 乐观下界 | ABI 字节 |
| -----: | -----------------------------: | ----------------------------: | -------: |
|      1 |                   0.0000323 ms |                  0.0001013 ms |      3 B |
|  1,024 |                     0.01683 ms |                   0.007213 ms |  3,072 B |
| 32,768 |                     0.55204 ms |                    0.21209 ms | 98,304 B |

因此 C=1 已由边界成本否决；C=1,024 要达到分项 15% 改善时只剩约 0.0071 ms 给真实 Wasm 调用和分类，也不应默认启用。满窗口要达到 15% 时仍有约 0.257 ms 留给调用和分类，复制没有吃尽预期节省，保留实施价值。这个探针不是浏览器 A/B、不是 P0 CPU profile、也没有任何 MoonBit 执行；它只支持预注册规模阈值而不支持“W10 一定加速”的结论。阈值应先由开发数据固定，再用未参与调参的数据验证；不能逐任务看计时后自适应选择。

W11 在 Logic Worker 收到同一 observation 后发生。`decideActor()` 先在 TS 选择目标，选择时的 `lineOfSight()` 已会读地形，之后才 `nextStep()`。所以只迁 `nextStep()` 既不能批量 LOS，又必须精确返回实际读取窗口集合；把全部窗口写进 `readRevisions` 会改变 Authority 的 revision gate。

推荐每条 observation 先 `load_windows`（occupancy 总计最多32 KiB，仍须复制进 Wasm Memory），再一次 `terrain_query_batch` 接收 TS 构造的 LOS/next-step 查询，返回每查询 status/step 与 read-window bitset。TS 按原窗口顺序映射 bitset 为 `{key,revision}`，继续做目标/action 和 Authority epoch/pose/read-set/TTL 验证。必须保持 A* 的 128 节点、`f/g/cellKey` tie-break、resolve `[0,-1,1,-2,2]`、邻居/高度次序、body AABB floor/epsilon 和 LOS 0.25 步长。

W11 只有在 P0 显示 LOS/A* 为热点时才实施，并必须比较原 TS、数值 key/heap 的等算法 TS、MoonBit 三组；否则目前的 `Map -> values -> sort` 改善会被错误归因给 Wasm。

## 近期顺序

1. W15 可作工具链/ABI 烟雾，但不预判采用。
2. W10 是第一条独立产品 ABI；使用显式 raw offset/length、容量和状态码。
3. W11 复用 W10 的窗口描述/工作区，等 P0 与 TS 控制组。
4. W08 保持候选与观测项，本阶段不投入实现。
