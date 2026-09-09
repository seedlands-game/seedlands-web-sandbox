# S3 单一逻辑时钟证据

## 范围

本切片只修改 lifecycle 合同、注册规范化、`ModuleLifecycle`、对应单元测试与本设计/证据。没有接入 `GameplayRuntime`、`AutonomyRuntime`、Pack、operation 合同、composition identity 或宿主状态；这些由 root 在同一单一时钟上接线。

## RED

设计先写入 `s3-clock-design.md`，随后把 lifecycle 用例改为新合同。在生产实现改动前执行：

```text
corepack pnpm exec vitest run tests/server/composition/module-lifecycle.test.ts
Test Files  1 failed (1)
Tests       6 failed (6)
```

首个决定性失败发生在 every-advance 注册阶段：

```text
System interval must be at least one millisecond: test:every
```

该失败证明旧实现尚无 every-advance cadence，因而 fresh/resume、数值和恢复断言均无法误绿。

## GREEN

完成实现和两处静态修正后执行：

```text
corepack pnpm exec vitest run tests/server/composition/module-lifecycle.test.ts
Test Files  1 passed (1)
Tests       6 passed (6)
```

用例覆盖：

- fresh 激活的 start、重复 dispose 的单次 stop；
- resume 不调用 start，恢复后按同一 schedule 推进并在 dispose 时 stop 一次；
- 0.4 + 0.6 的 every-advance 实际 elapsed 和 interval 边界/顺序；
- 零推进无 tick，every-advance snapshot remainder 恒为零；
- 未知字段、稀疏数组、重复/未知/错序 id、非法 remainder 和非规范数值的恢复原子拒绝；
- 非法 advance、精度/范围溢出、单次 256 operation 上限和拒绝后 schedule 不变；
- operation 中 advance/snapshot/time/dispose 重入拒绝、依赖环拒绝；
- `start()` 与运行中 `restore()` 的现有调用兼容，以及非法 cadence 定义拒绝。

静态验证：

```text
corepack pnpm exec eslint packages/game-core/src/server/composition/lifecycle-contracts.ts packages/game-core/src/server/composition/lifecycle-registration.ts packages/game-core/src/server/composition/module-lifecycle.ts tests/server/composition/module-lifecycle.test.ts
# exit 0

corepack pnpm --filter @seedlands/game-core typecheck
$ tsc -p tsconfig.json --noEmit
# exit 0
```

`git diff --check` 对归属路径通过。按切片合同未运行完整 `verify:static`、build、浏览器验收或性能采样。

## Root 接线要求

- 新世界只调用 `activateFresh()`；checkpoint 恢复只调用 `resume(snapshot)`，不能先 start 再 restore。
- `GameplayRuntime` 是唯一 `advance(actualPositiveSeconds)` 调用者；删除 needs/combat 等平行隐式推进。
- 同一 checkpoint frontier 校验 `lifecycle.time === gameplayTime`，并保存 `lifecycle.snapshot()`。
- composition identity 保存规范 cadence；interval 保存规范 intervalSeconds，every-advance 不制造 interval。
- gameplay 状态修改前调用 `validate(saved.moduleSchedule)` 做无副作用预检，全部恢复步骤成功后再调用 `resume` 安装同一快照。
- invoke 第三参数中，system tick 传 `definition.id`，start/stop 传 `${moduleId}/lifecycle`；调用者可继续使用忽略第三参数的两参数 callback，不能为 system 虚构 actor。
- root 接线后的静态、build 和真实宿主恢复验收不属于本切片证据，需由 root 补齐。

## Hardening RED / GREEN

在原实现与 root 的 systemId 接线之上先增加 getter、规范 delta、callback ID 和 `validate` 用例，执行得到决定性 RED：

```text
corepack pnpm exec vitest run tests/server/composition/module-lifecycle.test.ts
Test Files  1 failed (1)
Tests       2 failed | 6 passed (8)
```

两个失败分别为 `lifecycle.validate is not a function`，以及 every-advance 收到原始 `0.3333333333333333`、权威时钟实际推进为 `0.333333333`。随后改为 descriptor-only 快照读取、暴露无副作用 `validate()`，并将 every-advance delta 从同一个整数纳秒时钟转换；定向测试 GREEN：

```text
corepack pnpm exec vitest run tests/server/composition/module-lifecycle.test.ts
Test Files  1 passed (1)
Tests       8 passed (8)
```

新增断言确认顶层 snapshot、systems 数组索引和 entry accessor 均被拒绝且 getter 调用总数为零；start/stop callback 收到 `test:module/lifecycle`，every/interval callback 分别收到准确 system ID。
