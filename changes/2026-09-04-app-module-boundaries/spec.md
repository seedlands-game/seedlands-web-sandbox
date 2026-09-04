# App 模块边界与文件体量治理

**状态：** 实施完成，Midscene 环境阻塞（Breaking flow）

## Context & Goal

`src/app/main.ts` 同时承担启动、DOM 查询、Macro 地图、浏览器存档、Chunk streaming、Worker 调度、GPU Mesh 提交、玩家输入/碰撞、HUD、Harness 与保存生命周期，当前达到 1454 行；`visual-environment.ts` 与 `style.css` 也分别达到 376 行和 448 行。职责耦合使局部修改需要理解整条浏览器运行链路，也缺少阻止文件继续膨胀的自动门禁。当前全部 CSS 又由 `main.ts` 的 module import 才开始加载，HTML 首屏会先以无样式状态绘制，再切换成启动面板，产生可见闪烁。

目标是在不改变玩法、存档、世界生成、Worker 协议和最终视觉设计的前提下，把 `src/app/` 按稳定职责拆成可独立理解的模块，用 ESLint 对全仓库 JavaScript/TypeScript 文件设置统一体量上限，并让首屏关键样式由 HTML `<head>` 在 JavaScript 之前直接加载，消除无样式闪烁。

## Scope & Non-goals

### 范围

- 将 `main.ts` 收敛为浏览器启动与入口装配，只保留创建 `Game`、恢复存档和进入世界的入口事件。
- 将 DOM 引用、Macro 地图、浏览器存档、世界 streaming 协调、Worker Mesh 任务、GPU Mesh 生命周期、玩家控制/碰撞、HUD、Harness、质量档、材质创建和世界环境分别迁移到职责明确的模块。
- 将不依赖 JavaScript 的首屏基础布局、`[hidden]`、Canvas 背景、启动面板和表单样式迁移到 `public/assets/styles/start-screen.css`，由 `index.html` 的 `<head>` 以 `<link rel="stylesheet" href="/assets/styles/start-screen.css">` 直接加载。
- 将剩余运行时 CSS 按 HUD/快捷栏、Macro 地图和响应式职责拆到 `src/app/styles/`；JavaScript 只加载进入世界后需要的样式，不再承担首屏关键样式发现。
- 在真实项目 ESLint 配置中为仓库内所有 `*.{js,mjs,cjs,ts,mts,cts}` 启用 `max-lines`：最多 500 行有效代码，忽略纯空行和纯注释行；覆盖根配置、`src/`、`tests/`、`scripts/` 和 active/historical change E2E，现有 ignore 目录保持排除。
- 新增真实 ESLint 治理测试，覆盖阈值正反例及空行/注释不计数语义。

### 非目标

- 不改变 `src/world/`、`src/server/`、`src/client/` 或 Worker 消息协议的业务语义。
- 不改变移动、碰撞、交互、Chunk 排队、性能埋点、Harness API、存档 key、材质、昼夜、地图或 UI 的最终可观察行为；仅修复首屏无样式闪烁。
- 不新增依赖，不引入状态管理框架，不把 app 逻辑反向移动进 `src/world/`。
- ESLint 体量门禁覆盖其解析的全仓库 JavaScript/TypeScript；CSS 本次会拆分，但不为此引入 CSS parser/plugin。

## Decisions

本次采用按运行时所有权拆分，而不是按函数数量机械切文件：

1. `main.ts` 只做入口装配；DOM 查找集中到 `app-elements.ts`，避免每个模块重复 query 与非空断言。
2. Macro 地图与浏览器存档分别成为独立模块；它们不依赖 `Game` 私有状态。
3. 运行时依赖保持单向：`main/入口 → Game → World 协调器 → Mesh scheduler / GPU repository`。`Game` 负责启动、帧循环和顶层资源生命周期；`World` 协调器独占 app 层的体素写入口、streaming 需求与 remesh 触发；scheduler 独占 Worker、待发/在途队列、epoch/task identity 和结果接收；GPU repository 独占待提交与已挂载资源。scheduler 与 GPU repository 不互相导入，只经协调器传递已通过 identity 校验的结果。
4. 原 `Game` 将启动/帧循环与玩家控制、HUD、Harness 适配分开；跨模块只传窄接口或明确上下文，不导出可被任意修改的共享全局状态。Harness 只在 `?harness=1` 暴露同页重启和生命周期只读计数，不进入普通玩法入口。
5. 视觉环境拆为质量档、材质资源和昼夜环境模块；保持现有 PlayCanvas 资源创建/销毁顺序。
6. `max-lines` 选择 500 行有效代码作为全仓库 JavaScript/TypeScript 的硬上限。当前盘点中只有 1454 行的 `src/app/main.ts` 超限；376 行的 `visual-environment.ts` 仍按本需求主动拆分，但不是为了勉强过线。忽略空行和注释，避免格式或必要说明触发无意义失败。
7. 全局 config 同时设置 `linterOptions.noInlineConfig: true`；不增加临时豁免、按文件 override 或 disable comment。如未来任一目录文件超过阈值，必须继续收窄职责。
8. 销毁顺序固定为：先使当前 world epoch 失效并断开 scheduler 结果回调，再取消队列/终止 Worker，再由 GPU repository 拒绝后续提交并 exactly-once 销毁 pending 与 attached Mesh/Entity，随后销毁材质/环境，最后销毁 PlayCanvas Application。延迟到达的 Worker 或 `postrender` 回调只能被判定为过期并释放其仍持有的资源，不能重新挂载旧世界，也不能二次销毁。
9. 首屏 CSS 是独立的 render-blocking 静态资源：`index.html` 在任何 module script 之前直接引用 `/assets/styles/start-screen.css`；该文件不使用 `@import`、不等待 JavaScript 注入 class，也不包含进入世界后才需要的 HUD/地图规则。固定 public URL 是本次消除 FOUC 的明确取舍，生产构建必须读回该文件和 `<link>` 均存在。
10. CSS 仅按职责移动，不主动改变 selector 与 declaration；首屏静态 CSS 先加载，运行时 CSS 保持原规则相对顺序，避免 cascade 漂移。change 级 Midscene 覆盖启动页、运行中 HUD 和 Macro 地图。

关键协作接口固定为以下最小集合，实施时可以调整类型名，但不得扩大所有权或形成反向依赖：

| 所有者            | 对上游暴露的能力                                                            | 唯一持有的可变状态                                                          |
| ----------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `Game`            | `start()`、帧循环、顶层 `dispose()`                                         | PlayCanvas Application、当前 world/environment/controller 与启动 generation |
| `World` 协调器    | `updateStreaming()`、`edit()`、`drainCommits()`、telemetry、`dispose()`     | `GameServer`、stream center、dirty/remesh；只有此处可调用服务端体素写入     |
| Mesh scheduler    | `request(preparedTask)`、`cancel(key)`、`isCurrent(identity)`、`dispose()`  | Worker、queued/in-flight、epoch、latest task identity                       |
| GPU repository    | `enqueue(acceptedResult)`、`drain()`、`unload(key)`、telemetry、`dispose()` | pending commit、attached Chunk、Mesh/Entity 所有权与销毁集合                |
| Player controller | `install()`、`update()`、`interact()`、`dispose()`                          | 输入集合、速度、朝向、碰撞与交互状态                                        |
| Harness adapter   | `install(context)`、`dispose()`                                             | 仅 Harness API 装配和只读 lifecycle counters                                |

scheduler 只通过协调器提供的 `preparedTask` 接收服务端快照，并通过 `onAcceptedResult(identity, result)` 回调交回当前结果；worker-first canonical 的权威接纳仍由 `World` 协调器调用 `GameServer` 完成。GPU repository 通过协调器传入的 `isCurrent(identity)` 校验延迟提交，不直接读取 scheduler 状态，也不导入 scheduler。所有回调都绑定 world generation token；token 失效后只能丢弃/释放，不能修改新 world。

## Behaviour

- Given 任一被 ESLint 管理的 JavaScript/TypeScript 文件包含不超过 500 行有效代码, When 运行 ESLint, Then 不产生 `max-lines` 错误。
- Given 根配置、`src/`、`tests/`、`scripts/` 或 change E2E 中任一 JavaScript/TypeScript 文件包含 501 行或更多有效代码, When 运行 ESLint, Then 产生 `max-lines` 错误并阻止静态准出。
- Given 文件增加纯空行或纯注释行, When 运行 ESLint, Then 这些行不计入 500 行上限。
- Given 玩家以任意已有 seed 进入世界, When 完成模块拆分后启动游戏, Then 启动、streaming、渲染、输入、碰撞、交互、地图、HUD、存档和 Harness 仍沿用现有用户可观察行为。
- Given Chunk Worker 结果到达、过期或被取消, When 协调器处理任务, Then 仍按现有 task identity、epoch、revision 与 postrender 边界提交或丢弃，不接受陈旧结果。
- Given 任务在 Worker 回包前被替换或取消, When 旧回包到达, Then scheduler 不将其交给 GPU repository，陈旧提交计数保持可观察且旧世界不重新出现。
- Given GPU 资源已进入等待 `postrender` 的提交阶段, When world 在回调前被 dispose, Then 延迟回调不挂载资源，pending 资源只销毁一次。
- Given 玩家编辑世界或页面隐藏, When 保存发生, Then 仍只经 `World.edit()` / `GameServer` 权威状态与既有 Browser persistence 保存路径完成。
- Given app 资源被重启或销毁, When 新世界启动, Then Worker、GPU Mesh、PlayCanvas 资源、定时器与事件生命周期保持现有清理语义。
- Given Harness 在同一页面第二次启动不同 seed, When 新世界达到可见状态, Then world instance 已更换、旧 world 已销毁一次、旧 world 没有后续可见提交，且新 seed 的 Chunk 正常加载。
- Given CSS 被拆到多个文件, When 分别观察启动页、运行中 HUD 和 Macro 地图, Then 层级、可读性、显隐和主要布局与拆分前一致。
- Given 浏览器已解析 HTML 但 `main.ts` 尚未下载或被阻断, When 首屏首次绘制, Then body、Canvas、UI、`[hidden]` 和启动面板已经使用最终关键样式，不出现浏览器默认 margin、裸表单或布局跳变。
- Given 生产构建完成, When 检查 `dist/index.html` 与静态资源目录, Then `<head>` 仍在 module script 前引用 `/assets/styles/start-screen.css`，且对应 CSS 文件存在。

## Test Design

- `GLOBAL-SIZE-01`（Static，预期 RED）：`tests/governance/module-size-eslint.test.ts` 用真实 `eslint.config.mjs` lint 带 `eslint-disable` 的 501 行有效代码，必须仍收到 severity=error 的一个 `max-lines` 错误。规则接入前预期因消息数为 0 而失败。
- `GLOBAL-SIZE-02`（Static）：同一治理测试验证 500 行有效代码通过、额外空行/注释不计入阈值，并通过 calculated config 精确断言 `{ max: 500, skipBlankLines: true, skipComments: true }` 与 `noInlineConfig: true`。
- `GLOBAL-SIZE-03`（Static）：calculated config 参数化覆盖 root config、`src/`、`tests/`、`scripts/` 与 change E2E probe；`pnpm lint` 对所有真实 JavaScript/TypeScript 执行同一规则，不得使用局部 disable 或额外文件级 override 绕过。
- `APP-LIFE-01`（Vitest，实施前预期 RED）：`tests/app/mesh-task-scheduler.test.ts` 使用 fake Worker/clock 验证被替换与取消任务的旧回包不会进入已接受结果回调，最新 identity 仍可提交。
- `APP-LIFE-02`（Vitest，实施前预期 RED）：`tests/app/chunk-resource-repository.test.ts` 使用 fake scene/postrender 验证 dispose 与延迟回调竞争时不挂载旧资源，pending/attached 资源在重复 cancel/dispose 下仍 exactly-once 销毁。
- `APP-LIFE-03`（Playwright-change，实施前预期 RED）：`changes/2026-09-04-app-module-boundaries/e2e/app-restart.spec.ts` 在同页通过 Harness 连续启动两个 seed，断言 instance id 改变、旧 world dispose 计数加一、stale visible commit 为零且新 world 正常加载。
- `APP-CSS-01`（Playwright-change，预期 RED）：`changes/2026-09-04-app-module-boundaries/e2e/first-paint.spec.ts` 主动阻断 `main.ts`，只让 HTML 与静态 CSS 加载；断言 `<head>` 静态 stylesheet、body 零 margin、固定 UI、居中启动面板和 hidden 元素在无 JS 时已生效。当前实现预期因 stylesheet 不存在而失败。
- `APP-CSS-02`（Build）：`pnpm build` 后读回 `dist/index.html` 和 `dist/assets/styles/start-screen.css`，证明直接链接位于 module script 前且文件随 Vite public assets 原样交付。
- `APP-MOD-01`（Static）：`pnpm verify:static` 证明格式、ESLint、路径命名、Vitest coverage 和 TypeScript 均通过。
- `APP-MOD-02`（Build）：`pnpm build` 证明 Vite 生产入口和模块图可构建。
- `APP-MOD-03`（Playwright-baseline）：`pnpm test:e2e:regression` 证明现有启动、输入、交互、streaming、持久化与 Macro 地图的确定性浏览器基线仍通过。
- `APP-MOD-04`（Midscene）：`changes/2026-09-04-app-module-boundaries/midscene/app-layout.yaml` 语义检查启动页、运行中 HUD 与 Macro 地图，证明 CSS import/cascade 拆分未破坏主要视觉层级和显隐。

## Acceptance & Evidence

- [x] **Static / RED：** `CI=true pnpm exec vitest run tests/governance/module-size-eslint.test.ts` 为 7/8 预期失败：501 行 probe 没有 `max-lines`，root、`src/`、`tests/`、`scripts/` 与 change E2E 的 calculated config 均缺少规则；500 行与注释/空行用例通过。
- [x] **Playwright-change / RED：** `CI=true pnpm exec playwright test changes/2026-09-04-app-module-boundaries/e2e/app-restart.spec.ts` 失败，现有 Harness 缺少 `lifecycleSnapshot()`，证明同页重启和旧 world 生命周期尚无可观察合同。
- [x] **Playwright-change / RED：** `pnpm exec playwright test changes/2026-09-04-app-module-boundaries/e2e/first-paint.spec.ts` 失败；主动阻断 `main.ts` 后 `document.styleSheets` 为空，预期的 `/assets/styles/start-screen.css` 不存在，精确证明当前首屏样式依赖 JS module 发现。
- [x] **Review：** 用户已审核并批准本 Breaking-flow spec；批准绑定实施前 SHA-256 `ebaf8ed3033e35e7c6d9087aced26bf27f3bbd711a169f1314e3d18a4f63d2a7`。
- [x] **Architecture review：** 已按策略请求一次 Sol/xhigh 只读复核；reviewer 的首次结论为“补强后再审用户 hash”，其依赖所有权、销毁竞态、规则精确配置与 CSS 视觉证据要求已全部纳入本稿。运行时未暴露 effective model/effort telemetry，因此这里只证明 requested route。
- [x] **Static：** 所有 ESLint 管理的 JavaScript/TypeScript 有效代码不超过 500 行；`tests/governance/module-size-eslint.test.ts` 的阈值、忽略空行/注释、目标路径与禁止 inline disable 共 8 个断言通过。当前最大源文件为 407 行的 `player-controller.ts`。
- [x] **Static：** `pnpm verify:static` 通过：Prettier、ESLint、ls-lint、13 个 Vitest 文件共 80 个测试、TypeScript 全绿；`src/world/**` 行覆盖率 97.27%。
- [x] **Build：** `pnpm build` 通过；读回确认 `dist/index.html` 引用 `/assets/styles/start-screen.css` 且 `dist/assets/styles/start-screen.css` 存在。Vite 保留原有大 bundle warning，本需求未扩大到 bundle code splitting。
- [x] **Vitest：** scheduler 陈旧/取消回包与 GPU repository exactly-once 销毁竞态用例通过。
- [x] **Playwright-change：** `SEEDLANDS_E2E_PORT=4187 pnpm exec playwright test changes/2026-09-04-app-module-boundaries/e2e` 共 2/2 通过；同页二次 start、旧 world 生命周期和无 JS 首屏关键样式均满足合同。
- [x] **Playwright-baseline：** `SEEDLANDS_E2E_PORT=4188 pnpm test:e2e:regression` 共 8/8 通过；另以 4190 端口运行 benchmark 1/1 通过。
- [ ] **Midscene：** YAML 已建立，但执行在首个页面断言前因当前 worktree 没有 `.env`、模型 base URL 不可用而中止：`failed to get base URL of model (intent=default)`。这只证明视觉模型环境阻塞，不代表 CSS 语义失败；最小下一步是配置本地 Midscene 模型环境后复跑同一 YAML。
- [x] **Git：** 在明确的 `codex/app-module-boundaries` 功能分支上仅暂存本 change 文件并创建本地语义化 commit；未 push。

## Tasks & Current State

1. [已完成] 读取项目约定、Git 状态、active change、`src/app`、ESLint 与现有治理测试。
2. [已完成] 已预置 ESLint 规则治理用例并取得 RED；Sol/xhigh 只读架构复核已完成并补强合同。
3. [已完成] 已根据用户补充加入首屏静态 CSS 与无闪烁 RED；用户批准精确 spec hash。
4. [已完成] 拆分 app TypeScript / CSS 并接入全局 `max-lines`。
5. [已完成] 运行定向治理测试、静态检查、构建、change E2E、浏览器基线与 benchmark，并写回真实证据。
6. [已完成] 更新 Delivery Snapshot，创建本地语义化 commit，不 push。

## Delivery Snapshot

实施位于 `codex/app-module-boundaries`：`src/app/main.ts` 从 1454 行收敛为 29 行入口，运行时按 `Game`、World 协调器、Mesh scheduler、GPU repository、玩家控制、HUD、Harness、存档、Macro 地图、质量档、材质和环境职责拆成独立模块；删除原 376 行 `visual-environment.ts`，当前 app 最大文件为 407 行。scheduler 与 repository 分别持有任务 identity/Worker 和 GPU 资源状态，新增单测证明取消/替换旧回包不会提交，dispose 与 `postrender` 竞争不会挂载旧资源或重复销毁。Harness 新增只读 lifecycle 合同与同页 restart，change Playwright 和原有浏览器回归全部通过。

首屏基础布局、Canvas 背景、`[hidden]`、启动面板和表单样式已迁入 `public/assets/styles/start-screen.css`，由 `index.html` 在 module script 前直接引用；运行中 HUD 与 Macro 地图样式分别位于 `src/app/styles/hud.css` 和 `src/app/styles/macro-map.css`。阻断 `main.ts` 的 Playwright 用例仍读到最终首屏布局，生产 `dist` 也保留独立静态资源。Playwright 配置新增 `SEEDLANDS_E2E_PORT`，避免并行 worktree 复用别处的 4173 服务污染证据。

ESLint 的 `max-lines` 已对所有 `*.{js,mjs,cjs,ts,mts,cts}` 全局生效：500 行有效代码、忽略空行/注释，并通过 `noInlineConfig` 禁止文件内绕过；治理测试覆盖 root、`src`、`tests`、`scripts`、change E2E 与 Playwright config。`pnpm verify:static`、`pnpm build`、change E2E 2/2、回归 8/8、benchmark 1/1 均通过。Midscene YAML 因当前 worktree 缺少模型 base URL 在首个断言前环境阻塞，未将其伪报为视觉通过；配置 `.env` 后可按同一路径复跑。未 push，未修改线上或外部状态。

### 本地主干合并补充

合并到本地 `main` 时，主干提交 `84816ac` 已新增世界修改事务并继续修改旧版 `main.ts`，因此不能机械选择冲突一侧。合并将主干的 `editBatch`、`FillCommand`、world revision、结构事件诊断和聚合 remesh 迁入拆分后的 `world-runtime.ts`、`player-controller.ts` 与 Harness adapter，入口仍保持 29 行。全局 500 行门禁同时发现主干的 `game-server.ts` 和 `run-harness.mjs` 已增长到 725 与 513 个有效行；事务规划/提交、浏览器证据读取和 dist 体积统计进一步拆入独立模块，最终相关文件均低于阈值。

合并态验证：定向 Vitest 37/37、app 与 transaction change E2E 3/3、`pnpm verify:static` 94/94（性能门禁 3 个按默认配置跳过）、`pnpm build`、浏览器回归 8/8 和 `pnpm harness:benchmark` 均通过。生产构建仅保留既有大 bundle warning；未 push。
