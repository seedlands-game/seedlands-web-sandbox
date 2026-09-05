# Authority 实体物理接线进度

## 范围

本模块只在 `AuthoritySession` 内接入已准入的统一物理核心：所有动态实体的固定步、角色碰撞矩阵、掉落物吸附与一次性拾取提交，以及显式有界身体恢复。它不修改浏览器运行时、应用层、会话协议、玩法运行时或公开存档格式；完整准出仍以 change 总体验证为准。

## RED

- 2026-09-06：先新增 `tests/server/authority-entity-physics.test.ts`，使用真实 `VoxelCollisionWorld`、方块碰撞形状和纯物理求解器构造墙—角色—角色夹持、灯笼薄碰撞箱、相邻双体素恢复与未知 Chunk 阻挡。
- `pnpm exec vitest run tests/server/authority-entity-physics.test.ts`：5 项中 4 项按预期失败。角色保持 `0.4` 重叠；2.25 格内掉落物没有移动；`requestBodyRecovery` 不存在；未知区域未因吸附运动触发加载请求。灯笼跨墙用例在尚无吸附路径时自然通过，因此其单独结果不是实现证据，必须与吸附 GREEN 一起判断。
- `aac278c` 独立复审后新增五项 RED：被推离角色的最终接触被清空；吸附首步直接把水平速度重设为 -6；灯笼底面阻挡只有竖直接触时仍跨越完整碰撞形状提交拾取；首次拾取失败后 20 个物理 tick 仍不重试；11 个恢复请求在同一步全部处理。`pnpm exec vitest run tests/server/authority-entity-physics.test.ts tests/server/authority-session.test.ts` 得到 5 项失败、14 项通过，准确复现复审问题。

## 当前状态

- 阶段：本模块 GREEN，待总 change 集成准出。
- 阻塞：无。

## GREEN 与边界

- `AuthoritySession` 先按实体 id 排序运行全部 `stepBody`，再按同一顺序对角色两两调用 world-aware `separateBodies`。所有最终位置一次性写回；被推离身体通过纯 `probeBodyContacts` 查询最终支撑和真实接触，不再执行第二个时间积分，也不保留分离前位置的错误状态。掉落物不进入角色推离配对，保持碰撞矩阵定义的可重叠语义。
- `PhysicsInput.externalAcceleration` 与 `BodyConfig.maxExternalAcceleration` 提供通用有界外部加速度。掉落物在 2.25 格内选择 id 稳定的存活玩家目标，以 6 格每秒目标速度计算有限加速度，重力、流体、三轴速度和位移只进入一次 `stepBody` 与一次连续扫掠；首步不会重设已有下落速度。
- 0.75 格内拾取先以掉落物完整 AABB 对玩家脚底目标执行同一三维 swept-AABB 可达性检查，灯笼底面等只有竖直接触的薄障碍也会阻挡提交。失败提交按 15 个物理 tick 有界退避后重试，成功删除后不再提交，允许背包容量等玩法状态变化后自动恢复拾取。
- `requestBodyRecovery(entityId, reason, maxDistance)` 只接受 `initialization`、`legacy-restore`、`external-geometry-change`，距离限制为 0..8，队列最多 512 个不同实体且同实体合并。构造时已有实体排入初始化恢复；每个物理步按 id 最多消费 4 项并保留余项，普通 `stepBody` 不调用恢复。快照复制最近 32 条结果，记录原因、`recovered|blocked|missing`、脚底中心欧氏距离和物理 tick。
- `pnpm exec vitest run tests/server/authority-entity-physics.test.ts tests/server/authority-session.test.ts tests/server/authority-runtime.test.ts tests/server/authority-game-server-port.test.ts tests/physics/step-body.test.ts tests/physics/body-registry.test.ts`：6 个文件、52 项全部通过，覆盖有界加速度、纯接触探测、复合灯笼横向与底面阻挡、失败拾取重试及恢复预算。
- 对本模块文件执行 Prettier check 与 ESLint：通过。完整 `pnpm typecheck` 的 `svelte-check` 被共享工作树中尚未提交的 `src/server/headless/headless-session.ts:318` 阻塞：该文件读取不存在的 `BodyConfig.height`；本模块相关测试与源码没有单独类型错误。该结果不是完整 Static 或 Build 准出。
- 本模块只证明 Authority 内存端口和真实体素几何下的确定性行为。浏览器 Worker、自然河岸、完整存档恢复、Midscene、性能及删除旧 `EntityPhysics` 仍由总 change 集成验证，不能用上述 Vitest 代替。
