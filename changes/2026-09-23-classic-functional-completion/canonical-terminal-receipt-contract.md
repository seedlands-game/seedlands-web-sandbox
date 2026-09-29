# V2 Canonical Terminal Receipt 合同

阶段：`V2-CANONICAL-TERMINAL-RECEIPT-CLOSE-16`

状态：实施合同。只修复唯一 Classic Playwright 线路的终态 receipt 所有权，不改变玩法、Browser 旅程、预算、artifact、
performance-window-proof 或 trace ZIP 校验。

## 已有 RED

Browser23 的同一个 `{test, project, retry=0}` 在 `afterEach` 写入 FAIL 后，timeout cleanup 中仍在途的主函数又写入
detailed local PASS；现有 `writeAttempt` 将两者 append 成两个 `attempts`。同次运行的 skipped non-Classic test 还追加第三条
FAIL。顶层 `every(PASS)` 本次仍正确保持 FAIL，但 `attempts` 已不再等价于真实 Playwright attempts，且局部 PASS 不是
`onTestEnd` 终态。原 Browser23 raw、FAIL、SOURCE/MANIFEST/delivery 保持冻结，本阶段不重跑 Browser。

## Owner 与数据流

1. `evidence.ts` 继续构造并附加 `classic-runtime-evidence.json` 与 `classic-runtime-failure.json`。两份附件保持现有字段、
   measurement、stages、restore、errors/current/logic diagnostics；它不再写 `SEEDLANDS_CLASSIC_RESULT`。
2. `canonical-reporter.ts` 是 canonical receipt 的唯一文件 writer。它只接受精确 identity：
   `apps/web/tests/e2e/classic-runtime.spec.ts`、完整 main title、project `chromium`；visual 与 non-Classic 即使 passed/skipped
   也不进入 attempts。
3. Reporter 的 `onBegin` 使用过滤后的公开 `Suite.allTests()` 记录本次真实 selection；`onTestEnd` 使用公开
   `TestResult.status/errors/retry/attachments` 构造一个 terminal attempt；`onEnd` 只记录 full runner outcome 并写文件，返回
   `void`，不得覆盖 Playwright 已有结果。Reporter 方法异常即可能导致文件缺失，由 runner fail closed。
4. `scripts/harness/classic-receipt.mjs` 是 Reporter 与 `classic.mjs` 共用的纯 identity、合并和验证 owner；无 Web、游戏或
   artifact 写入。`classic.mjs` 保留运行前后 artifact verify，并在 Playwright 结束后同时校验 process status、runId、
   sourceSha、selection 与 terminal receipt。

## Receipt 兼容与终态

- 顶层继续保留 `schemaVersion/status/attempts`；每个 detailed attempt 继续把 `benchmark.measurement` 放在
  `attempts[0].benchmark.measurement`，兼容现有 performance-window-proof consumer。新增 selection、runnerOutcome、
  testOutcome、assertionEvidenceStatus 与 failureEvidence 分栏。
- attempt key 固定为 `{test, project, retry}`。相同 key 的字节等价 terminal event 幂等；不同内容的重复 event 明确冲突并
  使 receipt FAIL，不追加第二条。不同 retry 保留为不同记录；完整 canonical/benchmark 的唯一-attempt 门禁拒绝多 retry，
  不吞掉失败 attempt。
- terminal PASS 仅当 `TestResult.status=passed`、detailed attachment status=PASS、没有 failure attachment、附件合法且
  runId/source identity 一致。`failed/timedOut/interrupted/skipped`、局部 FAIL、缺 detailed、附件冲突或解析失败全部 FAIL。
  detailed local PASS 后发生断言或 teardown failure 仍由 `onTestEnd` 变成 terminal FAIL；局部 FAIL 即使 result passed 也
  fail closed。
- default full Classic 必须由真实 selection 精确选中一个 main，并只有 retry 0 的一个 terminal attempt。带 correctness
  selection args 时以 reporter 的过滤后 suite 判定 main 是否选中；visual-only 可明确 NOT_SELECTED。
  `SEEDLANDS_PACK_SMOKE=modular-world` 明确不要求 canonical main，main/visual 的动态 skip 不写 attempts。缺 receipt、
  malformed、ambiguous selection、stale runId/source、错误 main identity 或 full run 的 NOT_SELECTED 全部拒绝。
- Playwright process 非零永远整体 FAIL；receipt PASS 不能覆盖。`onEnd.runnerOutcome` 只记录 test runner 层状态，不声称
  覆盖 reporter 之后的进程/宿主错误。benchmark 除上述条件外必须保持唯一 attempt 且
  `benchmark.measurement.status=MEASURED`，才可写 measurement declaration。

Null closure 补充：附件是否存在与 payload 值分开判断。任何命中 `classic-runtime-failure.json` 名称的附件都表示
failure evidence 存在；即使 JSON 可解析为 `null`、primitive 或 array，也必须记录
`failure attachment is not a JSON object` 并使 terminal FAIL。不得用 `failures[0] ?? null`、truthiness 或
`failureEvidence === null` 同时表达“不存在”和“存在但值为 null”。正常没有 failure attachment 的 detailed PASS 仍可通过。

## 可执行 RED / GREEN

1. Browser23 形状的 failure+detailed（两种附件顺序）配 `timedOut`，预期一个 terminal FAIL，同时保留 detailed V2/C5、
   restore、benchmark 与 failure diagnostics。旧 append writer 会产生两个 records，因此 RED 不是缺 import。
2. detailed PASS 后 `result=failed` 仍 FAIL；failure attachment 配 `result=passed` 仍 FAIL；正常 detailed PASS 配 passed
   得一个 PASS 并保留 measurement。
3. visual/skipped non-main 不产生 canonical attempt；相同 key 重复事件幂等，冲突拒绝；retry 0/1 均可见且 runner 唯一
   attempt 门禁拒绝。
4. runner helper 覆盖非零 process+local PASS、full missing/malformed/ambiguous/stale runId/source、benchmark 非 MEASURED、
   visual-only NOT_SELECTED、modular NOT_SELECTED 与正常 full PASS。
5. 运行定向 reporter/runner/measurement 测试、Classic/root types、变更 TS/MJS ESLint、精确 Prettier 与 scope；不用
   Browser、build 或现有 145 行为闭包冒充终态修复。

## 非目标与停止线

不实现 trace EOCD/central-directory/CRC，不 repair、不 retry；未来 Browser evidence 仍由独立验收检查原 trace 完整性。
不修改 Close-15 的 900 秒 main 或 project 60 秒、scenario、route/aim/mouse、production、V1/V2 helper，也不补
new-reference、death/drop/respawn、16 armor/194、V3/V4。若公开 Reporter 实际附件/selection shape 无法在上述窄边界
稳定解析，停止并报告，不增加第二 writer 或泛化框架。

## 预算

AI 目标 `1-2h`、硬上限 `3h`；传统 `0.25-0.5 PD`，120% 容量为 AI `2.4h`、传统 `0.6 PD`。credits、费率、
API 等价费用、当前额度与占比均为 `unknown`。
