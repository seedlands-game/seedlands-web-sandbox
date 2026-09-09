# H1/H2 前序 Harness CI Low 失败独立分诊

## 结论

CI run `34324832874` 在固定源码
`a60966420dff8edaa97a3776cd00a2ccba0d1e86` 的失败，主要是
`browser-world-parity.spec.ts` 仍使用 Playwright 默认的 **30 秒整个 test
预算**。它在 Browser parity 和随后的 Headless round-trip 都成功执行后，已在
进入实际移动步骤之前耗尽预算。

这不是已证实的 `world.clock({ kind: 'run' })` 请求死锁：唯一可用 trace 在该
调用开始前被整项 test 超时截断；三个失败的错误上下文均显示世界状态为“运行”，
且 physics tick 已推进。Canvas 的 `boundingBox` / `click` 在低帧率下可能仍有
稳定性成本，但本次 artifact 不能测得其独立耗时，因为全局 deadline 已先到达。

分类：**集成测试预算/fixture 编排问题，高置信度**；不是生产实现故障，也没有
足够证据将其归为 canvas 不稳定或 clock 死锁。

## 固定输入与来源

| 项目         | 证据                                                                                                                                                                                                  |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 合同         | `changes/2026-09-09-living-npc-mvp/contracts/predecessor-triage-low.json`，SHA-256 `1fb7588dd81b48c3220f896db5606b883f3c2a97f4d9c51c3bad75225c734459`                                                 |
| 审阅源码     | `/tmp/seedlands-harness-main-sync`，clean，HEAD `a60966420dff8edaa97a3776cd00a2ccba0d1e86`                                                                                                            |
| CI           | GitHub Actions run `34324832874`，结果 `exitCode: 1`，源 SHA 同上                                                                                                                                     |
| 日志         | `/tmp/seedlands-living-npc/harness-low-ci-failure.log`、`harness-low-ci-result.json`                                                                                                                  |
| artifact     | `developer-harness-34324832874` 下载到 `/private/tmp/living-npc-harness-low-artifact`；retry 1 Playwright trace `.../browser-world-parity-chromium-retry1/trace.zip`                                  |
| 被读测试文件 | `changes/2026-09-09-developer-world-harness/e2e/browser-world-parity.spec.ts`（该树 blob SHA-256 `b87af2b7c051c74beb7a5213de2fb2b319fc7d77286bab17d4091016825ff9ed`），`tests/e2e/support/harness.ts` |

`a609664` 仅为该 parity fixture 在第 42 行预设
`seedlands.quality.v1 = 'low'`，并在第 44 行断言实际 quality；没有为该 test
设置专用 timeout。

## retry 1 的精确时间线

Trace context 的 `monotonicTime=36961.885ms` 对应 CI retry 1 开始
`2026-09-09T07:42:31.876Z`。下表均相对此 context 起点，且来自 trace action
开始/结束记录。

| 阶段                                                              |               起止（ms） |           耗时 | 结果                                             |
| ----------------------------------------------------------------- | -----------------------: | -------------: | ------------------------------------------------ |
| 浏览器 init script 开始                                           |                 3251.315 |              — | 成功                                             |
| `goto`                                                            |        3257.091–4948.385 |       1691.294 | 成功                                             |
| 输入 seed、进入并关闭 warning                                     |        4962.703–5211.806 |        249.103 | 成功                                             |
| 等待 loading card 消失                                            |        5217.579–6783.810 |       1566.231 | 成功                                             |
| 等待 debug 与首次 snapshot                                        |        6862.254–7602.136 |        739.882 | 成功                                             |
| Low quality 的 snapshot 断言结束                                  |        7637.902–7785.400 |        147.498 | 成功                                             |
| 主 Browser parity `page.evaluate`                                 |       7872.136–14740.691 |       6868.555 | 成功，返回完整 parity 结果                       |
| 随后 Headless restore / logic / advance / inspect / action 及断言 | 14740.691–至少 30993.055 | 至少 16252.364 | 无浏览器 trace action；源码位于测试第 176–204 行 |
| `beforeMovement = await snapshot(page)`                           |       **开始 30993.055** |     无结束记录 | trace 因 test timeout 截断                       |

默认 30,000 ms 的 deadline 到达点约为 30,000 ms。也就是说，在第 206 行的
`beforeMovement` 刚开始时，测试已经比该名义预算晚约 993 ms；其后第 208–211
行的 `world.clock(run)`、第 321–328 行 `lockPointer`、`boundingBox`、`click`
在 retry 1 trace 中均没有 action 起止记录，因而没有可测的剩余预算或独立耗时。

CI 日志中 retry 1 的 `boundingBox`，以及原始尝试和 retry 2 的 `click` 栈，表示
超时取消时执行停在 `lockPointer` 的 await，而不是该动作已持续 30 秒的证据。三个
错误上下文同时显示：canvas 已存在并可见（`921 × 518`）、quality 为
`low/benchmark`、世界状态为“运行”，physics tick 分别为 50、11、58。这证明
clock run 已在这些尝试中完成并有推进，排除了“clock 请求尚未返回”作为本失败的
主要解释。

诊断 spec 随后三次 parity 尝试后运行并通过；CI 汇总为 `1 failed, 1 passed`。本地
Low fixture 的一次无重试通过（15.5 s）是有用的对照，但不能覆盖 CI 的低性能
执行窗口。

## 有界、最小修复建议

仅修改测试，不修改 Harness/Authority/World 生产代码。

1. 在 `changes/2026-09-09-developer-world-harness/e2e/browser-world-parity.spec.ts`
   的该完整 Browser + Headless parity test 中设置 `test.setTimeout(90_000)`。
   该 test 包含两个世界恢复/推进路径、浏览器真实 PointerLock 与移动验证；仓库中
   更重的 browser macro 测试已有 90 s 专用预算，runtime diagnostics 为 120 s。
   90 s 给 CI 上的低质量渲染和 Headless round-trip 留出工作量匹配的总预算，不能
   用作放宽单个挂起操作的替代品。

2. 保留并补齐局部失败界限，避免 90 s 掩盖真正的 interaction/clock 回归：
   - 在该 parity test 的第 208 行 clock run 周围加一个只针对这一个 Promise 的
     5 s deadline（例如一个会在 `finally` 清除 timer 的 `Promise.race` 小 helper，
     错误消息包含 `clock run` 与实际毫秒数）。当前 `page.evaluate` 无单独 timeout
     参数，不能误以为 `page.setDefaultTimeout` 会为它提供可靠界限。
   - 在 `tests/e2e/support/harness.ts` 的 `lockPointer` 中，对第 324 行
     `canvas.boundingBox` 和第 326 行 `canvas.click` 各显式传入
     `{ timeout: 5_000 }`；已有 pointer-lock `waitForFunction` 已是 5 s。
   - 保留第 215–222 行真实 `KeyW` 位移的 15 s `waitForFunction`，不要因增大
     test timeout 改写该用户可见移动边界。

建议验证一次这个单独的 `browser-world-parity` test（`--retries=0`），并让 artifact
保留 trace。若它在专用 90 s 预算内仍触发任何 5 s 局部界限，才按那个标签进一步
诊断 clock 或 canvas；若只是总耗时接近 90 s，则将重的 Headless parity 拆为独立
test，而不是继续拉高全局 timeout。

## 范围、风险与缺口

- 未运行 CI、本地 browser、全量测试或生产修改；本报告只读取固定 git tree、既有
  CI 日志和已下载 artifact。
- 仅 retry 1 具有 trace；original/retry 2 的精确 action 耗时不可恢复。它们的错误
  上下文足以确认“运行”状态，但不足以量化各自 click 的稳定时间。
- 这份结论不声称 canvas 没有稳定性问题；它只证明 artifact 中的失败首先受整个
  test budget 截断，尚不能将 click/boundingBox 归因为单项慢或 canvas 故障。

## 交付字段

- 变更：无源码变更；写入本 triage 报告。
- 验证：固定 SHA、CI 日志、artifact retry 1 trace 的 per-action 时间线和三次错误
  上下文均已核对。
- 风险：未加局部边界而只增大全局 timeout 会掩盖未来 clock 或 PointerLock 回归；
  三次中两次 click、一次 boundingBox 的停点仍需在有余量的预算下复验。
- 实际成本：本次只读分诊约 35 分钟；未消耗测试、browser、CI 或外部写入预算。
