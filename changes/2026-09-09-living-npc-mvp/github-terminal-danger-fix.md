# Living NPC 终态目标危险恢复修复

合同 SHA-256：`55c75cee26d9310e2daa2b49a0cfcf46d2d3332395706420619d0ce8d6c91315`

冻结问题基线：`7c36c43`

## 变更

- 危险计时结束时保留原有语义：若 `suspendedGoal` 存在，恢复该先前 active goal。
- 若受击前 goal 已经 succeeded/failed、因此没有 `suspendedGoal`，不复活终态 goal；清除残留 `actionId`、`executionTargetId`、stall/refresh 状态，创建新的 active `fallback-life` forage goal。
- 两条恢复路径都递增 character revision、只记录一次 `fallback(reason='danger-cleared')`、启动恢复后的 goal 并触发 changed。

## 验证

- Meaningful RED：
  - 正常 Headless move-to 到当前位置并进入 succeeded 后，两次真实 `attackEntity`，checkpoint 恢复且累计危险时间超过 3 秒，角色仍为旧 move-to suspended。
  - 可见 follow 目标正常消失并进入 failed 后，真实 `attackEntity` 且推进 3.1 秒，角色仍为旧 follow suspended。
- GREEN：`./node_modules/.bin/vitest run tests/server/character-danger-recovery.test.ts`，2/2 通过，约 3.08s。
- 既有 active-goal flee 恢复联合回归：新用例加 `character-control-runtime` 的 `interrupts a goal`，2 files、3 tests 通过。
- 成功路径断言新 goal 为 `fallback-life/forage/active`、旧 terminal requestId 未复活，并且重复攻击后 `danger-cleared` fallback 事件恰好一次。
- succeeded 场景在仍 suspended 时导出 checkpoint、恢复到新 Headless session 后继续剩余危险时间并安全进入 fallback，覆盖持久恢复。
- Core tsc、test tsc、两文件 targeted ESLint、`git diff --check` 全部通过。

## 风险

- 本修复只改变没有可恢复 active `suspendedGoal` 的危险结束分支；既有 active forage/follow/move goal 恢复行为由回归覆盖并保持。
- 未运行 Browser、provider、全局格式、full static/build、提交或推送；这些由 Root 汇总。

## 实际成本

- 墙钟约 12 分钟，低于合同 0.5 agent-hour。
- 外部 API/provider 调用 0，未安装依赖或执行 Git 写入。
