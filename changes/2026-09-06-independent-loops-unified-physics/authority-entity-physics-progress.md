# Authority 实体物理接线进度

## 范围

本模块只在 `AuthoritySession` 内接入已准入的统一物理核心：所有动态实体的固定步、角色碰撞矩阵、掉落物吸附与一次性拾取提交，以及显式有界身体恢复。它不修改浏览器运行时、应用层、会话协议、玩法运行时或公开存档格式；完整准出仍以 change 总体验证为准。

## RED

- 2026-09-06：先新增 `tests/server/authority-entity-physics.test.ts`，使用真实 `VoxelCollisionWorld`、方块碰撞形状和纯物理求解器构造墙—角色—角色夹持、灯笼薄碰撞箱、相邻双体素恢复与未知 Chunk 阻挡。
- `pnpm exec vitest run tests/server/authority-entity-physics.test.ts`：5 项中 4 项按预期失败。角色保持 `0.4` 重叠；2.25 格内掉落物没有移动；`requestBodyRecovery` 不存在；未知区域未因吸附运动触发加载请求。灯笼跨墙用例在尚无吸附路径时自然通过，因此其单独结果不是实现证据，必须与吸附 GREEN 一起判断。

## 当前状态

- 阶段：本模块 GREEN，待总 change 集成准出。
- 阻塞：无。

## GREEN 与边界

- `AuthoritySession` 现在先按实体 id 排序运行全部 `stepBody`，再按同一顺序对角色两两调用 world-aware `separateBodies`。所有最终位置一次性写回；被推离身体重新探测最终支撑并清除分离前接触，快照不保留旧位置的接触状态。掉落物不进入角色推离配对，保持碰撞矩阵定义的可重叠语义。
- 掉落物在 2.25 格内选择 id 稳定的存活玩家目标，以 6 格每秒把吸附水平速度和垂直/重力分别送入同一个 `stepBody` 连续扫掠；没有直接改位置或复制旧碰撞算法。0.75 格内按物件/玩家对只提交一次 `pickupItem`，离开范围才允许重试；本步存在水平阻挡接触时不跨墙提交。
- `requestBodyRecovery(entityId, reason, maxDistance)` 只接受 `initialization`、`legacy-restore`、`external-geometry-change`，距离限制为 0..8，队列最多 512 个不同实体且同实体合并。构造时已有实体排入初始化恢复；请求只在下一物理步开头消费，普通 `stepBody` 不调用恢复。快照复制最近 32 条结果，记录原因、`recovered|blocked|missing`、脚底中心欧氏距离和物理 tick。
- `pnpm exec vitest run tests/server/authority-entity-physics.test.ts tests/server/authority-session.test.ts tests/server/authority-runtime.test.ts tests/server/authority-game-server-port.test.ts tests/physics/step-body.test.ts tests/physics/body-registry.test.ts`：6 个文件、46 项全部通过。
- 对本模块文件执行 Prettier check 与 ESLint：通过。完整 `pnpm typecheck` 被共享工作树中正在进行的 app/runtime 接线阻塞，报错集中在 `src/app/game.ts`、`src/app/game-harness.ts` 等其他任务文件；本模块相关测试与源码没有单独类型错误。该结果不是完整 Static 或 Build 准出。
- 本模块只证明 Authority 内存端口和真实体素几何下的确定性行为。浏览器 Worker、自然河岸、完整存档恢复、Midscene、性能及删除旧 `EntityPhysics` 仍由总 change 集成验证，不能用上述 Vitest 代替。
