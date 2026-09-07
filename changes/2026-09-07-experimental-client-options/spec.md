# 客户端实验配置与性能回退基线

**状态：** Breaking flow；用户已批准 SHA-256 `21edebf60723d04042fa902f27c80add2f1d5cea4ecec2f2d68bee94beccd0d0`；本地实现与分层验收完成，GitHub PR 交付与远端门禁确认中

## Context & Goal

当前分支已经把经验证的 TypeScript 数据面优化作为生产实现，并默认在 General Worker 中启用 Rust Wasm `w02,w03,w04,w05,w06`。标准 SIMD128 产物会被优先装载，但上述默认内核中只有 `w06` 的打包核实际使用 SIMD intrinsic；`w02–w05` 在同一产物中仍是标量 Rust。历史 WebGPU 实验完成过真实设备验证，但本机配对样本没有整帧收益且 request-to-visible 约慢 `210.4 ms`，因此 WebGL2 仍是当前最优默认渲染后端。

本 change 把这些结论固化为可配置、可持久化、可回退的客户端合同：

- TypeScript 优化全量启用并成为不可关闭的新兜底基线。
- 默认最优组合为 WebGL2 + Rust Wasm `w02–w06` + 标准 SIMD 优先；不采用的 `w07/w10/w14/w15` 继续使用优化后的 TypeScript。
- 用户可只定向切换渲染后端、Rust Wasm 和 SIMD；关闭或能力不可用时只回退该 feature，不连带关闭其他优化。
- 配置初始化后持久化；设置界面的修改只写入下一次页面启动配置，刷新页面后生效，不热重载当前 graphics device、Wasm module 或 Worker。
- Dedicated Web Worker 是可玩硬前置；能力不满足时禁止进入。估算可用核心数低于当前 Worker 拓扑最低需求时，在进入游戏前显示可继续的性能警告。
- Harness 同时维护“优化 TS 兜底基线”和“默认全优化基线”，并记录请求配置、真实生效配置和回退原因。

## Scope & Non-goals

### Scope

- 新增 `ExperimentalClientOptions`：`renderer: 'webgl2' | 'webgpu'`、`wasm: boolean`、`simd: boolean`。
- 配置优先级为默认值 < 本地持久化 < URL 参数 < 显式初始化参数；每层逐字段覆盖。
- 设置界面新增“实验性性能”分组；用户修改后立即持久化并显示“刷新页面后生效”，同时提供“立即刷新”操作。
- URL 支持 `renderer=webgl2|webgpu`、`wasm=on|off`、`simd=on|off`；保留 `wasm=w02,w03,...` 作为 change-scoped 性能消融入口，不进入普通 UI。
- 新增 `initializeSeedlands({ experiments })`；普通入口继续自动启动，宿主可在模块执行前设置 `window.__SEEDLANDS_INITIAL_OPTIONS__` 或直接调用显式初始化函数。
- WebGPU 使用 PlayCanvas 真实异步 graphics-device 创建；不可用时只回退 WebGL2。Wasm 不可用或加载失败时只回退优化 TS；SIMD 不可用或关闭时只回退标量 Rust。
- 启动前验证模块化 Dedicated Worker 的构造与消息往返能力；硬失败时禁用进入按钮并显示原因。
- 以 `navigator.hardwareConcurrency` 作为保守核心数估算。默认运行需要 5 个长期 Worker；`generalWorkers=2` 的 Harness 配置需要 6 个。估算值低于实际请求的 Worker 数时，进入前弹出非阻断性能警告。
- 运行诊断和 Harness 暴露页面已应用配置、设置待应用配置、本次 session 请求值、实际 renderer / Wasm artifact、逐 lane / slot Worker ready 状态和回退原因。
- 升级 Harness 浏览器基线为两个明确 profile，并更新 README。

### Non-goals

- 不提供关闭已采用 TypeScript 优化的开关，不恢复最初未优化的 TypeScript 实现。
- 不把 WebGPU 设为默认，不宣称其比 WebGL2 快，也不增加 WebGPU compute、GPU meshing 或专属画质。
- 不把 `w07/w10/w14/w15` 纳入默认 Wasm，不改变 Rust 算法、数值 ABI、权威状态、提交规则或 Worker 拓扑。
- 不启用 relaxed SIMD、fastmath、线程化 Wasm、SharedArrayBuffer、Node-API 或 native 宿主。
- 不支持页面生命周期内热切换 renderer、Wasm、SIMD 或 Worker；退出世界再进入也不应用新实验配置，必须刷新页面。
- 不把高级内核列表做成普通用户的逐内核设置，也不持久化临时内核列表本身。
- 不以某次自动回退后的样本覆盖默认全优化基线，不用跨机器浏览器时延设置硬阈值。

## Decisions

### 默认组合与定向回退

| Feature           | 默认请求                             | 关闭或不可用时                                  | 不受影响项                       |
| ----------------- | ------------------------------------ | ----------------------------------------------- | -------------------------------- |
| TypeScript 优化   | 全部启用                             | 不可关闭                                        | 全部                             |
| Renderer          | WebGL2                               | WebGPU 请求失败回退 WebGL2                      | Wasm、SIMD、TS 优化              |
| Rust Wasm         | `w02–w06`                            | 优化 TypeScript 核                              | Renderer、TS 优化                |
| SIMD              | 开，仅 `w06` 实际使用 SIMD intrinsic | 标量 Rust artifact；其后仍可因 Wasm 失败回退 TS | Renderer、Wasm 是否开启、TS 优化 |
| `w07/w10/w14/w15` | 优化 TypeScript                      | 不提供普通开关                                  | 其他内核                         |

`simd=true` 表示请求标准 SIMD128 artifact，不表示每个已选 Rust 内核都执行向量指令。诊断必须同时报告 artifact mode 和 selected kernels，避免把 `w02–w05` 误称为 SIMD 算法。

### 配置解析、持久化与页面冻结

1. 默认公开配置为 `{ renderer: 'webgl2', wasm: true, simd: true }`。
2. 本地键为 `seedlands.experiments.v1`，只接受完整且类型合法的三个公开字段；损坏、未知或旧格式数据被忽略，不阻塞启动。
3. URL 只覆盖出现且合法的字段。`?wasm=` 作为既有兼容特例表示关闭；`?wasm=garbage` 忽略该字段；`?wasm=w04,garbage,w04` 过滤并去重为 `w04`。
4. 显式初始化参数最后覆盖 URL。未给出的字段继承低优先级值。
5. 初始化解析完成后，把最终三个公开字段写入本地存储，再形成不可变的 `appliedConfig`；初始化失败不提交持久化。高级 URL 内核列表只在本页的内部 `appliedKernels` 中保留，持久化仅保存 `wasm: true`，下次没有该 URL 时恢复默认 `w02–w06`。
6. 设置 UI 展示 `pendingConfig`。用户修改某字段时立即保存完整 pending 配置，并通过 `history.replaceState` 仅移除该字段对应的实验 URL 参数，避免旧 URL 在刷新后反向覆盖手工选择；其他 URL 参数及未修改的高级内核列表保持不变。
7. 页面启动后 `appliedConfig` 永不变化。设置修改不影响当前世界，退出重进也不生效；UI 显示待应用状态，用户点击“立即刷新”或自行刷新后重新解析并应用。
8. 显式初始化参数是宿主每次加载的最高优先级控制。如果宿主持续提供某字段，它在每次刷新时仍覆盖用户本地值；设置界面必须标注该字段由宿主覆盖，不能承诺手工值会生效。
9. `Game.start()` 每次克隆页面冻结的 `appliedConfig` 为 `sessionRequested`；真实运行结果写入 `sessionEffective`。设置 pending 值不得与当前 session 状态混写或形成伪 fallback。

### 设置界面语义

- Renderer 使用 select：`WebGL2（推荐）`、`WebGPU（实验性）`。
- Wasm 与 SIMD 使用独立原生 checkbox，并排成两条紧凑设置行：名称/说明在左，checkbox 在右，整行可点击。checkbox 不继承文件输入的整行宽度和全局控件最小高度；Wasm 关闭时 SIMD 控件禁用并明确提示“需要先启用 Rust WebAssembly”，但保留 SIMD 偏好；再次开启 Wasm 后恢复。
- 任一实验选项变化后显示 `配置已保存，刷新页面后生效` 和“立即刷新”按钮。不得调用 `Game.leaveWorld()`、重建 `pc.Application`、替换 Worker 或动态装卸 Wasm。
- 自动回退不改写 pending / 持久化请求值。设置显示用户选择；Debug / Harness 显示 requested、effective 和结构化原因。

### Worker 能力与低核心数预警

- 支持门禁不是只检查 `typeof Worker`。初始化时创建一个同源 module Worker probe，要求在超时内完成消息往返后立即 terminate；构造失败、消息失败或超时均标记 `workerSupport='unsupported'`。
- Worker 不支持时主菜单仍可打开设置和指南，但“进入世界”与“继续世界”禁用，并显示“当前浏览器不支持运行游戏所需的 Web Worker”。不得静默退回主线程。
- `requiredWorkerCount = 4 + generalWorkerCount`：Authority、Logic、Persistence、Fluid 各 1 个，加 1 或 2 个 General。默认值为 5。
- `navigator.hardwareConcurrency` 是估算值；缺失、非有限或小于 1 时按 1 处理并标注 `estimated`。若估算核心数小于 `requiredWorkerCount`，点击进入先展示警告，包含两者数值和“可能出现加载慢或卡顿”；用户可取消或明确“仍然进入”。同一页面确认一次后不重复，刷新后重新判断。
- 能力 probe 通过不替代真实 Worker ready。任何生产 Worker 启动失败仍走现有错误反馈并释放全部已创建资源。

### 渲染设备生命周期

- `createSceneApplication` 改为异步并接收 requested renderer。WebGL2 请求仅允许 WebGL2；WebGPU 请求的 device 顺序为 WebGPU、WebGL2，使用 PlayCanvas `createGraphicsDevice` 创建并注入应用。
- 必须从 `app.graphicsDevice.deviceType` 读回 effective renderer。结果只有 `matched | fallback`；Null device 不是可玩回退，必须销毁并使启动失败。
- `Game.start()` 等待应用创建后再构造材质、环境、控制器和 Worker。每次 start / abort / leave 推进启动代次；迟到的 device、材质、Worker session 只能销毁，不能提交到新 session。
- `FINAL_RENDER_PIPELINE` 保持 draw unit、布局和 shader 合同；backend 改为 session 运行时读回值。

### Wasm / SIMD 协议与真实生效状态

- Worker 名称协议为 `seedlands-wasm:v2:<simd|scalar>:<comma-separated-kernels>`。旧 `seedlands-wasm:<kernels>` 按 SIMD preference 解析；空名称为 Wasm off。编码器稳定排序、去重并只接受 `KERNEL_NAMES`；解析器拒绝未知 version / mode。
- `BrowserComputeRuntime` 接收 `sessionRequested` 解析出的 worker kernel 配置，worker factory 不再读取 `location.search`。
- SIMD 关时 loader 只 fetch scalar；SIMD 开时按 SIMD → scalar。Wasm 关时不 fetch、不 validate、不 instantiate 任一 Rust artifact。
- 每个 Worker slot 状态为 `pending | off | matched | scalar-fallback | typescript-fallback`，并包含 `requestedArtifact`、`effectiveArtifact`、selected kernels、可选失败原因、epoch、lane 和 index。
- Worker loader 完成后发送 `compute-worker-ready`。Pool 为当前 slot 补齐 identity；slot 创建或重启重置 pending，10 秒未 ready 进入既有最多三次重启路径，旧 worker / epoch 的迟到 ready 被忽略。
- 默认内核不含 `w07`，所以 Fluid slot 合法报告 `off / no-selected-kernel`；General slot 报告实际 artifact。不得把全局 Wasm on 伪报为每个 lane 都使用 Wasm。
- 已知答案、SHA-256、模块失败回退优化 TS 和单内核运行失败回退保持不变。

### 显式初始化与事务回滚

```ts
type SeedlandsInitializationOptions = {
  experiments?: Partial<ExperimentalClientOptions>;
};

initializeSeedlands(options?: SeedlandsInitializationOptions): Promise<void>;
```

- 新建无副作用 bootstrap 模块。`src/app/main.ts` 只读取 `window.__SEEDLANDS_INITIAL_OPTIONS__` 并调用一次；集成方可直接导入并显式调用。
- 状态机为 `idle → starting → ready`。starting / ready 状态重复调用立即拒绝，不创建第二套 UI、监听器或 runtime。
- 首次失败必须卸载本轮 UI、移除新增监听器、terminate probe、销毁 Game / graphics 资源并恢复 idle；清理完成后允许重试。配置只在初始化成功后持久化。

### Harness 双基线

- `harness/baseline.json` 升级 schema，保留现有 Node / 纯 TS 指标，并新增两个浏览器 profile：
  - `typescriptFallback`：WebGL2、优化 TS 全开、Wasm off、SIMD 不参与，默认 5 Worker 拓扑。
  - `defaultOptimized`：WebGL2、优化 TS 全开、Wasm `w02–w06` on、SIMD on，默认 5 Worker 拓扑。
- 浏览器 benchmark 对每个 profile 采集至少 3 个隔离 Browser Context 样本，记录 initial-world-ready、稳定场景 frame p95/p99、30 秒 non-idle task duration 和受控编辑 request-to-visible p95/p99；汇总保留原始样本与 p50，不以单次最快值代表基线。
- 每个 profile 都保存 source SHA、浏览器 / OS / CPU 估算、requested / effective 配置和 Worker slot artifact 状态。只有实际配置匹配 profile 时才能更新该 profile 基线；例如默认 profile 自动回退 TS 时标记 `FALLBACK_NOT_BASELINE`，不得覆盖 `defaultOptimized`。
- `pnpm harness:baseline` 在同一 build、source SHA、run id 和环境中采集两个 profile 后原子更新；`pnpm harness` 同样采集两者，并只与相同 profile、相同可比环境比较。浏览器跨机器时延继续不设硬阈值，环境不一致标记 `NOT_COMPARABLE`。
- 两个 profile 的差异只用于验证回退和观察 Rust 增量收益；Node 纯 TS 指标继续与自己的历史基线比较，不能替代浏览器 profile。

## Behaviour

- **Given** 无任何覆盖，**When**初始化并进入世界，**Then**请求 WebGL2、Wasm `w02–w06` 和 SIMD artifact；`w06` 可执行 SIMD 路径，`w02–w05` 为标量 Rust，其他核为优化 TS。
- **Given** 持久化、URL 和显式初始化冲突，**When**解析，**Then**按“显式初始化 > URL > 持久化 > 默认”逐字段得到 applied 配置，并在初始化成功后持久化。
- **Given** 用户在设置中改变一个 feature，**When**不刷新而退出 / 重进世界，**Then**当前页面仍使用旧 applied 配置；**When**刷新，**Then**使用已保存的新配置，且只改变该 feature。
- **Given** 桌面或窄屏设置面板，**When**显示 Rust Wasm 与 SIMD 开关，**Then**每项保持同一行、checkbox 为原生紧凑尺寸并右对齐，不出现独立居中的巨大勾选框，文字不被控件挤出面板。
- **Given** 手工修改字段同时存在对应 URL 参数，**When**保存，**Then**只移除该字段 URL override 并保留无关参数，使刷新后本地选择可生效。
- **Given** `?renderer=webgpu&wasm=off&simd=off`，**When**进入世界，**Then**真实请求 WebGPU、不加载 Wasm；WebGPU 不可用时只回退 WebGL2，TS 优化和 Worker 拓扑保持。
- **Given** `?wasm=w04,w06&simd=off`，**When**General Worker 初始化，**Then**只选 `w04,w06` 且只请求 scalar artifact。
- **Given** SIMD 请求失败但 scalar 成功，**When**ready，**Then**报告 `scalar-fallback`；scalar 也失败时报告 `typescript-fallback` 并继续使用优化 TS。
- **Given** module Worker probe 失败，**When**主菜单就绪，**Then**禁止进入但设置 / 指南仍可用，不创建生产 Worker。
- **Given** 核心数估算为 4 且默认需要 5 Worker，**When**用户点击进入，**Then**先显示可取消的性能警告；确认后才启动，警告本身不改 Worker 数或实验配置。
- **Given** 默认 Fluid lane 没有 `w07`，**When**所有 slot ready，**Then**Fluid 报告 no-selected-kernel，General 报告真实 artifact，全部记录属于当前 epoch / lane / index。
- **Given** WebGPU 实际回退 WebGL2，**When**读取诊断，**Then**requested 为 webgpu、effective 为 webgl2、状态为 fallback；该样本不得更新 WebGPU 或 defaultOptimized 基线。
- **Given** 初始化中或成功后再次初始化，**When**重复调用，**Then**明确拒绝且不重复挂载；首次失败清理完成后可重试。
- **Given** start 被 abort / leave / 新代次取代，**When**旧异步资源迟到，**Then**资源被销毁且不能覆盖当前 session。

## Test Design

### 预期 RED

- `tests/client/experimental-client-options.test.ts`：默认值、逐字段优先级、非法 / 损坏输入、初始化后持久化、pending / applied 冻结、URL 定向移除和高级内核列表。
- `tests/app/client-capability-preflight.test.ts`：module Worker probe 成功、构造 / 消息 / 超时失败、5 / 6 Worker 核心估算、缺失 hardwareConcurrency 和一次性确认。
- `tests/worker/wasm-loader-fallback.test.ts`：Wasm off 零 fetch、SIMD off 仅 scalar、SIMD → scalar → TS 状态和 artifact 读回。
- `tests/worker/data-plane-defaults.test.ts`：v2 Worker 名称编解码、旧协议、非法 mode / version、默认 `w02–w06`、只有 `w06` SIMD 的诊断语义。
- `tests/client/compute-worker-pool.test.ts`：ready identity、pending、10 秒超时、重启、旧 slot / epoch 迟到消息拒绝。
- `tests/app/scene-bootstrap.test.ts`：WebGL2 默认、WebGPU device 顺序、effective readback、WebGL2 fallback、Null / 失败清理。
- `tests/app/application-shell.test.ts`：设置持久化、刷新前不生效、退出重进也不生效、Wasm 关闭保留 SIMD 偏好、Worker 硬阻断和低核心数警告。
- `tests/app/bootstrap.test.ts`：显式初始化、预初始化 global、成功后持久化、重复调用拒绝、事务回滚和重试。
- `tests/app/game-start-generation.test.ts`：abort / 新 start 后迟到 device、material 和 worker-session 被销毁。
- Harness runner / result helper 测试：双 profile、同 run / SHA、effective profile 校验、回退不覆盖基线、跨环境 `NOT_COMPARABLE`。

上述合同当前均不存在或与“下次进入世界生效 / 初始化不持久化”的旧草案语义相反，新增断言应先记录 RED，再实现到 GREEN。

### 浏览器与可见证据

- `changes/2026-09-07-experimental-client-options/e2e/experimental-client-options.spec.ts`（Playwright-change）：验证设置保存后刷新生效、未刷新及退出重进不生效、URL / 初始化优先级、Worker 硬门禁、低核心数警告、WebGPU / Wasm / SIMD requested-effective 回退、核心编辑旅程，以及两个开关在桌面/窄屏中的紧凑同行布局。
- `changes/2026-09-07-experimental-client-options/midscene/experimental-settings.yaml`（Midscene）：验证实验设置、推荐默认、风险说明、刷新提示、禁用关系、Worker 不支持错误、低核心数警告，以及 checkbox 不脱行/不异常放大的视觉语义。
- `tests/e2e/benchmark/initial-world.spec.ts` 与 result helper 扩展为双 profile 隔离采样；`pnpm harness` 关联同一 run id / source SHA 后再聚合。
- 长期回归继续证明默认加载、输入、存档、streaming 和编辑行为；本 change 用例不自动提炼进长期基线。

## Acceptance & Evidence

- [x] **Vitest：** `pnpm test` 为 183 个文件通过、3 个文件跳过，872 个用例通过、5 个跳过；配置、ApplicationShell、Worker probe、renderer、Wasm / SIMD loader、ready / restart 与 Harness profile helper 均有 GREEN 证据。
- [x] **Playwright-change：** `pnpm exec playwright test changes/2026-09-07-experimental-client-options/e2e` 为 5/5 通过，覆盖桌面与 390 px 窄屏紧凑开关、刷新生效、SIMD 依赖提示、URL / 初始化 scalar Wasm、WebGPU readback / fallback、Worker 硬门禁与低核心数确认。
- [x] **Midscene：** 交互式 zsh 读取用户全局配置后，`pnpm midscene:verify-model` 通过；指定系统 Chrome 执行 `experimental-settings.yaml` 为 1/1 通过，耗时 65.91 秒，覆盖设置入口、推荐默认、下拉选项、紧凑开关、变更提示与返回主菜单。报告位于忽略目录 `midscene_run/report/experimental-settings-2026-09-07_15-41-59-d3717d06.html`。
- [x] **Playwright-baseline：** 关联运行 9/9 通过；TS profile 真实命中 WebGL2 + Wasm off，默认 profile 真实命中 WebGL2 + SIMD artifact + `w02–w06`，Fluid lane 均按合同报告 `off / no-selected-kernel`。
- [x] **Harness：** run `eac329ff-efb8-4221-97f8-cccdecb48cf2`、source `044d2920a8db3038b18e77c4e952bc2876f0172f`、Node `v24.20.0` / darwin arm64 / Chromium / 12 核估算下，两个本 change profile 均为 PASS 且已写入 schema v2 基线。聚合命令同时报告了本 change 未修改的 World Mutation 独立门禁失败：10k single edit p50/p95 为 `8.60/9.47 ms`，上限 `3.86/4.73 ms`，100k batch speedup `0.98x`，要求 `>=2x`；该项保留为跨 change 已知风险，不冒充本 change profile 失败。
- [x] **Static：** 格式、ESLint、路径检查与类型检查通过；coverage 限制为 4 workers 后为 182 个文件通过、2 个跳过，863 个用例通过、4 个跳过，coverage 为 statements 95.37%、branches 90.42%、functions 96.93%、lines 96.89%。默认并发的两次重复运行分别让未触及的 Wasm mesh 与 headless CLI 长用例越过各自 30 秒 / 15 秒超时，对应 Wasm 文件单跑 6/6 通过；该机器负载敏感性保留在证据中，并由 GitHub Actions 当前 PR revision 再确认。`CI=true` 本地入口还在执行脚本前被 pnpm 供应链检查阻断，错误为 `devalue@5.9.2` 无法从当前 registry manifest 验证 minimumReleaseAge，未改 lockfile、registry 或策略规避。
- [x] **Build：** `pnpm build` 通过，Wasm 源码 / artifact 指纹、TypeScript / Svelte 和 Vite 生产构建均通过；产物包含 WebGL2 / WebGPU 路径、scalar / SIMD Wasm 和 `capability-probe-worker`。`CI=true` 与 Static 共用的 pnpm 前置检查仍受上一项环境阻塞。
- [x] **Documentation：** README 与中文镜像记录默认组合、TS 不可关闭、配置入口与优先级、刷新生效、持久化、定向回退、Worker 门禁和警告。
- [x] **Delivery Snapshot：** 已写回实现路径、验证命令、浏览器环境、双基线数据、真实 requested / effective 状态与限制；因仍有两项未准出，不创建 Delivered 本地提交。

## Tasks & Current State

1. [已完成] 读取当前分支、历史 WebGPU / Wasm 性能结论、当前 scene bootstrap、Worker 拓扑、设置 UI、初始化入口和 Harness runner。
2. [已完成] 确认 Breaking flow：重新引入可选 graphics backend，改变公开初始化、页面生命周期、Worker 协议和 Harness 基线 schema。
3. [已完成] 完成一次受控 Sol/xhigh 只读架构复核；已吸收 pending / applied / effective 隔离、逐 slot ready、协议 version、初始化回滚和迟到资源处置建议。
4. [已完成] 按用户最终方案更新合同：TS 固定基线、默认部分 Wasm / SIMD、刷新生效、初始化持久化、Worker 硬门禁、低核心警告和 Harness 双 profile。
5. [已完成] 用户批准新版精确 spec hash 后，新增 Vitest、Playwright-change、Midscene 与 Harness 双 profile 合同。
6. [已完成] 实现配置、设置 UI、bootstrap、capability probe、renderer、Worker 配置注入、Wasm / SIMD 状态和 Harness 双基线。
7. [已完成] 限制并发的 Vitest、build、Playwright change / baseline、Midscene 与同源 Harness 双 profile 已运行；默认并发静态入口的两个未触及长用例超时、CI 供应链检查和既有 World Mutation 性能门禁均按证据边界保留。
8. [进行中] README、Acceptance 和 Delivery Snapshot 已更新；用户已检查 GUI 并授权创建 GitHub PR，当前进入提交、推送与远端 readiness 跟踪。

## Delivery Snapshot

### 已实现范围

- 配置与入口：`src/client/experimental-client-options.ts`、`src/app/bootstrap.ts`、`src/app/application-shell.ts` 和设置 Svelte UI 实现默认 / 存储 / URL / 显式初始化优先级、页面冻结、保存后刷新生效和定向 URL override 移除。
- 运行与回退：scene bootstrap 支持真实 WebGPU 请求及 WebGL2 readback fallback；General / Fluid Worker 使用 v2 Wasm 协议和 ready handshake，逐 slot 报告 matched / scalar fallback / TS fallback；Worker probe 与低核心数确认在进入游戏前完成。
- Harness：浏览器 benchmark 维护 `typescriptFallback` 和 `defaultOptimized` 两个 profile，每个 3 个隔离 context、30 秒稳定窗口；Node Harness 改为内存 Rollup runtime bundle，避免手写 data URL 依赖图随源码漂移。
- 文档与测试：README 双语说明已更新；变更 E2E、Vitest 与长期浏览器回归均有实际通过记录。

### 双 profile 浏览器数据

| 指标                                     | 优化 TS 兜底 | 默认全优化 | 默认相对 TS |
| ---------------------------------------- | -----------: | ---------: | ----------: |
| 初始世界就绪中位数                       |   1139.73 ms | 1181.36 ms |      +3.65% |
| 稳定帧 p95 中位数                        |     17.30 ms |   17.40 ms |      +0.58% |
| 稳定帧 p99 中位数                        |     17.60 ms |   17.70 ms |      +0.57% |
| 30 秒 non-idle task 中位数               |   5217.94 ms | 5244.70 ms |      +0.51% |
| 编辑 request-to-visible p95 / p99 中位数 |     39.64 ms |   38.49 ms |      -2.90% |

这是同机环境观察值，不是跨机器硬阈值。默认 profile 的 General Worker 三次均真实装载 SHA-256 `320402dd0e3b8df902a106ef1a584f56236bad6ad3075628e42bce8b341b14d4` 的 SIMD artifact，并选择 `w02–w06`；其中仅 `w06` 有显式 SIMD intrinsic。整体收益没有形成稳定显著优势：稳态帧与 task duration 基本持平，编辑可见延迟约快 2.9%，启动时延在本轮反而慢 3.65%。主要原因是 Rust 核只覆盖 General Worker 的部分生成 / 网格批处理，稳态帧、渲染、Authority、资源加载与 Worker 启动仍占主要端到端路径，同时 `w02–w05` 只是同一 SIMD artifact 内的标量 Rust，边界与准备成本会稀释内核收益。

### 已执行命令与限制

- `pnpm exec vitest run --coverage --maxWorkers=4`：182 个文件通过、2 个跳过，863 个用例通过、4 个跳过；`pnpm build`：PASS；`pnpm exec playwright test changes/2026-09-07-experimental-client-options/e2e`：5/5 PASS；关联长期 Playwright：9/9 PASS。
- `pnpm harness:baseline` 的浏览器阶段与两个 profile 均 PASS，`harness/baseline.json` 已更新；最终进程因上文独立 World Mutation 门禁返回 1。当前 diff 未修改 `src/server/game-server.ts`、`world-mutation.ts` 或 `world-transaction-commit.ts`，因此该回归保留为显式阻塞，不在本 change 扩张修复范围。
- `CI=true pnpm verify:static`：在脚本执行前被 pnpm registry / minimumReleaseAge 检查阻断；普通本地确定性入口已通过。
- `pnpm midscene:verify-model`：交互式 zsh 下 PASS；Midscene YAML：1/1 PASS。修复前后截图与联合对照保存在本 change 的 `evidence/`，根目录 `design-qa.md` 结论为 `passed`。
- 尚未发布或合并；用户已授权创建 GitHub PR 并持续处理到可合入，远端 source SHA、Actions、review 与 mergeability 将在推送后回填。
