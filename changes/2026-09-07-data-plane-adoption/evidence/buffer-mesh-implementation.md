# 缓冲与 mesh 低拷贝实现记录

## 范围

本记录只覆盖 collision baseline、generated canonical、fluid Worker 输入和 mesh 打包的低风险数据平面修复。未修改 EntityStore、导航、Rust crate、端到端用例、根 spec 或包脚本。

## 所有权合同与移除字节

| 路径                                     | 修改后的所有权合同                                                                                                                                                                                                                 |                                 每次任务移除的显式复制 |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -----------------------------------------------------: |
| Authority collision baseline             | `AuthorityCollisionBaselineClient` 默认继续复制可注入 request 的返回值；仅 BrowserAuthorityClient 明确声明 Worker transfer 后，才以 TypedArray view 接管独占 buffer。                                                               |           `65,536 + 32,768 = 98,304 B/available Chunk` |
| generated canonical，慢速 Authority 接纳 | 公开 `acceptAuthorityCollisionBaseline()` 保持两份 callback 隔离副本；BrowserAuthorityClient 使用零参数的 `consumeTransferredAuthorityCollisionBaseline()`，结果 buffer 入镜像，只有发送 Authority 时才创建 dispatch-owned copy。 |  `65,536 B`（旧路径两份 canonical copy，现仅发送副本） |
| generated canonical，准备缓存命中        | 显式 consume 路径的结果 buffer 直接成为镜像，既不向 Authority 发送，也不创建 canonical 副本。                                                                                                                                        | `131,072 B`（旧路径的镜像副本与参数副本各 `65,536 B`） |
| fluid Worker 的 TS fallback              | Authority 保留 request 时创建的 lease snapshot；Worker 收到 transfer 后调用 `consumeFluidCandidate()` 原地修改 task-owned Chunk arrays。公开 `computeFluidCandidate()` 仍先 clone，供 Authority 校验、参考实现和可复用调用方使用。 |                                  `98,304 B/Chunk/task` |

generated canonical 的特殊 alias 防护：如果 relay/fake transport 将保留的 preparation 与新结果暴露为同一 buffer，慢速发送前先复制 preparation，确保后续 collision revision 写入不会污染 mesh preparation。正常 Worker transfer 下两者是独立所有权；该防护不会影响准备缓存命中快路径。

mesh `batchMeshData()` 改为先累计长度、一次分配目标 TypedArray、使用 `TypedArray.set()` 和有界循环填充；`compactMeshData()` 用有界循环取最大 index。它移除了大数组 `push(...typedArray)` 与 `Math.max(...indices)` 的参数展开失败风险。`batchCompactMeshData()` 进一步把 Worker 默认 pack 路径融合为一次输出分配，不再生成再复制 positions/normals；其 Float32→Float16 使用一个复用 bit view，保留旧的 JS Number NaN canonicalization、负零和截断结果。JavaScript 旧 `number[]` 的实际堆字节不是稳定协议量，本记录不把它伪报为固定节省。

P1 独立评审后补充的边界：公开 generated callback 可以 mutate 或 transfer 自己收到的 dispatch copy，不能接触 collision mirror；公开 baseline request 也默认复制。测试包含真实 `structuredClone(..., { transfer })` 后 sender `byteLength === 0`，并验证显式 consume 缓存接收端 buffer、公开路径仍与 request/result buffer 隔离。

## Preflight 诊断（非正式性能结论）

Root preflight 曾观察 W06 fixed `17.26ms` 对 staged TS `0.38ms`。该数字用于定位每 UV 临时 Float32Array/Uint32Array 分配及 batch 后 positions/normals 再复制；它不是本 change 的正式性能结果，未用于采纳结论。本次未执行新的计时或浏览器任务。

## RED 与 GREEN

先新增以下用例并在实现前执行：

- `tests/server/data-plane-buffer-ownership.test.ts`：公开/consume 所有权分界、transfer detach、prepared-hit canonical identity、公开 fluid 输入不变与独占接口无 `TypedArray.slice()`。
- `tests/world/data-plane-mesh-capacity.test.ts`：70,000 顶点、210,000 index 的 batch 与 compact；融合 pack 的完整字节及索引宽度；NaN payload、负零、subnormal 与 overflow 的旧转换语义。旧实现分别在 `push(...part.positions)` 和 `Math.max(...mesh.indices)` 抛出 `RangeError: Maximum call stack size exceeded`。

实现后通过：

```text
pnpm exec vitest run tests/server/data-plane-buffer-ownership.test.ts tests/world/data-plane-mesh-capacity.test.ts tests/world/mesh.test.ts tests/world/wasm-mesh-pack-equivalence.test.ts tests/compute/simd-pack-equivalence.test.ts tests/client/authority-collision-mirror-client.test.ts tests/worker/compute-worker-task.test.ts tests/worker/wasm-world-task-integration.test.ts
8 files passed, 45 tests passed
```

格式检查已通过。未执行浏览器、Harness 或计时任务；静态字节账不能代替端到端收益测量。

## 可调用的对照 seam

- `AuthorityCollisionBaselineClient.synchronize()`：默认公开复制；BrowserAuthorityClient 构造时显式 `consumeTransferredBuffers` 才可统计 `98,304 B` 主线程复制消除。
- `BrowserAuthorityClient.acceptWorkerCanonical()`：经 `consumeTransferredAuthorityCollisionBaseline()` 按 prepared-hit / slow-admission 分组统计 canonical copy 与 transfer。
- `computeFluidCandidate()` / `consumeFluidCandidate()`：以同一 `FluidAuthoritySnapshot` 比对 candidate，并单列 public-copy 与 Worker-consume 路径。
- `createFluidKernel(kernel, fallback)`：Worker 传入 `consumeFluidCandidate`，而 reference/Wasm 单测保留默认公开 fallback。
- `batchMeshData()` / `compactMeshData()` / `batchCompactMeshData()`：可对照相同 `MeshData` 的输出字节、峰值堆与大数组成功率；本次未采集计时或堆指标。
