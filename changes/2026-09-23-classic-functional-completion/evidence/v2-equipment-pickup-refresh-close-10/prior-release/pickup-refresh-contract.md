# V2 首个 Iron Pickup Route 刷新合同

阶段：`V2-EQUIPMENT-PICKUP-REFRESH-CLOSE-09`

状态：IMPLEMENTATION_AUTHORIZED。

## Browser19 RED

Browser19 已完成完整 V1、10 格 resource placement、wood/stone 各三格 mining/drop/pickup、木镐/石镐，并完成首个
iron `[92,31,2]` 的真实 leftdown、voxel `21 -> 0` 与可展示 drop。随后 `mineResources` 对 pickup waypoint
`[92.5,2.5]` 的 `followEquipmentRoute` 失败；首个 iron 的 inventory pickup 未证明。

完整 trace 将 45 秒 outer route 分为三次 `driver.walk`，真实 driver 都是 generic `walkTo`，pulse 为 11/3/3；
三个 outer baseline 的 client x 均大于 92.5，故固定 KeyS，trace 也记录 17 个 KeyS down/up、0 个 KeyW。

最早漏接 snapshot 是 `pw:api@15023`，位于 driver1 第 9 pulse 前的 `correctMouseToRoute.observe`：client/server
分别为 `[92.498108,32.6,2.442101]` / `[92.498111,32.6,2.442101]`，tick/ack `27121/20546`，
grounded/non-colliding；KeyS 下双方 distance 均约 `0.05793 < .06`，finite `.45/.08` 与相对旧 current/outer
baseline 的 freshness 均通过。horizontal correction `dx≈0.294<1` 后 helper 返回 void；`walkTo` 未刷新旧 current
`@15013`，继续发送 pulse 9。driver3 的 `@15548` 再次 strict 到达，correction 跨过共享 deadline 后仍发送 pulse 17。

## 冻结行为

1. `walkTo` options 新增私有可选 `refreshAfterCorrection?: boolean`，默认 false。
2. 仅 `EQUIPMENT_RESOURCE_WALK_OPTIONS` 设置 `refreshAfterCorrection: true`。
3. true 分支在 `await correctMouseToRoute` 后先检查原 deadline；仍在预算才调用已有 `snapshot(page)`，await 返回后
   再检查同一 deadline。null 稳定 fail closed，不使用旧 current 发键。
4. refreshed snapshot 赋给 current；仍在预算且 client 满足原 `reachedRouteTarget` 时返回该同一对象，否则才发送原
   pulse。generic helper 仍只控制 client movement；server late 继续由 outer strict/bounded wait 处理。
5. 省略/false 保持原路径和 snapshot 调用次数；不修改 `correctMouseToRoute`、`target-aim.ts` 或其他 caller。
6. 不改变共享 45 秒、20 秒 poll、80ms、`jump=false`、`.06/.08/±.45`、方向规则、坐标、route、fallback 或
   pickup `itemCount > before` 断言。
7. correction 或 refresh 跨 deadline 均零 keydown；不能把 deadline 后 arrived 当 PASS。

## RED / GREEN

- RED-A：fake Page 实际调用 exported `walkTo`，初始 current=Browser19 `@15013`，correction/refresh=
  `@15023`，true 应直接返回 refreshed 对象，keyboard down/up=0。旧实现忽略 option 并发送 KeyS，行为 RED。
- RED-B：fake Date.now 让 correction 后或 refresh await 后跨 deadline；两者均应抛原 route timeout 且 keyboard=0。
- RED-C：refresh=null 稳定拒绝且 keyboard=0。
- GREEN 正例：refresh 未到达时继续原 pulse；省略/false 保持原 pulse 与原 snapshot read count。
- Outer 正反例：client reached/server late 由既有 bounded wait 取得 strict arrival；stale、unready、one-sided 不得冒充
  strict。

## 边界与预算

- 只改 fixture/harness test code，不改 production、V1、scenario JSON、aim/mouse/mining callback、save schema 或公共 API。
- fixture/static GREEN 不代表 Browser19 改写或 Browser20 GREEN；Browser19 FAIL 与 iron inventory pickup NOT PROVEN 保持。
- AI 预计 1-2 小时，硬上限 3 小时；传统 0.25-0.5 PD。credits、费率、API 等价费用、额度与占比 unknown。
- 长期 docs 不更新：本片只修 canonical fixture 的可选读取边界，不改变架构 owner 或公共协议。
