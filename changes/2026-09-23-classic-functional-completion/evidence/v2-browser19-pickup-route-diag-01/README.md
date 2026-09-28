# Browser19 首个 Iron Pickup Route 诊断

阶段：`V2-BROWSER19-PICKUP-ROUTE-DIAG-01`

结论：最早可证伪缺口不在 `followEquipmentRoute` 的初始 already-arrived 判断，也不在 KeyW/KeyS 选择、容差或
Authority ack。缺口位于通用 `walkTo` 的单次长循环：`correctMouseToRoute` 已观察到满足现有 route 条件的新 snapshot，
但只返回 `void`；`walkTo` 没有把这次 observation 赋给 `current`，也没有在 correction 后、keydown 前重新检查
`reachedRouteTarget` 与 deadline，于是继续从旧 `current` 发出真实按键。

## 输入与边界

- 冻结 Browser19 evidence：SOURCE6
  `315d511e23cc9d7572bac0db3fc3f051af69c93f7f7ec56045d3c26f9ccefe00`、MANIFEST52
  `80fbb2c5b731a3f9659b1c5c46bf3d1fe805ae34f4ba30f53ee44b720dd64268`、delivery
  `35bf1a0c9a0abbf100bb3899052b4910c242f613f77ea32c363e164a11e16968`。
- 原 trace SHA256：`09f89b6ee5e56bddbd7721d0cc9640e5e2dd2fca38b455d550474c1c7b1edcc7`。
- 目标为首个 iron `[92,31,2]` 的 pickup waypoint `[92.5,2.5]`。iron voxel clear 和可展示 drop 已在本次 trace
  通过；inventory pickup 尚未确认。
- 常量保持生产 fixture 原值：`tolerance=.06`、`corridorTolerance=.08`、有限 x `±.45`、80ms、
  `jump=false`、外层 45s、server wait 20s。
- 本阶段不修改 Browser19 raw/manifests/report，不运行测试、build、Browser、Git、Cua、CI、部署或合并。

## 真实调用层级

`mineResources` 依次调用：

1. `followEquipmentRoute([92.5,2.5], driver)` 建立一次 45s deadline。
2. 每轮按外层 baseline 的 client x 选择方向，再把全部剩余预算交给 `driver.walk`。
3. 真实 driver 为 `walkTo(page, target, { key, timeout, tolerance:.06, corridorTolerance:.08, pulseMs:80, jump:false })`。
4. `walkTo` 先保存 `current=snapshot()`。只要该旧 `current` 未 reached，就运行最多 12 次
   `correctMouseToRoute.observe=snapshot`，再发一个 key pulse，最后用 `waitForSnapshot` 只等待
   `ack>sequenceBeforeInput && onGround && !colliding`，把这个 grounded match 赋给 `current`。
5. correction 内部 snapshot 只用于 yaw，既不更新 `walkTo.current`，也不返回给外层 controller。
6. 只有整个 `walkTo` 返回后，`followEquipmentRoute` 才运行 strict arrival 或 `waitForProgress` 分类。

因此“trace 中有 strict snapshot”与“外层拿到了 strict `walked`”不是同一事实。

## Driver 与 Pulse

`pickup-route-pulses.tsv` 保留全部 17 pulse；`pickup-route-timeline.json` 保留每次 correction observation、grounded
match、client/server、view、tick/ack 和逐条件结果。

| driver | 外层 baseline                             | 内层 pulse | 结果                                                            |
| ------ | ----------------------------------------- | ---------: | --------------------------------------------------------------- |
| 1      | `@14843`，z≈`-0.5008`                     |       1-11 | `walkTo` 返回 `@15162`；outer wait 的 `@15167` classified drift |
| 2      | `@15167`，client z≈`2.4518`               |      12-14 | `walkTo` 返回 `@15387`；outer wait 的 `@15390` classified drift |
| 3      | `@15390`，client/server z≈`2.4197/2.5099` |      15-17 | 内层直接抛 `Real input route timed out`，未返回外层             |

三个 driver 的外层 baseline client x 都大于 92.5，因此 `equipmentRouteDirection` 选择 KeyS；真实 trace 也只有
17 个 KeyS down/up，KeyW 为 0。active key 由源码固定参数和按键事件共同重建，不是 snapshot 内的序列化字段。

每个 pulse 的 grounded match 都满足 `ack > segmentStart.ack`、grounded、non-colliding，因而被内层
`waitForSnapshot` 接受。ack 只证明这条 ready 条件，不证明输入轴或 route reached。完整序列显示位置双向越过目标，
不是 Browser16 已否定的停滞。

## 四个静态包络样本

`static-envelope-samples.tsv` 保留逐项计算：

| snapshot | 来源                                             | KeyS reached/finite/fresh/strict | 是否进入 `walkTo.current`                     |
| -------- | ------------------------------------------------ | -------------------------------- | --------------------------------------------- |
| `@15023` | driver1 correction，pulse 9 前                   | true/true/true/**true**          | 否；只被 yaw helper 读取                      |
| `@15167` | driver1 后 outer `waitForProgress` poll          | client reached=false，drift      | 否；返回外层后成为 driver2 baseline           |
| `@15170` | driver2 correction，pulse 12 前                  | reached=false，finite=true       | 否；只被 yaw helper 读取                      |
| `@15548` | driver3 correction，pulse 17 前，持续到 `@15606` | true/true/true/**true**          | 否；只被 yaw helper 读取，随后仍发第 17 pulse |

最早真实到达是 `@15023`：client `[92.498108,32.6,2.442101]`，server
`[92.498111,32.6,2.442101]`，tick/ack `27121/20546`，grounded、non-colliding。相对内层旧 current
`@15013`（tick/ack `27112/20538`）和外层 baseline `@14843`，freshness 均通过；client/server 到目标的
Euclidean 距离约 `0.05793m`，直接满足 `distance<.06`，finite 也通过。它没有被任何 arrival 条件拒绝，而是从未
被传入 arrival predicate。

此时 view yaw `1.91°`，KeyS 的目标 yaw 约 `1.8717°`，horizontal correction `dx≈0.294<1`；
`correctMouseToRoute` 直接 return。随后 `walkTo` 没有刷新 `current`，从旧 `@15013` 发送 pulse 9，grounded
match `@15027` 已 overshoot 到 client z≈`2.7254`。

第二个 strict correction observation `@15548` 为 client/server
`[92.418396,32.6,2.574543]`，tick/ack `27652/21100`，在 driver3 旧 current `@15533` 后同样 fresh 并满足
KeyS reached/finite。该位置在多个 correction observation 中持续至 `@15606`；correction 已跨越共享 45s deadline，
但 `walkTo` 只在 correction 前检查 deadline，仍发送 pulse 17。这是同一 post-correction recheck 缺口的第二表现。

## 候选排除

- **Outer 初始 already-arrived**：否。`@14843` client/server z≈`-0.5008`，距目标约 3m。
- **KeyW/KeyS 选择错误**：否。三个 outer baseline 的 x 均在 target 东侧，KeyS 正确，trace 与之一致。
- **缺少横向 z/yaw 纠正**：不是首个缺口。correction 在 `@15023` 已收敛到 `|dx|<1`，且 strict 已成立。
- **输入/ack 停止**：否。17 pulse、tick/ack 持续前进；不能从 ack 反推 axis，但不存在停滞证据。
- **释放后惯性**：会造成 overshoot，却不是最早漏接原因；pulse 9 前已经有 strict observation。
- **容差太紧**：否。`@15023` 在现有 `.06/.08/±.45` 下通过，无需放宽。
- **outer strict predicate 本身拒绝 `@15023`**：否。它满足全部条件；问题是该 snapshot 未离开内层 helper。

## 单一候选修复

若 root 准出实施，最小候选是给通用 `walkTo` 的 options 增加一个**可选、默认 false/不改变行为**的私有 fixture
seam：`refreshAfterCorrection?: boolean`。`walkTo` 本身已经拥有 `snapshot(page)`，无需新增 callback 或修改
`target-aim.ts`；V2 的 `EQUIPMENT_RESOURCE_WALK_OPTIONS` 单独设为 true：

1. `await correctMouseToRoute(...)` 返回后、任何 keydown 前，先重新检查原 deadline；已超时则不再观察或发键。
2. option 为 true 时调用一次既有 `snapshot(page)`；有值时赋给 `current`，随后再次检查 deadline，防止观察本身
   跨过预算。
3. 仍在预算内且当前 client 已满足既有 `reachedRouteTarget` 时返回该 snapshot；否则才发送原 key pulse。
4. option 省略/false 时，所有原 caller 的行为、snapshot 调用数和默认路径完全不变。

V2 仍由 outer `matchesEquipmentRouteArrival` 验证双投影、freshness、grounded/non-colliding；generic `walkTo` 继续只按
client reached 返回。server 未到时 outer 进入既有 20s wait，client drift 时走既有 drift。该候选不增加 fallback/路线，
不改 45s/20s/80ms、`jump=false`、`.06/.08/±.45`、坐标或 pickup inventory 断言。

只改 outer controller 的初始 short circuit 不足，因为首个 strict snapshot 出现在仍未返回的内层 `walkTo` 中。

## 最小可执行 RED

1. 用最窄 fake `Page` 调用真实 `walkTo`。初始 current 取 Browser19 `@15013`；correction 内部 snapshot 和
   post-correction refresh 均返回 `@15023`，其中 view 使 `|dx|<1`。`refreshAfterCorrection=true` 时，期望返回
   `@15023` 且 keyboard down/up 均为 0。当前签名没有该 option，RED 稳定。
2. 第二用例用 Vitest fake timer 或 `vi.spyOn(Date, 'now')` 让 correction 过程跨过原 deadline，断言 correction 后
   keydown=0 且抛原 route timeout；防止 Browser19 pulse 17 行为，不延长预算。
3. 兼容反例：option 省略/false 时，用同一 fake Page 保持当前默认路径，仍发送一次 KeyS 并返回 grounded match。
4. V2 接线合同只证明 `EQUIPMENT_RESOURCE_WALK_OPTIONS.refreshAfterCorrection=true`；不复制 route、不新增 callback 或
   Harness 写口。
5. 负例保留：post-correction client 未 reached 时发送原 pulse；client reached/server late 时 generic 返回，outer 必须走既有
   bounded wait；outer stale/unready/one-sided strict 仍失败。

## Inventory 证据

首 iron mining 前 `countBefore=0`。`expectPresentedDropOrPickup` 返回 true 是“bag count 增加 **或** 可展示
world item”的析取；route 起点 trace 的 worldItems=1。后续 route 中 worldItems 变为 0，但该字段不能指明哪个 item、
谁拾取或是否进入 bag。canonical `itemCount > before` 断言位于 route 成功之后，未被执行；`restoreEvidence` 只保留
最后一次已记录的 pre-iron `stone-pickaxe` phase snapshot，并不是失败时重新读取的 bag。因此没有已有只读 bag 证据能
证明首 iron inventory pickup，也不能由该旧 snapshot 证明失败时 bag 必然没有 iron。

## 证据限制

- trace 不序列化 `Date.now()`，表中的 remaining budget 用 trace monotonic 相对 outer observe 近似，存在很小的调用开销
  偏差；pulse 17 的 down 已在该近似 deadline 后约 1.19s，且最终错误来自内层 deadline。
- active key 由源码固定参数和真实按键事件重建，不是 snapshot 字段。
- 本阶段没有运行候选 RED；这里只冻结可执行设计，不宣称修复已通过。
