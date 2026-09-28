# V2 Aim 期间到达交还合同

阶段：`V2-ARRIVAL-DURING-AIM-CLOSE-12`

状态：合同冻结，fixture/deterministic/static GREEN，等待 root 独立准出。输入为 MAP01 SOURCE15
`50c8c21b93c186427a27e47623e151b736bc17528fb4319a8aae2b6e35d991f3`、MANIFEST4
`486c335f220d9bacb1ea4019c81db44f7df36129e32c9b59d86c7410125e73a0`、delivery
`0e32bc91a71db284838265ecb5192fefb72dc7540c2c7a3eeca2537655538fc6`。

## 行为

1. `correctMouseToRoute<T extends RouteAimObservation>` 返回 `RouteAimOutcome<T>`：
   `{kind:'angle-aligned', observation:T}` 或 `{kind:'route-reached', observation:T}`。可选
   `routeReached?: (observation:T) => boolean` 只读观察值。
2. 每个非 null observation 先执行原 finite 校验，再调用 terminal predicate；true 时在 zero-vector、角度计算和 mouse
   move 之前原样返回同一对象。`route-reached` 只表示 caller 的 client route 条件成立，不表示角度、server、freshness、
   readiness 或 outer strict 成立。
3. 未提供 predicate 时，继续执行精确 zero-vector 检查和现有 `horizontalMouseCorrectionToRoute`；只有真实
   `abs(dx)<1` 返回 `angle-aligned`。最多 18 moves/19 observations，null、invalid、zero、no-response、exhaustion
   继续按 Close11 fail closed。
4. `walkTo` 仅在 `refreshAfterCorrection=true` 时传入复用现有 `reachedRouteTarget` 的 predicate，并保留完整
   `ClassicSnapshot` 类型。`route-reached` 在 helper 返回后的原 deadline 检查通过后赋给 current 并直接返回；不得再
   snapshot 覆盖或发 mouse/keyboard。`angle-aligned` 继续 Close10 的 refresh/null/deadline/reached/pulse 顺序。
5. true 路径的 observe wrapper 在 `snapshot(page)` await 返回后检查原 deadline；move wrapper 在
   `moveMouseBy(page,dx,dy)` 前检查原 deadline。省略/false 不使用 wrapper，不新增 `Date.now()`、snapshot 或行为。
6. outer `followEquipmentRoute` 保持唯一 strict owner：双投影、fresh tick、ack 不回退、grounded/non-colliding、最多 20s
   wait 和 drift。共享 45s deadline 不重置。exact zero 在 V2 predicate 已 reached 时先 handoff；默认 pure aim 仍
   `undefined-direction`。

## 不变量

- 不改 route `45s`、wait `20s`、pulse `80ms`、`jump=false`、`.06/.08/±.45`、mouse step `80`、sensitivity
  `0.13`、18/19 aim 上界、坐标或 pickup itemCount 断言。
- 不改 `equipment-resource-route.ts`、`equipment-journey-support.ts`、`v1-slice.ts`、`mouse-input.ts`、
  `route-progress.ts`、scenario JSON 或 production。
- 不加 exception fallback、第二 helper 调用、随机路线、缓存旧 current 或多策略框架。
- 旧 `route-aim-contract.md` 原字节保留；本合同只 supersede 其 `Promise<void>` 返回形状和“无 callback”局部边界，
  Close11 的 18/19 有界 fail-closed 核心继续有效。

## RED / GREEN

- Browser21 主 RED 调用真实 `followEquipmentRoute -> walkTo -> correctMouseToRoute`，用 outer `@6696`、walk
  current `@6753`、terminal `@6755`；目标是同对象交还、0 mouse、0 keyboard。旧实现继续 mouse/exhaustion。
- 用记录的 `@6759` 调用真实 classifier，必须得到 drift；下一 driver 必须仍是同 target/`KeyS`，由 sentinel 终止，
  不伪造成功。
- 未到达且未对齐继续 move；纯角度对齐返回 `angle-aligned`；route 到达返回 `route-reached`。默认 direct helper
  的全 yaw、null、invalid、zero、no-response、最后 observation 与 exhaustion 回归不得削弱。
- true observe/move/terminal-return deadline 边界均零额外输入；省略/false 的 snapshot/Date.now/pulse 兼容用例保留。
- stale、ack 回退、ungrounded、colliding、client/server one-sided 不得冒充 outer strict。

## Ownership、闭包与预算

实现只允许 `target-aim.ts`、`harness.ts`、新 `equipment-arrival-during-aim.test.ts`，以及窄改
`equipment-pickup-route-refresh.test.ts`、`route-aim-contract.test.ts`。文档只改当前 spec、本合同、
`arrival-during-aim-evidence.md` 和 Close12 evidence。其余上列路径与历史 evidence 只读。

affected 闭包为新测试，加 route-aim-contract、pickup-refresh、resource-route、arrival-drift、grounded-route、
route-progress、target-aim、door-collision-oracle、door-exit-face、door-readiness、equipment-mining-aim、scenario，共 13 个
test files；实际 tests 数在 RED 后记录。另跑 Classic/root test types、5 个变更 TS ESLint、精确 source/contract/spec
Prettier 与 scoped diff，全部 machine lock、Vitest `maxWorkers=1`。

最终实际闭包为 13 files / 138 tests PASS。可信 RED 为新测试 1 file / 6 failed / 1 passed；实现后新测试 7/7
PASS。affected 前两轮分别保留为 3 failed / 135 passed 与 1 failed / 137 passed：均为 Close10 true-path 旧测试数据
仍把 correction observation 建模为已到达，和新 typed terminal handoff 的少一次 snapshot 语义冲突；测试改为
angle-aligned 但未到达的样本后，原 refresh deadline/null 合同继续得到真实覆盖。Classic/root test types、5 TS ESLint、
Prettier 和 scoped diff 最终 PASS；ESLint 首轮仅因 `harness.ts` 超过既有 max-lines。Close12 当时为绕过行数门禁在
`walkTo` 新增多处 inline `prettier-ignore` 并压平控制流；这不满足正常格式合同，“未改 `.prettierignore`”不能等同
“未增加格式豁免”。`V2-ARRIVAL-DURING-AIM-CLOSE-12-FORMAT-CLOSURE` 已将 `ClassicSnapshot` 原字段逐字义拆到同目录
`harness-snapshot.ts`，由 `harness.ts` type import 并同名 re-export，随后移除本片全部 inline suppression 并恢复普通
Prettier 格式。该 type-only 拆分不改变 typed handoff、默认路径、Date.now/snapshot 次数或 runtime import。

预算：AI 1-2h、硬上限 3h，传统 0.25-0.5 PD；120% 容量为 AI 2.4h、传统 0.6 PD。credits、费率、API 等价
费用、额度与占比 unknown。Close12 初版未更新长期 docs 的理由只适用于行为；format closure 因新增测试侧 type-only
职责文件而窄更新 `docs/code-map.md`，不改变生产架构或公共协议。
