# 碰撞调试模块进度

状态：进行中。

## 2026-09-06：RED

- 已先写入 `tests/client/collision-debug-projection.test.ts`，锁定权威/预测颜色和来源、32 格与 128 实体预算、灯笼子碰撞箱、接触详情默认关闭与可选显示。
- RED 已实际执行：因生产投影模块缺失而失败，证据为 Vitest 的 `Cannot find module`。
- `src/physics/body-registry.ts` 已由主线并行工作提供 `BodyKind` 与 `bodyConfigFor()`；体素子形状来自现有 `src/world/voxel-model.ts` 的 `collisionBoxesForVoxel()`。未在 client 复制任一身体或方块尺寸。

## 2026-09-06：GREEN

- `CollisionDebugProjection` 现生成单个 `Float32Array` 位置/颜色线段批次以及每段的来源、tick、实体、支撑与传感器用途元数据。
- 预算按观察者 32 格筛选并稳定地取最近 128 个权威身体；输入快照和本地截断数会合并为面板可读的截断计数。
- `CollisionDebugRenderer` 延迟创建一份动态线段 Mesh，放入 `LAYERID_IMMEDIATE`，不会进入仅含 `WORLD` 与 `SKYBOX` 的水面反射相机；关闭及重复 `dispose()` 都会释放并保持幂等。
- 已通过：`CI=true pnpm exec vitest run tests/client/collision-debug-projection.test.ts`、`pnpm exec tsc --noEmit --pretty false`、`git diff --check`。真实 F3+B、Authority 订阅与画面验收由主线接线后补做。
