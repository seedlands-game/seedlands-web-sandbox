# V2 Route Driver 拒绝恢复合同

阶段：`V2-ROUTE-DRIVER-REJECT-RECOVERY-CLOSE-13`

状态：合同冻结，等待可信 RED、fixture 实现与 deterministic/static 准出。输入为 Browser-22 的唯一
canonical attempt0；该运行保持正式 FAIL，不能由本阶段静态证据改写为产品 GREEN。

## 行为

1. `followEquipmentRoute` 只识别当前 waypoint 的精确错误文本
   `Real input route timed out before ${target.join(',')}.`。其他 Error、其他 target、非 Error rejection 均保持
   原对象和原行为，不包装。
2. 精确错误发生时，outer route deadline 已耗尽则立即重抛原错误；尚有剩余时只调用一次
   `driver.observe()`，await 返回后再次检查同一 deadline。不得重置 45 秒预算。
3. refresh 为 null、deadline 越界，或现有 `classifyEquipmentRouteWait` 对 pre-walk baseline、同一 active
   direction 与同一 target 返回 null 时，必须重抛原 `driver.walk` 错误。stale tick、ack 回退、ungrounded、
   colliding 和 client-reached/server-late 均不能借 refresh 冒充成功。
4. classifier 返回 `arrival` 时原样返回该 fresh snapshot；返回 `drift` 时只把该 snapshot 设为下一轮
   baseline，并按原循环继续同一 waypoint。arrival/null/error 分支不得发第二次 walk；drift 只允许原循环在
   剩余共享预算内发下一次正常 walk。
5. 本恢复不是 exception fallback route，也不改变 `walkTo`、typed aim handoff、wait owner 或生产行为。

## 不变量与失败边界

- 保持 route `45_000ms`、wait `20_000ms`、pulse `80ms`、`jump=false`、`.06/.08/+-0.45`、mouse
  `18 moves/19 observations`、step `80`、sensitivity `0.13`、现有坐标和 pickup itemCount 断言。
- 不改 `harness.ts`、`target-aim.ts`、`equipment-journey-support.ts`、route progress、scenario、production 或
  Browser-22 冻结证据。
- refresh 只读 Authority snapshot；不添加 admin、teleport、第二 helper、第二补偿 walk、随机路线或扩大 timeout。
- Browser-22 的 C0-C3、完整 V1、resources placement 和三格 wood 独立入包为该次运行已达到项；stone、iron、
  36 ingot、五甲、pointer、C4/C5 与保存恢复在该次运行仍 `NOT_REACHED`。

## RED / GREEN

- 主 RED 让真实 `followEquipmentRoute` 的 `driver.walk` 抛出当前 target 精确 timeout；fresh ready strict
  observation 必须以同一对象返回，observe 总计 baseline+refresh 两次且 walk 只有一次。
- fresh ready drift 必须成为下一轮 baseline，并使同 waypoint、按新 baseline 推导的原方向继续正常 walk；
  不得新建 fallback 路线。
- null、stale、ungrounded、colliding、client-only/server-late、observe-after-await deadline 与
  walk-return deadline 必须重抛同一个原 Error；非目标 timeout、普通 Error 和非 Error rejection 不触发 refresh。
- 现有 overshoot、server wait、shared deadline、finite neighborhood、arrival drift 和路径安全回归不得削弱。

## Ownership、闭包与预算

运行逻辑只改 `apps/web/tests/e2e/classic-support/equipment-resource-route.ts`；主要 RED/GREEN 只改同目录
`equipment-resource-route.test.ts`，确有必要时只增强 `equipment-arrival-drift.test.ts` 断言。文档只改当前 spec、
本合同、`route-driver-reject-evidence.md` 与 Close-13 evidence。其余 fixture、生产、历史 raw、tasks/state 只读。

最小 GREEN 后运行新测试与 resource/arrival-drift/arrival-during-aim/pickup-refresh/grounded-route/route-progress/
scenario 的受影响闭包，实际文件和测试数如实记录；另跑 Classic/root test types、变更 TS ESLint、精确 Prettier
和 scoped diff。全部使用默认 benchmark machine lock，Vitest `maxWorkers=1`，不嵌套。

预算：AI 活跃 1-2h、硬上限 3h，传统 0.25-0.5 PD；保守 120% 容量为 AI 2.4h、传统 0.6 PD。
credits、费率、API 等价费用、额度与占比 unknown。
