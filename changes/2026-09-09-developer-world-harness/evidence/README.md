# H1/H2 浏览器截图证据

世界合同完整验收：`96322c84ac438f8faf5361580b4cbf913d33a8f0`，`CI=true pnpm test:developer-harness --retries=0`，2 项通过（11.9 秒）。最终截图：`23a0445a40d95c7b1083470ce60a487931454372`，仅补充复选框样式后以同命令加 `--grep 'F3 分类'` 通过（5.0 秒）。2026-09-09，真实 Chrome / Playwright。原始截图由测试保存，无重绘或后期合成；它们证明界面状态，不用于性能倍率结论。

- [概览](debug-overview.png)：1280×720，F3 分组与实际指标。
- [Wasm](debug-wasm.png)：实际 Worker 核执行计数、线性内存与样本来源。
- [紧凑布局](debug-small.png)：800×600，可滚动到碰撞控制；未知测量保持未提供。

同一命令还覆盖跨 seed 恢复、未知 Chunk canonical 准备、Headless → Browser → Headless 的世界/Actor/Action/推进一致性，以及恢复后真实 Pointer Lock 与 KeyW 移动。完整失败及修复过程见[实施记录](../implementation-report.md)。后续 CI 每次运行保留测试图片/报告 artifact 7 天。
