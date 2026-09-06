# W06 Mesh packing 进度

## 范围

本项只覆盖 `batchMeshData` / `compactMeshData` 的数值转换候选，不修改 `src/world/mesh.ts`，也不把完整网格生成迁入 MoonBit。TypeScript 继续负责 render category 分组、布局、positions/normals/UV 的 bulk `TypedArray.set` 和结果组装；MoonBit 只执行紧凑 UV half conversion、颜色 alpha/material 写入和带 vertex offset 的 u32 index 扫描。

## 保持的合同

- category 顺序固定为 `opaque`、`cutout`、`emissive`、`transparent`。
- half conversion 保留原 TypeScript 语义：NaN 映射为 infinity、无舍入截断 mantissa、underflow 保留 signed zero。
- 颜色保留 RGB，并把 alpha 改为零基 material id。
- index offset 后最大值不超过 65535 时使用 `Uint16Array`，否则使用 `Uint32Array`。
- Wasm 输入复制、输出复制和准备空间均计入；工作区从 64 开始，转换临时数据不超过 16 MiB arena。
- ABI/capacity 错误会停用当前实例并抛错，不能把 TS 结果作为 MoonBit 成绩。

## 当前状态

W06 已完成本地 GREEN：

- `src/compute/mesh-pack-kernel.ts` 暴露 `MeshPackKernel`、`createMeshPackKernel` 和 `runMeshPackKernel`；保留 positions/normals 的 TypedArray `.set` 批量复制与类别控制，仅将紧凑 UV half conversion、color/alpha/material、index offset/max 扫描交给 Wasm。
- `src/compute/mesh-pack-kernel-control.ts` 暴露 `createMeshPackControlMemory` 和 `runMeshPackControl`，通过同一 `KernelMemory` 布局执行 JavaScript 数值控制路径，供 A/B runner 复用。
- `tests/world/wasm-mesh-pack-equivalence.test.ts` 覆盖类别顺序、NaN/Infinity/下溢 signed zero、`u16`/`u32` index 及越界容量失败路径；运行结果为 2 个测试通过。
- 使用固定工具链执行 `node scripts/build-wasm.mjs --hash` 成功，产物 SHA-256 为 `e6d627aec3e9e2f759e4947549689d56b46af53666dd9530841a4d796820c9fd`。
- 与 W14 合并执行串行 Vitest：2 个测试文件、5 个测试全部通过；目标文件的 Prettier 与 ESLint 检查通过。

完整 `tsc -p tsconfig.test.json --noEmit` 仍被并行中的 worker 测试阻塞：缺少 `src/worker/wasm-kernel-loader`，且 `wasm-world-task-integration.test.ts` 使用了当前接口尚未接受的第 4 个参数。这些错误不来自 W06 文件。真实性能测量不在本子任务范围内。
