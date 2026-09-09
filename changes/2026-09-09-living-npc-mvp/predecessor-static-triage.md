# H1/H2 前序静态 CI 超时独立分诊

## 结论

固定源码 `54debdc137108efa8f89fdb1a8081ba94ca953e9` 的 CI run
`34326581294` 只失败于
`tests/server/world-harness-session.test.ts:56` 的 malformed-method-arguments
fixture。该 fixture 实测 **5,174 ms**，而它遗漏了该文件其余 Headless world
fixture 一致采用的专用 timeout，故被 Vitest 默认 **5,000 ms** 取消。

这是测试预算遗漏，高置信度；日志没有验证断言失败、未处理异常或生产行为失败的
证据。建议只在该 `it` 的末尾添加与相邻单 session fixtures 一致的 `20_000` ms
预算，不更改全局 `testTimeout`、Harness 或生产实现。

## 固定输入和 CI 范围

| 项目         | 证据                                                                                                                                                     |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 合同         | `changes/2026-09-09-living-npc-mvp/contracts/predecessor-static-triage.json`，SHA-256 `ce74dabdaeff59b1881a6ab55a20025b5efaf8154edb4ff8e8b9e1f36fbc733d` |
| 源码         | `/tmp/seedlands-harness-main-sync`，clean，HEAD `54debdc137108efa8f89fdb1a8081ba94ca953e9`，tree `3adee36e69c21a1b10b63bbdea944d9bda9c1643`              |
| 被检测试文件 | `tests/server/world-harness-session.test.ts`，该 commit blob SHA-256 `c35569eec14901198c0500addfc3b7266047c3d7394c46b3d5c95265eb9f1387`                  |
| CI           | run `34326581294`，source SHA 相同，`exitCode: 1`                                                                                                        |
| 日志         | `/tmp/seedlands-living-npc/harness-deadline-ci-failure.log`                                                                                              |

同次 GitHub job 结果：

| Job                 | 结果        | 时间（UTC）       |
| ------------------- | ----------- | ----------------- |
| Select CI scope     | success     | 07:58:16–07:58:24 |
| Chromium regression | **success** | 07:58:26–08:04:27 |
| Production build    | success     | 07:58:29–07:59:29 |
| Static verification | **failure** | 07:58:27–08:08:59 |

因此该 run 的 Browser Harness parity/diagnostics 所在 Chromium regression job 已通过；
失败只在 static verification。不得将本次 static 超时描述为 Browser parity 回归。

## 失败位置与可复现证据

冻结源码第 56–71 行：

```ts
it('returns structured validation errors for malformed method arguments without throwing', async () => {
  const session = await HeadlessSession.create({ platform: testCorePlatform, seedText: 'world-harness-invalid' });
  const invalidCalls = [/* inspect/prepare/command/clock/logic/actions/barrier/trace/checkpoint */];
  for (const result of await Promise.all(invalidCalls))
    expect(result).toMatchObject({ ok: false, error: { kind: 'validation' } });
});
```

CI 记录：

- Vitest 结果：`returns structured validation errors ... 5174ms`；唯一失败。
- 失败文本：`Error: Test timed out in 5000ms.`，位置正为
  `tests/server/world-harness-session.test.ts:56:3`。
- 覆盖运行最终汇总：235 test files passed、1 failed；1,166 tests passed、1 failed。
- 同文件相邻、同样创建 `HeadlessSession` 的 fixtures 已显式采用：第 8–54 行 wall
  clock `20_000`，第 73–104 行 malformed Logic `20_000`，第 106–137 行 identity
  `20_000`；更复杂的 checkpoint/barrier/action fixture 为 `30_000`。

该 case 并发调用九个已创建 session 上的入口，且 CI 执行的是
`vitest run --coverage --maxWorkers=1`。在 coverage 和单 worker 负载下，5,174 ms
仅比默认阈值多 174 ms；日志没有输出任一 assertion mismatch。因此目前没有足够证据
要求缩小 invalid-call 集合、改变并发语义，或修改请求验证生产代码。

## 最小、有界修复

在冻结源码的 `tests/server/world-harness-session.test.ts:71` 将闭合改为：

```ts
  }, 20_000);
```

这只给 malformed-arguments fixture 与相邻单 session world-harness fixtures 相同的
20 秒预算；全局 5 秒默认仍约束其他测试。应保持现有九个 Promise 并发及全部
structured validation assertions，以免“修复”通过减少所验证的 API 表面。

后续只需运行该精确 Vitest 文件或该单 case，确认九个请求均返回结构化
`{ ok: false, error: { kind: 'validation' } }`，而不是仅确认不超时；不建议在没有
新失败证据时重跑 Browser/full suite。

## 风险与缺口

- 单次 CI 只表明 5 秒对该 coverage fixture 太紧，不能证明其稳态耗时上界；20 秒是
  从该文件既有预算取得的保守、局部界限。
- 若修复后它达到 20 秒，需再单独诊断 Headless session 初始化或排队，而不能继续
  增大 timeout。
- 本次没有源码编辑、CI rerun、浏览器/全量测试、依赖操作或外部写入。

## 交付字段

- 变更：无源码变更；写入本 triage 报告。
- 验证：合同 SHA、固定 git tree、完整 CI job 状态与 static 日志已核对。
- 风险：全局提高 Vitest timeout 会掩盖非 Harness 测试回归；只应补该 fixture 的 20 s
  预算，并保留所有 malformed request assertions。
- 实际成本：只读分诊约 14 分钟；未执行测试、browser、CI、依赖或生产写入。
