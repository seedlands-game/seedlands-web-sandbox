# 纯物理核心进度

## 已冻结的模块合同

`src/physics/index.ts` 只提供无状态、无 DOM 的确定性几何/运动函数。实体姿态统一为脚底中心 `BodyState.position`，`BodyConfig.localAabb` 是相对此原点的局部碰撞箱。运行时单向依赖本模块：它负责固定步调度、协议、实体所有权和把已加载体素形状适配为 `PhysicsWorld`；本模块不保存 tick、世界或实体集合。

`stepBody({ state, config, input, world, dt })` 返回新的 `state`、阻挡接触、传感器重叠、真实底面支撑和介质采样。`dt` 可为任意有限正值，调用方默认传入 `1 / 60`。`recoverBody` 只供初始化、旧档恢复或外部几何变更显式调用，普通运动绝不自动脱嵌或爬一格。

`PhysicsWorld.querySolids` 必须返回扫掠包围范围内的真实复合方块子箱；未知区域由适配器作为阻挡箱返回，不能当空气。`sampleFluid` 返回不重叠的水体 AABB 与流速。层/掩码双方匹配才碰撞；`sensor` 只报告重叠，不参与阻挡。

## RED

2026-09-06：已预置 `tests/physics/step-body.test.ts`，在生产模块尚不存在时导入失败，覆盖薄平台高速下落、低顶、稳定角落滑动、灯笼子箱、无自动一格上升、真实跳搭支撑、浸没/流速、掩码/传感器、有限数值及显式重叠恢复。

2026-09-06：独立评审后补充的墙—角色—角色夹持、相邻体素恢复、深水齐水岸上浮、终点支撑及接触点夹具在修复前分别暴露了无 world 推离穿墙、局部贪心恢复失败、深水上浮停在半浸没平衡、历史接触滞留和原点点位错误。相关最小反例、规则及准入条件记录于 `physics-independent-review.md`。

## GREEN 与交付

2026-09-06：独立评审阻断项修复后，`pnpm vitest run tests/physics/step-body.test.ts` 通过，14 项用例全部 GREEN。修复将角色推离改为必经 `PhysicsWorld` 的静态 swept-AABB 有界位移；`separated` 仅表示完全脱离，受墙限制的合法部分推离保持 `false`。显式恢复改为有限全局候选搜索并在完整静态集合验证后原子提交，失败不改状态；普通步仍不调用恢复。接触点现在落在真实接触面，最终 `grounded` 只由终点实际支撑决定。`validateBodyConfig` 供形状注册与 Worker 边界一次性校验，公共入口同时防御有限数据和脚底中心原点。深水按住 Space 通过受水面条件的有限 `waterSurfaceJumpSpeed` 产生速度，岸和顶棚仍由同一连续扫掠处理。

`pnpm prettier --check src/physics/types.ts src/physics/geometry.ts src/physics/step-body.ts src/physics/recovery.ts src/physics/index.ts tests/physics/step-body.test.ts`、`pnpm eslint src/physics tests/physics`、`pnpm tsc --noEmit`、`pnpm build` 与 `git diff --check` 通过。生产构建保留既有大 Chunk 警告，未由本模块新增或掩盖。

2026-09-06：第三轮独立复审发现生产适配器逐水格返回 `FluidVolume` 时，不能从任一格的 `aabb.max.y` 推断自由水面。`FluidVolume.surfaceY` 现为权威适配器专门标注的暴露水面；无标记的覆水格和内部格仍参与浸没计算，但永不产生水面跃出速度。新增逐格三层深水、顶层部分水位、覆水层与低顶回归，覆盖内部边界无冲量、真实暴露面才跃出及连续碰撞顶棚。`separated` 现在准确表示返回状态是否已经完全无重叠，即使调用前本已分离也为 `true`；碰撞层和掩码收紧为无符号 32 位整数。恢复候选在笛卡尔积物化前按固定预算 fail closed，避免极端复合形状的超预算临时分配。

本模块仅交付纯核心；Authority Worker、体素/未知 Chunk 查询适配、客户端预测、眼睛入水滞回和真实碰撞箱调试投影由主线按已冻结合同接入。`sampleFluid` 只计算身体 AABB 的介质比例，刻意不读取相机/眼睛状态。

# A1 身体坐标解释收口补充

只读审计确认统一物理步已经从 `body-registry` 读取真实 AABB，但玩法射线仍为生物种类复制 `1.9/2.35/2.1` 高度，Actor 攻击射线另固定使用脚底 `+0.9`；浏览器重生、水流采样和脚步地面采样也直接复制当前玩家眼高数值。它们不会创建第二套物理解算，却会在身体尺寸调整后让交互、表现与权威碰撞发生漂移。

本补充保持玩家触达距离、伤害、音频采样深度和所有玩法数值不变，只统一坐标解释：实体中心由 `bodyKindForEntity()` 与 `bodyConfigFor().localAabb` 推导，玩家相机到脚底偏移统一读取 `player-view-offsets`。已停用自主大循环中的旧 `PerceptionRuntime` 仍作为历史查询模块保留，不在本次扩大删除范围。

RED 用例 `tests/server/gameplay-body-geometry.test.ts` 枚举玩家、世界物品和三种 Actor，要求交互射线中心与身体注册表完全一致。旧实现对玩家和世界物品错误套用 2.1 格默认高度，预期失败。

RED 实测五个参数用例中玩家与世界物品两项失败：旧射线中心分别得到 `21.05`，注册表预期为 `20.9` 与 `20.2`。实现后玩家攻击与 Actor 攻击的射线两端都从注册身体 AABB 中心推导；重生相机、水流脚底采样和脚步地面采样复用 `PLAYER_FEET_OFFSET`，脚步仍保留原有向下 0.1 格语义。身体坐标、Actor 规则、生存玩法及未知 Chunk 共 4 个文件、25 项用例通过，受影响 ESLint、源码与测试 TypeScript、`git diff --check` 通过。旧 `PerceptionRuntime` 没有重新接入生产推进，保留为历史查询模块。
