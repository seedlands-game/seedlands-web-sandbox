---
name: seedlands-evidence
description: Run or review Seedlands Harness, browser evidence, and performance diagnostics when a change needs correlated multi-layer evidence or a performance claim.
---

# Seedlands 证据

当 Seedlands change 触及浏览器行为、Worker 接线、Harness 输出或性能证据时使用本 skill；只需定向单元测试的纯逻辑改动不使用。

先读当前 change spec，它决定需要哪类证据；Vitest、Playwright、Midscene、Harness 和手工检查不能互相替代。

- `pnpm harness` 会启动并聚合同次浏览器结果；同次 run id 与 source SHA 必须关联。不得把旧 `harness/results/` 当作当前证据。
- 浏览器性能采样与诊断 readback 分开。`readPixels`、截图分析和 Midscene 可解释视觉连续性，但其耗时不是帧成本证据。
- 对视觉运动或连续行为，从同一真实输入流程检查多张原始帧，包含早/中状态和相关的转头。单张截图或 Harness 布尔值不足以支撑视觉语义结论。
- Worker 或 streaming 改动除静态/构建外需要真实浏览器基线。移动文件后逐项检查 `new URL(...worker...)` 和动态 import。

复用既有 `scripts/run-playwright-harness.mjs`、`scripts/run-harness.mjs` 和 change 内证据合同，不重建 runner。证据生命周期和结果边界按需读[开发治理](../../../docs/development-governance.md)与当前 spec。
