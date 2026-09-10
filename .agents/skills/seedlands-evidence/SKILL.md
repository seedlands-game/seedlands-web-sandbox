---
name: seedlands-evidence
description: Run or review Seedlands CI, Harness, browser evidence, and performance diagnostics when a change needs correlated multi-layer evidence or changes test acceptance criteria.
---

# Seedlands 证据

当 change 触及浏览器行为、Worker 接线、Harness 输出、性能声明或 CI 测试口径时使用；只需定向单元测试的纯逻辑改动不使用。

先读当前 change spec，确定要证明的行为和证据边界；Vitest、构建、Playwright、Midscene、Harness 与手工检查各自证明不同层级。

## 按需读取

- CI、测试选择、重试或回归保障：读[CI 测试边界](references/ci-testing.md)，尤其是 TDD、已知缺口与执行成本。
- 需求用例生命周期、RED/GREEN 或交付身份：读[开发治理](references/development-governance.md)的相关章节。
- 性能结论：先按开发治理固定对照，再读[性能执行窗口](references/performance-execution.md)取得独占采样窗口。普通功能测试和诊断 readback 不充当性能样本。
- 修改本 skill 或沉淀经验：读[上下文沉淀](references/context-engineering.md)，沿用现有资源和职责。

## 验证行为与因果

- 就绪条件绑定实际被测对象；夹具显式定义影响结论的地形、数据和生命周期。局部功能不要求无关后台任务全部清空，超时不充当性能阈值。
- 计数增长或输入 ack 前进不能单独证明目标操作已生效。基线对齐正式 owner 的完成边界，并检查该操作对应的状态、轨迹或结果；不依赖截图、网络往返或固定休眠恰好落在某个时刻。
- 关键回归按风险选择定向故障反例，确认破坏目标行为会让测试失败；反例仍通过时先修正测试。无需给每个 PR 增加全仓 mutation testing，也不把某个用例的帧数、tick 数推广为通用门槛。
- CI 的 flaky、失败与未运行如实保留，处理约定以 CI 测试边界为准。诊断重试不替代根因修复。

## 浏览器与性能证据

- 同次浏览器结果关联 run id 与 source SHA，不把旧运行产物当作当前证据。
- 浏览器性能采样与诊断 readback 分开。`readPixels`、截图分析和 Midscene 可解释视觉连续性，但其耗时不是帧成本证据。
- 视觉运动或连续行为从同一真实输入流程检查多张原始帧，包含早/中状态和相关转头。单张截图或 Harness 布尔值不足以支撑视觉语义结论。
- Worker 或 streaming 改动需要真实浏览器基线。移动文件后逐项检查 `new URL(...worker...)` 和动态 import；dev server 通过与生产产物可运行分别取证。

## 包内脚本与运行位置

优先从仓库根目录使用 `package.json` 中的既有命令。脚本入口在包内可读、可调用：

- [浏览器 Harness](scripts/run-playwright-harness.mjs)：运行长期浏览器基线，关联 run id/source SHA；`--aggregate` 继续聚合，`--baseline` 仅在当前任务授权更新基线时使用。
- [Harness 聚合](scripts/run-harness.mjs)：消费同次浏览器结果和仓库源码/构建产物；其 `harness-*` helper 与 runtime entry 同样位于本包 `scripts/`。
- [性能窗口入口](scripts/with-benchmark-reservation.mjs)：调用包内 `benchmark-window.mjs` 实现，支持等待上限、独立测试锁和退出码传播。用法见性能执行窗口。

`references/` 与 `scripts/` 采用仓库内相对软链接，源文件仍在根 `docs/` 与 `scripts/` 单点维护。读取链接文档的后续相对引用时，先解析真实源路径，再以原文档目录为基准。完整 checkout 可迁移；运行依赖本仓库的源码、package scripts、锁文件对应依赖与按需生成的产物。单独分发本包需解引用资源并携带运行依赖，软链接本身不提供独立运行环境。
