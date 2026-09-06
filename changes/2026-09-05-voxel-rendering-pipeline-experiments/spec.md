# 体素渲染管线重写与性能实验

**状态：** Breaking flow；用户已批准 SHA-256 `3014f0a9fc31b1678a7900cbdc91bc78f994c34578e802e5aa6bbc49f674c5e8`；已按 RED → 实验 → 收敛完成本地交付

## 背景与目标

历史讨论把当前阶段概括为从“几何管线已经正确”升级到“可持续演进的实时图形管线”：体素经 Hidden Face Culling 与 Greedy Meshing 形成 Chunk Mesh，PlayCanvas 把 MeshInstance 提交到一个或多个 render pass，Shader 只是 Mesh 到 Framebuffer 整条链路中的可编程阶段。

客户端 / 服务端基础和客户端性能可观测性已经交付。当前仓库仍按 `FaceMaterial` 产生 Mesh part，每个 part 创建独立 `pc.Mesh`、`pc.MeshInstance` 和 `StandardMaterial`；应用固定由 `pc.Application` 创建 WebGL2 device。High 质量档已有一个 `512` 分辨率的基础 Directional Shadow，但尚未形成正式的 voxel-specific shader、材质索引流或可比较的后端 / 顶点布局 / draw batching 实验框架。

本 change 是三期图形路线中的第零期，只处理渲染管线重写和性能实验。它不预设“更新的 API、更少的 draw call、更紧凑的数据或手写 shader 一定让整帧更快”，而是把候选改动拆成可独立启停、可恢复基线的 A/B 实验。每项先建立假设和主指标，再以同场景配对采样验证；结果不正向时先排查实现原因，修正后重测，确认无法获得正向收益或代价不可接受时撤销该候选。最终交付允许只保留部分候选，也允许与初始计划明显不同。

完成态由两部分组成：

1. 生产代码只保留经过正确性、视觉和性能证据支持的管线改动，不携带已放弃实验的死分支；
2. 交付记录明确汇总最终改了什么、放弃了什么、每项 A/B 结果，以及实际重写或覆盖了哪些 Vertex / Fragment / Depth / Shadow shader 或 shader chunk。

后续功能分两期另立 Breaking-flow change：第一期实现光照系统、人工光源、阴影系统和水体渲染，作为本期新管线的功能冒烟；第二期实现反射、后处理、滤镜和用户可调画质 / 设备负载选项。

## 范围与非目标

### 范围

- 冻结当前 FaceMaterial 分 part、每材质一个 `StandardMaterial`、WebGL2 路径为实验基线，并补齐可重复的多材质、森林、水边、Chunk crossing 和 remesh 场景。
- 建立 change-scoped 实验选择器和结果合同，使每个候选一次只改变一个被测维度；正式交付前移除已放弃候选及仅为人工切换而存在的生产死路径。
- 候选 P1：`Chunk × RenderCategory` draw batching。比较当前 `Chunk × FaceMaterial` 与 `opaque / cutout / transparent` 每类最多一个 MeshInstance 的路径；B 路径允许使用纹理数组、稳定材质层索引和最小 shader chunk 作为不可拆分的正确性条件。
- 候选 P2：GPU / Worker 顶点数据布局。比较当前 positions / normals / uvs / colors / indices attribute streams 与一种经 PlayCanvas 能力验证的紧凑布局；候选可包含法线、AO、材质层和适用时的 `Uint16` indices，但不得降低位置、UV、AO 或材质表达精度到可见错误。
- 候选 P3：voxel-specific surface shader。比较 PlayCanvas 通用 `StandardMaterial` 路径与只接管体素职责的 shader / shader chunks；被测范围可包括顶点 attribute decode、纹理层采样、AO 组合、cutout alpha / depth / shadow 一致性。GLSL 与 WGSL 必须功能对等。
- 候选 P4：WebGL2 / WebGPU backend。只在 P1–P3 已得出阶段结论后，用同一最终候选栈比较 CPU submission、frame tail、首帧、稳定性和资源成本；WebGPU 不可用时记录 `UNSUPPORTED`，不能以 fallback 冒充 WebGPU 样本。
- 为每个候选保存独立的假设、A/B 配置、source SHA、环境、场景、原始摘要、诊断与 `ACCEPTED` / `RETRY_REQUIRED` / `ABANDONED` 结论。
- 使用已有 telemetry / Harness 采集 frame p50 / p95 / p99 / max、long frame、Chunk request-to-visible、相关主线程 span、draw call、MeshInstance、material / shader variant、triangle、Worker transfer bytes、mesh bytes、GPU upload 代理、first-visible、内存和设备 / backend 信息。GPU 精确时间不可测时写 `NOT_COLLECTED`。
- 保持现有视觉、权威状态、streaming、编辑、持久化、AO、树叶、水与 High 档基础阴影行为，使用 change-scoped Playwright 和 Midscene 检查候选路径的视觉等价性。
- 在 Delivery Snapshot 增加“最终实现清单”“实验处置矩阵”和“Shader 重写清单”，使计划与实际结果的差异成为正式交付证据。

### 非目标

- 本 change 不新增或升级光照功能、Point / Spot Light、CSM、软阴影、shadow budget、光照传播或灯具内容。
- 本 change 不新增水面波动、Fresnel、depth-aware color、refraction、Reflection Probe、Planar Reflection 或 SSR；当前水面只作为透明 pass 和性能 / 视觉回归场景。
- 本 change 不新增 Bloom、SSAO、TAA、Color Grading、滤镜、体积雾、体积云、Light Shafts、GI、Ray Tracing 或面向玩家的新增画质 UI。
- 不修改基础世界生成、canonical voxel、服务端 revision、编辑事务、Chunk snapshot、持久化身份或碰撞规则。
- 不引入 GPU meshing、compute shader、WASM、SharedArrayBuffer、Worker Pool、LOD、Occlusion Culling 或跨 Chunk 合并。
- 不用 PlayCanvas `BatchManager` 把整个世界静态合并；Chunk 继续作为 streaming、frustum culling、remesh 和 GPU 资源释放单位。
- 不更新长期 Harness 性能基线；如最终确需更新，必须获得独立明确授权。

## 关键决策

### 三期边界

1. **本期：渲染管线重写与性能实验。** 建立可测量的 batch、vertex layout、voxel shader 和 backend 候选；最终只保留正向项。
2. **功能第一期：光照、人工光源、阴影和水体。** 至少覆盖 Directional / Point / Spot 三类光源、光源与阴影预算、可扩展水体 shader，并用真实多 pass 功能验证本期管线，而不是用空 fixture 宣称架构可用。
3. **功能第二期：高级光影与画质控制。** 加入反射、后处理、滤镜等效果，并提供可调质量选项，让玩家主动权衡画质、GPU / CPU 负载、分辨率和额外 render pass。

后两期只记录路线，不在本 spec 获得实施授权；各自必须另建 spec、定义 RED、重新绑定 SHA-256 审核。

### 实验协议

1. **候选不等于承诺。** P1–P4 都是待证伪假设；Acceptance 要求的是可信实验、正确处置和最终收敛，不要求四项全部进入生产代码。
2. **一次只比较一个维度。** 每项以当时已经选定的生产候选栈为共同基线，A 与 B 除被测项外使用相同 seed、场景、相机路径、质量、分辨率、阴影、水、warmup、浏览器和设备。若候选存在技术前置，前置必须同时进入 A / B 或作为一个不可分割实验单元，不得用不同功能栈伪造收益。
3. **先测噪声。** 每个计时实验先运行同配置 A/A，建立本机本次 jitter envelope，再执行 `A → B → A → B`；需要时增加配对轮次。确定性计数指标不使用统计噪声作为借口。
4. **主指标先于数据。** 每个实验开始前在 `ab-results.md` 固定主指标、次指标和否决项。看到结果后不得更换主指标来把负结果解释成成功。
5. **正向判定。** 主指标必须向假设方向变化，且计时收益应超过同次 A/A 波动；正确性、视觉语义、资源释放、稳定性和 server authority 任一回退都直接否决。主指标改善但次指标恶化时，必须记录明确权衡并由该候选的用户体验目标判断，不能只报最好数字。
6. **负结果处理。** 首次负结果先结合 trace、shader compilation、draw / state、payload 和生命周期证据定位是实现缺陷、场景未触发瓶颈还是方案本身无收益。可在原合同内修正的实现缺陷必须重跑完整 A/A 与 A/B；确认方案不正向或修复代价超出范围时标记 `ABANDONED` 并从最终生产代码移除。
7. **实验顺序只控制归因。** 默认按 P1 batching → P2 layout → P3 shader → P4 backend 进行；前一项被放弃不自动阻塞后续项。若后续项技术上依赖前项，必须重新定义独立 control，不得把依赖项收益算给后续项。
8. **最终实现可以偏离计划。** Delivery Snapshot 以真实保留代码为准，逐项解释与初始候选的差异；不得为了让计划表“全绿”而保留中性或负向改动。

### 候选假设与初始门槛

| 候选             | A                                    | B                                            | 主指标                                                              | 正向条件                                               | 主要否决项                                             |
| ---------------- | ------------------------------------ | -------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------ |
| P1 Draw batching | FaceMaterial 分 part                 | Chunk × RenderCategory，纹理数组与材质层索引 | 固定多材质 fixture 的 draw call / material switch                   | 确定性下降，且 render / frame tail 不超出 A/A 波动恶化 | 材质错误、Greedy / AO 回退、透明或阴影错误             |
| P2 顶点布局      | 当前 attribute streams 与 index 类型 | 经验证的紧凑 / packed layout                 | transfer bytes、mesh bytes、upload / request-to-visible             | bytes 明确下降，至少一个相关计时不劣化                 | 精度或可见质量下降、CPU pack 成本造成尾延迟            |
| P3 Voxel shader  | 通用 StandardMaterial 行为           | voxel-specific shader / chunks               | shader / material variant、first-visible、render CPU / GPU 可测代理 | 体素职责更少且至少一个性能指标超过噪声改善             | 光照 / fog / alpha / depth / shadow 不一致，双后端分叉 |
| P4 Backend       | WebGL2                               | WebGPU                                       | frame p95 / p99、render CPU、long frame、稳定性                     | 目标场景计时超过噪声改善且无功能 / 稳定性回退          | fallback 冒充样本、shader 差异、启动 / 内存显著恶化    |

这些是初始假设，不是预写结论。若当前工具无法采集某项 GPU 指标，必须使用明确代理或 `NOT_COLLECTED`，不能伪造精确 GPU duration。

### 渲染与 Shader 所有权

- `src/world/` 只生成确定性的几何与 attribute data，不依赖 DOM、PlayCanvas、Worker global 或具体 graphics backend。
- PlayCanvas 继续拥有 scene traversal、frustum culling、通用 light、shadow pass、透明排序、fog、tone mapping、device 和 GPU resource lifecycle。
- 自定义 shader 只接管体素特有职责。允许实验的最小清单是：
  - Vertex：材质层、AO、法线等 attribute decode 与 varying；
  - Fragment：纹理数组 / tile repeat、材质 albedo、AO 组合；
  - Cutout：主颜色、depth 与 shadow pass 使用相同 alpha discard 语义；
  - Backend：同一行为提供 GLSL 与 WGSL，或用经过实测的可靠转换链路。
- 水体 shader、人工光源 shader、反射 pass 和 post-process shader 明确留到后续功能 change。
- 若 P3 最终被放弃，但 P1 为材质层采样必须保留最小 shader chunk，Delivery Snapshot 必须把“batching 的必要正确性代码”与“被放弃的 shader 性能重写”分开说明，不能把依赖代码包装成 P3 性能成功。

## 行为

- **Given** 任一候选 B 被启用，**When**运行固定场景，**Then**可查询唯一 experiment id、候选名、A / B、source SHA、requested / effective backend、质量档和完整 workload identity，结果不会读取上次运行遗留样本。
- **Given** A 与 B 进行配对比较，**When**两者的 seed、相机路径、分辨率、可见 Chunk、triangle、操作序列或功能开关不一致，**Then**该 pair 标记为不可比较，不得生成接受结论。
- **Given** P1 的多材质 Chunk，**When**B 路径 meshing 和 commit，**Then**不同 FaceMaterial 仍不互相 Greedy 合并，但允许共享 RenderCategory MeshInstance；opaque、cutout、transparent 的 depth / blend / shadow 语义不互相泄漏。
- **Given** P2 使用紧凑 attribute，**When**跨 Chunk、编辑后 remesh 和 AO 边界发生，**Then**解码后的几何、UV、法线、AO、材质和 indices 与 control 等价，stale result 与资源释放规则保持不变。
- **Given** P3 覆盖一个 shader 阶段，**When**主颜色、depth 或 shadow pass 消费同一 cutout 表面，**Then**alpha、AO、材质和空间变换语义一致；不允许只修主视图而产生错误深度或方块状树叶影子。
- **Given** P4 请求 WebGPU，**When**设备支持并成功创建，**Then**effective backend 必须真实为 WebGPU；不支持或创建失败时结果明确记录原因，该轮不能计入 WebGPU B 样本。
- **Given**某候选首次得到负结果，**When**证据指向范围内的实现缺陷，**Then**修正后重新运行完整实验；**Given**确认没有正向收益或存在不可接受回退，**When**本 change 收敛，**Then**候选从生产路径移除、结论标记 `ABANDONED`，其他候选可继续。
- **Given**所有实验结束，**When**交付本 change，**Then**运行时只保留 `ACCEPTED` 项及不可替代的正确性 seam，README / debug 信息反映真实 effective renderer，spec 列出最终文件、数据合同、资源路径和所有实际 shader 改写。

## 测试设计

- `tests/client/render-experiment.test.ts` 预期 RED：当前没有隔离候选、workload identity、结果状态或 comparable-pair 合同。测试固定 experiment metadata、A/A jitter、A/B 配对校验、`ACCEPTED / RETRY_REQUIRED / ABANDONED` 状态和遗留样本拒绝。
- `tests/world/mesh.test.ts` 按实际进入实现的 P1 / P2 候选先 RED：覆盖 RenderCategory grouping、稳定材质层、不同材质禁止 Greedy 合并、attribute decode 等价、AO / UV / indices 对齐、透明相邻出面、跨 Chunk 与加载顺序确定性。未进入实现的候选不得预写成必过生产合同。
- `tests/app/voxel-render-pipeline.test.ts` 按 P1 / P3 / P4 实际候选先 RED：使用纯配置或 fake adapter 验证材质 / shader registry、GLSL / WGSL 对等清单、depth / blend / shadow policy、backend requested / effective / fallback 语义和 Chunk / 共享资源生命周期。
- `changes/2026-09-05-voxel-rendering-pipeline-experiments/e2e/render-pipeline-experiments.spec.ts` 先 RED：固定多材质、森林、水边、High shadow、Chunk crossing 和编辑 remesh 场景；每个已实施候选都能单独选择 A / B，断言 workload 等价、postrender-visible、draw / MeshInstance / triangle / bytes 与资源回收。WebGPU 只接受真实 backend，否则结构化 `UNSUPPORTED`。
- `changes/2026-09-05-voxel-rendering-pipeline-experiments/e2e/render-pipeline-ab.spec.ts` 先 RED：运行 A/A 后再按 `A → B → A → B` 采样，产出每候选独立结果；不允许跨 source SHA、设备、分辨率或 workload 拼接。
- `changes/2026-09-05-voxel-rendering-pipeline-experiments/midscene/render-pipeline-parity.yaml` 在实现前定义可见语义：plains / forest / river 在 day / sunset / night 下材质、AO、树叶、水和 High 基础阴影与 control 一致，无纹理拉伸 / bleeding、错误透明、方块状叶影、Chunk 裂缝、闪烁或 material 跳层。
- `changes/2026-09-05-voxel-rendering-pipeline-experiments/ab-results.md` 在首个实验前建立空结果模板；每项先写假设和指标，再附真实 A/A、A/B、诊断、重测和最终处置。它不是手工美化后的单一最好样本。
- 既有 `tests/e2e/regression/**/*.spec.ts` 继续证明加载、输入、碰撞、编辑、streaming、持久化、地图和 Debug Shell 未回归；本 change 用例不自动提炼到长期基线。

## 验收与证据

- [x] **Experiment / Harness：** P1–P4 每项都有独立 hypothesis、control、candidate、主 / 次指标、否决项、A/A jitter、成对 A/B、source SHA、环境和 `ACCEPTED` 或 `ABANDONED` 结论；P3 标记 `NOT_RUN` 并记录原因。
- [x] **Experiment / Harness：** P1 的 draw call 和 P2 的 mesh bytes 确定性向预期改善；不声称噪声以内的计时收益；正确性、视觉、server authority、资源释放和稳定性没有已知回退。
- [x] **Experiment / Diagnosis：** P1 纹理数组上传失效、P2 v1 WebGPU 顶点格式不支持和 P4 无正向收益均已诊断并重测；P2 v1 和 WebGPU 生产切换路径已移除。
- [x] **Vitest：** 最终保留的 Mesh / attribute / shader / backend 合同具有确定性覆盖；`129 passed | 4 skipped`。
- [x] **Playwright-change：** 最终路径完成固定场景的加载、跨 Chunk、编辑 remesh、postrender-visible 和资源回收；历史 A/B workload 合同保留，运行时实验分支移除后显式 skip。最终路径 `1 passed`。
- [x] **Midscene：** 最终路径的材质、AO、树叶、水、day / sunset / night 和 High 基础阴影语义通过，未发现性能改动引入的可见回退。
- [x] **Playwright-baseline：** 现有长期浏览器回归 `9 passed`；change 用例保持在 change 目录。
- [x] **Static：** `CI=true pnpm verify:static` 通过，`src/world/**` 行覆盖率为 `94.86%`，purity、文件行数与路径规则通过。
- [x] **Build：** `CI=true pnpm build` 通过；最终 bundle 不包含运行时 A/B 选择器或 WebGPU 启动分支。
- [x] **Delivery Snapshot：** 已列出最终保留 / 放弃改动、计划差异、数据合同、性能结果、已知限制和后续边界。
- [x] **Shader 重写清单：** 已逐项记录修改和未修改的 shader 职责。

## 任务与当前状态

1. [已完成] 从引用对话提取 Mesh / Draw Call / Shader / multi-pass 心智模型、四层原始路线和性能观测前置原则。
2. [已完成] 读取当前 `AGENTS.md`、README、Visual / Client-Server / Performance changes、当前 Mesh / Material / GraphicsDevice / Shadow 实现与 Git 状态。
3. [已完成] 根据用户修订将路线调整为“当前性能实验与管线重写 + 功能一期 + 功能二期”，并把候选失败 / 放弃定义为正常结果。
4. [已完成] 选择 Breaking flow：本 change 可能修改 Mesh 输出、Worker transfer、PlayCanvas resource adapter、shader seam 和 graphics device 启动路径，但最终范围由实验结果收敛。
5. [已完成] 用户批准本修订 spec 的精确 SHA-256 `3014f0a9fc31b1678a7900cbdc91bc78f994c34578e802e5aa6bbc49f674c5e8`；Scope、Decisions、Behaviour、Test Design 或 Acceptance 再发生实质变化时必须重新审核。
6. [已完成] 建立实验结果合同和共同 fixture，在生产代码前得到实验选择器、P1 和 P2 合同的预期 RED。
7. [已完成] 逐项执行 A/A → A/B → 诊断 / 修正 → 重测 → 接受或放弃；P1、P2 接受，P3 未运行，P4 放弃。
8. [已完成] 对最终保留栈运行长期回归、静态、构建、Playwright change、Midscene 和资源回收检查，完成最终实现与 Shader 清单。
9. [已完成] 更新 Delivery Snapshot，当前位于 `codex/voxel-rendering-pipeline-experiments` 功能分支；交付时仅暂存本 change 相关文件并创建语义化本地 commit，不 push。

## 交付快照

最终生产管线固定为 `Chunk × RenderCategory` draw unit、category batching、Float16 UV + 安全时 Uint16 index、voxel texture-array shader chunks 与 WebGL2 backend。运行时 A/B query switch 和 WebGPU 启动分支已删除；调试 Harness 只暴露最终 effective pipeline。

### 最终实现清单

- `src/world/mesh.ts` 增加 `RenderCategory`、类别合批、稳定材质层编码、Float16 UV、安全 Uint16 index、解码与 byte summary；几何、AO 和不同 FaceMaterial 的 Greedy 边界不变。
- `src/worker/world-worker.ts` 只输出最终类别合批 + 紧凑布局；`src/app/playcanvas-chunk-adapter.ts` 以 `pc.TYPE_FLOAT16` 上传 UV，保留 transparent 排序与不投影策略。
- `src/app/voxel-materials.ts` 把十个 FaceMaterial 的独立材质收敛为 opaque / cutout / transparent 三个共享 `StandardMaterial`，并通过二维纹理数组取样；数组层在 mip 0 `levels` 构造时上传。
- `src/app/voxel-render-pipeline.ts`、`src/app/app-contracts.ts`、`src/app/game-harness.ts` 定义并暴露最终 renderer 合同；`src/app/world-runtime.ts` 将 Rendered 计数收敛为真正具有 triangle 的 Chunk。
- README 中英文能力说明、change-scoped Playwright / Midscene、Mesh / Shader 单测和 A/B 结果记录已同步。

### 实验处置矩阵

| 候选             | 最终状态    | 保留实现                                              | A/A 噪声                                    | A/B 主结果                               | 诊断 / 重测                                             | 放弃代码 |
| ---------------- | ----------- | ----------------------------------------------------- | ------------------------------------------- | ---------------------------------------- | ------------------------------------------------------- | -------- |
| P1 Draw batching | `ACCEPTED`  | Chunk × opaque / cutout / transparent                 | frame p95 波动 `0.6 ms`                     | draw call `39 → 25`，`-35.9%`            | 修正纹理数组上传黑色后重测通过                          | 是       |
| P2 顶点布局      | `ACCEPTED`  | Float32 position / normal + Float16 UV + Uint16 index | mesh bytes 稳定为 `329448`                  | `329448 → 274540`，`-16.7%`              | v1 的 8-bit x3 布局被 WebGPU 拒绝，v2 双后端重测通过    | 是       |
| P3 Voxel shader  | `NOT_RUN`   | 仅保留 P1 必需的最小纹理数组 chunk                    | `NOT_RUN`                                   | `NOT_RUN`                                | 无法在不复制通用 lighting / fog / shadow 的前提下单变量 | 不适用   |
| P4 WebGPU        | `ABANDONED` | WebGL2 继续作为默认后端                               | WebGL2 request-to-visible 波动约 `152.1 ms` | frame p95 无收益，可见延迟约 `+210.4 ms` | 确认真实 WebGPU，在 P2 v2 上重测仍负向                  | 是       |

更完整的原始摘要和计时边界见 `ab-results.md`。

### Shader 重写清单

| Shader / chunk                             | 路径                                    | 阶段 / pass                                      | 旧实现 / 所有者                                     | 新实现 / 所有者                                               | 语言        | 职责                                          | 关联候选   | 最终状态 |
| ------------------------------------------ | --------------------------------------- | ------------------------------------------------ | --------------------------------------------------- | ------------------------------------------------------------- | ----------- | --------------------------------------------- | ---------- | -------- |
| `diffusePS`                                | `src/app/shaders/voxel-array-chunks.ts` | Fragment；forward 表面颜色                       | PlayCanvas `StandardMaterial` 的普通 2D diffuse map | 体素所有；按顶点 alpha 材质层采样 2D texture array，再组合 AO | GLSL + WGSL | 类别合批的材质识别、tile repeat、albedo 和 AO | P1         | 保留     |
| `opacityPS`                                | `src/app/shaders/voxel-array-chunks.ts` | Fragment；forward / depth / shadow 的 alpha 语义 | PlayCanvas 的单材质 2D opacity map                  | 体素所有；与 diffuse 相同材质层的 texture-array alpha         | GLSL + WGSL | cutout / transparent 的一致 alpha 取样        | P1         | 保留     |
| Vertex transform / attribute decode        | PlayCanvas 内建                         | Vertex                                           | PlayCanvas                                          | 本期未重写；只改变 CPU/GPU attribute 布局                     | 内建        | 空间变换与 varying                            | P2         | 本期未改 |
| Lighting / fog / standalone depth / shadow | PlayCanvas 内建                         | 多 pass                                          | PlayCanvas                                          | 本期未重写；继续由 `StandardMaterial` 组合                    | 内建        | 通用光照、雾、深度和阴影管线                  | P3 / P4    | 本期未改 |
| Water / reflection / post-process          | 后续 change                             | Fragment / render pass                           | 当前简化水材质 / 无对应 pass                        | 本期未改                                                      | 不适用      | 水体、反射、后处理与滤镜                      | 后续功能期 | 本期未改 |

### 验证证据

- `CI=true pnpm verify:static`：通过；22 个测试文件通过、2 个 skip，129 tests passed / 4 skipped，`src/world/**` line coverage `94.86%`。
- `CI=true pnpm build`：通过；Vite 生产构建成功。
- `CI=true pnpm test:e2e`：长期 Chromium 基线 `9 passed`。
- `CI=true pnpm exec playwright test changes/2026-09-05-voxel-rendering-pipeline-experiments/e2e`：历史 A/B 用例 `3 skipped`，最终路径 `1 passed`；其额外验证远距离 streaming 后资源数量受界。
- `pnpm exec midscene changes/2026-09-05-voxel-rendering-pipeline-experiments/midscene/render-pipeline-parity.yaml`：`1 passed`；使用确定性 Harness fixture 验证 day / sunset / night 的材质、水体、AO、接缝和 High 基础阴影。
- `git diff --check`：通过。

### 与初始计划的差异与已知限制

- P2 没有保留初版 8-bit position / normal 压缩；跨后端格式约束使最终方案收敛为 Float16 UV + Uint16 index。
- P3 没有为凑齐计划而运行一个与 P1 不可分离的伪实验；P4 负向后已恢复 WebGL2。
- 性能数据是本机 headless Chrome 的场景内配对结果，不是跨设备通用基线；GPU 精确 duration 为 `NOT_COLLECTED`。
- WGSL chunk 作为与 GLSL 的行为对等源码保留，不代表 WebGPU 默认后端或性能收益。
- 本期没有新增光照、人工光源、阴影系统、水体高级渲染、反射、后处理、滤镜或新画质选项；它们仍按功能一期 / 二期边界另建 Breaking-flow change。
- 本地分支为 `codex/voxel-rendering-pipeline-experiments`；本 change 不 push、不发布。

后续路线只作为边界记录，不在本 spec 内实施：

1. **功能第一期：** 光照系统、人工光源、阴影系统、水体渲染；作为本期最终管线和 shader seam 的功能冒烟。
2. **功能第二期：** 反射、后处理、滤镜等高级光影功能，并提供可调画面选项以控制画质、分辨率、阴影、反射、后处理和设备负载。
