# V2 Canonical Browser 预算登记合同

阶段：`V2-CANONICAL-BUDGET-REGISTRATION-CLOSE-15`

状态：合同冻结；本阶段只登记现有唯一 Classic Browser 线路的有限预算，不改变玩法、旅程、证据 schema 或失败处理。

## 观察 RED

Browser23 是本阶段已存在的可执行观察 RED，不重新运行：唯一 Chromium attempt、单 worker、retry 0，main test 在
`720000ms` 总预算处 `timedOut`，runner exit 1。C5 在 main start 后 `718819ms` 完成；重开后玻璃步骤已开始，最终断言链
在 timeout 后的 cleanup 中于 `727316ms` 完成。原 trace 为 `1269815136` bytes、SHA-256
`fa61f3c1962a0134a85c9cb72eee911f141804f04cc39f764a3d949ca5fbcc48`，缺 EOCD/中央目录并以 `zipinfo -t` exit 9
失败。局部断言完成和 detailed local PASS 不改变 canonical FAIL。

有限 Git 历史证明 `720000ms` 在 `5d05607027ad0781a349bec37bb49c1c485b8b99` 引入 V1 browser oracles 时由
`480000ms` 上调；完整 V2 equipment journey 在后续 `3df61d38b0b0de55c48ab709afd6315aa9f23ff2` 插入同一 main
test 时没有重新登记总预算。

## 预算合同

1. `classic-runtime.spec.ts` 的 canonical main test 总预算固定为 `900000ms`。推导仅基于 Browser23 最终断言
   `727316ms * 120% = 872779.2ms` 后向上取整；它是下一次工程验收的有限预算，不是性能阈值、p95 或稳定性声明。
2. `playwright.config.ts` 的现有 `chromium` project 显式登记 `timeout: 60000`。main 的 `900000ms`、视觉 test 的
   `240000ms` 与 modular smoke 的 `90000ms` 继续由各 test 显式覆盖；`actionTimeout=10000`、
   `navigationTimeout=30000`、`webServer.timeout=30000`、worker=1、retries、trace=`retain-on-failure` 均不改。
3. 锁定的 Playwright 1.62.1 中，after-hooks slot 使用
   `calculateMaxTimeout(project.timeout, testInfo.timeout)`，所以 main 的正常 afterEach 路径可有 `900000ms` slot；独立
   worker teardown slot 和 trace stop slot各使用 project timeout，即分别为 `60000ms`。多个 slot 不组成“全收尾最多
   60 秒”的单一墙钟承诺。
4. Browser23 从最终断言到 context close 的单次观测为 `34967ms`；`34967 * 120% = 41960.4ms` 只支持把各独立
   project-timeout slot 的下一次候选登记为 `60000ms`。它不能证明 60 秒充分，不能证明第二个 30 秒 timeout 唯一来自
   trace stop，也不能授权继续加预算。
5. 通用 `walkTo` 45 秒、`waitForSnapshot`/equipment progress 最多 20 秒、equipment pulse 80ms、普通 pulse 300ms、
   route aim 18 moves/19 observations、mouse step/sensitivity、容差、路线和坐标全部保持。总预算不能掩盖局部超时或
   死循环。

## RED、验证与停止线

- 不新增只把 literal 与自身比较的测试。用 TypeScript AST/配置解析读回确认：唯一 canonical main 为 900 秒；视觉与
  modular 分别仍是 240/90 秒；chromium project 为 60 秒；worker/retries/trace/action/navigation/webServer 等字段不变。
- 运行 Classic test types、root test types、两个变更 TS 文件的 ESLint、精确 Prettier 与 scoped diff。已有 14 files /
  145 tests 行为闭包不重跑，本阶段没有改变业务行为。
- 后续唯一 Browser 验收只有 root 另行授权后才能运行。若 main 仍未在 900 秒内正常返回，或任一独立收尾 slot 仍超时、
  trace 仍缺中央目录/CRC，则保持 FAIL，单独归因 fixture cost 或 finalization，不再自动增加预算。

## 后续独立合同

本阶段不修改 `evidence.ts`、`classic.mjs`、receipt schema 或 ZIP 处理。Browser23 已证明当前 aggregate 的 FAIL 优先没有
被稍后的 local PASS 覆盖，但同一 `{test, project, retry}` 会追加多个 records，且 skipped non-main 进入同一 receipt；
runner 的 `attempts.length===1` 假设因此需要后续独立终态合同。失败 trace 的 EOCD、中央目录和全 entry CRC 验证也属于
同一后续独立范围；repair 产物不得替代 raw，失败不得自动 retry。

## Ownership 与预算

本阶段只修改 `apps/web/tests/e2e/classic-runtime.spec.ts`、`playwright.config.ts`、当前 `spec.md`、本合同、
`canonical-budget-evidence.md` 和 `evidence/v2-canonical-budget-registration-close-15/`。production、scenario、
route/aim/mouse、receipt writer/runner、历史 Browser23/MAP、累计 Browser 报告、tasks/state 均只读。

传统工程量不超过 `0.25 PD`；AI 目标 `<=1h`、硬上限 `1.5h`。credits、费率、API 等价费用、当前额度与占比均为
`unknown`。长期 docs 不更新，因为本片只登记现有 fixture 的内部预算，不改变 owner、API 或生产架构。
