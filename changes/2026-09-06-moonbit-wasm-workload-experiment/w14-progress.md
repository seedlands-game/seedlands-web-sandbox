# W14/W15 存档编码与 CRC 进度

## 范围

本项只提供现有 `chunk-snapshot-codec.ts` 的 MoonBit 编码候选和 CRC 适配，不接入 Persistence Worker，也不改变存档 schema 或 TypeScript 解码路径。解码继续由 TypeScript 持有，原因是存档身份校验、截断/非法长度、候选格式兼容和恢复错误路径已经由现有 codec 统一负责；本项的可验证收益边界是编码候选字节与校验值逐字节一致。

## ABI 与候选顺序

- 输入为两个固定长度的 `u16` Chunk（32³ 个体素）和可选的 32³ `u8` fluid sidecar，所有视图偏移从 64 开始。
- MoonBit 提供 procedural diff、palette bitpack、raw little-endian u16 三个编码候选，以及 payload、procedural base 和 fluid CRC32。
- TypeScript 适配器按现有严格顺序选择最短候选：`procedural-diff-v1`、`palette-bitpack-v1`、`raw-u16-v1`；相同长度保留先出现的候选。
- 编码失败会停用当前 KernelMemory 实例并抛出错误，不把 TS 编码结果伪装成 MoonBit 等价结果。
- 最大输出容量固定为 140000 bytes，低于 16 MiB arena；raw payload 为 65536 bytes。

## 当前状态

W14/W15 已完成本地 GREEN：

- `src/compute/codec-kernel.ts` 暴露 `CodecKernel`、`createCodecKernel`、`encodeStoredChunkRecord`、`runCRC`、`runCrc32Bytes` 和 `runCrc32U16`，编码控制路径与 MoonBit 导出共用同一份内存布局。
- `src/compute/codec-kernel-control.ts` 暴露 `createCodecControlMemory` 和 `runCodecControl`，通过同一 `KernelMemory` 布局执行 JavaScript 编码/CRC 控制路径，供 A/B runner 复用。
- `tests/world/wasm-codec-equivalence.test.ts` 覆盖 uniform、稀疏 diff、多 palette、随机 `u16`、fluid、CRC 已知向量和失败回退断言；运行结果为 3 个测试通过。
- 使用固定工具链执行 `node scripts/build-wasm.mjs --hash` 成功，产物 SHA-256 为 `e6d627aec3e9e2f759e4947549689d56b46af53666dd9530841a4d796820c9fd`。
- 与 W06 合并执行串行 Vitest：2 个测试文件、5 个测试全部通过；目标文件的 Prettier 与 ESLint 检查通过。

完整 `tsc -p tsconfig.test.json --noEmit` 仍被并行中的 worker 测试阻塞：缺少 `src/worker/wasm-kernel-loader`，且 `wasm-world-task-integration.test.ts` 使用了当前接口尚未接受的第 4 个参数。这些错误不来自 W14/W15 文件。真实性能测量不在本子任务范围内。
