# Retained UI 与 UI Bridge 底座

**状态：** 已交付；用户已批准 SHA-256 `87db3b6f22e0a75bbb08cac59f3e446af1835ac881885d3c6468ce12b0a9e3b7`，实现、准出与本地提交已完成

## 背景与目标（Context & Goal）

当前 PlayCanvas runtime 已有启动界面、世界 HUD、材质 Hotbar、Macro 地图和 Change 7 Debug Shell，但 UI 由 `index.html` 预建节点、`app-elements.ts` 全局查询、`game.ts` / `player-controller.ts` / `hud-presenter.ts` / `debug-command-shell.ts` 直接修改 `hidden`、`textContent`、`innerHTML`、事件属性和子节点。`updateHud()` 每个游戏 frame 重新计算 Macro 信息并写 DOM，调试指标、世界时间、Hotbar 与 overlay 没有独立的更新频率或 session stale 防护。

本插入变更在 Change 8 生存玩法前建立 Svelte 5 standalone retained UI runtime、分片 presentation state、`UiBridge`、更新频率合同、语义化 CSS token 和可复用 UI primitives。完成后，当前全部正常 Player/Debug UI 由一个 Svelte root 持有；Game/Telemetry 只向 `UiBridge` 发布小型投影，Svelte 不成为 `GameServer`、World、Inventory 或 frame state 的第二份 canonical truth。Change 8 后续的生命、饥饿、背包与合成 GUI 必须扩展本合同，而不再引入手写 DOM 状态路径。

## 范围与明确不做（Scope & Non-goals）

### 范围

- 安装并配置 Svelte 5 standalone、官方 Vite plugin、`svelte-check` 与 Svelte ESLint 支持；继续使用现有 Vite SPA，不引入 SvelteKit。
- 将 `index.html` 的运行期 UI 收敛为 PlayCanvas canvas、统一 `#ui` mount root 与无 JavaScript 首屏 fallback。fallback 保留现有 render-blocking `public/assets/styles/start-screen.css`，确保 module 被阻断时仍有完整首屏；Svelte mount 后一次性接管并移除 fallback，它不形成第二套运行期状态路径。
- 建立 `src/app/ui/`：`AppRoot.svelte`、Shell/HUD/Interaction/Debug 分区组件、Debug Shell、Macro Map 与 build watermark 组件；保留 Change 7 的可访问名称、输入历史、文本选择/复制/粘贴、F4/Esc 和命令错误后继续行为。
- 建立最小 primitives：`GameButton`、`GamePanel`、`GameSlot`、`GameTextField`、`GameSlider`、`GameOverlay`；定义 disabled/selected/open/error 等状态、键盘/指针语义与可访问标签。当前不需要 Tooltip/Popover，因此不引入 Bits UI。
- 建立 `UiBridge` 与只读 presentation contract，至少逻辑分片 `shell`、`hud`、`interaction`、`debug`。各分片有独立 subscription/revision，不建立一个每次整体替换的 `GameUiStore`。
- `shell` 包含 boot/menu/loading/playing/error、seed、quality、Macro Map 与 Debug Shell 开关；`hud` 包含 world clock、四格现有材质 Hotbar、selected slot 与静态帮助；`interaction` 包含 target identity、提示与短生命周期 feedback；`debug` 包含现有 FPS/frame percentile/位置/Chunk/streaming/内存代理/draw calls/triangles/backend ·等只读投影。 取消/替换 timeout；debug 采样默认 250ms（4Hz）；位置包含在该 debug sample 中；静止 crosshair 不产生 reactive write。
- `UiBridge.sampleDebug(now, projector)` 使用 lazy projector：未到 cadence 时不得调用昂贵的 Macro/telemetry projection。相同投影不 publish；Game frame loop可以每帧调用 sample gate，但不能每帧写 Svelte state 或重建 DOM。
- 建立 UI action port。Svelte 组件只能请求 `startWorld`、切换 overlay、选择材质、执行 slash command、改变地图 layer 等意图；实际 Game、World、Command Executor、Pointer Lock 与 persistence 操作由 app adapter 执行。Svelte 组件不得 import `GameServer`、`World`、PlayCanvas 或 canonical store。
- 重构 `Game`、`PlayerController`、Macro Map 和 Debug Shell 集成：移除运行期手写 Player/Debug UI 更新；控制器以 callback/action port 发布选择与交互，不持有 Hotbar/Debug/Overlay DOM；Macro Map 数据按 center/layer 变化计算，Canvas 绘制由 Svelte component 生命周期管理。
- 建立 UI presentation ESLint 边界及正反例测试：`src/app/**/*.ts` 不得在 Svelte mount adapter 之外通过 `textContent`、`innerHTML`、`hidden`、`replaceChildren`、`append` 或 `document.createElement` 构建/更新 Player UI；PlayCanvas canvas 输入、Pointer Lock、resize、2D map canvas draw 与 Svelte mount/unmount 是明确允许的窄例外。
- 建立 semantic CSS Custom Properties，覆盖 color/surface/content/border/spacing/size/typography/motion/z-layer；组件样式优先使用 token，保留少量 `.row/.column/.center/.fill/.absolute-fill/.sr-only/.no-pointer/.scroll` 结构 utility，不引入 Tailwind 或原子间距类体系。
- 保留真实 DOM 的 button/input/select/dialog/log/status/label 语义、可见 focus、键盘导航、文本选择和 `prefers-reduced-motion`；非交互 HUD 默认 `pointer-events: none`，overlay 打开后只有其交互表面接收指针。
- 扩展现有 performance telemetry 与 Harness snapshot：记录 UiBridge projection/publish duration、Svelte DOM commit duration（publish 到 component effect commit 的近似值）、debug sample/publish 次数、stale/coalesced 次数、UI update rate；不引入通用 Browser Layout profiler。
- 建立同机固定 A/B：迁移前 commit `863ff08` 与迁移后使用相同 seed、medium quality、viewport、browser、route、debug visible 状态和 frame 数，比较 frame p50/p95/p99、long frame、HUD/UI spans、heap/mesh proxy、bundle raw/gzip size 与 UI update rate。浏览器性能不设跨机器硬阈值；交付时对同机差异逐项记录并解释。
- 更新 README / README.zh-CN 的 UI 架构与操作说明；既有操作、可访问 locator、Change 7 command shell 和长期 Playwright baseline 保持兼容。

### 非目标

- 不实现 Change 8 的 Health/Hunger game model、完整 Inventory/Crafting UI、Item/Entity gameplay、Dialogue、Agent interaction 或任何新 gameplay truth。
- 不完成最终 Main Menu、Pause/Settings 产品功能或最终视觉语言；只保留当前 start/loading/playing/error 与既有 overlays，并为后续状态留扩展 seam。
- 不引入 SvelteKit、React、Vue、Tailwind、Redux、MobX、Zustand、大型 UI suite、Canvas/WebGL UI renderer、cross-engine abstraction 或通用 distributed state framework。
- 不引入 Bits UI；当前 primitives 足以覆盖现有交互，未来真正需要 focus trap/popover 等复杂行为时另立 change。
- 不修改 `GameServer` authority、World mutation、Chunk streaming/mesh、generator、snapshot persistence 格式、网络边界或 PlayCanvas 场景 renderer。
- 不把每帧完整 Game/World/Telemetry 对象复制进 Svelte，不把大量 world-space entity label 放进 DOM，也不使用每帧 layout 读取、blur/filter 大面积动画或 console logging。

## 关键决策（Decisions）

1. **Svelte 是 retained presentation runtime，不是 game architecture。** `AppRoot.svelte` 只消费 `UiBridge` 暴露的只读 stores 与 action port；canonical Game/Server 对象不进入 component props/store，也不能从 component 直接 mutation。
2. **一个 root、四个独立频道。** `UiBridge` 暴露 `shell/hud/interaction/debug` 四个可独立订阅的 readonly channel，每个 channel 使用不可变 snapshot、distinct equality 与独立 revision。根组件组合它们，但一个 debug publish 不得生成新的 shell/hud/inventory identity。
3. **静态 fallback 只解决首次绘制。** `public/assets/styles/start-screen.css` 与 `index.html` 中 `data-ui-fallback` 保持无 JS 首屏和既有 first-paint 证据；module 启动后 mount adapter 原子替换 fallback。fallback 没有事件处理、store 或运行期更新，不违反单一 UI presentation path。
4. **`UiBridge` 是纯 TypeScript、可在 Node Vitest 验证。** 它不 import Svelte、DOM、PlayCanvas、World 或 Server；以 subscribe/unsubscribe contract 向 Svelte adapter 提供状态，以注入 `now/setTimeout/clearTimeout` 实现 cadence 与 feedback 生命周期，从而确定性测试。
5. **采样先于投影。** Frame loop 只把 lazy projector 交给 gate；250ms 窗口未到时 projector 不执行。world time 单独按展示分钟 distinct，selected slot/overlay/command result 等事件立即发布。
6. **session 与 sequence 双门禁。** `beginWorldSession(id)` 先 dispose 旧 handle并重置 world-scoped state；handle publish 必须匹配 active id 且 sequence 严格递增。stale publish 返回 false、只增加 metric，不触发 subscriber。
7. **Svelte 5 使用官方 mount/unmount 与 scoped component CSS。** 不运行两个 Svelte roots，不把 Svelte component 当作 PlayCanvas Entity，不采用每帧 `$state` mirror。外部 channel 用标准 subscribe contract接入；组件内部仅保留输入草稿、焦点和开关动画等 presentation-local state。
8. **Change 7 Debug Shell 完整迁移。** `CommandHistory` 继续作为纯状态对象；Svelte shell component负责表单、历史列表和 focus，命令仍调用 `executeSlashCommand`。打开 overlay 会请求 controller release input / Pointer Lock；关闭不自动重新捕获。
9. **Macro Map 的模型与 DOM 分离。** 既有地图采样/颜色/legend 投影拆成无 DOM model；Svelte component只在 open、layer、center 或 map revision 变化时绘制其 canvas，不把绘制放进 Game update。
10. **UI DOM 边界必须可执行。** 新 ESLint rule检测 TypeScript 中的运行期 UI presentation mutation；规则的正反例先 RED。Svelte component到 server/world/playcanvas 的依赖限制由 governance test扫描 import，避免边界只留在文档。
11. **性能证据采用相关环境 A/B，不假装跨机器确定性。** A/B 都记录 source SHA、browser、viewport、seed、quality、采样 frame 和环境；frame percentile/heap/bundle只报告差异。可硬断言的是结构性质：静止 HUD publish ≤ 6Hz、debug projector ≤ 4Hz、跨分片 identity不变、DOM node identity在无结构变化时保持。
12. **旧 CSS 分阶段收敛但不破坏首次绘制。** critical fallback/base tokens保留在 public CSS；运行期主题、utility与组件 CSS 位于 `src/app/ui/styles/`。迁移后删除 `src/app/styles/hud.css`、`macro-map.css`、`debug-command-shell.css` 的运行期重复规则，禁止同一组件两套 active selector。
13. **依赖变更与 lockfile 是本 change 的一部分。** 实施时使用 pnpm 安装 Svelte/Vite/typecheck/lint所需包并提交精确 lockfile；不安装 Bits UI 或其他未使用套件。
14. **Change 8 等待并重新绑定。** 现有 `2026-09-04-survival-gameplay-entity-foundation` 尚未批准，已暂停；本 change 交付后要把其 GUI scope改为扩展 UiBridge/retained components并重新计算 SHA，不沿用旧 hash。

## 行为（Behaviour）

- **Given** JavaScript module 被阻断，**When** 页面首次加载，**Then** static start fallback仍显示标题、Seed、quality 与进入按钮的完整布局且无 FOUC；按钮不伪装为可运行。module成功后 fallback被单个 Svelte root接管。
- **Given** 应用处于 menu，**When** 输入 Seed/quality并进入世界，**Then** shell依次呈现 loading和playing，失败呈现可重试 error；Game start参数来自 action payload，不从任意 component DOM反查。
- **Given** 相同 hud/interaction/shell projection重复发布，**When** 值和 identity均未变化，**Then** 对应 subscriber、Svelte state和DOM不更新，其他分片对象 identity保持不变。
- **Given** Game frame loop 以约60Hz调用 `sampleDebug`，**When** 1秒内 runtime数据持续变化，**Then** debug projector/publish不超过4次，静止 retained HUD总 publish不超过6次；crosshair和Hotbar DOM node identity保持。
- **Given** target voxel/entity identity未变化但相机每帧变化，**When** frame推进，**Then** Interaction channel不 publish；target identity变化时立即发布一次。
- **Given** World A 被 World B替换，**When** A的晚到 persistence/telemetry结果或逆序 sequence到达，**Then** bridge拒绝并记录 stale，不改变B的任何 presentation state。
- **Given** feedback A尚未超时，**When** feedback B到达，**Then** B立即替换A并重置计时；旧timer触发不能清除B；session dispose后timer和subscription被清理。
- **Given** F3/F4/M或对应button，**When**切换 Debug、Command Shell或Macro Map，**Then** retained tree更新可见状态，不重新创建无关Hotbar/Start shell；overlay打开释放输入和Pointer Lock，Esc关闭且不自动捕获。
- **Given** Debug Shell输入/历史，**When**执行成功、失败、ArrowUp/Down、copy/paste与Esc，**Then** Change 7的可访问语义和行为保持；输入中的WASD、数字、P/T/M/F3/F4不泄漏到gameplay控制。
- **Given** Hotbar选择改变，**When**按1–4，**Then** controller更新自己的选择并经事件发布一次HUD projection；Svelte只渲染选择状态，不能直接修改controller/world。
- **Given** Macro Map关闭，**When** player position每帧变化，**Then** map sampling/canvas draw为零；打开或layer/center变化时才生成并绘制一次，关闭后交互表面不接收指针。
- **Given** reduced-motion偏好，**When** overlay/feedback/slot状态变化，**Then**功能不依赖动画，transition被缩短或关闭。
- **Given** runtime运行固定性能场景，**When**导出Harness snapshot/trace，**Then**包含frame分位、UI bridge/project/publish/DOM commit duration、update counts/stale/coalesced与环境关联信息，可与迁移前证据逐项比较。

## 测试设计（Test Design）

- `tests/app/ui-bridge.test.ts` 在实现前预期 RED：覆盖四分片独立订阅/distinct identity、lazy debug 4Hz gate、target identity、feedback timer替换、world session/sequence stale拒绝、dispose和metrics。
- `tests/governance/ui-presentation-boundary-eslint.test.ts` 在实现前预期 RED：新 rule必须拒绝非UI adapter中的`textContent/innerHTML/hidden/replaceChildren/append/document.createElement` presentation mutation，允许Svelte mount、canvas draw与callback发布。
- `tests/governance/svelte-ui-boundary.test.ts` 在实现前预期 RED：检查 package/Vite/typecheck/lint接入、单一AppRoot、primitives齐全、component不得import server/world-runtime/playcanvas、index保留fallback且不保留运行期HUD树。
- `changes/2026-09-05-retained-ui-bridge-foundation/e2e/retained-ui.spec.ts` 在实现前预期 RED：检查Svelte root标识、首次接管、menu/loading/playing、F3/F4/M、Debug Shell历史/错误/输入隔离、Hotbar选择、Macro Map与现有可访问locator兼容；在固定frames内验证node identity和静止UI publish rate。
- `changes/2026-09-05-retained-ui-bridge-foundation/e2e/ui-performance.spec.ts` 在实施前先采集commit `863ff08`的现有manual HUD样本，实施后用同用例采集retained UI；固定seed/quality/viewport/debug状态/frame数，输出source SHA、frame p50/p95/p99、long frame、UI/HUD spans、update rate和heap/mesh proxy。Bundle raw/gzip由同机production build单独记录。
- `changes/2026-09-05-retained-ui-bridge-foundation/midscene/retained-ui.yaml` 在实现前定义Start/HUD/Hotbar/Map/Debug Shell的可见语义、focus、窄屏、reduced-motion和迁移前后视觉不退化；Midscene不代替cadence和架构断言。
- 现有 `tests/e2e/regression/world-play.spec.ts`、`macro-map.spec.ts` 与Change 7 shell E2E按原路径运行，证明用户旅程/命令行为没有因框架替换而回归。
- 本change用例交付后保留为历史准出证据，不自动提升至`tests/e2e/`；若未来提炼长期 retained UI核心旅程，必须另经独立Sol/xhigh评审。

## 验收与证据（Acceptance & Evidence）

- [x] **Vitest：** UiBridge四分片、distinct publish、lazy cadence、target identity、feedback timer、session/sequence stale与dispose全部通过。
- [x] **Vitest / Static：** UI presentation ESLint规则正反例通过；Svelte components无server/world-runtime/playcanvas依赖，旧manual UI mutation路径被移除。
- [x] **Static：** Svelte 5、Vite plugin、`svelte-check`和Svelte ESLint接入，`pnpm verify:static`通过；500行、kebab-case与world/server purity不回归。
- [x] **Playwright-change：** static fallback与Svelte接管、boot/menu/loading/playing、retained node identity、F3/F4/M、Shell、Hotbar、Map、focus/input isolation全部通过。
- [x] **Playwright-change / Harness：** 60Hz frame输入下debug projector≤4Hz、静止HUD总publish≤6Hz，分片identity稳定，stale/coalesced/DOM commit指标可观察。
- [x] **Playwright-baseline：** `tests/e2e/regression`与Change 7 Debug Shell用例通过，既有world entry、编辑、streaming、碰撞、persistence和命令行为无回归。
- [x] **Benchmark：** 在同机固定A/B中记录frame p50/p95/p99、long frame、UI span/update、heap/mesh proxy与bundle raw/gzip；逐项解释差异，不用单次样本冒充跨机器硬结论。
- [x] **Midscene：** Start/HUD/Hotbar/Map/Debug Shell保持清晰、无重叠/截断，focus和成功/错误不只靠颜色表达，窄屏语义可用；reduced-motion由确定性Playwright补证。
- [x] **Build：** `pnpm build`通过；`dist`保留render-blocking fallback CSS且Svelte production bundle可运行。
- [x] `git diff --check`通过。

## 任务与当前状态（Tasks & Current State）

1. [已完成] 已读取附件、AGENTS、README、Change 7交付、暂停中的Change 8、当前DOM/CSS/Game/Controller/Harness/Telemetry和Git状态。
2. [已完成] 已选择Breaking flow：本change引入UI framework和依赖、替换全部运行期UI主路径、增加可执行架构边界并改变浏览器性能/测试口径。
3. [已完成] 已建立合同、UiBridge/Governance RED、3个Playwright-change RED、Midscene预期与迁移前同机性能/Bundle样本。聚焦Vitest得到3个test file RED：UiBridge模块不存在，Svelte/package/root/primitives/fallback不存在，UI presentation ESLint反例未被规则拒绝；2个允许callback/canvas与mount adapter的正例已通过。聚焦Chromium的3个行为用例分别因无Svelte root标识、Hotbar无button语义、无fallback标识而失败，均命中预期缺口。
4. [已完成] 用户按精确hash批准后，在`codex/retained-ui-bridge-foundation`实施Svelte 5、UiBridge、primitives、单一root、现有UI迁移、边界lint和Harness telemetry。
5. [已完成] RED已转GREEN；修复浏览器回归发现的reload boot race，并恢复Change 7日志原生聚焦/复制与release build完整`data-commit`契约。
6. [已完成] 静态、构建、浏览器、性能A/B和Midscene准出；仅本change文件进入本地语义化commit，未push。
7. [下一步] 修订Change 8 GUI contract/RED并生成新的审核hash，再在本底座上实现生存玩法。

## 交付快照（Delivery Snapshot）

### 实施前基线

- Source：本地 `main` commit `863ff0837c32e96c0a50d866ce21c572b6ebb71e`；Chromium、1280×720、medium、seed `retained-ui-performance`、Debug HUD可见、360 frames。
- `ui-performance.spec.ts` 实测通过：duration 6011.28ms；frame p50 16.70ms、p95 17.20ms、p99 17.60ms、max 33.20ms、long frame 1；estimated mesh 6,743,688 bytes；manual `DebugHud` span 360次、合计21.60ms，等于每frame一次UI写入；当前无UiBridge metrics。
- `pnpm exec vite build` 实测通过：主JS 2,020,198 bytes / gzip 523,593 bytes，主CSS 5,363 bytes / gzip 1,817 bytes；Vite继续报告既有主bundle超过500kB警告。该命令用于隔离记录迁移前bundle；完整`pnpm build`当前会被已暂停Change 8的预期RED测试影响，不作为本change实施前基线。
- RED命令：`pnpm exec vitest run tests/app/ui-bridge.test.ts tests/governance/ui-presentation-boundary-eslint.test.ts tests/governance/svelte-ui-boundary.test.ts --reporter=verbose --no-file-parallelism --maxWorkers=1`；`SEEDLANDS_E2E_PORT=4211 pnpm exec playwright test changes/2026-09-05-retained-ui-bridge-foundation/e2e/retained-ui.spec.ts --workers=1 --reporter=line`。

### 实施与准出结果

- 依赖与工具链：`svelte@5.57.0`、`@sveltejs/vite-plugin-svelte@6.2.4`、`svelte-check@4.7.6`、`eslint-plugin-svelte@3.23.0`、`prettier-plugin-svelte@4.1.1`；`pnpm peers check`为`No peer dependency issues found`。
- 运行结构：`index.html`只保留Canvas、`#ui`与无JavaScript fallback；`src/app/ui/`新增单一`AppRoot`、六个primitive、分区组件、mount adapter、主题token与UiBridge；删除旧`app-elements`、手写Debug Shell/HUD/Map viewer及三份重复runtime CSS。
- UiBridge/Governance：聚焦Vitest 3个文件、12项断言全部通过；Svelte check为0 error / 0 warning；全量静态门禁在临时隔离已暂停Change 8预置RED后通过，23个test file、134项测试通过、4项按既有条件skip，`src/world/**`行覆盖率95.70%。隔离仅影响测试发现范围，命令结束后Change 8文件已原样恢复。
- 浏览器：retained UI change用例4/4通过；固定SHA下的release identity、Change 7 Debug Shell和长期`tests/e2e/regression`合并运行14/14通过；另行验证app restart、first-paint与visual-upgrade，其中first-paint保留fallback内空的隐藏`#hud`兼容哨兵，mount时一并移除。
- Midscene：当前桌面文件3/3任务通过；固定700×720窄屏文件1/1任务通过。早期两次失败分别源于关闭Shell后无法从最终截图观察先前草稿、以及要求视觉代理自行修改viewport导致replanning耗尽；拆成可观察断言并用页面级固定viewport后均已GREEN。reduced-motion以Playwright的`emulateMedia`和transition时长断言补证。
- 迁移后同机A/B（相同Chromium、1280×720、medium、seed、debug visible、360 frames）：duration 5990.28ms；frame p50 16.70ms、p95 17.00ms、p99 17.40ms、max 17.60ms、long frame 0；estimated mesh仍为6,743,688 bytes。UiBridge debug projection 3.82Hz、总publish 5.65Hz、stale 0；UI trace由360次/21.60ms降为23次/5.00ms。单次样本中frame分位未退化，但这不是跨机器性能保证。
- 迁移后production bundle：主JS 2,071,436 bytes / gzip 544,999 bytes，相对基线raw +2.54%、gzip +4.09%；主CSS 6,672 bytes / gzip 2,240 bytes，相对基线raw +24.41%、gzip +23.28%。增量来自Svelte runtime、语义组件和token层；既有>500kB主bundle警告仍存在，未在本change内做code splitting。
- 最终门禁：`pnpm verify:static`、`pnpm build`、相关Playwright/Midscene、`pnpm peers check`与`git diff --check`均通过。当前Change 8生产代码仍未开始，其旧hash继续失效；本change没有push或发布。
