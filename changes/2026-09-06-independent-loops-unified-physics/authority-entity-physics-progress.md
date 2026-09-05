# Authority 实体物理接线进度

## 范围

本模块只在 `AuthoritySession` 内接入已准入的统一物理核心：所有动态实体的固定步、角色碰撞矩阵、掉落物吸附与一次性拾取提交，以及显式有界身体恢复。它不修改浏览器运行时、应用层、会话协议、玩法运行时或公开存档格式；完整准出仍以 change 总体验证为准。

## RED

- 2026-09-06：先新增 `tests/server/authority-entity-physics.test.ts`，使用真实 `VoxelCollisionWorld`、方块碰撞形状和纯物理求解器构造墙—角色—角色夹持、灯笼薄碰撞箱、相邻双体素恢复与未知 Chunk 阻挡。
- `pnpm exec vitest run tests/server/authority-entity-physics.test.ts`：5 项中 4 项按预期失败。角色保持 `0.4` 重叠；2.25 格内掉落物没有移动；`requestBodyRecovery` 不存在；未知区域未因吸附运动触发加载请求。灯笼跨墙用例在尚无吸附路径时自然通过，因此其单独结果不是实现证据，必须与吸附 GREEN 一起判断。
- `aac278c` 独立复审后新增五项 RED：被推离角色的最终接触被清空；吸附首步直接把水平速度重设为 -6；灯笼底面阻挡只有竖直接触时仍跨越完整碰撞形状提交拾取；首次拾取失败后 20 个物理 tick 仍不重试；11 个恢复请求在同一步全部处理。`pnpm exec vitest run tests/server/authority-entity-physics.test.ts tests/server/authority-session.test.ts` 得到 5 项失败、14 项通过，准确复现复审问题。
- `832690f` 独立复审以 `/tmp/seedlands-authority-review.test.ts` 复现两项 RED：合法 `maxDistance=8` 的稠密地下恢复因 8192 候选预算抛出 `RangeError` 并击穿 `wake()`；等距的较小 id 玩家隔墙时，物件 120 个物理步后仍停在墙前 `x=0.95`，没有转向另一侧可达玩家。原始评审命令得到 2 项失败。
- `eda8230` 复验关闭恢复 P1 后新增 8/9 候选 RED：固定截取最近 8 个目标时，第 9 个范围内可达玩家永远没有检查机会。仓库先新增 Authority 两步用例，第一步 8 次 sweep 全部受墙阻挡，第二步仍未推进到第 9 个目标，得到 1 项失败。

## 当前状态

- 阶段：本模块 GREEN，待总 change 集成准出。
- 阻塞：无。

## GREEN 与边界

- `AuthoritySession` 先按实体 id 排序运行全部 `stepBody`，再按同一顺序对角色两两调用 world-aware `separateBodies`。所有最终位置一次性写回；被推离身体通过纯 `probeBodyContacts` 查询最终支撑和真实接触，不再执行第二个时间积分，也不保留分离前位置的错误状态。掉落物不进入角色推离配对，保持碰撞矩阵定义的可重叠语义。
- `PhysicsInput.externalAcceleration` 与 `BodyConfig.maxExternalAcceleration` 提供通用有界外部加速度。掉落物在 2.25 格内按距离和 id 稳定排序，每步从该物件的有界游标开始检查最多 8 个目标；本页没有可达目标时游标前进 8，本页找到目标时保持页首，因而静态第 9 个候选会在下一步获得检查且已选目标保持稳定。游标只跟踪最多 512 个当前物件，物件消失即清理；超额物件以物理 tick 轮转页首，不增加全局状态也不会固定在第一页。目标速度仍以 6 格每秒计算有限加速度，重力、流体、三轴速度和位移只进入一次 `stepBody` 与一次连续扫掠。
- 0.75 格内拾取复核本步吸附所选的同一玩家，以掉落物完整 AABB 对玩家最新脚底目标执行三维 swept-AABB 可达性检查；灯笼底面等只有竖直接触的薄障碍也会阻挡提交。失败提交按 15 个物理 tick 有界退避后重试，成功删除后不再提交，允许背包容量等玩法状态变化后自动恢复拾取。
- `requestBodyRecovery(entityId, reason, maxDistance)` 只接受 `initialization`、`legacy-restore`、`external-geometry-change`，距离限制为 0..8，队列最多 512 个不同实体且同实体合并。构造时已有实体排入初始化恢复；每个物理步按 id 最多消费 4 项并保留余项，普通 `stepBody` 不调用恢复。核心 8192 候选预算耗尽是 `recovered:false` 的有界失败，由 Authority 记录 `blocked` 后继续同批请求和本步；无效输入或碰撞箱仍抛错。快照复制最近 32 条结果，记录原因、状态、脚底中心欧氏距离和物理 tick。
- `9b2ec22` 回修时的原始双反例 2 项全部通过；`eda8230` 增补文件中其余恢复和双玩家反例继续通过。单次 helper 调用不可能在最多 8 次 sweep 内检查第 9 个候选，故按澄清后的跨物理步公平合同以仓库 Authority 两步用例取代该断言：首步不吸附，次步选中第 9 个可达目标。仓库回归 `pnpm exec vitest run tests/physics/reachability.test.ts tests/physics/step-body.test.ts tests/physics/body-registry.test.ts tests/server/authority-entity-physics.test.ts tests/server/authority-session.test.ts tests/server/authority-runtime.test.ts tests/server/authority-game-server-port.test.ts`：7 个文件、58 项全部通过。
- 对本模块文件执行 Prettier 与 ESLint：通过。完整 `pnpm typecheck` 的 `svelte-check` 通过，测试 TypeScript 被共享基线 `tests/e2e/support/harness.ts:185,200` 仍限定旧 `integrated-server` runtime 字面量阻塞；本模块相关测试与源码没有单独类型错误。该结果不是完整 Static 或 Build 准出。
- 本模块只证明 Authority 内存端口和真实体素几何下的确定性行为。浏览器 Worker、自然河岸、完整存档恢复、Midscene、性能及删除旧 `EntityPhysics` 仍由总 change 集成验证，不能用上述 Vitest 代替。
