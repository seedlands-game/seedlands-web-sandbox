# Round 6 最终窄复核

冻结范围：8590f98f1c66aa01f7e65a779096c71d8f27b0fe..38c97f543fab5baf573799b2808db4a6d4949e67。合同 round6-final-recheck.json SHA-256 7ae6440d459922cd8d84c7e8e980e9679daf2f9e396495b5acf65a68625d38cd 已核对。只读审阅，未运行测试、Browser、provider 或门禁。

## 结论

此前 same-goal/no-action P1 已解决。本窄范围未发现新的可证实 P0/P1/P2。

## 已解决项

CharacterRuntime.applyIntent() 现在在 280-281 行对每个非 idle goal 无条件执行 capacity preflight，不再以 retainsAction 为条件。该检查位于 interruptAction、revision/currentGoal、requestIds、goal-started 和 speech/event 写入之前；请求 ID、speech 和 follow target 的前置验证/解析均为无写入操作。

新增回归先让真实 follow 到达以清空 actionId，再恢复 exhausted sequence、移动 player，并以相同 follow goal 加 speech 重提 intent。请求抛出 sequence error 后完整 runtime snapshot 与请求前相等，因此同时覆盖 revision、requestId、speech、event 和动作状态的原子性。

idle 仍不要求新 action capacity，符合不分配动作的语义。内置 tick 的 startMovement() 仍把已有目标的耗尽转为具名 failed goal，而不抛出中断世界 tick。

## 覆盖与验证

本 delta 的生产文件、focused test、spec、复核记录与两项证据均已检查。Root 报告 13 focused tests GREEN，static/build 正在执行；本复核未执行这些命令。

## 风险

未独立运行门禁是唯一证据缺口；没有剩余可定位逻辑问题。

## 实际成本

约 0.08 agent 小时；未派发、未写仓库、未调用外部服务。
