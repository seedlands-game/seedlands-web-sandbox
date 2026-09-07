# Seedlands Wasm SIMD 可行性审查

## 结论

本轮实现前保全的 MoonBit 和 Rust Wasm 产物都没有实际 SIMD 指令。两份产物均以标量 `i32` load/store、移位、比较和循环为主；当前构建参数也没有启用 `simd128` 或 relaxed SIMD。

可作为后续同条件 A/B 候选的顺序是：

1. W10 `occupancy`：连续 `u16 -> u8` 分类，最适合先做。
2. W06 `pack_color_alpha` 与 `offset_indices`：连续 RGBA/索引扫描，适合做 SIMD128 批处理。
3. W06 `compact_uvs`：每个 `f32` 的位级转换彼此独立，但必须保留现有 NaN、下溢和截断语义，实施复杂度高于前两项。

CRC、流体传播和导航暂不适合强行 SIMD。它们分别受 CRC 链式依赖、流体分支和不规则内存访问、A* 的动态容器与邻居分支限制。

## 已检查的实际产物

| 产物（保全引用）                                                                                                                           | SHA-256                                                            |        大小 |                                         反汇编文本 |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ | ----------: | -------------------------------------------------: |
| `../2026-09-06-moonbit-wasm-workload-experiment/evidence/preservation-manifest.json` 中的 `src/generated/wasm/seedlands-kernels.wasm` 条目 | `e342dd87279fe651eba7e649a6b5c0db172bd7653dbbf6380c272f88a7f7b17a` | 9,788 bytes |        `/tmp/seedlands-kernels.wat`，182,789 bytes |
| `../2026-09-06-moonbit-wasm-workload-experiment/evidence/rust-reference.wasm`                                                              | `4260b0cc63e361ce11c85f91e0ca777fba1f7b7c36cc01a2cf5f49662d3d4c4f` | 8,211 bytes | `/tmp/seedlands-rust-optimized.wat`，159,480 bytes |

MoonBit 二进制由 `../2026-09-06-moonbit-wasm-workload-experiment/evidence/preservation-manifest.json` 保全清单引用；Rust 二进制已保存在 `../2026-09-06-moonbit-wasm-workload-experiment/evidence/rust-reference.wasm`。`/tmp/*.wat` 是本次只读反汇编的临时文本，不作为二进制保全路径。

实际固定工具链版本：

- `moon 0.1.20260827 (d0aaa07 2026-08-27)`
- `moonc v0.10.11+6ff76a5f9 (2026-08-28)`
- `rustc 1.88.0 (6b00bc388 2025-06-23)`
- `moon-wasm-opt`：`wasm-opt version 125 (version_125)`

本次只对已有二进制执行 `moon-wasm-opt --print-features` 和 `-S` 文本反汇编，没有重新编译、覆盖或启动浏览器。两份 WAT 均执行了以下特征检索：

```text
v128/f16x8/f32x4/f64x2/i8x16/i16x8/i32x4/i64x2 指令数：0
v128 token 数：0
simd128/relaxed-simd 特征词数：0
```

`--print-features` 实际输出：

- MoonBit：`mutable-globals`、`bulk-memory`、`sign-ext`、`reference-types`、`multivalue`、`bulk-memory-opt`
- Rust：上述特征加 `nontrapping-float-to-int`、`call-indirect-overlong`

输出中均没有 `simd128`、`simd` 或 `relaxed-simd`。Moon WAT 的导出包括 `occupancy`、`compact_uvs`、`pack_color_alpha`、`offset_indices`；Rust 参考只包含 `fill_chunk`、`fluid_candidate`、`mesh_describe`，因此 W06/W10 的直接 SIMD 证据来自 Moon 产物和同源代码，Rust 参考目前没有对应 W06/W10 导出。

## 当前构建参数证据

MoonBit 的 [scripts/build-wasm.mjs](/Users/chlorinec/.codex/worktrees/moonbit-wasm-20260906/voxel-sandbox-foundation/scripts/build-wasm.mjs) 第 16 行固定为：

```text
-O3 --enable-bulk-memory --enable-reference-types --enable-multivalue
```

第 74 行执行 `moon-wasm-opt` 时仍只传入这组参数，没有 `--enable-simd`。固定工具的帮助文本确认 `--enable-simd` 是可用选项，但当前管线没有使用它。

Rust 的 [build-rust-reference.sh](/Users/chlorinec/.codex/worktrees/moonbit-wasm-20260906/voxel-sandbox-foundation/changes/2026-09-06-moonbit-wasm-workload-experiment/experiments/build-rust-reference.sh) 第 28-39 行使用：

```text
--target wasm32-unknown-unknown -O -C panic=abort -C target-feature=-relaxed-simd
```

第 42 行用与 MoonBit 相同的 `-O3 --enable-bulk-memory --enable-reference-types --enable-multivalue` 做 post-opt，没有 `--enable-simd`。因此两份现有产物的“无 SIMD”结论来自实际 WAT 与实际 flags 两层证据，而不是由源码或文件名推断。

## SIMD 候选

### W10 occupancy：最高优先级

`wasm/seedlands-kernels/occupancy.mbt:18-20` 对每个输入 `u16` 执行相同的谓词：`voxel == 0 || voxel == 8`，再写一个 `u8`。循环没有跨元素状态，输入输出连续，且上限只有 `32^3` 个单元。

可用 `i16x8` 读取 8 个 voxel，比较 0 和 8，或运算后把布尔结果压缩为 `u8`。实现必须保留未知 voxel ID 的现有分类规则，并处理尾部不足一个 SIMD 批次的元素。该候选的控制流和数据布局最简单，适合作为第一项 scalar/SIMD 对照。

### W06 pack_color_alpha：高优先级

`wasm/seedlands-kernels/mesh-pack.mbt:42-62` 每个元素复制 RGB 三个字节，并以同一个 material 派生的 alpha 覆盖第四字节。它是固定 4-byte record 的连续扫描，无跨元素依赖。

可以按 16 bytes 批量读取，保留 RGB 位并用 material alpha 填充每个第四字节，再按 16 bytes 写回。必须保留 `material < 1` 的拒绝路径、输入输出边界检查以及字节布局。该路径比 UV 位转换更适合先验证吞吐收益。

### W06 offset_indices：中高优先级

`wasm/seedlands-kernels/mesh-pack.mbt:67-87` 对每个 `u32` 加同一个 `vertex_offset`，同时返回结果最大值。加法元素独立，适合用 `i32x4.add` 批量处理；最大值可用无符号比较或批内归约实现。

需要明确保持 `u32` 模 2^32 加法，以及当前 `maximum` 的无符号比较语义。最大值归约和尾部处理会增加少量控制代码，但仍是规则的连续扫描。

### W06 compact_uvs：中优先级，语义风险较高

`wasm/seedlands-kernels/mesh-pack.mbt:19-37` 先按位读取 `f32`，再计算 sign/exponent/mantissa，最后截断到 `u16`。当前注释和实现明确要求：NaN 映射为 infinity，下溢映射为带符号零，尾数不舍入。

Wasm SIMD128 没有把这套历史语义自动等价实现的简单入口。可用 `i32x4` 批量完成位移、掩码和比较，再用 select 合并三个 exponent 分支并打包到 `u16`；不要直接替换为可能改变 NaN、subnormal 或舍入行为的浮点转换指令。该候选应在 W06 其他两个扫描通过逐字节对等后再做。

## 不建议强行 SIMD 的路径

### CRC

`wasm/seedlands-kernels/checksum.mbt:23-39` 的每一步都用上一步 CRC 计算 table index，再更新下一步 CRC。该循环存在严格的 loop-carried dependency，并且每个字节都要做表查找。常见的 SIMD CRC folding 需要改用另一种多项式折叠算法，不能仅把当前 table loop 机械打包；这会扩大确定性和对等验证范围。保持串行标量实现更稳妥。

### 流体传播

`wasm/seedlands-kernels/fluid.mbt:161-251` 包含 frontier 数量、未知 Chunk 计数、源水判断、上下左右邻域、动态写入去重、指针生成和容量失败标志。每个 frontier 单元访问的 Chunk 和邻域不同，写入数量也依赖前一项状态；SIMD lane 很容易因分支和缺块路径分化。当前重点应保持 pointer provenance 校验、整任务回退和 Moon/Rust 逐字段一致，不应以 SIMD 改写算法。

### 导航

当前导航仍是 TypeScript 的 A*。`src/server/simulation/ground-navigator.ts:27-49` 使用 `Map` 保存 open/visited 集合，并在每轮动态排序；`69-89` 按可行性分支展开邻居，`96-103` 再沿 parent 链回溯路径。这是动态容器、分支和不规则访问主导的单路径搜索，不具备稳定的批量 lane。除非先改变算法和数据布局，否则 SIMD 不会是合适的第一优化方向。

## 后续边界

本轮按 Rust-first 使用同一 Rust 算法的标量 / 标准 `simd128` 对照，继续关闭 relaxed SIMD、fast-math、threads，并把既有 TS 数值规则作为逐元素 oracle。已完成的 MoonBit 产物继续保全，本轮不扩大 MoonBit SIMD 实现；因此新增结果回答 Rust 内 SIMD 收益，不用于重新宣称 Rust / MoonBit 语言优劣。每个候选都应重新检查 WAT 的 `v128`/具体 SIMD mnemonic、功能等价测试、尾部长度和 NaN/无符号边界；本文件没有性能估计，也没有把“工具支持 SIMD”当作“当前产物已经使用 SIMD”。

## 新实现与官方依据

本轮新增 `crates/world-kernels` 的可宿主编译纯标量算法，以及独立 `world-kernels-wasm` 适配层中的四个标准 SIMD128 后端。构建脚本固定 Rust 1.88.0，两个产物使用相同优化、arena 和堆栈参数；明确禁用自动 loop/SLP vectorization，以隔离手写 SIMD 这一变量。产物与全部 Rust 源码 hash 由 `evidence/simd-build-manifest.json` 记录并由测试校验。这里的 scalar 是实验控制组，不代表开启自动向量化后的所有 Rust 编译配置上限。

标准 SIMD 是 Wasm 单线程内向量运算，不要求 SharedArrayBuffer，也不因此要求跨源隔离。本轮每个浏览器测试仅一个 Web Worker，各 Wasm 实例持有独立 memory，不启用 Wasm threads。SIMD 编译特性及 intrinsic 依据：[V8 SIMD 说明](https://v8.dev/features/simd)、[Rust wasm32 intrinsic](https://doc.rust-lang.org/core/arch/wasm32/index.html)。所有权审计依据：[MDN transferable objects](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Transferable_objects)。

实测性能与是否采用的正式结论单列在 `simd-results.md`，不能用本文件的适合性判断代替 A/B 证据。

新增实际产物的最终反汇编检查记录在 `evidence/simd-instruction-audit.json`：标量 0 条、SIMD 91 条 SIMD 指令，包含 `v128.load/store`、整数 narrowing、bitselect、`i32x4.max_u`，两者均无 relaxed 指令。检查还记录了实际 data/stack/heap 边界与 18 MiB memory 容量。
