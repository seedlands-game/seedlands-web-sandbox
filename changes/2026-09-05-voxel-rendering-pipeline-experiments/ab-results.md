# 渲染管线 A/B 实验记录

## 公共实验合同

- 批准的 spec SHA-256：`3014f0a9fc31b1678a7900cbdc91bc78f994c34578e802e5aa6bbc49f674c5e8`
- 采样顺序：先 A/A，再 `A → B → A → B`；同一 pair 必须具有相同 source SHA、环境、视口、质量档、seed、场景、相机路径、操作序列、可见 Chunk 和 triangle。
- 计时结论：B 的主指标变化必须超过同轮 A/A jitter；计数指标必须确定性改善。
- 否决项：正确性、视觉语义、server authority、资源释放或稳定性任一回退。
- GPU 精确耗时：当前浏览器 Harness 不提供时记录 `NOT_COLLECTED`。

## 运行环境

2026-09-05 在本机 Google Chrome / Chromium headless、macOS、`1280 × 720`、Medium 质量、benchmark 性能档执行。A/B 运行的是同一未提交 worktree；最终 source SHA 在 Delivery Snapshot 记录。每轮固定 seed、49–50 个已加载 Chunk，其中 25 个具有可渲染表面；triangle、draw workload 与操作序列在同一候选的六轮中一致。最后一个差异 Chunk 是零 triangle 的空上层 Chunk，不改变可渲染 workload。GPU 精确耗时为 `NOT_COLLECTED`。

## P1 Chunk × RenderCategory batching

- 假设：把 `Chunk × FaceMaterial` 合并为 `Chunk × RenderCategory`，能确定性降低多材质场景的 draw call 与 material switch。
- 主指标：固定多材质 fixture 的 draw call。
- 次指标：MeshInstance、MeshCommit、frame p95 / p99、request-to-visible。
- 否决项：材质、AO、cutout、透明、阴影、Chunk 边界或资源释放错误。
- A/A：两轮 control 的 draw call 都为 `39`；frame p95 为 `16.8 / 17.4 ms`，p99 为 `113.0 / 100.8 ms`，request-to-visible p95 为 `5119.3 / 4973.8 ms`。
- A/B：按 `A → B → A → B` 得到 draw call `39 → 25 → 39 → 25`，减少 `35.9%`；triangle 恒为 `1684`，mesh bytes 恒为 `141456`。frame p95 的 control / candidate 均值为 `17.1 / 17.5 ms`，候选的 `+0.4 ms` 小于 A/A 的 `0.6 ms` 波动；没有计时负向结论。request-to-visible p95 均值为 `4993.2 / 4815.3 ms`，但不把一次本机计时代理包装为稳定收益。
- 诊断 / 重测：首次浏览器截图为黑色；定位到 PlayCanvas `Texture.setSource(array)` 会把 array texture 判为无效。改为在构造器的 mip 0 `levels` 中提供 layer 数组后，材质恢复，正确性与视觉截图重测通过。
- 结论：`ACCEPTED`。接受依据是确定性的 draw call 主指标下降，计时没有超过 A/A 噪声的回退。

## P2 紧凑顶点布局

- 假设：Chunk 局部整数位置 / UV、轴对齐法线与安全的 Uint16 index 能降低 Worker transfer 与 mesh CPU bytes，并不恶化 request-to-visible。
- 主指标：transfer bytes 与 mesh bytes。
- 次指标：MeshCommit、request-to-visible、frame p95 / p99。
- 否决项：解码不等价、可见精度下降、CPU pack 尾延迟恶化。
- A/A：两轮 Float32 control 的 mesh bytes 都为 `329448`；frame p95 为 `17.4 / 16.8 ms`，p99 为 `100.2 / 109.8 ms`，request-to-visible p95 为 `5187.3 / 5137.0 ms`。
- A/B：修正版按 `A → B → A → B` 得到 mesh bytes `329448 → 274540 → 329448 → 274540`，减少 `16.7%`；triangle 恒为 `3922`，draw call 恒为 `25`。frame p95 均值为 `17.4 / 17.45 ms`，p99 为 `109.4 / 114.65 ms`，request-to-visible p95 为 `5016.0 / 5027.0 ms`，差异均没有超过各自 A/A 波动。
- 诊断 / 重测：v1 曾把 position / normal / UV 分别改成 `UINT8x3 / INT8x3 / UINT8x2`；WebGL2 正确性通过，但真实 WebGPU 报错并停止上传，因为 WebGPU 不支持三分量 8-bit vertex format。v2 保留 Float32 position / normal，只把 UV 改为 Float16，并在顶点数安全时使用 Uint16 index；单元 round-trip、WebGL2 与真实 WebGPU 全部重测通过。
- 结论：`ACCEPTED`。保留跨后端正确的 v2；v1 已完全移除。

## P3 voxel-specific surface shader

- 假设：在 P1 必需的材质层采样之外，进一步缩小通用材质职责可减少 shader variant / first-visible 或 render CPU。
- 主指标：shader / material variant 与 first-visible。
- 次指标：render CPU、frame p95 / p99；GPU duration 为 `NOT_COLLECTED` 时使用明确代理。
- 否决项：光照、fog、alpha、depth、shadow 或 GLSL / WGSL 语义不一致。
- A/A：`NOT_RUN`。
- A/B：`NOT_RUN`。
- 诊断 / 重测：P1 为纹理数组合批已经必须覆盖 `diffusePS` 与 `opacityPS`；继续把通用 lighting / fog / shadow 组合替换为完整 `ShaderMaterial`，无法在不复制 PlayCanvas 现有多 pass 职责的前提下形成单变量候选，也会提前侵入下一期光照、水体与阴影功能范围。
- 结论：`NOT_RUN`。本期只保留 P1 的最小 voxel-specific 材质层采样和 alpha 一致性 chunk，不把必要正确性代码冒充 P3 性能收益。

## P4 WebGL2 / WebGPU backend

- 假设：在相同最终候选栈上，真实 WebGPU 能改善 frame tail 或 render CPU，且启动、稳定性与资源成本无显著回退。
- 主指标：frame p95 / p99。
- 次指标：render CPU、long frame、first-visible、启动与内存代理。
- 否决项：fallback 冒充 WebGPU、shader 差异、功能或稳定性回退。
- A/A：两轮 WebGL2 的 frame p95 都为 `17.5 ms`，p99 为 `116.6 / 65.4 ms`，request-to-visible p95 为 `5867.1 / 5715.0 ms`。
- A/B：按 `WebGL2 → WebGPU → WebGL2 → WebGPU` 得到 frame p95 `17.3 → 17.3 → 17.3 → 17.2 ms`，差异只有 `0.05 ms`，没有形成可信主指标收益；WebGPU 的 request-to-visible p95 均值约为 `5530.2 ms`，WebGL2 约为 `5319.8 ms`，候选慢约 `210.4 ms`，超过本轮 A/A 的约 `152.1 ms` 波动。两轮 candidate 的 effective backend 都确认是 `webgpu`，不是 fallback。
- 诊断 / 重测：P2 v1 先导致 WebGPU vertex format 验证错误；改成 P2 v2 后，GLSL / WGSL shader 与真实 WebGPU 正确性通过，再执行上述完整配对。修复后仍未得到正向性能结论。
- 结论：`ABANDONED`。最终运行时继续使用 WebGL2，不保留 WebGPU 选择器；WGSL chunk 作为 P1 的双语言等价源码保留，但不声明 WebGPU 性能收益。
