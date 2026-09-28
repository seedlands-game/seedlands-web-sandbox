# Browser21 Aim 期间到达合同地图

阶段：`V2-BROWSER21-ARRIVAL-DURING-AIM-MAP-01`

状态：只读诊断完成，等待 root 冻结实施合同。本阶段未修改源码、Browser21 frozen raw/report、spec、tasks 或
execution-state，未运行测试、build、browser、Git、Cua、CI、部署或合并。Browser21 保持正式 FAIL；本报告不把 fixture
边界称为 production gameplay 缺陷，也不推断反事实 Browser 成功。

## 冻结输入

- 当前功能分支 baseline：`24dc3a1daca6e629ca273ea07aeae50eb4be868a`。Browser21 实际 BUILD12 source 为
  `908d0d82881e3e8c7dff7ee27cf3a4785013f37a`，tree `eb8a5d9a3cc423378f243e93804a6284f64539e6`。
- Browser21 SOURCE14 `fb23dc4103d57b34f150beb6a48bef0d0f89563a619379293dbf4d2a8d4f2001`、MANIFEST43
  `83cd38aa8ef30c0eee03c725faf5b8ecd591f6e2b823820b0e5db48ab17247a8`、delivery
  `93c572c0a698bc55cf969b226242946073392326722a6233bb2318e027ab9d72`。
- 本阶段复用 frozen `return-route-aim-timeline.json`，未重新扫描完整 trace。该 timeline 的 SHA256 为
  `9f424f6aaac3d499d54415e266e5380812e330bbbb77723a257f6de93a3ed6d3`。
- 目标 `[80.5,-0.5]`，direction `KeyS`；保持 `.06/.08/±.45`、外层 45s、wait 20s、pulse 80ms、
  `jump=false`、mouse step 80 与 sensitivity `0.13`。

## 调用边界

真实调用链为 `mineResources -> followEquipmentRoute -> driver.walk -> walkTo -> correctMouseToRoute`。

`followEquipmentRoute` 先保存 outer baseline，再把剩余总预算传给 `walkTo`。`walkTo` 保存 `current`，只要 client 尚未
满足 `reachedRouteTarget`，就调用 `correctMouseToRoute`。该 helper 的 `observe` 已读取完整 `ClassicSnapshot`，但参数类型
只要求 player/view，返回值是 `void`；所以 observation 既不能更新 `walkTo.current`，也不能交给 outer strict/wait。

Close10 的 `refreshAfterCorrection=true` 只在 helper 正常返回后执行 refresh。Browser21 中 helper 没有达到 angle
`abs(dx)<1`，而是在第 19 次 observation 抛 exhaustion，因此 Close10 refresh 没有执行。不能捕获这个 exhaustion 再
fallback，因为那会把失败当正常控制流，且丢失最早到达 snapshot。

## 真实样本与机械判定

`arrival-condition-timeline.json` 保留所有 19 个 correction observations，`arrival-conditions.tsv` 提供逐行条件。位置、
view、tick/ack、grounded/colliding 和调用时间来自 frozen timeline；distance、reached、finite、fresh、strict 与 classifier
是按当前 `route-progress.ts` / `equipment-resource-route.ts` 机械推算。snapshot 未序列化 active key；`KeyS` 来自 outer
baseline `client.x > target.x` 的 `equipmentRouteDirection` 和真实调用参数。`Date.now()` 未序列化，剩余预算仅按 trace
monotonic time 近似。

| 样本           | 调用角色                         | client reached/finite | server reached/finite | fresh/ready   | outer strict | 结果                                      |
| -------------- | -------------------------------- | --------------------- | --------------------- | ------------- | ------------ | ----------------------------------------- |
| `@6696`        | outer baseline                   | false/false           | false/false           | baseline/true | false        | 起始 z≈2.445                              |
| `@6697`        | `walkTo` 初始 current            | false/false           | false/false           | true/true     | false        | 进入内层循环                              |
| `@6753`        | 第 7 个 KeyS pulse 后的 current  | false/false           | false/false           | true/true     | false        | client 距目标 `0.086464`                  |
| `@6755`        | 下一次 correction 首 observation | **true/true**         | false/false           | true/true     | false        | 最早 client reached，server late          |
| `@6759`        | 旧实现发一次 mouse move 后       | false/false           | true/true             | true/true     | false        | 若以 `@6755` 为 wait baseline，则是 drift |
| `@6763..@6845` | 旧实现后续 correction            | false/false           | false/false           | true/true     | false        | 持续 drift，最终 exhaustion               |

`@6755` client `[80.500381,32.599998,-0.474648]` 距目标 `0.025355m < .06`，满足现有
`reachedRouteTarget` 和有限 neighborhood；server `[80.500644,32.6,-0.263537]` 距目标 `0.236464m`，不满足
`.06/.08`。它相对 outer `@6696` 与 walk current `@6753` 都 tick/ack fresh，且 grounded/non-colliding。没有条件
拒绝 client reached；缺口是 helper 在计算 angle correction 前没有把同一 observation 交还 caller。

若 `@6755` 原样交还 `walkTo`，`walkTo` 应在原 deadline 内返回它。outer 的 strict 双投影仍为 false，但现有
client-reached 分支会调用最多 20s 且受剩余 45s 截断的 `waitForProgress(@6755, KeyS, remaining)`。实际旧路径的
下一 observation `@6759` 是 client z `-0.580203`、server z `-0.474648`：相对 `@6755` fresh/ready，client 已越出
严格 `<.08` corridor，因此既有 `classifyEquipmentRouteWait` 会返回 `drift`；outer 随后以该 snapshot 为 baseline，仍对
同一 waypoint 按 client x 选择 `KeyS` 并再次调用真实 driver。由于修复后不会发送产生 `@6759` 的旧 mouse move，这只
证明现有 wait/drift 分支能处理该形状，不宣称修复后的真实未来轨迹或 Browser 成功。

完整调用序列显示 `@6704/@6711/@6718/@6725/@6732/@6743/@6750` 共 7 个失败 correction 前 KeyS pulse。
Browser21 frozen 累计报告中的“5 个”是过度压缩计数；本阶段遵守历史字节不可修改约束，以这里的 call IDs 为准。

## 单一最小合同

建议显式冻结以下 fixture-only 方案：

```ts
type RouteAimObservation = Readonly<{
  player: Point;
  viewAngles: readonly [number, number];
}>;

type RouteAimOutcome<T extends RouteAimObservation> =
  | Readonly<{ kind: 'angle-aligned'; observation: T }>
  | Readonly<{ kind: 'route-reached'; observation: T }>;

correctMouseToRoute<T extends RouteAimObservation>(options: Readonly<{
  target: RoutePoint;
  direction: RouteDirection;
  observe(): Promise<T | null>;
  move(dx: number, dy: number): Promise<void>;
  routeReached?: (observation: T) => boolean;
}>): Promise<RouteAimOutcome<T>>;
```

1. 每个非 null observation 先做现有 finite 校验，再调用可选只读 `routeReached`；true 时在 mouse move 前返回
   `{kind:'route-reached', observation}`。这是正常 typed outcome，不用异常传递正常控制流。
2. 未提供 predicate 时，继续检查 zero vector、计算现有 `horizontalMouseCorrectionToRoute`，且只有
   `abs(dx)<1` 才返回 `{kind:'angle-aligned', observation}`。closed-door direct caller 不传 predicate，仍执行严格
   18 moves/19 observations、undefined-direction 与 exhaustion 合同。
3. `walkTo` 只在现有 `refreshAfterCorrection === true` 时传 predicate，predicate 仅调用既有
   `reachedRouteTarget(observation.player, target, key, tolerance, corridorTolerance)`。省略/false 的 generic walk 使用原
   observe/move callbacks，不增加 snapshot、`Date.now()` 或分支语义；现有唯一生产旅程配置仍只有
   `EQUIPMENT_RESOURCE_WALK_OPTIONS` 开启 true。
4. true 路径用 wrapper observation 在每次 `snapshot(page)` await 返回后检查原 walk deadline，并用 wrapper move 在
   每次 `moveMouseBy` 前检查原 deadline；超时即抛原 route timeout，确保 observation/move 跨界不会再发新输入。helper
   返回后仍执行原 deadline 检查；`route-reached` 直接把同一 snapshot 赋给 current，`angle-aligned` 才走 Close10 已有
   post-correction refresh。refresh await 后原 deadline 检查保留。默认路径不使用 wrapper，不增加 `Date.now()`。
5. `walkTo` 只凭 client reached 返回；outer 继续唯一拥有双投影、freshness、grounded/colliding、20s wait 与 drift
   分类。outer 的 45s deadline 不重置，driver 接收的仍是剩余预算。
6. 对 V2 predicate，exact zero vector 已是 route reached，须在默认 helper 的 undefined-direction 检查之前 typed return；
   未启用 predicate 的 direct helper 仍对 zero vector fail closed。near-point crossing 也只按现有 directional predicate，
   不新增容差或路线规则。

该方案修改 shared helper 的返回类型和一个窄可选 predicate，因为只有 helper 拥有“发 move 前的同一 observation”；
只在 outer 或 post-correction refresh 修补已经太迟。它不复制 correction 算法、不增加第二 helper/fallback、不改变
18/19 上界、step/sensitivity、route/poll/pulse timeout、容差、坐标或 pickup itemCount 断言，也不泛化成多策略框架。

## 可执行 RED 与闭包

新增 `equipment-arrival-during-aim.test.ts`，先在旧实现上取得行为 RED，而非 missing import/collection RED：

1. fake Page 调用真实 `followEquipmentRoute -> walkTo -> correctMouseToRoute`。outer baseline=`@6696`，walk current
   从 `@6753` 开始，helper 首 observation=`@6755`。期望返回同一对象给 outer、mouse move=0、keydown/up=0；
   outer strict=false 并调用真实 `classifyEquipmentRouteWait`。当前实现会发 mouse move并最终 exhaustion，故 RED。
2. wait 输入用记录的 `@6759`，断言 classifier=`drift`，下一 outer iteration 对同一 target 仍调用 `KeyS` driver；
   第二次 driver 以测试 sentinel 终止，不伪造 arrival 或 Browser 成功。
3. true 路径 angle 未齐且 client 未 reached 时仍执行原 move；angle aligned 时返回 typed `angle-aligned`，再执行
   Close10 refresh。省略/false 保持原 read/move/pulse 次数和 helper exhaustion-before-keydown。
4. true 路径中 observation await 跨 deadline 时零 mouse/keyboard input；move 前发现 deadline 已耗尽时不发该 move；
   terminal handoff 后发现 deadline 已耗尽时零 keyboard input。首个 reached observation 后也必须零 mouse input。outer
   总预算仍是同一个 45s。
5. exact zero vector + V2 predicate 返回 `route-reached`；相同 observation 无 predicate 继续抛 undefined-direction。覆盖
   `.06` 内 near point、跨目标变向、client reached/server late、stale tick、ack regression、ungrounded、colliding、
   one-sided server，并确认它们不冒充 strict arrival。
6. 默认 direct helper 的 W/S、X/Z、wrap ±180、最后 observation、null、invalid、no-response 与 exhaustion 继续由现有
   `route-aim-contract.test.ts` 验证，不增加 move/observation 配额。

建议 affected 闭包为新测试，加现有 `route-aim-contract`、`equipment-pickup-route-refresh`、
`equipment-resource-route`、`equipment-arrival-drift`、`equipment-grounded-route`、`route-progress`、`target-aim`、
`door-collision-oracle`、`door-exit-face`、`door-readiness`、`equipment-mining-aim`、`scenario`，共 13 个 test files；
测试数在 RED 文件落盘后按实际收集记录，不预填。另跑 Classic/root test types、变更 5 个 TS 的 ESLint、精确
source/contract/spec Prettier 与 scoped diff，全部 machine lock、Vitest `maxWorkers=1`。不需 Browser 或 build。

## Ownership 与预算

建议实施 owner 仅：

- `apps/web/tests/e2e/classic-support/target-aim.ts`：typed outcome 与可选只读 `routeReached`。
- `apps/web/tests/e2e/classic-support/harness.ts`：仅 true 路径的 predicate、deadline boundary 和 typed handoff。
- `apps/web/tests/e2e/classic-support/equipment-arrival-during-aim.test.ts`：新增 RED/GREEN。
- `apps/web/tests/e2e/classic-support/equipment-pickup-route-refresh.test.ts`：只调整 true 路径 snapshot 次数/typed handoff
  断言；默认兼容断言保留。
- `apps/web/tests/e2e/classic-support/route-aim-contract.test.ts`：只更新 direct helper 的 typed `angle-aligned` 返回断言，
  并继续冻结无 terminal predicate 的 18/19、zero-vector、null 与 exhaustion 合同。
- 当前 change 的 `spec.md`、新 `arrival-during-aim-contract.md`、evidence/report 与阶段 evidence。

`equipment-resource-route.ts`、`equipment-journey-support.ts`、`v1-slice.ts`、`mouse-input.ts`、`route-progress.ts`、
production、scenario JSON、坐标和其他历史 evidence 默认只读。旧 `route-aim-contract.md` 不原地改；新合同明确只
supersede 其 `Promise<void>` 返回形状与“无 callback”局部边界，18/19 fail-closed 核心继续有效。

实施估时：AI 1-2h、硬上限 3h，传统 0.25-0.5 PD；120% 保守容量为 AI 2.4h、传统 0.6 PD。credits、费率、
API 等价费用、额度和占比 unknown。本只读 MAP 阶段预算不超过 30min。长期 docs 不更新，因为候选仅收紧 canonical
fixture 的内部数据交接，不改变生产架构或公共协议。
