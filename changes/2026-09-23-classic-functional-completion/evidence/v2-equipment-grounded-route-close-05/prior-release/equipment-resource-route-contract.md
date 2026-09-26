# V2 装备资源安全走廊合同

阶段：`V2-EQUIPMENT-RESOURCE-ROUTE-CLOSE-01 / V2-EQUIPMENT-RESOURCE-ROUTE-CLOSE-02 / V2-EQUIPMENT-RESOURCE-ROUTE-CLOSE-03 / V2-EQUIPMENT-GROUNDED-ROUTE-CLOSE-04`

状态：Close-04 fixture、确定性与静态验证完成；Browser-16 保持 FAIL，Browser-17 未授权。

## Close-04 平地路线输入

- Browser-16 完整失败 leg 不是停滞：server x 从 `98.4630739258` 连续降到 `85.8325211929`，53/53 个
  `KeyS+Space` pulse 的匹配落地 snapshot 都有负向位移，总进展 `12.6305527329m`。旧 256-sample 尾窗只显示
  `1.35m`，本节 supersede 该旧诊断，不改 Browser-16 FAIL 与原始证据。
- 每个约 85ms 的按键 pulse 因 `jump=true` 后必须等待 grounded，pulse 起点实际相隔约 `751..901ms`；初始视角校正
  约 2.45s，固定最长 leg 为 `19.9630739258m`，因此原 45 秒预算不足。不得以 ack 增长解释为停滞或输入丢失。
- `walkEquipmentRoute` 只把传给既有 `walkTo` 的 `jump` 固定为 `false`。方向、坐标、`.06/.08/.45`、80ms pulse、
  20s poll、共享 45s deadline、arrival predicate 与通用 `walkTo` 均不变；不增加第二路线或 fallback。
- scenario floor 是 x=`[-4,225]`、z=`[-3,4]`、顶面 y=`31` 的连续平面。player half-width=`0.32`；V1 jukebox
  approach 到 V2、workbench 放置/打开/回收、10 格资源放置、三批 corridor、清空格 pickup/retreat 的全部固定 leg
  都必须在完整 `±0.45/<0.08` 到达包络下保持 floor 支撑，并按当时未清 voxel 集验证 AABB 净空。
- 确定性 A/B 使用生产 `PlayerInputStream -> InputCommandBuffer -> stepBody` 链和真实 player body config；它只证明
  平地输入/物理与 fixture 几何合同，不是浏览器性能样本，也不保证 Browser-17 通过。

## Close-03 真实 driver 语义

- `walkTo` 的 while 条件只读取 client player 与 `reachedRouteTarget`。client 已位于 target 时，不论传入 `KeyW`
  或 `KeyS` 都会零输入返回；server projection 不是移动控制 owner，不能用于选择按键。
- 每个微段方向只由最新 client position 决定。client 在有限邻域外，或在邻域内但尚未满足当前方向 crossing 时，
  wrapper 才继续调用真实 `walkTo`；client overshoot 仍按 client 位置反向纠正。
- client 已在 `±0.45m/<0.08m` 邻域且完成 crossing，而仅 server 位于邻域外时，wrapper 只调用既有
  `waitForSnapshot`。等待仍要求最终同一 snapshot 满足双方有限域、双方方向 crossing、fresh tick、ack 不倒退及 client
  grounded/non-colliding；server 未追平不能成功。
- server-only wait 使用 `min(20s, remaining)` 且计入原 45 秒总 deadline。wait 返回不匹配或在 deadline 耗尽后返回
  均稳定失败；不重置预算、不 fallback、不把 server 投影伪装成可直接驱动的位置。
- Close-02 的有限邻域、完整包络几何、路线、资源、坐标和通用 helper 边界保持；CLOSE-02 历史测试只代表当时 stub
  覆盖，其“server-only 再 walk”预期由本节 supersede。

## Close-02 有限域收口

- Close-01 的 `matchesEquipmentRouteArrival` 仍只调用 `reachedRouteTarget`。该函数对 `KeyW` 允许任意
  `x>=target`、对 `KeyS` 允许任意 `x<=target`，因此即使 z 在 corridor 内，也会错误接受远越过 waypoint 的 client
  或 server projection。
- client 与 server 必须各自位于 waypoint x 的 `±0.45m` 有限邻域，z 继续严格位于 `<0.08m` corridor。
  `0.45m` 对齐既有 `mineVoxel` approach tolerance；在 player 最大速度 4.5m/s 与 80ms pulse 下单脉冲位移不超过
  `0.36m`，同时距下一 resource 的 player-expanded AABB 尚有 `2-0.45-0.32-0.5=0.73m` 净空。
- 若 `walkTo` 返回有限域外，wrapper 必须对同一个 waypoint 依据新 snapshot 重算方向并再次发真实键盘输入，不能
  静止等待位置自行改变。所有纠正 leg 共用原 45 秒 deadline；readiness poll 取 `min(20s, remaining)`，不得重置
  总预算或引入第二路线/random fallback；`walk` 或 poll 在 deadline 后才返回的匹配 snapshot 也必须拒绝。
- 几何证明覆盖有限邻域的整个保守包络，不只枚举理想端点；client/server 各自远越界、正反向、Browser-15 斜线、
  三批 10-resource、pickup 退回与 workbench 往返均为独立反例/正例。
- Close-01 的 SOURCE/MANIFEST/delivery/合同/证据原字节复制至
  `evidence/v2-equipment-resource-route-close-02/prior-release/` 并经 `cmp` 验证；旧 raw/manifests 不改写。

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
