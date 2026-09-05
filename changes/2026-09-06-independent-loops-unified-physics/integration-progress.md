# 集成进度与证据

本文记录实施过程和真实证据，不修改已批准的 `spec.md`。

## 接口冻结

- 已核对 `spec.md` SHA-256 为 `c14711d82070e0b9c255eda0bfc5b2bbd134d130a8c45dacf662480e9b953512`。
- 已在 `contracts.md` 冻结物理、时钟、Authority 协议、逻辑意图、计算池、预测/插值、碰撞调试、保存和 headless 的依赖方向及接口。
- 最小接线顺序：纯 runtime/client RED 与实现 → 内存 Authority → 浏览器 Worker → 流体/计算池 → app/headless → 完整准出。

## RED / GREEN 记录

- RED（`3337ed5` 后的工作树）：`pnpm exec vitest run tests/runtime tests/client/compute-task-queue.test.ts tests/client/snapshot-interpolator.test.ts tests/governance/runtime-purity-eslint.test.ts`。结果为 6 个测试文件失败：5 个生产模块尚不存在；纯 runtime/physics ESLint 边界的 2 个反例未被规则拒绝，正例通过。该失败与预期一致，发生在生产实现之前。
- GREEN（物理提交 `7502d70` 后）：`pnpm exec vitest run tests/runtime tests/client/compute-task-queue.test.ts tests/client/snapshot-interpolator.test.ts tests/governance/runtime-purity-eslint.test.ts tests/physics/step-body.test.ts`，7 个文件、36 个测试全部通过。覆盖活跃时钟暂停/恢复、跨执行环境时间换算、30/60/120Hz、非整数频率比、有限追赶与欠债、输入/事务独立幂等流、迟到按键拒绝、流体保留队列、依赖/合并/背压/epoch、物理时间插值和纯模块静态边界。
- RED（`65834d5`）：`pnpm exec vitest run tests/server/authority-session.test.ts` 因 Authority 会话和只读已加载体素适配器尚不存在而失败，发生在对应生产实现之前。
- GREEN（当前工作树）：`pnpm exec vitest run tests/server/authority-session.test.ts tests/runtime/session-protocol.test.ts tests/physics/step-body.test.ts`，3 个文件、20 个测试全部通过。Authority 现在按固定步推进所有传入实体；逻辑无返回时物理继续，暂停不补算时间，流体 lane 只派生请求；未知 Chunk 产生合成阻挡和异步加载请求，已加载空气与灯笼注册形状明确区分。
- RED（`1a07f93`）：`pnpm exec vitest run tests/server/authority-game-server-port.test.ts`，2 个测试按预期失败：`GameServer.peekLoadedVoxel()` 与 `advanceGameplayRules()` 尚不存在。
- GREEN（当前工作树）：`pnpm exec vitest run tests/server/authority-game-server-port.test.ts tests/server/authority-session.test.ts tests/server/dropped-item-physics.test.ts tests/server/entity-player-runtime.test.ts tests/server/gameplay-command-persistence.test.ts`，5 个文件、22 个测试全部通过。只读已加载体素不生成未知 Chunk；可靠 gameplay 时间可推进饥饿/采集规则而不调用旧实体重力和导航移动。
- 协议复查 GREEN：`pnpm exec vitest run tests/runtime/session-protocol.test.ts tests/server/authority-session.test.ts tests/server/authority-game-server-port.test.ts`，3 个文件、16 个测试全部通过。输入按 `targetPhysicsTick` 保留历史，ack 只在物理步实际消费后推进；迟到输入进入明确重同步状态；暂停期间不会借旧 debt 积分，消息分批与预先批量到达得到相同身体状态，despawn 身体从快照删除。
- 身体注册表 RED：`pnpm exec vitest run tests/physics/body-registry.test.ts` 因 `src/physics/body-registry.ts` 尚不存在而失败。
- 身体注册表 GREEN：`pnpm exec vitest run tests/physics/body-registry.test.ts tests/client/entity-hit-volume.test.ts tests/physics/step-body.test.ts`，3 个文件、20 个测试全部通过。玩家、掉落物与三类角色使用脚底中心具名身体；战斗射线改为消费同一注册表，不再保留 client 硬编码碰撞尺寸。
- 流体 Worker 端口 RED：`pnpm exec vitest run tests/server/authority-game-server-port.test.ts` 因 `GameServer.requestFluidWork()` 尚不存在而失败；证明用例没有落回同步 `advanceFluid()`。
- 流体 Worker 端口 GREEN：`pnpm exec vitest run tests/server/authority-game-server-port.test.ts tests/server/fluid-transaction.test.ts tests/server/voxel-fluid-runtime.test.ts`，3 个文件、26 个测试全部通过。Authority 可租赁只读快照、接纳候选或归还租约；请求端口不执行候选计算。同步 `advanceFluid()` 仅保留旧路径兼容，最终生产调度不得调用。
- 协议有界窗口 RED：`pnpm exec vitest run tests/runtime/session-protocol.test.ts`，新增 4 项均按预期失败：未来 tick 无上限、倒序目标 tick 被接纳、迟到后重同步标记不恢复、事务回执永久增长。
- 协议有界窗口 GREEN：`pnpm exec vitest run tests/runtime/session-protocol.test.ts tests/server/authority-session.test.ts`，2 个文件、18 个测试全部通过。输入默认最多保留 256 条且不超过未来 240 tick；目标 tick 倒序或超限时清空未消费历史并要求完整状态重同步，随后较新合法状态可恢复。事务每流只保留有限回执，淘汰后的旧 sequence 明确返回 `expired`，不会再次执行；输入 ack 始终只在物理步消费后推进且不回退。
- 计算池控制器 RED：`pnpm exec vitest run tests/client/compute-worker-pool.test.ts` 因浏览器池模块尚不存在而失败。
- 计算池控制器 GREEN：`pnpm exec vitest run tests/client/compute-worker-pool.test.ts tests/client/compute-task-queue.test.ts`，2 个文件、9 个测试全部通过。池固定一个流体槽并只允许 1/2 个通用槽；通用任务无法占流体槽，两个通用槽可并行。任务数/字节背压、合作式取消、过期结果计数及世界切换时终止并重建 Worker 均已覆盖，计算 Worker 总数硬上限为 3。

## 集成提交

待记录。不会推送远端。

## 阻塞与未满足准出

- 物理核心与流体候选模块由并行隔离 worktree 实现，必须通过接口审核后再合并。
- 独立物理审查发现实体对实体分离与显式恢复仍有夹持几何问题；Authority 暂未调用该路径，等待物理修订后再接入，禁止以客户端脱困补丁绕过。
- 浏览器自然场景、视觉语义和 2/3 Worker 同机对照尚未执行。
