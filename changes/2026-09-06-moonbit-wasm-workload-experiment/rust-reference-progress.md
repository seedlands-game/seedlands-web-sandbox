# Rust 对照内核进度

## 范围

Rust 参考只位于实验 change 内，不导入生产路径。`experiments/rust-reference.rs` 按现有 `chunk.mbt`、`fluid.mbt`、`mesh.mbt` 逐函数转换，保留 raw ABI、16 MiB arena、header/输入/写入/next 固定偏移和三项导出：`fill_chunk`、`fluid_candidate`、`mesh_describe`。没有第三方 crate，也没有替换算法或增加 Rust 优化。

## 构建与验证

- `experiments/build-rust-reference.sh` 锁定 `rustc 1.88.0` 和 `wasm32-unknown-unknown`，固定 `-O`、`panic=abort`、关闭 `relaxed-simd`，并将 global base 固定在 16 MiB、最大线性内存限制为 32 MiB；随后要求调用者显式提供固定 `moon-wasm-opt`，以 `-O3 --enable-bulk-memory --enable-reference-types --enable-multivalue` 优化；默认输出 `/tmp/seedlands-rust-reference.wasm`，可由 `RUST_REFERENCE_OUTPUT` 覆盖。
- `experiments/check-rust-reference.mjs` 校验 `memory`、三项 ABI 导出、初始线性内存和 `__heap_base` 均落在 16-32 MiB 安全区。post-opt 实际构建通过，`/tmp/seedlands-rust-optimized.wasm` SHA-256 为 `4260b0cc63e361ce11c85f91e0ca777fba1f7b7c36cc01a2cf5f49662d3d4c4f`。
- `RUST_REFERENCE_WASM=/tmp/seedlands-rust-reference.wasm pnpm exec vitest run tests/world/rust-reference-equivalence.test.ts --no-file-parallelism --maxWorkers=1`：生产路径对照通过。测试使用 `createChunkKernel`、`createFluidKernel`、`createMeshKernelInput` 和 `runMeshDescriptorKernel`，分别运行 30 个确定性 Chunk、fluid、mesh corpus；fluid 断言真实写入和 next frontier，mesh 断言完整 `MeshData` 数组及非空结果，所有 kernel 均保持 `failed=false`。
- W06/W14 控制 memory 与 MoonBit 路径、工具链治理和 Rust 生产路径对照合并运行：4 个文件、15 个测试通过；`tsc -p tsconfig.test.json --noEmit` 通过。
- 早期直接 ABI smoke 已不再作为对等证据；其中 fluid 曾为错误坐标导致的 no-op，mesh 曾比较 mask 区域而非 descriptor 区域。当前测试已删除该证据口径。
- `pnpm exec tsc -p tsconfig.test.json --noEmit` 通过。

## 限制

当前 wasm 只作为 `/tmp` 实验产物保存，没有加入生产 `src/generated/wasm/`，也没有接入生产 loader、Persistence 或 Worker。完整 workload 性能和 Rust/MoonBit 三方大样本测量由负责人统一 runner 执行。
