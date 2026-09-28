# GIT-40 Canonical Discovery

阶段：`GIT-40-CANONICAL-DISCOVERY`。baseline 为
`549dfecad3f6a8c6ba5c5179382f1af39101c1ff`。第一笔精确 4 路径只交付唯一 Chromium project 的 discovery
boundary 与合同；第二笔交付 Browser24/Close17 evidence、累计报告和状态。

隔离 detached tree 在默认机器锁内重新执行真实 Playwright 1.62.1
`pnpm exec playwright test --list --reporter=json`，只证明静态收集和 identity，不运行 webServer、Chromium 或
产品行为。Classic/root types、配置 ESLint、第一笔 4 路径正常 Prettier 与 scope 同窗串行；GIT39 已冻结的 16 focused
tests 和此前 145 行为测试只复用，不机械重跑。

Browser24 保持 `FAIL_BEFORE_TEST_DISCOVERY`、实际 Chromium attempt 0；Browser23 保持
`FAIL/TRACE_INCOMPLETE`。BUILD16、Browser25、artifact、Cua、devserver、CI 修复、deploy 和 merge 均不在本阶段。
