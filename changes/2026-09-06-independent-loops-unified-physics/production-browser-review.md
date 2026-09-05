# 生产浏览器独立验收进度

本记录由主任务维护，遵循已批准合同，不代表全部准出完成。

## 固定提交的线程与输入检查

从 `0927ed5` 的 Git archive 在 `/tmp` 独立构建 Vite 生产包，通过独立端口 4273 提供。浏览器测试使用当前 Mac 的 Chrome，避免并行源代码修改和 HMR 污染结果。

- CDP 实际枚举：Authority、Logic、Persistence、Fluid Compute、World Compute 各一个，另有 Tone 的 Blob Worker，总计六个。默认池尚未超过六个总上限，但扩大通用池会越界，且原诊断漏计音频实例。`c1b1827` 将 Tone 调度改为 timeout 后，独立前台 CDP 复验确认默认共 5 个、扩展共 6 个，均为预期真实实例，无额外 Blob Worker。
- 真实 W 在一格河岸侧面受阻；W+Space 经连续权威位置轨迹上岸。按物理 tick 差检查竖直和水平位移上界，并要求存在中间高度。Headless 与前台 Chrome 分别通过，前台两个强交互用例为 `2 passed (7.5s)`。
- 独立 10 秒前台采样通过：实际 9999.9ms、1201 帧、最大相邻帧间隔 12.1ms；Logic 的实际阻塞窗口覆盖 492.5ms、60 帧，期间完成 29 个物理步、29 个输入确认，最大物理债务 16.4ms。
- 原始采样保存在 `evidence/authority-logic-block-0927ed5.json`。此采样画布视口为 1280×720，仅用于 A3，不作为 A9 的 1920×1080 性能准出。

运行入口：`SEEDLANDS_E2E_PORT=4273 pnpm exec playwright test changes/2026-09-06-independent-loops-unified-physics/e2e/authority-worker-physics.spec.ts --headed --workers=1`。10 秒采样显式选择 `--grep 'Logic实际'`；线程用例在音频修订前仍为 RED。

`c1b1827` 不可变生产包在端口 4274 完整运行该需求文件：`4 passed (27.9s)`，涵盖两种实际拓扑、10 秒逻辑阻塞和真实跳跃上岸。后续恢复生态与预测接入后仍需最终集成复验。

## 验收工具自身的纠正

- `blockForHarness()` 的 Promise 确认阻塞开始，而不是阻塞结束。原初版测试因此只收集一帧，不能据此判断渲染卡顿。当前以生产 Worker 的 `blockCompletedCount` 判定实际窗口，并独立采满 10 秒。
- 前台首次鼠标锁定失败时 Chrome 未置前。将 Chrome 置前并在测试中 `bringToFront()` 后真实 Pointer Lock 成功；未模拟或替换鼠标锁定。
- 三个单元测试夹具修复 TypeScript 契约：补全 AuthoritySnapshot 字段、按真实结果联合类型收窄 Mesh 结果、显式运行时修改插值副本以验证隔离。原断言保留，三文件九项 GREEN，受影响 ESLint 通过。

## 尚未准出

最终集成版本还需完整线程预算复验、A7 延迟和乱序传输、存档与故障、真实调试碰撞箱、生态与动作生命周期、Midscene、长期基线独立准入审查以及 A9 同机性能对照。模块测试和上述两项浏览器通过不能替代这些证据。
