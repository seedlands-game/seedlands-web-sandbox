# 流体几何过渡进展

绑定方案：`changes/2026-09-06-independent-loops-unified-physics/spec.md`，批准 SHA-256：`c14711d82070e0b9c255eda0bfc5b2bbd134d130a8c45dacf662480e9b953512`。

## 目标与边界

本项只替换已提交流体状态的可见网格过渡，不改变权威流体、碰撞缓存、介质采样、水面高度定义或反射面选择。权威提交仍立即驱动物理；180ms 视觉过渡只消费旧、新两个已接纳 Chunk 网格，不能延迟或反向写入权威状态。

现有 `playcanvas-chunk-adapter.ts` 同时保留完整旧、新透明 Mesh，并通过 `material_opacity` 对整块 Chunk 交叉淡化。该路径会让未变化的静水也整块闪动，并让两份水面同时进入透明渲染，形成倒影和透明重影。本项删除该路径。

## 设计决策

采用 `Chunk × water surface patch` 的单几何过渡：

- 透明分类当前只包含 `FaceMaterial.Water`。Mesher 的批处理会合并材质，但仍保留每四个顶点一个轴对齐贪心四边形。因此适配器可以从既有 `MeshPart` 恢复水面描述，不修改 `src/world/` 或 Worker 协议。
- 把旧、新贪心四边形按整数体素边界拆成稳定单元面，键由法向轴、所在平面和面内单元坐标组成。水位改变、贪心合并或拆分时不依赖顶点索引一一对应。
- 同键面从旧顶点变形到新顶点；新增面从相邻旧面共享边界推进，没有相邻旧面时从本格底面升起；撤除面向相邻新面边界或本格底边收退。过渡 Mesh 使用旧、新面键的并集，同一稳定面只出现一次。
- 过渡期间隐藏旧水实例和新水最终实例，只显示一份并集过渡 Mesh；完成后销毁过渡资源并显示新水最终 Mesh。材质透明度保持正常值，不设置每实例 `material_opacity`。
- 每帧只更新一个 PlayCanvas 原生 Morph 权重。起点、终点和稀疏位置差在准备阶段一次生成并上传，避免每帧在 CPU 重写全顶点缓冲；水材质仍根据变形后的 `vPositionW` 采样世界空间倒影。
- 单 Chunk 拆分面数设硬上限。超过预算时跳过动画并直接显示已提交新 Mesh，绝不退回旧、新整块叠加。工作量只与被替换 Chunk 的两个水 Mesh 有关，不扫描世界，也不创建逐体素 Entity。
- 连续 remesh 会先结束较早过渡并显现其已接纳终态，再以该终态建立下一次过渡；旧 epoch、Chunk 淘汰和世界销毁均取消动画并释放 Morph、临时 Mesh 和实例。取消与完成必须幂等，旧资源仍只销毁一次。

## 预置测试与 RED

新增 `tests/app/water-surface-transition.test.ts`，在改生产接线前覆盖：

1. 完全相同的静水 Mesh 返回 `unchanged`，不得启动动画。
2. 相同单元面的水位变化生成唯一面，起点为旧高度、终点为新高度，中间值单调。
3. 贪心二格旧面与拆分/不同高度的新面按稳定单元键匹配，不产生旧、新重叠面。
4. 新增水面优先从相邻已提交水面共享边界展开；孤立新增面从本格底面升起。
5. 撤水面收退后退化，并在最终 Mesh 切换时消失。
6. 超过单 Chunk 面预算返回 `budget-exceeded`，不分配无界过渡几何。

新增适配器定向测试，证明生产接线不再设置水实例 opacity；准备过渡时旧、新最终水实例均隐藏且只有一个临时 Morph 实例可见；完成、打断和销毁后资源被一次性释放。测试须先在旧整块淡化实现上得到 RED，再实现至 GREEN。

## RED 证据

`CI=true corepack pnpm exec vitest run tests/app/water-surface-transition.test.ts tests/app/playcanvas-water-transition-adapter.test.ts`：预期 RED。纯几何套件因生产模块尚不存在而无法导入；适配器套件在旧实现上确认旧水实例仍可见，且连续替换没有清理临时几何，2 项均失败。旧实现同时触发 PlayCanvas `Could not find current application` 警告，来源是整块 opacity 参数路径，不作为新用例的通过条件。

## 当前状态

- 已完成 `water-surface-transition.ts`：从旧、新透明 `MeshPart` 恢复轴对齐水面，把贪心四边形拆成稳定单元面，并生成一份起点加位置差的并集几何。水位变化、贪心拓扑拆并、相邻推进、孤立新增、相邻收退和垂直边界移动均有定向断言。
- 已完成 `playcanvas-water-transition.ts`：使用一份 `pc.Mesh`、一个 `pc.MorphTarget` 和一个 `pc.MeshInstance`。每帧只改 Morph 权重；水材质、世界空间 UV/倒影采样和最终 Chunk Mesh 继续使用现有路径。
- 已完成 `playcanvas-chunk-adapter.ts` 生产接线：删除旧 `material_opacity` 整块交叉淡化。过渡期间隐藏旧、新最终水实例，只挂载一个临时变形实例；完成或取消后释放临时实例并显示当前已提交 Mesh。
- 连续 remesh 会先取消旧动画并完成其资源交接，再从最近已接纳终态生成下一次动画。新资源在首次 `postrender` 前被判旧、Chunk 淘汰或世界销毁时，准备阶段的取消钩子恢复旧可见水面并幂等销毁临时资源。
- 每 Chunk 最多 `16384` 个稳定面；超过后直接显示已提交终态。全世界同时最多 `8` 个水面动画；达到上限的新提交直接显示终态。最坏单个动画上传 `65536` 个顶点以及一份同尺寸位置差，CPU 构建只读取该 Chunk 的旧、新水 Mesh，不扫描其他 Chunk。已加载资源额外保留原有水 `MeshPart` 引用用于下一次替换，不复制权威体素或建立逐体素 Entity。

## GREEN 与待验收证据

- `CI=true corepack pnpm exec vitest run tests/app/water-surface-transition.test.ts tests/app/playcanvas-water-transition.test.ts tests/app/playcanvas-water-transition-adapter.test.ts tests/app/water-mesh-transition.test.ts tests/app/chunk-resource-repository.test.ts`：`5` 个文件、`18` 项全部通过。覆盖静水跳过、真实水位高度、贪心拓扑变化、推进/收退、面预算、单实例、无 opacity、连续替换、首次渲染前丢弃、全局并发预算、最近记录上限、Morph 权重、创建失败清理和幂等销毁。
- `CI=true corepack pnpm test` 的最新完整并行运行：`117` 个文件通过、`2` 个失败、`2` 个跳过；失败为 `tests/server/headless-session.test.ts` 与 `tests/server/server-headless-cli.test.ts` 各一项固定 `5s` 超时，均不经过本项水面模块。随后以 `--no-file-parallelism --maxWorkers=1` 单独复验这两个文件，`13` 项全部通过。该结果记录为共享套件并行负载失败，不能把完整 Vitest 记为 GREEN；本项 `17` 项定向用例保持 GREEN。
- `corepack pnpm exec eslint` 对本项生产、Vitest 与 Playwright 文件执行：通过。
- 本项完成时曾运行 `corepack pnpm build`，Svelte、生产与测试 TypeScript 检查和 Vite 生产构建均通过。补充 Morph 创建失败清理后再次运行时，共享工作树新出现的 `authority-load-performance.spec.ts` 与 Harness 类型未同步，产生 `13` 个测试 TypeScript 错误，完整 `pnpm build` 因此不再是最新 GREEN。最终源码另以 `corepack pnpm exec tsc --noEmit && corepack pnpm exec vite build` 复验通过；已有大 bundle 提示未变为错误。该外部测试类型阻塞须由其归属任务收口。
- `corepack pnpm lint:paths`：通过。
- 已新增 `changes/2026-09-06-independent-loops-unified-physics/e2e/fluid-geometry-transition.spec.ts`，程序化检查静水重网格不启动动画、动态边界只记录一份几何且无 opacity crossfade、动画最终完成，以及连续提交打断旧动画后由更高 revision 的后继动画完成。完成时同时要求 Mesh 队列、延后重网格、上传队列和 active transition 全部归零；最近完成/取消记录维持 `32` 条硬上限。
- 生产快照 `3e65ff2` 的首次 headed 运行在旧断言处失败：断言把首次观察到的 held trace 当成必须完成的终态。在 `4278` 上独立重复 `9` 次可复现 `2` 次失败；随后 `/private/tmp/seedlands-preview-3e65ff2/changes/2026-09-06-independent-loops-unified-physics/e2e/fluid-geometry-transition-debug.spec.ts` 连跑 `12` 次，其中 `2` 次捕获该 trace 在进度 `0.28/0.37` 被更高流体提交取消，最终 `activeCount=0` 且 Mesh、延后重网格、上传队列均为 `0`。后继提交的水面几何与当前已接纳终态相同，因此直接显示最新 Mesh，没有产生另一条动画记录；这不是资源泄漏，但旧断言错误等待了已明确 superseded 的 trace。
- 同一生产快照的独立单例取证确认未被打断的真实过渡约 `200ms` 内从进度 `0` 单调到 `1`，`frameCount=13`、`completed=true`、`activeCount=0`。修订后的用例改用暂停流体的直接世界编辑固定完成一条真实 Morph，再显式制造两个连续已提交 revision：旧 trace 必须 `superseded=true`，后继 trace 必须 `completed=true` 且进度为 `1`。修订后的定向 Vitest `4` 文件 `15` 项、Prettier、ESLint 与 `git diff --check` 均通过；测试 TypeScript 全量检查被其他任务尚未提交的 `browser-authority-client.ts` 未使用导入阻塞。主线浏览器独占切换后尚待在最新不可变生产快照复跑，不能提前记为 Playwright GREEN。
- 已新增 `changes/2026-09-06-independent-loops-unified-physics/midscene/fluid-geometry-transition.yaml`，观察中间帧的单一前沿、无双层透明墙/双重倒影、静水不闪动、世界空间纹理连续，以及完成后无旧面残片。自然视觉和 1920×1080 Medium 性能仍由 Astra 主线准出，本记录不代替该证据。

当前实现已满足可审查的生产接线、纯逻辑与资源生命周期证据；最终准出仍取决于上述 Playwright-change、Midscene 和主线自然视觉/性能检查。视觉动画不参与权威碰撞、介质或流体提交，跳过动画也不会延迟已提交状态。
