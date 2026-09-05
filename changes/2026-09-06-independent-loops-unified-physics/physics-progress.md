# 纯物理核心进度

## 已冻结的模块合同

`src/physics/index.ts` 只提供无状态、无 DOM 的确定性几何/运动函数。实体姿态统一为脚底中心 `BodyState.position`，`BodyConfig.localAabb` 是相对此原点的局部碰撞箱。运行时单向依赖本模块：它负责固定步调度、协议、实体所有权和把已加载体素形状适配为 `PhysicsWorld`；本模块不保存 tick、世界或实体集合。

`stepBody({ state, config, input, world, dt })` 返回新的 `state`、阻挡接触、传感器重叠、真实底面支撑和介质采样。`dt` 可为任意有限正值，调用方默认传入 `1 / 60`。`recoverBody` 只供初始化、旧档恢复或外部几何变更显式调用，普通运动绝不自动脱嵌或爬一格。

`PhysicsWorld.querySolids` 必须返回扫掠包围范围内的真实复合方块子箱；未知区域由适配器作为阻挡箱返回，不能当空气。`sampleFluid` 返回不重叠的水体 AABB 与流速。层/掩码双方匹配才碰撞；`sensor` 只报告重叠，不参与阻挡。

## RED

2026-09-06：已预置 `tests/physics/step-body.test.ts`，在生产模块尚不存在时导入失败，覆盖薄平台高速下落、低顶、稳定角落滑动、灯笼子箱、无自动一格上升、真实跳搭支撑、浸没/流速、掩码/传感器、有限数值及显式重叠恢复。

## GREEN 与交付

2026-09-06：`pnpm vitest run tests/physics/step-body.test.ts` 通过，10 项用例全部 GREEN。`pnpm eslint src/physics tests/physics`、`pnpm tsc --noEmit`、`pnpm tsc -p tsconfig.test.json --noEmit`、`pnpm build` 与 `git diff --check` 通过。生产构建保留既有大 Chunk 警告，未由本模块新增或掩盖。

本模块仅交付纯核心；Authority Worker、体素/未知 Chunk 查询适配、客户端预测、眼睛入水滞回和真实碰撞箱调试投影由主线按已冻结合同接入。`sampleFluid` 只计算身体 AABB 的介质比例，刻意不读取相机/眼睛状态。
