---
name: seedlands-evidence
description: Run or review Seedlands CI, Harness, browser evidence, and performance diagnostics when a change needs correlated multi-layer evidence or changes test acceptance criteria.
---

# Seedlands 证据

当 change 触及浏览器行为、Worker 接线、Harness 输出、性能声明或 CI 测试口径时使用；只需定向单元测试的纯逻辑改动不使用。

先读当前 change spec，确定要证明的行为和证据边界；Vitest、构建、Playwright、Midscene、Harness 与手工检查各自证明不同层级。

## 按需读取

- CI、测试选择、重试或回归保障：读[CI 测试边界](references/ci-testing.md)，尤其是 TDD、已知缺口与执行成本。
- Owner、base/head 计划、runner stage 或生产产物身份：读[Harness 合同](references/harness-contracts.md)。
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
- 浏览器只走 `apps/web/tests/e2e/classic-runtime.spec.ts`：从生产 build 下载并校验同一份 `apps/web/dist`，不直接调用历史 `changes/*/e2e`、不在 Chromium job 重建，也不新开 Playwright/Puppeteer/Midscene 旁路线。
- 浏览器性能采样与诊断 readback 分开。`readPixels`、截图分析和 Midscene 可解释视觉连续性，但其耗时不是帧成本证据。
- 视觉运动或连续行为从同一真实输入流程检查多张原始帧，包含早/中状态和相关转头。单张截图或 Harness 布尔值不足以支撑视觉语义结论。
- Worker 或 streaming 改动需要真实浏览器基线。移动文件后逐项检查 `new URL(...worker...)` 和动态 import；dev server 通过与生产产物可运行分别取证。

## 包内脚本与运行位置

优先从仓库根目录使用 `package.json` 中的既有命令。PR 先冻结 `baseSha` 与实际 checkout 的 `headSha`；base 有 selector 时使用 base tree 的完整 `scripts/harness/` 生成计划，缺失时仅允许显式 `missing-base-selector` 的 `--all` bootstrap。未知路径、无 owner、空匹配、selected test 未执行、计划/source 不一致都 fail closed。

- [影响计划](scripts/plan.mjs)：对应 `pnpm harness:plan --root "$PWD" --base <base> --head <head> --out <path>`；普通变更输出 affected，策略/构建/未知范围与 `--all` 输出 full-new。
- [Harness runner](scripts/run.mjs)：对应 `verify:affected`、`verify:all`、`test`、`harness:classic` 与 `bench:runtime`。它按 owner 的独立 Vitest config 执行具体 selected files，并只从 canonical Playwright config 启动浏览器。
- [生产产物](scripts/artifact.mjs)：`pnpm build` 生成 `harness-artifact.json`；Classic 在启动前后校验 `sourceSha`、source/lock/artifact digest 与所有 dist bytes。
- `scripts/run-playwright-harness.mjs` 仅为 `harness:classic` 兼容别名；`scripts/run-harness.mjs` 仅为 `stdlib-world` 局部 benchmark 兼容别名。它们不再拥有历史浏览器列表、aggregate 或 baseline 写入语义。
- [性能窗口入口](scripts/with-benchmark-reservation.mjs)：调用包内 `benchmark-window.mjs` 实现，支持等待上限、独立测试锁和退出码传播。用法见性能执行窗口。

Harness baseline、scenario 或阈值更新只有在当前任务明确授权且带 identity/diff 时执行；普通 affected、Classic 或诊断运行不得自动改绿基线。

`references/` 与 `scripts/` 采用仓库内相对软链接，源文件仍在根 `docs/` 与 `scripts/harness/` 单点维护。读取链接文档的后续相对引用时，先解析真实源路径，再以原文档目录为基准。完整 checkout 可迁移；运行依赖本仓库的源码、package scripts、锁文件对应依赖与按需生成的产物。单独分发本包需解引用资源并携带运行依赖，软链接本身不提供独立运行环境。
