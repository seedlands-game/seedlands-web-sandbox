# W10 占据窗口内核进度

状态：**内核与纯 ABI 适配完成，尚未接入 Authority、Logic Worker 或普通玩家运行路径。**

## 已实现边界

- MoonBit 导出 `occupancy(input:Int, output:Int, count:Int) -> Int`。输入是连续 little-endian `u16` 体素 ID，输出是连续 `u8` 占据位；成功返回 `0`，非法 offset、对齐、长度或 arena 范围返回 `1` 而不 trap。
- 占据规则与 `collisionBoxesForVoxel(voxel).length > 0` 一致：仅 `Voxel.Air (0)` 和 `Voxel.Water (8)` 输出 `0`；灯笼和所有未知 `u16` ID 输出 `1`，符合当前 registry 对未知非水体 ID 的 collision box 行为。
- `runOccupancyKernel()` 只将已验证的 `Uint16Array` 写入固定 arena、调用导出并复制 `Uint8Array` 结果。loaded voxel、chunk key、revision 与未知窗口门禁仍由未来的 Authority 调用方负责，保持既有所有权。
- 单次 W10 输入上限保持 `32 ** 3`；输入从 offset `64` 开始，输出从固定的非重叠 offset `65,600` 开始。适配拒绝超限窗口，不进行后端选择或生产接线。

## RED 与验证

- RED：`tests/server/wasm-occupancy-equivalence.test.ts` 先因 `src/compute/occupancy-kernel` 缺失失败，证明用例在实现前存在。
- GREEN：以真实 `src/generated/wasm/seedlands-kernels.wasm` 实例运行上述用例，3/3 通过。覆盖所有登记体素、未知 `11/255/65535`、完整 `u16` 域（拆为两个合规窗口）、最大 32768 格窗口，以及非法 ABI offset/length 不 trap。每个成功用例均断言 `kernel.failed === false`，不允许回退伪装成 Wasm 通过。
- `moon check --target wasm` 通过；输出仅为共享 `memory.mbt` 内尚未使用的 `store_u32/load_f64/store_f64` 警告。TypeScript 文件已通过 Prettier。

## 尚未完成

- 未接入 `createTerrainWindow()`；因此没有改变窗口门禁、Worker transfer、Authority 结果、浏览器行为或性能计时。
- 尚未进行 MoonBit 全包格式化：当前共享源已有格式差异，不能由本子项改写。新增 `occupancy.mbt` 已按 MoonBit 建议的声明格式编写。
- 规模阈值仍是候选，必须按本 change 的 P2 预注册样本和浏览器 A/B 结果决定，不能默认启用。

## 交付文件

- `wasm/seedlands-kernels/occupancy.mbt`
- `src/compute/occupancy-kernel.ts`
- `tests/server/wasm-occupancy-equivalence.test.ts`

基准提交：`faa719fb24670173ce5997897afa11ca19ab9901`。
