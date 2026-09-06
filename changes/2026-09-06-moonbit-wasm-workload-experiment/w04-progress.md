# W04/W05 网格描述符阶段进度

## 已定边界

原 `meshChunk` 的最终 `MeshData` 在合法高表面积输入时可超过固定 16MiB Wasm arena：仅约 101376 个未合并四边形的五个数组就约 17MiB；大量灯笼的模型面会更高。因此本阶段不把最终顶点数组放进 Wasm，而是由 Wasm 生成固定 16 字节描述符，TypeScript 依描述符发射现有的 `Float32Array`、`Uint8Array` 和 `Uint32Array`。这仍迁移逐格可见性、AO、贪心合并与水面台阶判断；最终数组写入、材质分组和模型盒展开仍在 TypeScript，必须连同复制成本参加后续 A/B。

描述符顺序保持原循环：三个轴的贪心四边形在前，随后按 `y,z,x` 的灯笼体素记录。发射层用原来的面、UV、AO、索引和水面塑形规则重建数组，材质对象属性仍由 JavaScript 的既有数值键枚举顺序决定；未知体素以 `255` 哨兵保留原 `undefined` 材质路径，而不归一化为任意已知材质。

## 半径二输入窗

一格 `34³` halo 不能满足原 `meshChunk` 的严格语义：边界外的 source voxel 也可能发射反向面，随后 AO 角点或水面高度会继续读取第二圈。ABI 保留 `36³` 的体素与 fluid 窗，索引范围为本 Chunk 局部坐标 `[-2, 33]`。但完整扫描的依赖集经 source-face、AO 与水高路径复核后是 `[-1, 32]³`；唯一会读第二圈的位置是 canonical `x/z` 上、`y=32` 为水时的 `(x,33,z)`。输入准备只填这组点，其他 ABI 槽保留零值且描述符核不会读取，避免整窗填充触发无用的 `baseVoxel`/宏观地形查询。准备仍精确复用 `data`、一圈 halo、`fluid`、`fluidHalo`、编辑覆盖、`outside` 和程序地形回退优先级，且属于 W04/W05 端到端成本，不能从 A/B 中移除。

## 容量与失败语义

`mesh_describe(window, fluidWindow, output, capacity)` 对小容量先进行不写描述符的计数遍，再校验容量并写入。返回值为描述符字节数；`-1` 是非法、重叠或越界 ABI 范围，`-2` 是容量不足。`-2` 前不会写任何描述符，TS 适配层也不会返回部分网格。适配层固定 arena 所给的完整容量满足静态上界 `3 × 33 × 32 × 32 + 32³` 个 16 字节记录，即 2,146,304 字节，核直接单遍写入；这不改变记录顺序。适配层在读取前还拒绝非安全整数、非 16 字节对齐或超过该上界的导出长度，防止异常导出扩大 TypedArray 读取范围。输入、mask 工作区和描述符均在 arena 的 16MiB 范围内；MoonBit heap 不用作临时数组。

## 对照与当前限制

`tests/world/wasm-mesh-equivalence.test.ts` 已先创建并实际执行 RED：当时缺少 `mesh-kernel` 导入，Vitest 在收集阶段以 `Cannot find module '../../src/compute/mesh-kernel'` 失败（0 个测试执行）。用例要求真实 Wasm 实例且 `kernel.failed === false`，并逐 TypedArray 比较空、实心、棋盘、水位台阶、灯笼、AO、相邻 halo。当前 `meshChunk` 对孤立未知 ID 本身会在掩码合并中抛出异常；描述符发射器同样拒绝 `255` 哨兵，避免悄悄分配一个错误材质。

当前实现的 TypeScript 发射层与 Wasm 描述符使用相同的 `36³` 准备布局，并已补齐独立的纯 TS 描述符扫描器；控制组与 Wasm 共享输入准备和发射层，只替换扫描循环，因此后续 A/B 可以拆分布局与语言贡献。MoonBit 热路径移除了坐标元组返回与 AO 元组绑定，并为 raw load/store、可见性、贪心掩码和 AO helper 标注 `#inline`；完整容量走单遍写入，小容量仍保留原子失败语义。

## 验证状态

- RED：已实际记录，如上。
- MoonBit `moon check --target wasm`：通过；仅共享 `memory.mbt` 未使用 f64 helper 和 MoonBit 旧 `to_uint` 转换警告。
- `SEEDLANDS_MOON_HOME=... node scripts/build-wasm.mjs --check --hash`：通过；优化后产物 SHA-256 为 `e342dd87279fe651eba7e649a6b5c0db172bd7653dbbf6380c272f88a7f7b17a`。
- `pnpm exec eslint src/compute/mesh-kernel.ts src/compute/mesh-kernel-control.ts`：通过。
- 伪 `mesh_describe` 导出先实际 RED：返回超静态上界的字节数时旧适配层会继续解析并报“无效贪心四边形”，未在读取前拒绝。
- `pnpm exec vitest run tests/world/wasm-mesh-equivalence.test.ts --no-file-parallelism --maxWorkers=1`：6 项通过；使用真实生成 Wasm，包含同布局 TS 扫描对照、`y=32` 外圈水读取 `y=33`、一圈 AO 边界，以及伪导出的超上界、非对齐和非整数输出长度拒绝。
- V8 coverage 已实际复现唯一超时：随机 halo 对等语料保留全部 Wasm、TS 控制和逐 TypedArray 断言，覆盖插桩下运行 7,656ms，超过 Vitest 默认 5,000ms。仅该语料设为 30,000ms，避免把覆盖开销误判为语义失败；其他用例维持默认时限。
- 该单文件 coverage 运行的 6 项测试随后通过；进程仍因只覆盖此文件而触发全仓 `src/world/**` 80% 门槛（26.17%）退出，不能替代全仓 coverage 准出。
- `RUST_REFERENCE_WASM=/tmp/seedlands-rust-reference.wasm pnpm exec vitest run tests/world/rust-reference-equivalence.test.ts --no-file-parallelism --maxWorkers=1`：通过；30 个确定性语料的 Chunk、fluid 与 mesh 描述符三方路径一致。
- 全仓 `tsc` 仍被其他未完成的 W03/W06 Worker 模块缺失及现有调用签名问题阻断；本次新增文件的先前未使用变量错误已修复。
- 未接生产调用，未更改 `src/world/mesh.ts`、共享 `moon.pkg` 或共享 memory ABI 文件。
