# 首屏资源与 JavaScript 分包优化

## Context & Goal

当前生产构建把 PlayCanvas 与游戏运行时代码合并进约 2.01 MB（gzip 522.54 kB）的入口脚本，用户只浏览开始页也必须下载、解析完整 3D 引擎。目标是在不改变进入世界旅程的前提下，让开始页只加载轻量启动代码，在用户表达“进入世界”意图后再加载游戏运行时，并以可复现的资源预算和 Lighthouse 报告证明首屏优化。

## Scope & Non-goals

- 将 PlayCanvas 和游戏运行时移出首屏入口依赖图，并在首次进入世界时按需加载。
- 配置稳定、按职责命名的 vendor/runtime 分包，避免单一匿名巨型入口资源。
- 增加生产构建资源预算检查与本地 Lighthouse 命令。
- 记录优化前后首屏传输体积和 Lighthouse 指标。
- 不修改世界生成、Chunk、渲染效果、存档格式或游戏内交互。
- 不把 `dist/`、Lighthouse 临时报告或浏览器运行产物纳入版本控制。

## Decisions

- 采用 Agile flow：本次仅调整启动边界和构建配置，不改变公开协议、存档或核心渲染实现。
- 首屏入口不得静态导入 `Game`；点击进入后用动态 `import()` 加载游戏模块，并复用同一个加载 Promise，避免重试时重复请求。
- `playcanvas` 固定输出为独立缓存块；应用运行时由动态入口形成独立块。资源预算从 Vite manifest 追踪 `index.html` 的静态 JS 依赖，而非简单汇总所有产物。
- 资源预算以 gzip 传输口径计：首屏静态 JavaScript 不超过 25 KiB，任一 JavaScript 文件 gzip 不超过 550 KiB；预算给当前引擎留出小幅升级空间，同时阻止其重新进入首屏。
- Lighthouse 在本机生产预览上审计移动端默认配置；Performance、Best Practices、Accessibility、SEO 均不低于 90。报告写入忽略目录，作为一次性准出证据。

## Behaviour

- Given 用户首次打开开始页，When 浏览器完成首屏模块加载，Then 网络只请求轻量入口及其静态依赖，不请求 PlayCanvas 游戏引擎块。
- Given 用户点击“进入世界”，When 游戏模块尚未加载，Then 按钮保持禁用并显示加载状态，模块加载完成后启动与当前相同的世界流程。
- Given 游戏模块加载或启动失败，When Promise 拒绝，Then 恢复开始卡片、按钮可用状态和重试文案，并允许再次点击重试。
- Given 生产构建超过首屏或单资源预算，When 执行资源预算命令，Then 命令以非零状态退出并报告超标资源。

## Test Design

- `scripts/check-build-assets.mjs`：读取 Vite manifest，从 `index.html` 遍历静态 imports，统计 gzip 首屏 JavaScript，并校验单文件预算。预期 RED：基线入口 gzip 522.54 kB，超过 25 KiB 首屏预算。
- `changes/2026-09-04-first-load-assets/e2e/first-load-assets.spec.ts`：生产预览下观察首屏资源，断言进入前无 PlayCanvas/runtime 块、点击后才加载且能进入世界。预期 RED：基线首屏直接加载完整入口。
- `pnpm audit:lighthouse`：对已在 `127.0.0.1:4173` 启动的生产预览生成 JSON，并执行四项分数门禁。预期 RED：优化前先采样并记录真实结果；若环境缺少 Chromium 则如实记录阻塞，不能以其他证据替代。
- `pnpm verify:static` 与 `pnpm build`：验证静态质量、逻辑回归和生产构建。

## Acceptance & Evidence

| 准出条件                                                               | 证据类型                                            | 实际结果                                                                                           |
| ---------------------------------------------------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 首屏静态 JavaScript gzip 不超过 25 KiB，且 PlayCanvas 不在首屏依赖图   | Build、Playwright-change                            | Build 通过：6.92 KiB；Playwright 因系统缺少 `libatk-1.0.so.0` 阻塞                                 |
| 任一 JavaScript 产物 gzip 不超过 550 KiB，并形成可长期缓存的职责分包   | Build                                               | 通过：最大 PlayCanvas 分包 483.40 KiB gzip                                                         |
| 点击进入后世界仍可启动；加载失败可恢复重试                             | Playwright-change                                   | 自动化用例已建立；浏览器依赖缺失导致运行阻塞，生产构建与 TypeScript 检查通过                       |
| Lighthouse Performance、Best Practices、Accessibility、SEO 均不低于 90 | Playwright-change                                   | 环境阻塞：npm registry 与 apt 均被代理返回 403，无法安装 Lighthouse 与 Chromium 动态库，未伪造分数 |
| 静态基线和生产构建通过                                                 | Static、Build                                       | 通过：109 tests passed、4 skipped；world 行覆盖率 95.7%；生产构建及资源预算通过                    |
| 视觉语义未改变                                                         | N/A：仅改变资源调度与构建产物，不改变 UI 或渲染呈现 |

## Tasks & Current State

- [x] 建立 spec、预算与浏览器用例设计。
- [x] 记录资源预算预期 RED。
- [x] 实现启动懒加载、稳定分包与审计命令。
- [x] 执行需求 E2E、Lighthouse、静态检查和构建，并如实记录环境阻塞。
- [x] 更新交付快照并提交变更。

当前阶段：实现与可运行的本地准出完成；浏览器/Lighthouse 证据受环境依赖与网络策略阻塞。

## Delivery Snapshot

- 变更路径：`src/app/main.ts`、`vite.config.ts`、`package.json`、`.gitignore`、`scripts/check-build-assets.mjs`、`scripts/check-lighthouse-report.mjs`、本 change 的 spec 与 E2E。
- 优化前：首屏入口 2,007.57 kB，522.54 kB gzip（预算脚本同口径复测为 510.29 KiB gzip）。
- 优化后：首屏静态 JavaScript 17.15 KiB，6.92 KiB gzip，减少约 98.6%；PlayCanvas 独立为 1,879.08 KiB、483.40 KiB gzip 的点击后加载缓存块；游戏运行时为 64.79 KiB、20.97 KiB gzip。
- 验证：`pnpm verify:static` 通过；`pnpm build` 通过；需求 Playwright 因缺少 `libatk-1.0.so.0` 阻塞；`pnpm audit:lighthouse` 因 npm registry 403 阻塞；`pnpm exec playwright install-deps chromium` 因 apt 源 403 阻塞。
- 已知限制：本环境无法产生可信 Lighthouse 分数；门禁命令和 90 分阈值已交付，可在具有 Chromium 依赖及 npm 访问的 CI/开发机上执行。未将 `dist/`、报告或浏览器产物纳入版本控制。
- 相关 SHA：提交后补充 Git commit SHA；本次为 Agile flow，无 Breaking review hash。
