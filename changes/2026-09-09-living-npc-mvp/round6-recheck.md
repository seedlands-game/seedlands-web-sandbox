# Round 6 容量预检独立复核

冻结范围：1044a508fa1d6da24604249744c407772f00413d..8590f98f1c66aa01f7e65a779096c71d8f27b0fe。合同 round6-recheck.json SHA-256 523f11ca0615f022f9b719dbc1818774de2c0170075d23d08412226fa5edbc30 已核对。只读审阅，未运行测试、Browser、provider 或门禁。

## 结论

GitHub5153861695 的主要 P1 已修复：ActionRuntime、Autonomy 与不同目标的 Character intent 都在写入前预检。另发现一个同目标/无活动动作分支仍会绕过 Character 预检，见下方 P1。

### P1：同目标但无活动动作时，耗尽意图仍部分写入

**位置：** packages/game-core/src/server/simulation/character-runtime.ts:276-303

**触发：** 角色 active follow 已抵达并在 CharacterGoalRuntime.advanceFollow() 清除 actionId，角色目标和 executionTargetId 仍保持 active。Action sequence 耗尽后目标离开跟随距离，客户端提交相同 follow 目标。当前 retainsAction 只检查 goal/status/executionTargetId，未检查 actionId 是否存在且为 pending/running，因此跳过 280 行容量检查；随后仍递增 revision、替换 currentGoal requestId、追加 requestId，若带 say 还写 speech/event。下一 tick 才在 startMovement():142 失败为 action-sequence-exhausted。

**影响：** 一个无法创建所需动作的非 idle intent 没有原子拒绝，违反本轮“容量错误不得改变 revision/目标/requestId/事件”的上层合同；观察者会先看到被接受的意图状态，再看到 tick 的失败。

**最小修复：** 对每个非 idle intent 无条件预检 capacity；补 exhausted + same-follow + cleared actionId 的 snapshot 不变断言。Root 已确认采用该范围。

## 已确认路径

- ActionRuntime.validateStart() 校验输入和 capacity；AutonomyRuntime.startAction() 在 interruptAction() 前调用它，避免原问题的动作中断。
- 不同目标/不保留动作时，Character 在目标解析和语义验证之后、interrupt/revision/goal/requestIds/events 之前执行 capacity 检查。
- 内部 startMovement() 在计划和启动前检查 capacity；此路径把已存在的世界目标转为具名 failed goal，并继续 tick，符合本轮要求。
- Authority gameplay 的 move/eat 回调均在动作启动前还未改行为或消耗物品；combat 的 create-action 回调在 CombatRuntime 建立 active state 前执行。它们不会留下已写的上层状态。
- 新 focused 用例覆盖 Autonomy 与不同目标 Character 请求的完整 snapshot 不变，以及内部 tick 的 failed goal/继续推进；它没有覆盖上述 same-goal/no-action 分支。

## 覆盖与验证

10 个冻结变更文件已覆盖：五个生产 runtime/types 文件、一项 focused test、spec/delivery 与两份证据。实现记录称 12 focused tests GREEN，Root 正在执行 static/build；本复核未执行。只读 git diff --check 仅提示 evidence/round6-green.log EOF 新空行，和运行时语义无关。

## 风险

在该 P1 修复及窄复核前，不能宣称 Character 非 idle intent 在容量耗尽时完全原子。未独立运行门禁是额外证据缺口。

## 实际成本

约 0.14 agent 小时；未派发、未写仓库、未调用外部服务。
