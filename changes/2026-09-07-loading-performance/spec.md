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

- [ ] Static：格式、ESLint、路径与类型检查通过；完整 `pnpm verify:static` 中无关 Wasm/mesh 高负载测试超时，未宣称通过。
- [x] Build：`pnpm build` 通过，manifest 与 gzip 资源指标已记录。
- [ ] Browser：用例已实现；容器缺少 Playwright 浏览器，备用 Chrome 又缺 `libatk-1.0.so.0`，依赖源被 403 拒绝，未能执行。
- [ ] Performance：同一浏览器环境限制使 Lighthouse、Navigation Timing/LCP/CLS 无法采样，不伪造分数。
- [ ] Visual：截图步骤已写入用例；同一浏览器环境限制使本地原始截图未生成，需 CI 补跑。
- [ ] Harness：依赖真实浏览器，受同一环境限制未运行。

## 任务状态

- [x] 合同、RED 设计与观察预期
- [x] 实现与静态/构建 GREEN
- [x] 记录浏览器环境阻塞与 Delivery Snapshot

## Delivery Snapshot

2026-09-07：生产构建成功。独立首屏 HTML 2,914 B、首屏 CSS 3,695 B、轻量入口 1,762 B（gzip 981 B）；入口只同步依赖 1,113 B preload helper，业务 bootstrap 为异步入口，Svelte、Tone、PlayCanvas 与 common vendor 均为独立稳定 chunk，详见 `evidence/bundle-report.json`。格式、ESLint、路径与类型检查通过。完整 static 的覆盖率阶段暴露 4 个不涉及本 change 的高负载/Wasm 失败并因执行持续超时中止；浏览器下载、系统依赖安装均被环境网络 403 阻断，因此 Playwright、Harness、Lighthouse 与实际截图未冒充为已通过，交由 PR CI 补齐。长期 docs baseline 不更新：本 change 是局部加载编排与 UI 行为，规则完整保存在本 change。
