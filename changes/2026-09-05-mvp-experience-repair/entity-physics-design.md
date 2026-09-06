# 实体掉落物理设计

## 目标与范围

本设计落实本 change 的 R1：`world-item` 由服务端以确定性重力、体素碰撞和吸附规则驱动；`creature` 与 `npc` 在脚下支撑被移除后同样会下落。浏览器只呈现服务端位置，不以 bob 动画伪造物理。

## 坐标与状态

- `world-item.position` 是物件中心，使用半宽 `0.20`、半高 `0.20` 的 AABB；`creature` 与 `npc` 的 position 保持现有导航含义，即脚底中心，使用半宽 `0.32`、高度 `1.8` 的 AABB。
- 可物理化的非玩家实体保存 `physicsVelocity: [x, y, z]`。旧存档缺失该字段时按 `[0, 0, 0]` 恢复；新字段必须是三个有限数值。
- 固定步长为 `1 / 60` 秒。单次 `advance` 至多处理 `600` 个物理步（10 秒）；超出部分仍按分段推进而不合并成不稳定的大步。重力为 `18 m/s²`，竖直速度下限为 `-24 m/s`。

## 碰撞与下落

- 每一固定步先积分竖直速度，再用沿 y 的 AABB 扫掠检查 `isSolid` 体素。落到固体顶面时把物件中心/实体脚底钳到接触面，并把 y 速度置零。
- 水和空气不作为碰撞体；横向导航仍由 `AutonomyRuntime` 管理。物理在自治步之后运行，因此导航给出的横向位置会先得到体素落地校正，不会在悬空处永久保持高度。
- 位置和速度均拒绝非有限数值；每步结果按 6 位小数归一化，保证分段调用和一次调用给出相同权威状态。

## 吸附与拾取

- 活着玩家距物件 `2.25m` 内，且从物件中心到玩家拾取中心的有界体素射线采样没有中间实心体素阻挡时，物件按每秒最多 `6m` 向玩家移动。
- 距离不超过 `0.75m` 时才尝试一次原子入账。背包已满、玩家死亡或射线被墙阻断时不移除实体，也不产生拾取事件。
- 物件在同一步只可被一个玩家处理（按玩家 id 排序），成功后立即脱离实体存储，因此不会重复入账。

## 测试和证据

- `tests/server/dropped-item-physics.test.ts` 在实现前覆盖重力/落地、支撑移除、墙体阻断、满背包、死亡、固定步长、存档恢复和非玩家下落，初始预期为 RED。
- `changes/2026-09-05-mvp-experience-repair/e2e/item-physics.spec.ts` 需要由主 agent 在其已有 Harness 接线中公开只读生产快照后执行：在浏览器内构造物件和支撑变化，断言服务端位置改变、落地与拾取。此子任务不修改 `Game.ts` 或 Harness。

## 当前状态与证据

- RED：`CI=true corepack pnpm exec vitest run tests/server/dropped-item-physics.test.ts` 在实现前失败三项：静态位置未下落、无自动吸附、快照无速度字段。
- GREEN：同一命令在实现后通过 `4/4`。覆盖重力落地、支撑撤除后的再次下落、清晰路径吸附一次、墙体/满背包/死亡保留、分段定步长一致性、速度快照恢复和悬空 creature 落地。
- `git diff --check` 通过。当前未运行完整静态检查、生产构建或浏览器 E2E，依本子任务范围由主 agent 集成后统一执行。
- Playwright-change：`SEEDLANDS_E2E_PORT=4261 CI=true corepack pnpm exec playwright test changes/2026-09-05-mvp-experience-repair/e2e/item-physics.spec.ts --retries=0` 通过 `1/1`。它经既有受控命令生成物件/编辑支撑，查询权威实体位置验证下落、落地、移除支撑后的继续下落，以及吸附后实体消失和背包仅有一份物品。
- 现有 `tests/server/gameplay-command-persistence.test.ts` 的保存/恢复 fixture 原先把物件放在玩家 1m 内，与本 change 的自动吸附合同冲突；为保持该用例只验证持久化，物件位置改为距玩家 3m，原有保存/恢复断言不变。
- `tests/server/inventory-interaction.test.ts` 原先把同位静止玩家在 `0.1s` 内未拾取视为前置条件；该假设已由 R1 替换为近距站立自动吸附，仍断言成功事件只产生一次、物品仅入账一次。
