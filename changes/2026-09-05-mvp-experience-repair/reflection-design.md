# 水位反射平面修正设计

## 背景与目标

流体网格不再以完整方块顶面渲染水：暴露的满水单元顶面为 `y + 7/8`，流动单元顶面为 `y + level/8`。现有 `PlanarWaterReflection.scanNearbyVoxels()` 却把水面固定为 `y + 1`，反射相机与真实网格错开。水材质也只根据法线混合反射，因此同一材质中其他高度的顶面会采样错误平面；附近没有水后，先前的强度参数还会保留。

本修正使反射相机、反射 shader 和流体网格使用同一水面高度定义。完成态是：只为扫描选中的一个暴露水面渲染和采样反射，流动水顶面按其 level 对齐，其他高度的水顶面、水侧面及无有效水面时没有错位反射。

## 范围与明确不做

本任务只修改 `src/app/advanced-visual-effects.ts`、`src/app/shaders/voxel-array-chunks.ts`，并新增纯选择 helper 与 focused 测试；必要时更新本 change 的流体浏览器用例。复用 `src/world/water-mesh-height.ts` 的正式高度规则和 `world.server.getFluidCell()`，不修改 Sol 负责的流体模拟、网格生成、持久化或 `Game.ts`/UI。

## 设计决策

1. 新增无 PlayCanvas/DOM 依赖的 `water-reflection-plane` helper。它以单元 `y`、fluid level 和是否有上方水单元计算实际顶面，并判定相机是否位于该平面上方；扫描和 `PlanarWaterReflection.update()` 都直接调用它，避免自行复写 `7/8` 规则。
2. 扫描仅接受上方不是水的水单元，读取 `world.server.getFluidCell(x, y, z)?.level`；缺失 sidecar 仍按权威默认 level 8 处理。候选选择保持现有最近距离语义，但三维距离中的 Y 改为真实顶面。
3. `PlanarWaterReflection` 每次 update 都同步 `uReflectionWaterPlaneY` 与 `uReflectionStrength`：只有候选面在相机下方才使用预算强度；无候选、相机在水面或水下时均将强度设为 0，不能继续采样旧纹理。
4. 水 shader 新增选中平面 uniform，并将反射混合乘以“世界空间顶点 Y 与该平面相等”的小容差门控和原有向上法线门控。侧面法线仍为零，其他高度的顶面也为零；不为材质创建新实例或每帧创建数组。

## 行为与验收

- Given 暴露 level 8 水单元在 `y=58`，When 选择反射平面，Then 平面为 `58.875`，不是 `59`。证据：Vitest、Playwright-change。
- Given 暴露 level 6 水单元在 `y=58`，When 它是最近候选，Then 平面为 `58.75`。证据：Vitest。
- Given 同列水单元上方仍是水，When 扫描，Then 下层不成为候选；其高度由网格规则视为完整填充。证据：Vitest。
- Given 选中平面 `58.875`，When 水 shader 绘制另一高度顶面或任意侧面，Then 平面门控为零；只有同平面且向上的表面可混合反射。证据：Static、Playwright-change、Manual supplement。
- Given 扫描范围内没有暴露水面，When effects update，Then `waterPlaneY` 为 `null` 且 `uReflectionStrength` 为 0。证据：Vitest、Playwright-change。
- Given 相机位于选中水面或水下，When effects update，Then 反射不活动且 `uReflectionStrength` 为 0。证据：Vitest、Playwright-change。

## 测试设计与 RED

- `tests/app/water-reflection-plane.test.ts` 在实现前导入尚不存在的 `src/app/water-reflection-plane.ts`，定义满水、流动水、被覆盖水及相机位于水面上/下的预期，预期 RED 为模块无法解析。
- `changes/2026-09-05-mvp-experience-repair/e2e/fluid-world.spec.ts` 保留已有的 level 6 流体 fixture，并在相机最近位置明确放置 level 8 反射探针；浏览器读取 `snapshot.visualEffects.waterPlaneY`。实现前旧代码会得到整格高度 `59`；实现后应读到探针的实际顶面 `58.875`。
- 完成后运行 `pnpm exec vitest run tests/app/water-reflection-plane.test.ts`，再显式执行该 change 的流体 Playwright 用例；浏览器截图只作为视觉补充，不能代替高度断言。

## 当前状态与证据

- RED：`pnpm exec vitest run tests/app/water-reflection-plane.test.ts` 在 helper 尚未创建时按预期报 `Cannot find module '../../src/app/water-reflection-plane'`。
- GREEN：实现后同一 focused Vitest 覆盖满水 `58.875`、level 6 `58.75`、覆盖水排除，以及相机在水面上/下时的激活边界。
- 浏览器：`pnpm exec playwright test changes/2026-09-05-mvp-experience-repair/e2e/fluid-world.spec.ts --workers=1` 通过（1 项，20.9 秒）。该用例真实读取 `visualEffects.waterPlaneY`，对最近 level 8 探针断言 `58.875`；流动 level 6、跨 Chunk、存档恢复与回退断言同时保持通过。
- 静态：`pnpm exec tsc --noEmit`、相关文件 `prettier --check` 与 `git diff --check` 通过。
- 视觉补充：浏览器真实截图保存为 `evidence/fluid-level-and-reflection-plane.png`。画面可见水面、阶梯水流和透明侧面；高度数值正确性以浏览器 snapshot 断言为准。

本文件不替代 change 总 spec 的 R5 最终集成准出。
