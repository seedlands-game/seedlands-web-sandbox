# V2 Canonical Browser 预算登记证据

阶段：`V2-CANONICAL-BUDGET-REGISTRATION-CLOSE-15`

状态：`STATIC_GREEN / BROWSER24_NOT_RUN`。Browser23 保持正式 FAIL；本阶段只登记下一次有限验收预算，没有执行
browser、build、artifact、行为测试、Cua、CI、Git、push、deploy 或 merge。

## 观察 RED 与实现

Browser23 唯一 attempt 在 `720000ms` main budget 处 timed out，runner exit 1。C5 在 `+718819ms` 完成；timeout 后
cleanup 中的在途调用于 `+727316ms` 才完成最终断言。原 trace 缺 EOCD/中央目录，不能把分片重组或 detailed local PASS
升级为 canonical PASS。该冻结观察代替重新运行 RED。

本阶段实现严格限于：

- `classic-runtime.spec.ts` 的唯一 canonical main `test.setTimeout` 从 `720000` 登记为 `900000ms`。
- `playwright.config.ts` 的唯一 `chromium` project 增加 `timeout: 60000`。
- `spec.md` 与 `canonical-budget-contract.md` 记录推导、Playwright 1.62.1 slot 语义和停止线。

没有修改业务步骤、断言、scenario、route/aim/mouse、安全预算、receipt writer、runner 或 ZIP 处理。900 秒来自
`727316 * 120% = 872779.2ms` 后向上取整，只用于下一次有限工程验收，不是性能改善、p95 或稳定性证明。

## Timeout Slot 读回

`budget-structure-check.mjs` 使用 TypeScript AST 解析当前 source/config，并从 BUILD14 acceptance 的锁定 Playwright
1.62.1 依赖读取 worker runtime：

- canonical main=`900000ms`；visual=`240000ms`；modular smoke=`90000ms`。
- chromium project=`60000ms`。唯一 testMatch、single worker、`retries=CI?1:0`、failOnFlaky、
  `actionTimeout=10000`、`navigationTimeout=30000`、`webServer.timeout=30000` 与 `trace=retain-on-failure` 保持。
- worker runtime line 1650：after-hooks slot 为 `max(project.timeout, testInfo.timeout)`；line 1690 的 worker teardown
  slot 与 line 1713 的 trace stop slot 各自取 project timeout。60 秒不是所有收尾工作的合计墙钟上限。

前三次检查器失败均原样保留：首轮空白正则在 patch 转义中变成 `/s+/g`；第二轮假设主树存在
`node_modules/playwright` 顶层链接；第三轮假设 acceptance 也有该顶层链接。最终只把检查器绑定到 BUILD14 acceptance
内精确的 pnpm store 路径，第四轮 PASS；被验收的两处 TS 配置没有因这些失败改变。

## 静态门禁

所有命令均经 `node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- ...` 串行执行：

- AST/config/Playwright slot 结构读回：PASS。
- `pnpm typecheck:classic`：PASS。
- 根 `pnpm typecheck`：PASS，包含各 workspace、root tests/tools 与 Classic tests 类型检查。
- `pnpm exec eslint apps/web/tests/e2e/classic-runtime.spec.ts playwright.config.ts`：PASS。
- 精确 Prettier 与 scoped diff 在最终 metadata 后执行并封存。

本阶段复用此前 `14 files / 145 tests` 行为闭包，不重跑无行为变化的测试。静态 GREEN 只证明预算登记和类型/配置
结构正确，不证明新预算足够、Browser canonical PASS 或 trace 完整。

## 停止线与后续缺口

后续只有 root 可授权唯一 Browser24。若 main 仍超 `900000ms`，或任一独立收尾 slot 仍超时、trace 仍不完整，必须
保持 FAIL 并独立归因，不再自动加预算。receipt 同 attempt 多记录、skipped non-main 污染、runner 唯一终态与 ZIP
EOCD/中央目录/CRC 校验仍待独立合同；本片没有实现。

Browser23 已触达 V2 19 checkpoint 与保存恢复，但 new object reference 未 assert；death/equipment drop/respawn、16 件
armor、194 项矩阵、V3、V4、完整 canonical、Cua 和人类音频仍未完成。

本阶段传统工程量不超过 `0.25 PD`，AI 目标 `<=1h`、硬上限 `1.5h`；credits、费率、API 等价费用、额度与占比
均为 `unknown`。长期 docs 未更新，因为这是既有 Harness fixture 内部预算登记，没有 owner/API 变化。
