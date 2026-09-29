# A3.1 Geometry Registry Evidence

日期：2026-09-24
范围：最小 per-composition voxel geometry registry、geometry capability module、Classic wooden-door descriptors。

## 行为合同

- Registry 输入是有界、dense、plain、JSON-compatible 数据；每个 storage voxel 唯一。
- 所有坐标必须 finite 且位于 `0..1`，每个 box 必须有正体积，material 使用当前公共 atlas ID 范围。
- `get/require/list` 返回深冻结的 detached descriptor；`list` 是下一阶段 Authority/Worker/Web 的序列化投影。
- Geometry module 每次 assembly 创建独立 registry，并在 definitions-ready 校验 voxel 已注册、可渲染、box material 属于该 voxel semantics、collision presence 与 `solid` 一致。
- Classic 只声明 `89..104`；closed 为四向 `3/16` 薄门且有同形 collision，open 顺时针旋转且按当前 Structure contract 无 collision；lower/upper 相同；legacy `52` 不注册新 geometry。
- 本阶段没有接入 `VoxelCollisionWorld`、player occupancy、recovery、mesh/Worker/Web，也未修改 production `pack.ts`。这些是 A3.2/B 的显式依赖。
- Structure durable state 仍只在 Chunk voxel variants，不增加 Gameplay snapshot child。
- Placement map 已修订：顶面/底面用 Authority actor body position 到 cell center 的水平主轴 bearing；现有树没有 Authority yaw，禁止从 Web camera 或客户端玩法 ID 推导。

## RED

1. `node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec vitest run --config packages/stdlib/vitest.config.ts packages/stdlib/tests/world/voxel-geometry.test.ts --maxWorkers=1`
   - FAIL，0 tests collected。
   - 精确原因：`Cannot find module '../../src/server/gameplay/modules/voxel-geometry-module'`。
2. `node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec vitest run --config playbooks/classic/vitest.config.ts playbooks/classic/tests/structure-descriptors.test.ts --maxWorkers=1`
   - FAIL，0 tests collected。
   - 精确原因：`Cannot find module '../src/structure-descriptors'`。

## GREEN

1. stdlib geometry：1 file / 5 tests PASS，最终复跑 PASS。
2. Classic descriptors：1 file / 3 tests PASS，最终复跑 PASS。
3. Targeted ESLint：PASS。
4. Targeted Prettier check：PASS。
5. `pnpm typecheck:classic`：PASS。
6. `pnpm --dir packages/stdlib typecheck`：第一次被并行 A1 `game-server.ts` 三处 unused import 阻塞；A1 owner 收口后最终 PASS。
7. `pnpm --dir playbooks/classic typecheck`：第一次同样被 A1 import 阻塞；A1 owner 收口后最终 PASS。
8. `git diff --check`：PASS。
9. `pnpm exec tsc -p tsconfig.test.json --noEmit`：A3 测试自身 TS2352 首轮已修复；最终仅被并行 interactions/inventory tests 阻塞：`inventory-pointer-model.test.ts` 缺 `cursor.craftingGrid`，`item-interaction-security.test.ts` 两处 TS7024。A3 文件无错误。

所有 test/typecheck/lint/format 命令均通过 `benchmark-window.mjs --wait-timeout-ms 600000` 全机锁串行执行；Vitest 使用 `--maxWorkers=1`。未运行 build、browser 或 dev server。

## 文件 SHA-256

- `packages/stdlib/src/world/voxel-geometry.ts`: `2f2440ffe95410d67a26e07dd814d2ea9ec8011103c0ff98802dd8ccb33aff63`
- `packages/stdlib/src/server/gameplay/modules/voxel-geometry-module.ts`: `a21ecb5c908984426812218a02578258b700dbe9cd23eb44c318bc83a92c79a8`
- `packages/stdlib/src/server/composition/mod-api.ts`: `d1f5f0a7cd172cfc666a41c0d6dd1b430b04e75036595f8ba4a7e848cdffd23d`
- `packages/stdlib/tests/world/voxel-geometry.test.ts`: `5b34be2bc66da152d4d416f74baf4e232fa067b000abb3dbe313354343f8d6fc`
- `playbooks/classic/src/structure-descriptors.ts`: `ec49e272ce0045f5c08f446a2b81405b8a176567a9019d94b19125efd129f5da`
- `playbooks/classic/tests/structure-descriptors.test.ts`: `be33254e032fb6c3e8c67381fc620fbf3bd18ec27cc90f9d2e12f4552a820fe5`
- `changes/2026-09-23-classic-functional-completion/v1-next-slice-map.md`: `3325dfc57f3eba4da99c6e5d7ef904a12bfa8cbc2c978c5ed0b2370bd9bdc263`

以上实现与测试 hash 是最终验证后读回值；evidence 文件自身 hash 仅在 checkpoint 报告，避免自引用导致内容不稳定。

## 下一阶段依赖

- A3.2 由公共 consumer owner 将 `VoxelGeometryRegistryV1` 注入 Authority collision、player occupancy/recovery、AuthorityReady/mesh payload、TS mesh/Worker、item mesh 和 collision debug。
- A3.2 必须用非 Classic geometry 和 WebGL vertex/normal readback证明消费闭包；A3.1 unit GREEN 不代表门可见或可碰撞。
- Structure definition module 的 `registered-structure` closure 只能在 A3.2 提供可查询 catalog 后解除；本阶段不伪造完成。
- B 木门 operation/transaction 等 A2 target-first 与 A3.2 consumer接口冻结后实施；最终 `pack.ts` 安装由总负责人串行完成。
