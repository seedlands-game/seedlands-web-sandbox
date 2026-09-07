# W07 同布局 TypeScript 控制进度

## 目的与范围

`src/compute/fluid-kernel-control.ts` 提供 `createFluidControlMemory()`，创建与 MoonBit 线性内存同样的独立 16MiB arena（初始 256 页、最大 512 页），再向既有 `KernelMemory` 提供 JavaScript 的 `fluid_candidate` 导出。`src/worker/fluid-kernel.ts` 可在不改变输入准备、复制、结果解码、排序或 fallback 路径的前提下，将该控制内存传给同一 `createFluidKernel()`。

控制只替换内核执行语言，不替换数据布局或算法：Chunk 行、frontier 行、writes 原值表和 next 行分别仍在既有 `1024`、`8192`、`4MiB`、`5MiB` arena offset；`u8/u16/u32/i32` TypedArray 视图只创建一次并缓存，不在 raw load/store 时分配新视图。

## 必须保持的细节

- 坐标采用 MoonBit `Int` 截断除法等价的负坐标 Chunk 计算，保留逐 Chunk 的线性查找。
- 每次未命中 `fluid_address` 都增加 offset `68` 的 unknown read 计数，包括重复读取和写/放置中的未命中；不以 Map 省略它。
- 水源位、零 fluid 的 `0x88` 默认值、`above` 二次读取、横向 `some` 的短路方向、写入前原值指针去重、邻域写入顺序和容量溢出状态逐句沿用 `fluid.mbt`。
- 输出仍由共享适配器过滤无变化 write、按位置排序 writes/next，并保留 snapshot 原有的 readSet 和 consumed frontier 次序。因此后续比较可以把布局/适配成本与 MoonBit 执行成本分开。

## 验证状态

- `pnpm exec vitest run tests/server/wasm-fluid-control-equivalence.test.ts --no-file-parallelism --maxWorkers=1`：通过（1 文件、1 用例）。该用例调用真实控制 `KernelMemory`，在 16 个随机化场景、跨 Chunk、负坐标、未知邻块 cleanup 读和连续 4 个 tick 中，把共享适配器输出与生产 `computeFluidCandidate` 逐字段比较，并断言 `failed === false`。
- `pnpm exec prettier --check src/compute/fluid-kernel-control.ts tests/server/wasm-fluid-control-equivalence.test.ts changes/2026-09-06-moonbit-wasm-workload-experiment/w07-control-progress.md`：通过。
- `pnpm exec eslint src/compute/fluid-kernel-control.ts tests/server/wasm-fluid-control-equivalence.test.ts`：通过。
- `pnpm exec tsc --noEmit`：通过。此前短暂出现的任务外未使用常量已由其所有者处理后重跑，本控制文件和测试未报类型错误。
