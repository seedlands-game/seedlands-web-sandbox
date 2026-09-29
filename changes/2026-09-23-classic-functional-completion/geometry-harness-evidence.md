# Geometry Harness 只读摘要证据

状态：`V1-HARNESS-GEOMETRY-01` 私有 seam 完成。基线为 `1b98df45a287bfe70ba853aa91823a748dd7ce9b`；未运行 build、browser、dev server、CI、Git 写操作或性能采样。

## 边界与实现

正式签名：

```ts
World.getRenderedMaterialMesh(
  cx: number,
  cy: number,
  cz: number,
  material: FaceMaterialId,
): RenderedMaterialMeshSummary | null
```

`RenderedMaterialMeshSummary` 只包含 `chunkKey`、`chunkRevision`、`material`、`vertexCount`、`indexCount`、world-space `min/max`。

- `playcanvas-chunk-adapter.commitPart()` 在同一 `MeshPart` 送入 `pc.Mesh` 前读取 `positions/colors/indices`。普通 part 使用 `part.material`；compact batched part 使用每个实际 index 引用 vertex 的 `colors[vertex * 4 + 3] + 1`。
- 每个 material 只统计实际被 index 引用的唯一 vertex 和 index 数；bounds 只扫描这些 vertex。运行期仅在 Chunk resource 保存小型摘要 Map，不保留或复制完整 typed buffer，不做每帧扫描。
- `World` 只查询 `ChunkResourceRepository.chunks` 中已完成 postrender 安装的当前 record，并用 `task.cx/cy/cz * CHUNK_SIZE` 转换为 world bounds。尚未 postrender、material 不存在、replacement 已安装、unload 后均返回 `null`。
- 本 seam 不从 geometry descriptor 构造渲染结果，不增加写口或第二状态 owner，也不宣称性能收益。共享 Browser Harness 的 clone/freeze 转发由公共 owner负责。

开工时两个既有生产文件没有工作区 diff；记录 SHA-256：

```text
140241a899dbb791dde75eccc985982e0683a3b5232291074c244adca8184c9b  apps/web/src/app/world/playcanvas-chunk-adapter.ts
d9e305d5d068f2e6fc1ad103ad80bc2c111b284a3dfcf1c388f61089eb426e1c  apps/web/src/app/world/world-runtime.ts
```

现有 Lighting imports、block-light hook 和 water transition 路径原样保留；没有格式化或回退其文件内容。

## RED / GREEN

首次 RED 命令：

```sh
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/tests/unit/app/rendered-material-mesh.test.ts --maxWorkers=1
```

结果为 `1 suite failed / 0 tests collected`，准确失败为新增私有模块 `apps/web/src/app/world/rendered-material-mesh.ts` 不存在。落最小实现后的首次运行 `2/3 PASS`；剩余失败是测试 adapter 误把三参数 `commitPart` 直接绑定为二参数 helper，修正 fixture callback 后为 `3/3 PASS`。

最终本域与相邻回归：

```sh
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/tests/unit/app/rendered-material-mesh.test.ts apps/web/tests/unit/app/playcanvas-water-transition-adapter.test.ts apps/web/tests/unit/app/chunk-resource-repository.test.ts apps/web/tests/unit/worker/geometry-mesh-task.test.ts --maxWorkers=1
```

结果：`4 files / 22 tests PASS`。覆盖：

- mixed compact material 按 encoded alpha 隔离；
- Chunk origin 转 world-space bounds；
- postrender 前不可读；replacement/unload 后无旧摘要；无目标 material 为 `null`；
- Classic storage `89`/`91` 通过真实 `meshChunk -> batchCompactMeshData -> summary` 均有 vertex/index，薄轴由 Z 转 X，长轴同步旋转。

共享组合回归曾运行 `5 files / 25 tests`：本域四文件 `24/24` 通过，但公共 owner 同时新增必填 `bindings.renderedWorldEpoch()` 后，其 `game-harness-observability.test.ts` fixture 一度尚未同步，产生 `TypeError: bindings.renderedWorldEpoch is not a function`。将原文和位置 `game-harness.ts:412` 发给公共 owner后，对方同步 fixture；本阶段未越权修改共享 Harness 测试，最终单独复验该文件 `3/3 PASS`。

## 静态验证

以下命令均经默认 `benchmark-window` 全机锁执行：

```sh
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm --filter @seedlands/web typecheck
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec tsc -p tsconfig.test.json --noEmit --pretty false
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec eslint apps/web/src/app/world/playcanvas-chunk-adapter.ts apps/web/src/app/world/world-runtime.ts apps/web/src/app/world/rendered-material-mesh.ts apps/web/tests/unit/app/rendered-material-mesh.test.ts
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec prettier --check apps/web/src/app/world/playcanvas-chunk-adapter.ts apps/web/src/app/world/world-runtime.ts apps/web/src/app/world/rendered-material-mesh.ts apps/web/tests/unit/app/rendered-material-mesh.test.ts
```

- Web typecheck：最终 PASS，Svelte `0 errors / 0 warnings`。中间唯一错误是新增 helper 的 fallback array 被推断为非定长 tuple；改为显式 `vector(x,y,z)` 后关闭，没有使用 `any` 或双重断言。
- Root test typecheck：PASS。
- 定向 ESLint：最终 PASS；中间只捕获测试 optional-chain 非空断言，改为显式缺失检查。
- 定向 Prettier：PASS。scoped `git diff --check`：PASS。

## 最终 SHA-256

```text
6479afdd34115bfc9e97fe0b4f1d7e4470595901f25fe289c821405898b7cb8c  apps/web/src/app/world/playcanvas-chunk-adapter.ts
a66a42f968746d6bd792af6f1c921de4f1e06e7dac0e66db7b1607d082f7e447  apps/web/src/app/world/world-runtime.ts
31adfb737976cccc454b2936bb8897b784e90369371aa7a04e8b235b0333308e  apps/web/src/app/world/rendered-material-mesh.ts
c71c6d695c62cd2f1dc1508469ef7ca48786ecc0953fd1c35699ddb4a014ef8a  apps/web/tests/unit/app/rendered-material-mesh.test.ts
```

上述哈希取自最终格式化、最终 `22/22` 回归和 scoped diff check 之后；evidence 自身哈希在最终交接中单独回报。

## 未验证

- 没有启动 production browser，未证明真实 WebGL context、pixel结果、玩家输入或门可玩性。
- 没有性能采样；摘要只在 mesh commit 时生成，不据此主张更快或零开销。
- 公共 Harness epoch gate 的并发 fixture 已由公共 owner关闭并单独复验 `3/3 PASS`；完整 production browser仍未运行。
