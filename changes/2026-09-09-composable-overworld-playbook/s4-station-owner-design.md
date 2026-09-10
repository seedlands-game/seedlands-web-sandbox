# S4 工位实例与原子 owner 接线

状态：Implementing。承接已批准 D3/D4/D5/D6，采用一次独立只读源码复核的最小方案，不新增通用组件框架。

工作台、箱子、炉体是现有 EntityStore / bitECS owner 的 station 类型；稳定 EntityId/lifetime 与普通实体共享分配和退休约束。station 不初始化 actor needs/control，也不进入默认动态实体查询、空间物理/pose；独立 queryStations、stationAt 和 stationSnapshot 提供宿主派生访问。坐标索引可重建，状态只在 ECS。

StationComponentV1 保存 entityId、revision、kind、voxel；workbench 持久化 9 格 grid，产物直接进入角色背包；chest 保存 24 格；furnace 保存已存在的 FurnaceSnapshotV1。这些是本期界面容量取值，不宣称性能收益。组件由每世界不可变 definition 与 items/furnace definitions 校验，缺 station codec 的旧工程宿主不能创建 station。每种 station 只对应显式定义的 voxel，位置为唯一整数坐标。

EntityStore component snapshot 升为 V2，增加 stations；读取 V1 时显式迁移为空。stations / actors / identities / entities 严格对应，重复位置、跨 kind、错误物品/炉体进度在候选 owner 中失败。旧运行时 epoch 引用在恢复后失效，持久 lifetime 保留。整体 checkpoint 另外校验 station 与地形双向完整性，不能仅校验 gameplay。

PreparedEntityMutation 增加 station spawn/replacement，沿现有 despawn 处理销毁；一个 candidate 同时准备角色库存、station 和掉落。先完成 schema、ID、容量、frontier、clone，再同步 apply；拒绝或 stale 不影响任何 owner。Block place/finish 复用同一 entity plan 与现有 world plan：放置产生新工位实例；拆除按固定顺序掉落方块与槽位内容；半成品进度/剩余燃烧时间消失，不凭空产物。raw editBatch/set-block/fill 初版拒绝改变 station voxel，要求正常 station-aware Block 事务。

注册 station-transfer / station-craft 与 system furnace-advance。station 专用 state port 同时投影 actor 和 station，避免跨两个 mutable port。交互带 expectedStationRevision，重试旧 revision 无副作用失败；角色/工位权限分别校验，距离、LOS、lifetime、当前 voxel 和规则均在 final validate 重检。修改当前工具时复用 prepared cancellation 清 Combat/breakAction。

炉体复用逻辑时钟 every-advance；满输出是正常 no-op，不扣料/燃料、不增加 station revision，也不由炉体 commit 增加 gameplay revision；宿主逻辑时钟仍沿既有持久化规则推进 gameplay revision，逻辑时钟照常前进，不追补阻塞时间。本期 8×128 个 active furnace 上限在激活前检查，inactive station 不占 active 上限。creative 可放置/拆除并照定义结算站内物品；拒绝 transfer/craft，以保护原生存库存。具体命令/UI 后续按此合同补正常输入验证。

决定性 RED：同坐标拆建引用隔离、V1→V2/跨 epoch 恢复、候选数组别名/stale/重复位置/容量错误、同一计划扣库存并创建工位、拆站完整掉落；半途冶炼同 checkpoint 恢复恰产一次；重复 transfer/craft、满格、veto/clone 失败无部分提交；缺实体或缺 voxel 的 checkpoint 在替换前拒绝。

独立复核本身为静态方案证据，无测试或实现结论。public 入口、新 voxel/材质、真实 Browser 操作、完整生存循环与 S5/S6 仍需后续实施与验收。

交互细化：transfer 支持显式正整数 count（省略则整堆），用于普通输入把材料分配到 3×3 配方位置；目标容量不足整笔拒绝，不做隐式交换或部分转移。炉体槽位固定 0=input、1=fuel、2=output，产物槽只取出；移走活动原料会清除本配方进度，保留已消耗燃料的剩余燃烧时间，不把进度转给另一种原料。该约束由同一 detached candidate 和最终提交复算执行。
