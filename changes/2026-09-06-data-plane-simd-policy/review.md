# SIMD Rust ABI 与 headless A/B 修复复核

## 审查范围

本次只读复核覆盖 `scripts/build-simd-experiment.mjs`、`scripts/link-wasm-kernels.mjs`、`crates/world-kernels-wasm` 的 Wasm ABI、`tests/compute/simd-kernel-equivalence.test.ts`、`tests/compute/simd-pack-equivalence.test.ts` 以及当前 change 的 headless A/B runner。没有重新编译、运行性能窗口或启动浏览器；以下“已通过”依据现有代码、保全 manifest 和任务提供的执行结果。

## 已关闭的问题

- 旧的 `--stack-first` 低地址布局已由 `scripts/link-wasm-kernels.mjs` 过滤，并在 `scripts/build-simd-experiment.mjs` 中改为 `global-base=16MiB`、独立 1MiB stack 和 32MiB 最大内存。`tests/compute/simd-kernel-equivalence.test.ts:9-15` 读取 `__data_end`、`__stack_pointer`、`__heap_base`，断言完整 `[64,16MiB)` arena 与 data、stack、heap 不重叠，再填充整个 arena；根据任务提供的执行结果，两种产物均通过。
- `offset_indices` 已改为返回 `f64`，以精确容纳完整 `u32` max，同时保留 `-1.0` 作为错误码。`MeshPackKernel` 的高位 max 回归覆盖 `0xffffffff`，见 `tests/compute/simd-pack-equivalence.test.ts:97-108`；这消除了合法高位 max 被 wrapper 当成负错误码的问题。
- A/B 的 `compare()` 已同时检查 baseline 和 candidate 的零值，计时低于分辨率时返回 `BELOW_TIMER_RESOLUTION`，不再把零值送入 bootstrap。runner 元数据还区分 `formal` 与 `smoke`，见 `changes/2026-09-06-data-plane-simd-policy/e2e/simd-ab.spec.ts:24-31,91-103`。
- 标量和 SIMD 两个 Rust 产物继续使用完全相同的 linker、arena、stack、内存上限和非 relaxed SIMD 参数；差异只有 `simd128` 与 `simd` feature。`evidence/simd-build-manifest.json` 同时记录了源码和二进制 SHA，等价测试会校验这些哈希，见 `tests/compute/simd-kernel-equivalence.test.ts:30-43`。

## 保留事项与限制

### [P2] staged TS control 仍返回有符号 max

Rust adapter 的 `offset_indices` 已使用 `f64`，但 `src/compute/mesh-pack-kernel-control.ts:56-66` 的 JavaScript control 仍返回 `maximum | 0`。因此 staged control 在合法 max 大于 `0x7fffffff` 时仍可能被 `MeshPackKernel.invoke()` 的负值检查拒绝，且当前高位 max 回归只构造了真实 Rust Wasm wrapper，没有覆盖 staged control。当前 mesh corpus 的索引范围没有触发该问题，但若 staged control 继续作为同布局对照，应补上相同的无符号返回语义或明确其仅限当前低索引 corpus。

### [P2] control 与 Rust 的初始线性内存大小不同

`createMeshPackControlMemory()` 使用初始 16MiB；新的 scalar/SIMD Wasm 产物使用初始 18MiB。两者共享 input/output offset、复制和 kernel 调用路径，scalar 与 SIMD 之间是公平的；staged-vs-SIMD 仍有 2MiB 初始内存 footprint 差异，不能把它描述成完全相同的线性内存配置。该限制应保留在 A/B 结果说明中。

### [P2] micro core 路径只接受有效 corpus

`simd-worker.ts:98-111` 的重复核心计时路径没有像普通 `run()` 一样检查每次调用的负返回码。当前 corpus 在进入计时前已通过正确性准备阶段，故不影响已提供的有效样本；若复用该接口做非法 ABI 或回退测试，应先检查状态并让错误使该样本失效。

### 产品采用边界

SIMD 不支持时的生产标量/TS 回退仍属于候选通过采用门槛后的产品 loader 条件，本实验 harness 只负责在显式 SIMD 产物可加载时做 scalar/SIMD 对照，不把 harness 本身当作产品回退证据。正式性能结论仍必须使用 `formal` 元数据对应的 10 对、每 run 1000 任务、5 秒预热结果；低于分辨率的指标只能保留为不可判定，不得用于正收益准出。

## 复核结论

此前 arena 重叠、合法高位 max 与零计时误判三个高影响问题已由代码和现有执行证据覆盖。当前没有发现新的 Rust scalar/SIMD ABI 高影响阻塞项；交付前需保留 staged control 的有符号 max 限制，并确认正式 headless 运行结束后只引用最终 `formal` evidence，不引用旧布局或 `smoke` 文件作采用依据。
