# Rust FLUID 与 MESH 纯 core 迁移证据

## 范围与边界

本次把 `changes/2026-09-06-moonbit-wasm-workload-experiment/experiments/rust-reference.rs` 中 W07 FLUID 和 W04 MESH 的既有参考算法迁入 `world-kernels` 纯 core，并在 `world-kernels-wasm` 保留薄 ABI adapter。没有修改 generation、codec、生产 loader、TS wrapper、协议或性能采纳结论。

纯 core 不含固定 Wasm 地址、raw pointer、宿主 global 或 intrinsic：

- FLUID 接受安全 `&mut [u8]` arena、显式 `FluidChunkLayout`、typed `FluidPosition` 和调用方提供的 `FluidWrite`/next scratch。chunk 数据偏移由调用方传入，算法顺序、unknown 计数、首次原值、写入去重、next frontier 重复项和容量失败语义保持既有 reference。
- MESH 接受 typed `&[u16]` halo、`&[u8]` fluid、调用方 mask scratch 和 descriptor 输出 slice。source-face 遍历、water height、AO、greedy 合并、lantern record、两遍容量检查及 16-byte record 顺序保持既有 reference。
- 固定 header/chunk/frontier/write/next 地址、16 MiB arena 约束、指针对应关系和 `fluid_candidate`/`mesh_describe` 导出只存在于 Wasm adapter。adapter 校验输入范围、u16 对齐、scratch count 上限，以及可变 chunk/output 与控制区、scratch 输出和其他 chunk buffer 的不重叠。

## RED

先新增 `crates/world-kernels/tests/fluid-mesh.rs`，再执行：

```text
cargo test -p world-kernels --test fluid-mesh
```

预期 RED：编译失败，`world_kernels::fluid` 与 `world_kernels::mesh` 尚不存在。

## GREEN

host core 测试：

```text
cargo test -p world-kernels
```

结果：2 个既有 data-plane 用例与 2 个新增 FLUID/MESH 用例全部通过。新增用例验证 source water 的 4 个 side write 顺序、28 个 next activation、caller scratch 和 single-cube 6 条 descriptor/capacity 规则。

Wasm 产物构建：

```text
SEEDLANDS_RUST_OUTPUT=changes/2026-09-07-data-plane-adoption/evidence corepack pnpm wasm:rust:build
```

scalar 与 SIMD 构建、源码/产物 fingerprint 校验通过。当前 manifest 记录：

- scalar：21,942 bytes，SHA-256 `b27e950854435c00c9b4b21dea6635823b32ee521495d638291f723a5aab818c`
- SIMD：23,502 bytes，SHA-256 `15fa30c3ae565c260e760f2e54494d5cf514624f2ca1c67282c6b55d866737d3`

30 场景 production-path 对照已分别以 scalar 与 SIMD 产物执行过；在最后一次仅增加 adapter alias 拒绝前，两者均为 1/1 测试通过，覆盖各 30 个 Chunk、FLUID 和 MESH corpus。alias 校验不改变合法输入算法，但资源预约期间未冒充重跑结果；释放后需再各跑一次并更新本记录。

`cargo fmt --all -- --check` 环境阻塞：固定 Rust 1.88.0 toolchain 未安装 `rustfmt` component。没有自动安装工具链组件。

没有执行正式性能窗口，没有 Git commit。
