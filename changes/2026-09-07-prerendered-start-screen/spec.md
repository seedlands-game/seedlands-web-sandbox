# Svelte 同源预渲染启动页

## Context & Goal

PR #11 当前在 `index.html` 手写一份首屏 fallback，随后由 `mount-ui.ts` 清空 `#ui` 并重新挂载 Svelte `AppRoot`。fallback 与真实 `StartScreen` 的 DOM、文案、字段和样式已经分叉；运行时即使恢复 seed 与质量，也会替换节点并丢失焦点、选区与布局连续性。目标是让无 JavaScript 首屏与客户端运行时使用同一套 Svelte 组件和首屏 CSS：构建时生成静态 HTML，浏览器加载后在原节点上 hydration，不再维护手写骨架。

## Scope & Non-goals

- 使用现有 Svelte 5 与 Vite 的 SSR 能力，为单一首页生成确定性的 boot HTML；不引入 SvelteKit、路由框架或运行时 Node 服务。
- `AppRoot` 的服务端与 hydration 初始树只包含启动页；HUD、overlay 和其他浏览器运行期 UI 在 hydration 完成后再启用。
- 客户端使用 `hydrate(..., { recover: false })` 接管构建产物，删除 `replaceChildren()` 与 fallback 后重新 `mount()` 的路径。
- 把启动页首绘需要的样式收敛为一个 render-blocking CSS 源；删除手写 fallback 专属样式，不让动态 bootstrap CSS 决定首次布局。
- hydration 前读取用户已编辑的 seed、质量、焦点和选区，使用相同初始 UI model 接管；不得以创建新节点后重新赋值冒充保留。
- Dev 与生产构建调用同一个首屏 renderer；生产构建把生成结果注入 `#ui` outlet，并验证 base path、SEO 元数据和现有资源分包不回退。
- 不修改世界生成、Chunk、PlayCanvas 渲染、存档、音频、输入协议或游戏内 UI 行为。

## Decisions

1. **采用 Breaking flow。** 本变更修改构建链、UI 根节点接管方式与跨模块初始化顺序；必须在本 spec、测试设计及验收口径的精确 SHA-256 获用户审核后才实施生产代码。
2. **不引入完整 SSG 框架。** 当前只有一个静态首页，现有 `svelte` 已提供 `svelte/server.render`，Vite 已提供 SSR build；新增小型 server entry 与 prerender/injection 流程即可。若未来出现多路由、路由级数据加载或多页面 SEO，再单独评估 SvelteKit static adapter。
3. **同一个 `AppRoot` 完成 render 与 hydrate。** SSR 与客户端接收同一份确定性 boot model。`AppRoot` 在 SSR 和 hydration 首次求值时只输出 `StartScreen`；`onMount` 后才启用 `ShellOverlays`、HUD 和运行期子树，避免维护完整 `ApplicationShell` server fake。
4. **hydration 失败必须显式失败。** 客户端设置 `recover: false`；DOM 或初态不一致必须由测试/错误暴露，不允许 Svelte 静默清空节点并退化成 mount。
5. **首屏 CSS 单源且阻塞首绘。** 真实 `StartScreen` 使用的基础布局、控件与颜色规则迁到同一份首屏 CSS，由 HTML `<link>` 在 module script 之前加载；运行期 CSS 不再覆盖启动页的关键几何。
6. **表单连续性以节点身份为准。** hydration 前用户输入通过初始 shell model 接入；`#seed` 和 `#quality` 必须复用原 DOM，seed 值、质量值、焦点和文本选区保持不变。
7. **生成流程可复现。** renderer 只读取代码内固定 boot model 和公开构建配置，不读取时间、随机数、浏览器存储、网络或凭据；同一 source SHA 重复生成得到相同 outlet HTML。临时 SSR 产物不提交。

## Behaviour

- Given bootstrap JavaScript 被阻断, When HTML 与首屏 CSS 已到达, Then 用户看到与 Svelte 启动页相同的完整标题、推荐起点、seed、质量、世界版本和次级入口；进入世界保持 disabled。
- Given 用户在 hydration 前编辑 seed 与质量并把焦点留在 seed 输入框, When bootstrap 完成, Then 原输入节点被复用，值、焦点和选区保持不变，启动卡片关键几何不跳变。
- Given server renderer 与客户端初态或 DOM 不一致, When 客户端 hydration, Then 初始化明确失败并留下可诊断错误，不清空 DOM 后重挂。
- Given 生产构建完成, When 读取 `dist/index.html`, Then `#ui` 内含 Svelte SSR 标记与完整 boot HTML，首屏 CSS 链接位于 module script 之前，手写 `data-ui-fallback` 路径不存在。
- Given resource preflight、atlas 预取或世界初始化发生, When 状态推进, Then既有 boot、error、menu、loading、playing 旅程与重试入口保持一致。

## Test Design

### 实施前 RED

- `changes/2026-09-07-prerendered-start-screen/e2e/prerendered-start-screen.spec.ts`
  - 阻断 `bootstrap.ts`，断言首绘已经包含真实启动页的 `game-panel`、推荐起点、世界版本和设置/指南入口，并标记为 Svelte prerender；当前手写 fallback 缺少这些结构，预期 RED。
  - 延迟 `bootstrap.ts`，先编辑表单并记录 seed DOM 节点、焦点、选区和启动卡片矩形；释放 bootstrap 后断言同一节点被 hydration、值与交互状态不变、关键矩形误差不超过 1 px，并且控制台没有 hydration warning；当前 `replaceChildren()` 必然使节点身份断裂，预期 RED。

### 实施后 GREEN

- 为 renderer 增加确定性测试：同一 boot model 连续渲染两次完全一致；输出含 Svelte hydration 标记、真实启动页语义且不含手写 fallback 标记。
- 为构建注入器增加正反例：只替换唯一 outlet；缺失或重复 outlet、空 SSR 输出、临时产物越界均硬失败。
- 运行本 change Playwright、`changes/2026-09-07-loading-performance/e2e/loading-performance.spec.ts`、`pnpm test:e2e:regression`、`pnpm verify:static:ci` 与 `pnpm build`。
- 生产预览复验无 JavaScript 首绘、hydration 连续性、503 重试和世界 loading；截图只证明视觉连续性，不替代 DOM 身份和构建读回。

## Acceptance & Evidence

| 准出条件                                                            | 证据类型                         | 当前结果                                                                                       |
| ------------------------------------------------------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------- |
| 无 JS 首绘由真实 Svelte 启动页生成，不维护手写骨架                  | Playwright-change、renderer unit | GREEN：change E2E 2/2；renderer 两次输出一致并含完整启动页与 hydration markers                 |
| hydration 复用 seed/quality 节点并保留值、焦点、选区                | Playwright-change                | GREEN：`sameNode=true`、`focused=true`，选区保持 `7..16`                                       |
| hydration 前后启动卡片关键矩形误差不超过 1 px，无 hydration warning | Playwright-change                | GREEN：dev change E2E 通过；production preview 四项矩形位移均为 0 px、0 warning                |
| `recover: false`，不存在 `replaceChildren()` 后 mount 的 fallback   | Static、source inspection        | GREEN：mount adapter 仅调用 `hydrate(..., { recover: false })`                                 |
| Dev 与生产构建使用同一 renderer，输出确定且 base path 正确          | Unit、Build、production preview  | GREEN：dev request-time SSR 与生产生成物均调用 `renderPrerenderedStartScreen()`；base 单测通过 |
| 首屏 CSS 单源、render-blocking，既有资源分包预算不回退              | Build、network readback          | GREEN：`dist/index.html` 读回确认 CSS 位于 module 前；首屏 CSS 5.57 kB                         |
| 既有首次加载、503、世界 loading 与浏览器回归通过                    | Playwright-change、Regression    | GREEN：`pnpm test:e2e:regression` 14/14                                                        |
| 静态基线与生产构建通过                                              | Static、Build                    | GREEN：`pnpm verify:static:ci` 870/870（另 4 skipped）；`pnpm build` 通过                      |

## Tasks & Current State

- [x] 完成架构静态审查与独立 Sol/xhigh 只读复核；结论为有条件通过。
- [x] 冻结 Breaking scope、决定、行为和测试设计。
- [x] 执行 RED 并记录精确失败：2 tests failed，分别命中手写 fallback 分叉与节点替换。
- [x] 固定本版本作为待审核合同；精确 SHA-256 见审核交接消息。
- [x] 实现同源 SSG、严格 hydration 与 CSS 收敛。
- [x] 完成浏览器、静态、构建和生产预览验收。
- [x] 更新 Delivery Snapshot；提交并推送到 PR #11 原分支。

当前阶段：实现与本地验收完成，等待 PR 人类审核。

## Delivery Snapshot

- 目标分支：PR #11 `codex-66t83g`，基线 head `e2c41cc55f87c31957ab7c66927db8ef2556df1c`。
- 实际生产范围：`index.html`、Svelte UI root/start screen、mount adapter、bootstrap 初态、首屏 CSS、Vite/build scripts，以及相应单元/E2E/治理测试；不改世界、服务端、存档或玩法合同。
- 长期 docs baseline：已更新 `docs/repository-structure.md` 与 `docs/code-map.md` 中首屏生成物、共享 CSS 和入口链路；`docs/development-governance.md` 无需变化，因为本 change 不修改通用证据门禁。
- 验收摘要：change E2E 2/2、浏览器回归 14/14、静态单测 870/870（4 skipped）、build 通过；production preview 在 JS 禁用与延迟 hydration 两种路径均通过，DOM 连续性及矩形位移有独立读回。
- 未授权事项：自动合并、分支保护绕过、发布与权限变更。
