# V2 装备资源安全走廊合同

阶段：`V2-EQUIPMENT-RESOURCE-ROUTE-CLOSE-01`

状态：fixture、确定性与静态验证完成；Browser-15 保持 FAIL，Browser-16 未授权。

## Browser-15 RED

- 唯一窗口 `129ac7e8-effb-44a0-a011-3a8f56076510` 已完成完整 V1 test step 和 V2 的
  `resources-placed` evidence。首个 wood target `[80,31,2]` 尚未执行采矿。
- resource strip 放置结束时玩家位于东端 approach。`mineResources` 对西端首个 wood approach 仍使用默认 `KeyW`；
  对当前 `reachedRouteTarget`，只要 x 位于 target 东侧且 z 已在 corridor 内就会被视为已越过，故会在远处提前返回。
- `mineVoxel` 随后从超距位置推导 `[77.2,2.5]` 并选择 `KeyS`。该直线经过尚未采集的资源带；trace 中 player x
  从约 `83.60` 到 `81.32` 后不再减少、z 继续漂移，最终耗尽 15 秒 helper route budget。没有 voxel aim、
  left mouse down 或 Authority mining action。

## 可验证行为

1. V2 专用路线只复用现有 `walkTo` 与真实键鼠。每个 leg 在调用前从当前只读 snapshot 比较 x：当前 x 小于等于
   waypoint x 使用 `KeyW`，当前 x 大于 waypoint x 使用 `KeyS`；不得随机 fallback。
2. 固定 corridor 是所有 resource 声明 approach 共有的 z=`-0.5`。workbench corridor waypoint 为
   `[workbench.approach.x,-0.5]`。从 workbench 进入资源带和从资源带返回 workbench 均先走这些固定 waypoint。
3. 每个 batch 的 resource 顺序保持 scenario 声明顺序。每个 resource 先沿外侧 corridor 到其声明 approach；采矿
   与 pickup 后，必须沿已清空的该格回到相同 approach，才可横移到下一资源或 workbench。不得斜穿未采资源。
4. 每个 leg 统一使用 `tolerance=0.06`、`corridorTolerance=0.08`、`pulseMs=80` 和现有默认 45 秒 timeout。
   `walkTo` 前 snapshot 是 freshness baseline；返回值或既有 `waitForSnapshot` 返回的同一 snapshot 必须满足 client
   grounded/non-colliding、physics tick 严格前进、ack 不倒退，且 client player 与同轮 serverPlayerPosition 都满足
   `reachedRouteTarget`。
5. 调用原 `mineVoxel` 前，同一 matched snapshot 的 client/server 到 target center 距离都必须位于现有
   `2.5..4.5` 范围。不得删除 `mineVoxel` 自身补位防护；安全路线应使其不触发。原 voxel Air、drop/pickup 与
   inventory 增量验证保持。
6. 纯测试使用真实 10-resource layout 与 player half-width `0.32`：Browser-15 的旧斜线会撞未采资源；corridor、
   当前 approach 到清空后 pickup、pickup 退回 approach，以及 workbench 往返均不与剩余资源或 workbench 相交。
   覆盖三个 batch 起点、10 个资源顺序、东西双向及到达域边缘的双投影 mining distance。

## 范围、预算与停止线

- 只修改 `equipment-journey-support.ts`，新增同职责 `equipment-resource-route.ts/.test.ts`，必要时只更新
  `scenario.test.ts` 的 source-policy；`equipment-journey.ts` 仅在真实必要时接线。
- `harness.ts`、`route-progress.ts`、aim/target-aim、mouse、V1、scenario JSON 和 production 全部只读。资源数量、
  target/support、workbench 坐标、720 秒 canonical、45/15/8/20 秒与 180 aim 预算均不变。
- 本阶段预计 AI 活跃 2-4 小时，上限 6 小时；传统工作量约 0.5-1 PD。credits、API 等价费用、费率、额度分母
  与占比 unknown。
- 不改变长期 owner、公开协议或架构，长期 docs baseline 不更新。确定性/static GREEN 仅证明 fixture 路线合同，
  不证明动态 Browser 可达；Browser-16 必须由 root 另行授权。
