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
- 计算池故障恢复 RED：新增用例复现 `Worker.onerror` 后复用已死实例，以及 `postMessage()` 同步抛错时任务占用槽且没有失败回执；两项均失败。
- 计算池故障恢复 GREEN：`pnpm exec vitest run tests/client/compute-worker-pool.test.ts tests/client/compute-task-queue.test.ts`，2 个文件、12 个测试全部通过。坏实例先终止再以指数退避有界重建；Worker 工厂持续失败最多重试三次并报告槽不可用；同步传输失败立即释放槽并向调用方返回任务失败，使流体租约能够被 Authority 归还。
- 生产计算 Worker RED：浏览器计算运行时与合作式 Worker 阶段测试先因模块不存在失败；旧 `world-worker.ts` 只能接收私有 mesh 消息，运行期间无法消费 pool 取消。
- 生产计算 Worker GREEN：`pnpm exec vitest run tests/client/browser-compute-runtime.test.ts tests/worker/compute-worker-task.test.ts tests/client/compute-worker-pool.test.ts tests/world/mesh.test.ts tests/server/fluid-transaction.test.ts`，5 个文件、40 个测试全部通过。一个保留 Fluid Worker 只计算候选，一个或两个 General Worker 统一生成/halo/mesh；生成、halo 和 mesh 阶段间让出事件循环并检查取消，旧 Mesh 端口只作为通用池适配层，不再自行创建 Worker。
- 物理审查修订已接入：本地提交 `f042740` 合入全局候选恢复、world-aware 实体分离、身体配置验证、终点接地判定和有限水面跃出；冲突只保留身体注册表导出并同时导出 `validateBodyConfig`。
- 水面同源与注册校验 RED：`pnpm exec vitest run tests/server/authority-session.test.ts tests/physics/body-registry.test.ts`，2 项按预期失败：物理源水按满格采样而渲染为 7/8；玩家注册表未显式配置水面跳速。
- 水面同源与注册校验 GREEN：`pnpm exec vitest run tests/server/authority-session.test.ts tests/physics/body-registry.test.ts tests/physics/step-body.test.ts`，3 个文件、30 个测试全部通过。物理流体 AABB 复用 `waterSurfaceHeight()` 并检查上方覆水；身体注册加载时执行 `validateBodyConfig()`，角色显式配置有限水面跃出速度。
- 暴露水面信号 RED：物理核心收紧 `FluidVolume.surfaceY` 后，生产逐格适配测试证明最上层水格没有标记真实自由水面；内部覆水格不应带该标记。
- 暴露水面信号 GREEN：`pnpm exec vitest run tests/server/authority-session.test.ts tests/physics/step-body.test.ts tests/server/authority-runtime.test.ts`。Authority 适配器仅在上方已装载且非水时设置与 `waterSurfaceHeight()` 同源的 `surfaceY`；内部格和上方未知的格都不触发水面跃出。
- 浏览器实际接线 RED：新增 `changes/2026-09-06-independent-loops-unified-physics/e2e/authority-worker-physics.spec.ts`，先定义生产 Worker 数量、Logic Worker 阻塞 500ms 时 Authority 物理与真实输入继续、一格岸真实 W 阻挡及 W+Space 连续轨迹。执行拓扑用例后按预期失败：Harness 实际返回 `runtime: "integrated-server"`，而合同要求 `authority-worker`；证明当前浏览器仍是旧主线程权威，不能以纯模块测试冒充完成。
- Authority Worker 运行时 RED：`pnpm exec vitest run tests/server/authority-runtime.test.ts tests/server/authority-game-server-port.test.ts`，新套件因 `src/server/authority/authority-runtime.ts` 尚不存在而失败；同时确认 GameServer 已有的 `peekLoadedVoxel()` 可携带已装载流体而不生成未知 Chunk。
- Authority Worker 运行时 GREEN：`pnpm exec vitest run tests/server/authority-runtime.test.ts tests/server/authority-game-server-port.test.ts tests/server/authority-session.test.ts tests/client/compute-worker-pool.test.ts`，4 个文件、21 个测试全部通过。`AuthorityRuntime` 是唯一创建 `GameServer` 的会话工厂，创建脚底中心玩家、驱动固定步物理、按已装载数据查询碰撞并异步准备可转移网格副本；`authority-worker.ts` 使用独立计时器、嵌套 Persistence Worker、流体租约和 Logic observation 消息。
- 浏览器 Authority 端口 RED：`pnpm exec vitest run tests/client/browser-authority-client.test.ts` 因 `src/client/browser-authority-client.ts` 尚不存在而失败。
- 浏览器 Authority 端口 GREEN：同一命令 1 个文件、2 个测试通过。客户端等待真实 Worker ready、拒绝旧 epoch、把网格响应保存为只读镜像并为计算 Worker 复制独立传输数组；输入、暂停、事务、保存、流体和 Logic 路由只走消息端口。

## 集成提交

待记录。不会推送远端。

## 阻塞与未满足准出

- 物理核心与流体候选模块由并行隔离 worktree 实现，必须通过接口审核后再合并。
- 独立物理审查发现实体对实体分离与显式恢复仍有夹持几何问题；Authority 暂未调用该路径，等待物理修订后再接入，禁止以客户端脱困补丁绕过。
- 浏览器自然场景、视觉语义和 2/3 Worker 同机对照尚未执行。
- Worker-first 权威接纳 RED：`pnpm exec vitest run tests/server/authority-runtime.test.ts tests/client/browser-authority-client.test.ts tests/app/mesh-task-scheduler.test.ts`，4 项按预期失败：Authority 仍同步生成 canonical/halo，客户端仍缓存主线程快照，scheduler 未等待异步权威接纳，体素变更数错误复用了物理提交序号。
- Worker-first 权威接纳 GREEN：`pnpm exec vitest run tests/worker/compute-worker-task.test.ts tests/client/browser-compute-runtime.test.ts tests/client/browser-authority-client.test.ts tests/server/authority-runtime.test.ts tests/app/mesh-task-scheduler.test.ts tests/server/authority-session.test.ts`，6 个文件、23 个测试全部通过；`pnpm exec tsc --noEmit` 通过。Authority 只加载持久化覆盖并返回生成输入，General Worker 负责缺失 Chunk 的 canonical/halo/mesh；结果必须先异步回送唯一 Authority 校验 epoch/revision 后才进入本地只读碰撞镜像和渲染。新世界安全出生点搜索也在 General Worker 执行，Authority bootstrap 完成后才建立会话时间原点，加载耗时不形成物理欠债；未知碰撞只发加载请求并保持合成阻挡。`worldMutationCount`、`physicsTick` 与全局 `commitSequence` 已在快照端口分栏，外部事务统一提交序号仍在下一阶段接线。
- 全局提交与幂等事务 RED：Authority 只在每个物理步推进内部计数，玩法时钟、编辑、库存、流体和命令没有进入同一序号；生产 RPC 的 `requestId` 也未提供 producer/stream/sequence 幂等键，重复投递会再次执行。新增测试按预期复现 gameplay 到期少一次全局提交、重复操作执行两次。
- 全局提交与幂等事务 GREEN：`pnpm exec vitest run tests/server/authority-session.test.ts tests/server/authority-runtime.test.ts tests/client/browser-authority-client.test.ts tests/runtime/session-protocol.test.ts`，4 个文件、31 个测试全部通过。Authority 用一个 `commitSequence` 排序物理步、玩法/昼夜时钟、体素编辑、库存/行动、流体接纳、命令与显式迁移；`worldMutationCount` 只统计真实体素写入。浏览器事务携带 `epoch + issuer + stream + sequence`，同键复用首次回执，过期/容量/`expectedCommitSequence` 冲突明确拒绝；输入的 invalid/late/resync 决策也显式回传预测层，不再静默丢弃。
- 浏览器主入口接线 GREEN：`pnpm exec tsc --noEmit --pretty false` 通过；`pnpm exec vite build` 通过并明确产出 `authority-worker`、`game-logic-worker`、`persistence-worker`、`fluid-compute-worker` 与 `world-worker` 五类独立 Worker bundle。`Game` 不再导入或实例化 `GameServer`，只持有消息客户端；Authority Worker 内唯一持有 `GameServer` 和 Persistence Worker，Logic Worker 独立，计算池保留一个 Fluid 槽并按配置提供一个或两个 General 槽。
- 浏览器生产 Worker 初次验收：`pnpm exec playwright test changes/2026-09-06-independent-loops-unified-physics/e2e/authority-worker-physics.spec.ts --workers=1`，拓扑与 Logic 阻塞 500ms 时 Authority 物理/真实输入继续两项通过。岸边项失败，证据显示 fixture 的异步 `fillWorld`/`movePlayerTo` 未由旧测试回调返回，起点仍是旧高度 `12.6`，随后才跳到目标高度 `50.585`；Harness 生产入口已改为返回真实事务 Promise，需求用例需显式等待后再判断连续轨迹。
- 预测与输入定向 GREEN：`pnpm exec vitest run tests/client/browser-logic-client.test.ts tests/client/player-input-stream.test.ts tests/server/logic-observation-builder.test.ts tests/worker/game-logic-worker.test.ts`，4 个文件、11 个测试通过。输入按独立固定物理时钟每步生成唯一 `sequence/targetPhysicsTick`，视角先映射为世界坐标；预测以实际 `physicsHz` 固定步积分，Authority ack 后按保留历史重放，版本不匹配保守重同步。Logic 客户端只有一个在途 observation 并合并为一个最新待发 observation，Harness 阻塞在 Worker 实际开始后才回执。
- Headless 同核推进 GREEN：`pnpm exec vitest run tests/server/headless-session.test.ts tests/server/authority-session.test.ts tests/server/authority-runtime.test.ts --no-file-parallelism --maxWorkers=1`，3 个文件、22 个测试通过。`AuthorityRuntime.advanceSession()` 按最高 lane 频率分片驱动同一个 Authority 会话，以会话真实累计值返回物理、玩法与流体增量；默认 1 秒严格产生 60/20/30 次推进和 20 个 Logic batch，流体候选经同一事务提交，物理欠债为零。
- 全局 Worker 成本 RED/GREEN：不可变生产 preview 的 CDP 实测除五类生产 Worker 外，Tone 默认 ticker 还创建一个 Blob Worker，使单 General 配置达到 6、双 General 达到 7。新增音频测试先证明 `MusicPlayer` 未配置可控 ticker；随后改为复用同一 `AudioContext` 的 `Tone.Context({ clockSource: 'timeout' })`。`pnpm exec vitest run tests/app/reference-audio-lifecycle.test.ts tests/client/audio-composition.test.ts tests/client/audio-policy.test.ts --no-file-parallelism --maxWorkers=1` 共 3 文件、12 项通过，source TypeScript 通过。不可变生产 preview 再以 CDP 实测：单 General 为 5 个 Worker，双 General 为 6 个 Worker；菜单、进入世界、音乐前台播放及返回菜单四项真实浏览器检查通过。
- Authority唯一所有权静态门禁 RED/GREEN：新增 ESLint 正反例先证明 `src/app/**` 与 `src/client/**` 可值导入或动态加载 `GameServer`；实现 `seedlands/authority-worker-owner` 后，浏览器主线程目录的值导入、动态 import 与 require 全部拒绝，明确 type-only 协议引用仍允许。`pnpm exec vitest run tests/governance/authority-ownership-eslint.test.ts tests/governance/runtime-purity-eslint.test.ts tests/governance/world-purity-eslint.test.ts --no-file-parallelism --maxWorkers=1` 共 3 文件、12 项通过，实际 `src/app` 与 `src/client` 全量 ESLint 通过。
- Authority 世界时钟 RED/GREEN：定向用例先证明 P/T 只改本地环境、Authority 会话没有可变时钟速率、浏览器协议缺少事务端口。实现后 P/T 和 Harness 都经 `set-world-clock-rate` 幂等事务设置唯一 Authority；暂停速率为 0，恢复和 1/20/100 倍速从同一基础速率换算，非法速率在会话边界拒绝。`pnpm exec vitest run tests/server/authority-world-clock.test.ts tests/client/browser-authority-client.test.ts tests/app/player-input-gates.test.ts --no-file-parallelism --maxWorkers=1` 共 3 文件、16 项通过。
- 保存序号重入协作 GREEN：Authority 会话支持经验证的 `initialCommitSequence`，Runtime 从持久化恢复出的 `GameServer.restoredCommitSequence` 建立全局提交序号，避免较长旧会话重入后立即保存被防旧覆盖门禁拒绝。`tests/server/authority-checkpoint-restore.test.ts` 与世界时钟、客户端、碰撞调试定向套件合计 7 文件、28 项通过；持久化原子事务与浏览器重入 E2E 由独立保存准出记录负责。
- 真实碰撞箱 RED/GREEN：输入用例先证明 F3+B 未进入生产动作，投影用例先证明预测身体被错误标为 Authority 同一 tick。现在 F3+B 切换独立 Immediate 调试层，批量显示 Authority 实体真实身体、接触法线、拾取传感器、目标体素子碰撞形状与玩家预测身体；图例分别标出 Authority/预测 tick，关闭时销毁调试 Mesh、材质和 Entity。定向输入、投影和统一身体注册表测试通过；真实浏览器按键、可见语义及关闭后 GPU 资源零增量仍待当前生产构建验收。
- 旧玩家碰撞路径清理 GREEN：删除客户端旧轴分离、中心格、step-down、脱嵌和第二套 epsilon 的死实现；玩家脚底到视角的偏移由 `bodyConfigFor('player')` 的真实高度派生，旧代码不再作为不可达备用权威。定向测试验证视角偏移与身体注册表同源，源码与测试树中无旧模块或旧函数引用。
