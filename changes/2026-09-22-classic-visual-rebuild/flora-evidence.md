# Classic 植物交叉网格证据

状态：S1 已完成源码与确定性/Wasm 对照；Browser 视觉验收待主线程在本 change 的场景中执行。

## 已完成

- `Sapling`、`TallGrass`、`Flower`、`Mushroom`、`SugarCane`、`DeadBush`、`RedFlower`、`RedMushroom` 都从贪婪完整方块网格移出，改为同格内两张对角竖直面、每面正反各一张 quad（每个植物 24 个 index）。
- 植物不产生角色碰撞、不会遮挡相邻完整方块面；`Cactus` 仍为完整、可碰撞方块。
- 八种面材质均属于 `cutout`；`apps/web` 的预览分类直接复用 stdlib 分类。
- 普通 TS chunk mesher、TS Wasm 描述符对照、Rust/Wasm 描述符发射和库存静态模型均复用同一 TS 几何 helper；Rust 将同一八个 ID 作为 model descriptor 输出。
- 已重建 `rust-kernels-scalar.wasm`、`rust-kernels-simd.wasm` 和 source fingerprint manifest。

## 自动证据

| 命令                                                                                                                                                                                                    | 结果      | 覆盖                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | -------------------------------------------------------------------------------------- |
| `pnpm exec vitest run --config packages/stdlib/vitest.config.ts packages/stdlib/tests/world/voxel-model.test.ts packages/stdlib/tests/world/mesh.test.ts --maxWorkers=1`                                | 28 passed | 八种植物非完整立方体、双面交叉面、cutout、相邻石头面和碰撞边界                         |
| `cargo test --manifest-path crates/world-kernels/Cargo.toml`                                                                                                                                            | 12 passed | Rust descriptor 中八种植物均为 model record，且所有既有 kernel 测试通过                |
| `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/tests/unit/client/item-mesh-definition.test.ts apps/web/tests/integration/runtime/world/wasm-mesh-equivalence.test.ts --maxWorkers=1` | 17 passed | inventory 与 world mesh 数组一致，scalar Wasm/TS control/world mesher 覆盖八种植物一致 |
| `pnpm --filter @seedlands/web typecheck`                                                                                                                                                                | passed    | Web/Svelte/TypeScript 类型检查                                                         |
| `pnpm wasm:rust:verify`                                                                                                                                                                                 | passed    | Rust 源码与 scalar/SIMD 生成物指纹一致                                                 |

## 尚未验证

- Browser 中日/夜、正/侧/斜视角的实际 cutout alpha、双面可见性和阴影表现。
- 浏览器真实运行下的准星选取和穿行/采集交互；权威碰撞与 targetable 代码未在本工作包改变，仍需 change 的 Browser 场景读回。
- 最后一次全量 Web typecheck 受并行生物资产改动阻断：`classic-creature-definitions` 尚未出现，以及旧 `grazer`/`settler`/`stalker` 类型引用未同步。报错不涉及本工作包改动的植物、Wasm 或库存文件；本工作包变更前的 Web typecheck 已通过，定向 Web 测试保持通过。

## 生产画面后的 UV 纠正

第二轮Browser实际画面发现花头落地、茎向上。根因是PixelTexture第0行表示画面顶部，而交叉面沿用方块侧面V=0对应世界底部。新增共用`voxelModelFaceUvs()`并仅对植物翻转V；TS世界网格、Wasm描述符展开与静态物品几何共享该映射。Rust仅编码model descriptor，不携带UV，因此无需更改Rust产物。

定向验证：stdlib mesh 24/24，item mesh + Wasm等价17/17，Rust kernel 12/12，stdlib typecheck通过。194引擎缩略图已由主线程统一重建；生产Browser近景仍需最终读回。
