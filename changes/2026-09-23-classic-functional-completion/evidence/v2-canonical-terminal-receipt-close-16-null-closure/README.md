# V2 Canonical Terminal Receipt Close-16 Null Closure

状态：`DETERMINISTIC_STATIC_GREEN / Browser24 NOT RUN`。本阶段只修复 Close16 新 receipt helper 对已存在
`classic-runtime-failure.json` 的 JSON `null`/primitive/array payload 漏判，不改变 Reporter、runner、预算、selection、
ZIP、生产或 Browser 行为。

## RED

root 已独立复现同一 main attempt：有效 detailed PASS、`resultStatus=passed` 与 payload 为 JSON `null` 的 failure
attachment 会得到 `status=PASS` 且 runner validator 接受。本阶段没有冒充 root 的外部输出，另取得两份本地可执行 RED：

- pure helper 参数化 `null`、string、number、boolean、空 array、非空 array，并对附件前后顺序各跑一次；旧代码
  `7 passed / 1 failed`，失败点为 receipt 实际 PASS。
- 真实 Reporter 用 `Buffer.from('null')` 经 `onBegin/onTestEnd/onEnd` 写临时 receipt；旧代码 `4 passed / 1 failed`，
  同样错误 PASS。

## 修复

`classic-receipt.mjs` 分开计算 `assertionEvidencePresent` 与 `failureEvidencePresent`，再读取第一个 payload。只要 failure
attachment 名称存在就阻止 terminal PASS；`null`/primitive/array 保留在 `failureEvidence`，同时记录
`failure attachment is not a JSON object`。正常没有 failure attachment 的 detailed PASS 仍记录
`failureEvidencePresent=false` 并通过。

Reporter 实现不变：它已把合法 JSON `null` 作为 payload 交给 pure owner。runner validator 不需修改：修复后的 receipt
顶层与 attempt 均为 FAIL，它按既有双门禁拒绝。测试显式覆盖真实 Reporter 写文件后调用 runner validator，
`processStatus=0`、`requireCanonicalMain=true` 仍拒绝。

## 验证与边界

- 最终 pure receipt helper `8/8` PASS。
- 最终 Reporter adapter `5/5` PASS。
- 既有 performance-window consumer `3/3` PASS。
- Classic/root types、三个变更 TS/MJS 的 ESLint、正常 Prettier、diff/scope、无 suppression 与空 index PASS。
- `canonical-reporter.ts`、`classic.mjs`、`classic-receipt.d.mts`、`playwright.config.ts`、`classic-runtime.spec.ts`、
  `evidence.ts` 和 code map 与 Close16 predecessor 逐字节相同。

首次 GREEN 的 pure 8/8 已通过，但 Reporter malformed JSON 用例因新增 non-object 诊断多出第二条错误而失败；调整测试
以接受两条精确信息后最终 GREEN。该失败 raw 保留。本阶段未运行 145 行为闭包、Browser24、build、artifact、Cua、
devserver、CI、Git、push、deploy 或 merge；Browser23 保持正式 FAIL。ZIP EOCD/CRC、new reference、death/drop/respawn、
16 armor/194、V3/V4 仍未完成。

预算：AI 目标 `<=45min`、硬上限 `1h`；传统 `0.25-0.5 PD`，120% 容量传统 `0.6 PD`。credits、费率、API 等价
费用、额度与占比 unknown。长期 docs 不更新：这是既有 receipt owner 的输入闭包修复，无 owner/API 变化。
