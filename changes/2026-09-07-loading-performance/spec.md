# 首屏加载与世界准备体验优化

## 目标

以 Agile 方式优化浏览器首次访问：HTML 与独立首屏 CSS 在业务运行时之前给出可操作的登录/世界选择骨架；把轻量入口、业务异步包与稳定第三方依赖分层缓存；主入口执行后立即启动业务代码和游戏资源预取。进入世界时必须等待资源和初始区块均完成，并以类似沙盒游戏加载菜单的阶段文案反馈真实等待过程。

## 范围与非目标

- 修改 HTML 首屏、静态首屏样式、浏览器启动编排、Vite 分包、世界 loading 呈现及其自动化证据。
- 补齐基础 SEO 与 GEO（生成式搜索可理解的描述、语言、结构化数据、canonical/OG 元数据）。
- 不修改 seed + generatorVersion、世界生成、存档协议、渲染后端或服务端权威规则。
- 不把 Lighthouse 实验室分数当作真实用户遥测；以同环境构建体积、浏览器 Navigation Timing/LCP/CLS 和 Lighthouse 报告共同准出。

## 关键决定

1. `index.html` 只加载极小启动入口；完整应用使用动态 import，浏览器解析主入口后立即发起，不等用户点击。
2. Vite 将 Svelte、PlayCanvas、Tone 稳定供应商与业务代码分开命名；初始 HTML 不直接引用大业务包。
3. 首屏骨架保留原生表单交互，但进入按钮在运行时和必要资源 ready 前保持 disabled；Svelte 接管时保留用户已输入的 seed/质量。
4. 资源准备使用可观察 Promise；世界 loading 从点击持续到 `Game.start()` 已创建材质、启动 worker authority、请求初始 streaming 并安装 UI/Harness 后才结束。
5. Loading 文案轮播仅解释当前等待，不伪造百分比；减少动态偏好下禁用动画。

## 可验证行为

- Given JavaScript 被延迟，When HTML/CSS 已响应，Then 登录骨架可见，seed 与质量可编辑，进入按钮 disabled 且基础 SEO 元数据存在。
- Given 轻量入口已执行，When 用户尚未点击，Then 完整业务异步 chunk 与必要游戏资源请求已开始；ready 后进入按钮可用。
- Given 用户点击进入，When 资源或初始世界尚未稳定，Then 独立 world loading 视图可见、按钮不可重复触发、状态文案轮播。
- Given `Game.start()` 完成，Then loading 消失且游戏 HUD/画布可用；失败则提供可读重试状态。
- Given 生产构建，Then 初始入口、业务与第三方依赖为独立 chunk，记录首屏请求体积；Lighthouse Performance/SEO 与 LCP/CLS 留下可审计结果。

## 实施前测试设计（RED）

- Playwright 阻塞脚本确认原生骨架、可编辑字段、禁用按钮和 SEO；现状缺少描述、canonical、OG 与结构化数据，RED。
- Playwright 监听网络确认无点击时异步业务和 atlas 已开始；现状 HTML 直接加载完整静态入口且 atlas 等到点击，RED。
- Playwright 延长 atlas/worker 响应并点击，确认 loading 视图及轮播；现状只有按钮文字，RED。
- 构建 manifest 检查入口/业务/Svelte/PlayCanvas/Tone 分层和初始资源预算；现状无显式稳定分包，RED。

## 验收与证据

- [x] Static：`pnpm verify:static:ci` 通过，182 个测试文件通过、2 个跳过；867 个测试通过、4 个跳过。
- [x] Build：`pnpm build` 通过，manifest 与 gzip 资源指标已记录。
- [x] Browser：change 的资源 gate、输入保留、失败重试与初始区块 ready 用例 4/4 通过；合并到 Chromium regression 后共 12/12 通过。
- [ ] Performance：同一浏览器环境限制使 Lighthouse、Navigation Timing/LCP/CLS 无法采样，不伪造分数。
- [x] Visual：真实 Chromium 原始截图已生成并人工检查，见 `evidence/world-loading.png`。
- [ ] Harness：change E2E 已通过真实 Harness snapshot 确认 loading 消失时 `loadedChunks` 与 `renderedChunks` 均大于 0；完整聚合 `pnpm harness` 未运行。

## 任务状态

- [x] 合同、RED 设计与观察预期
- [x] 实现与静态/构建/浏览器 GREEN
- [x] 记录浏览器环境阻塞与 Delivery Snapshot

## Delivery Snapshot

2026-09-07：生产构建成功。独立首屏 HTML 2,914 B、首屏 CSS 3,695 B、轻量入口 1,580 B（gzip 886 B）；入口只同步依赖 1,110 B preload helper，业务 bootstrap 为异步入口，Svelte、Tone、PlayCanvas 与 common vendor 均为独立稳定 chunk，详见 `evidence/bundle-report.json`。修复后的资源 Promise 与 capability preflight 共同控制 menu ready；动态 bootstrap 接管时保留原生 seed/质量输入；失败时由 Svelte 保留可读重试入口；world-loading 直到首个区块 postrender 可见后才退出，并有 30 秒失败边界。`pnpm verify:static:ci`、`pnpm build`、change E2E 4/4 与完整 Chromium regression 12/12 通过，原始 loading 截图已人工检查。Lighthouse、Navigation Timing/LCP/CLS 与完整聚合 Harness 仍未运行，不冒充性能准出。长期 docs baseline 不更新：本 change 是局部加载编排与 UI 行为，规则完整保存在本 change。
