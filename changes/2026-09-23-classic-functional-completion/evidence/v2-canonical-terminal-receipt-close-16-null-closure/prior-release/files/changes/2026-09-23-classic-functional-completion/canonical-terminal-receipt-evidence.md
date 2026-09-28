# V2 Canonical Terminal Receipt 证据

阶段：`V2-CANONICAL-TERMINAL-RECEIPT-CLOSE-16`

状态：定向 GREEN，等待 root 独立准出。Browser23 仍为正式 FAIL；本阶段未运行 Browser24、build、artifact、Cua、
devserver、CI、Git、push、deploy 或 merge。

## RED 与实现

RED 将现有 `writeAttempt` 的 append/every(PASS) 语义抽到 pure helper 后执行 6 个合同测试，结果 `0 passed / 6 failed`。
失败分别证明：Browser23 failure+detailed local PASS 形成两个 records；result failed 可被 local PASS 错标；visual 污染；
重复 key/multiple retry 无唯一门禁；process/run/source/selection 与 benchmark 未被 runner 校验。不是缺 import 或测试未收集。

GREEN 后：

- `evidence.ts` 仍构造原 detailed/failure attachment，measurement、stages、restore、errors/current/logic diagnostics 不丢；
  failure attachment 补齐 runId/sourceSha。它不再写 canonical 文件。
- `canonical-reporter.ts` 从过滤后的 `Suite.allTests()` 精确识别 file/title/project，并在 `onTestEnd` 读取公开
  TestResult status/errors/retry/attachments；`onEnd` 原子写 receipt、返回 void，不覆盖 Playwright 结果。
- `classic-receipt.mjs` 统一 `{test,project,retry}` key、附件解析、FAIL precedence、幂等/冲突、多 retry、selection 与 runner
  校验；attempt 的 file/test/project/testId 还必须与 selection 中唯一 main 精确对应。`.d.mts` 只为 TS Reporter 提供窄声明。
- `classic.mjs` 启动前删除同 runId 旧 receipt，Playwright 后无论 correctness/benchmark 都要求新 receipt 的 runId/source
  与真实 selection；process 非零先失败。default full 要唯一 retry-0 main PASS；visual-only/modular 可明确无 canonical
  attempt；benchmark 额外要求 MEASURED，并继续在原位置写 measurement declaration。

## 验证

- pure receipt/runner：最终 `7 passed / 0 failed`；runner 从 `selectedTests` 重算精确 file/title/project identity，
  伪造自报 mode/matches 不能放行。
- Reporter adapter：`4 passed / 0 failed`，覆盖 Browser23 双附件终态、filtered non-main、modular selection，以及
  file-backed detailed attachment 与 malformed failure attachment fail closed。
- 既有 performance-window consumer：`3 passed / 0 failed`，确认 `attempts[0].benchmark.measurement` 位置兼容。
- Classic test types、root typecheck、变更 TS/MJS ESLint、精确 Prettier 与 scope 检查通过。
- 首轮 ESLint 仅报告 missing-receipt 重抛未保留 cause；修正为 `{ cause }` 后通过，无 suppression。
- pure GREEN 中间两次失败原样保留：第一次 `5/6` 暴露 attempt key 读错 legacy `attempt`；第二次已保留两个 retry，
  但 validator 先报 aggregate FAIL，调整为先报告唯一-attempt 门禁后最终通过。
- 后续实现审计发现 attempt key 中误落真实 NUL，已改为 JSON tuple；同时收紧 modular selection 必须精确包含唯一
  modular smoke 且与 runner 的 modular mode 一致。新增 file-backed/malformed attachment 用例先得到 `1 failed / 6 passed`，
  证明旧适配把 malformed 当缺失并错误 PASS；显式 parse error 接入后最终 GREEN。
- 最终 runner 审计还将 receipt 的 file/test/project/testId 与 selection 中唯一 main 绑定，并让 runnerOutcome/status 双门禁
  覆盖 canonical、visual-only 和 modular 三种 selection；最终 focused run 为 pure `7/7`、Reporter `4/4`、measurement
  consumer `3/3`。

## 边界

Reporter `onTestEnd` 只覆盖 test terminal result；`onEnd.runnerOutcome` 只覆盖 Playwright run 层，之后的 runner process/artifact
错误仍由 `classic.mjs` 独立 fail closed。本阶段不实现 trace EOCD/central-directory/CRC、不 repair、不 retry，不能宣称
Browser23 trace 根因已修。

Close-15 predecessor SOURCE5 与身份 metadata 已在
`evidence/v2-canonical-terminal-receipt-close-16/predecessor-close15/` 逐字节归档和验签，历史 manifest/delivery 未修改。

new object reference、death/equipment drop/respawn、16 armor/194、V3/V4、完整 canonical、Cua/人类音频仍未完成。长期
docs 只窄更新 `docs/code-map.md`，因为新增 Reporter 明确改变了 test evidence owner；生产架构/API 不变。

预算：AI 目标 `1-2h`、硬上限 `3h`；传统 `0.25-0.5 PD`，120% 容量 AI `2.4h`、传统 `0.6 PD`。credits、
费率、API 等价费用、额度与占比 unknown。
