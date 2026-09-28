# V2 Post-Drift Direction 合同

阶段：`V2-EQUIPMENT-POST-DRIFT-DIRECTION-CLOSE-14`

状态：实现前合同冻结。依据 MAP01 SOURCE11
`40190d99bdf880e3d0678e8c6d2efb6477e1754dce57fbd2f509e3e233983c11`、MANIFEST21
`c627fc471c55eee7c7cfc3d367610bb0b3f72bd64e0815d487c57c5cd85a4b4c`、delivery
`ba13b9c41eea62b534524c50a1e4b23603262bf7a25c32617487fa163c1b7579`。

## 被拒绝的 Close-13

Close-13 提议在 `driver.walk` 抛出同目标 route timeout 且 outer deadline 尚有剩余时 observe/classify。真实
`walkEquipmentRoute` 使用 `Date.now`；outer 计算 remaining 后，inner `walkTo` 才用稍后的 `Date.now()+remaining` 建
deadline，因此 inner deadline 不早于 outer deadline。Browser22 在 inner deadline 越界后抛错，回到 outer 时该分支
必不可达。其未批准 source/test/spec/contract 与 raw 已原字节归档到本阶段 `rejected-close13/`；原 raw 目录保留。
不得恢复该 catch，也不得以提前 reject 的 stub 证明真实 driver。

## 行为

1. `followEquipmentRoute` 保持单一 target 与原 45 秒 deadline。默认每轮仍用
   `equipmentRouteDirection(baseline.player,target)`。
2. 只有 `waitForProgress` 返回后，且现有 `classifyEquipmentRouteWait` 对相同 wait baseline、target、active key 重新验证
   为 `drift`，才将 `baseline` 设为该同一 snapshot，并把下一轮一次性 direction hint 设为刚使用 key 的反向。
3. 下一轮开始时优先消费该 hint，并立即清空。该 key 同时传给真实 `driver.walk` 和本轮后续
   `matchesEquipmentRouteArrival` / `classifyEquipmentRouteWait`，避免输入方向与验收方向不一致。
4. hint 轮若返回普通 non-arrival 且未进入 wait，下一轮恢复 x-based direction。若又产生 validated drift，则根据该轮
   实际使用 key 再设置一次反向 hint，可有界交替但不保留陈旧 hint。
5. arrival 立即返回；null/mismatch/error 不设置 hint。`driver.walk` rejection 保持原对象直接传播，不 catch、不 observe、
   不 retry。

## 不变量

- route 45s、wait 20s、pulse 80ms、jump=false、`.06/.08/+-0.45`、18 moves/19 observations、mouse step80、
  sensitivity0.13、坐标与 pickup itemCount 断言全部不变。
- `matchesEquipmentRouteArrival` 与 `classifyEquipmentRouteWait` 本体不放宽；改变 movement crossing key 不扩大 client/server
  双投影 finite neighborhood。
- `harness.ts`、`target-aim.ts`、`mouse-input.ts`、`equipment-journey-support.ts`、`route-progress.ts`、scenario、
  production、Browser22/MAP01、tasks/state 全部只读。
- 不加第二 walk/helper、exception fallback、teleport、Harness 写口或新通用策略框架。

## RED / GREEN

- 主 RED 直接调用真实 `followEquipmentRoute` 和真实 classifier，重放 Browser22
  `@8674 -> @8880 -> @8883(stale/null) -> @8885(drift)`；下一 `driver.walk` 必须同 target 使用 KeyW，并以 sentinel
  结束，不能 stub 出 arrival。旧 x-only 实现唯一失败为收到 KeyS。
- 独立 counterfactual fixture 重放 `@8885 -> @9107 -> @9110 -> @9112`，明确这是旧轨迹输入而非新策略因果实测；
  下一轮同样反向。用真实 `horizontalMouseCorrectionToRoute` 比较 @8885/@9112 两个 key 的校正量，不复制算法。
- 验证 hint 真正一次性消费、连续 validated drift 按刚用 key 反转；arrival 立即返回；stale/ackback/ungrounded/
  colliding/one-sided 不冒充 strict；driver rejection 保留原对象；各 await 后 deadline 越界仍失败，共享 deadline 不重置。
- 保留两方向 finite neighborhood、overshoot、mining-distance、Close12 typed handoff、Close10 refresh/default 等回归。

## Ownership、闭包与预算

运行逻辑只改 `equipment-resource-route.ts`；先撤除已归档的 Close13 catch 与对应 test hunks，再优先新增
`equipment-post-drift-direction.test.ts`。现有 `equipment-resource-route.test.ts` 仅保留基线兼容；如
`equipment-arrival-during-aim.test.ts` 硬编码 drift 后 KeyS，只窄改期望为 KeyW，保留同 snapshot/零输入/sentinel。
文档只改当前 spec、本合同、`post-drift-direction-evidence.md` 与 Close14 evidence。

affected 以既有 13 files / 138 tests 闭包为下界并加入新测试，实际数如实记录；另跑 Classic/root test types、变更 TS
ESLint、精确 Prettier/scoped diff。全部默认 machine lock、Vitest `maxWorkers=1`。

预算：AI 1-2h、硬上限 3h，传统 0.25-0.5 PD；120% 容量 AI 2.4h、传统 0.6 PD。credits、费率、
API 等价费用、额度与占比 unknown。
