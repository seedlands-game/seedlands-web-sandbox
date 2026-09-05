# 集成进度与证据

本文记录实施过程和真实证据，不修改已批准的 `spec.md`。

## 接口冻结

- 已核对 `spec.md` SHA-256 为 `c14711d82070e0b9c255eda0bfc5b2bbd134d130a8c45dacf662480e9b953512`。
- 已在 `contracts.md` 冻结物理、时钟、Authority 协议、逻辑意图、计算池、预测/插值、碰撞调试、保存和 headless 的依赖方向及接口。
- 最小接线顺序：纯 runtime/client RED 与实现 → 内存 Authority → 浏览器 Worker → 流体/计算池 → app/headless → 完整准出。

## RED / GREEN 记录

- RED（`3337ed5` 后的工作树）：`pnpm exec vitest run tests/runtime tests/client/compute-task-queue.test.ts tests/client/snapshot-interpolator.test.ts tests/governance/runtime-purity-eslint.test.ts`。结果为 6 个测试文件失败：5 个生产模块尚不存在；纯 runtime/physics ESLint 边界的 2 个反例未被规则拒绝，正例通过。该失败与预期一致，发生在生产实现之前。
- GREEN（物理提交 `7502d70` 后）：`pnpm exec vitest run tests/runtime tests/client/compute-task-queue.test.ts tests/client/snapshot-interpolator.test.ts tests/governance/runtime-purity-eslint.test.ts tests/physics/step-body.test.ts`，7 个文件、36 个测试全部通过。覆盖活跃时钟暂停/恢复、跨执行环境时间换算、30/60/120Hz、非整数频率比、有限追赶与欠债、输入/事务独立幂等流、迟到按键拒绝、流体保留队列、依赖/合并/背压/epoch、物理时间插值和纯模块静态边界。

## 集成提交

待记录。不会推送远端。

## 阻塞与未满足准出

- 物理核心与流体候选模块由并行隔离 worktree 实现，必须通过接口审核后再合并。
- 浏览器自然场景、视觉语义和 2/3 Worker 同机对照尚未执行。
