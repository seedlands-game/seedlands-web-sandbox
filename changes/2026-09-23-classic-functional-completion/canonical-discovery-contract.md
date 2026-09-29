# V2 Canonical Discovery Boundary 合同

阶段：`V2-CANONICAL-DISCOVERY-BOUNDARY-CLOSE-17`

状态：实施合同。只修复唯一 Classic Playwright 线路的静态测试收集边界，不改变 Browser 旅程、运行预算、Reporter、
receipt、artifact、生产代码或测试业务。

## 已有失败与可执行 RED

Browser24 的唯一外层命令在 test discovery 阶段 exit 1，实际 Chromium attempt 为 0。Playwright 1.62.1 的字符串
matcher 会给 `apps/web/tests/e2e/classic-runtime.spec.ts` 补可匹配任意前缀的 glob；配合顶层 `testDir: '.'`，除真实
canonical 文件外还会收集 Close15 predecessor 和 Close16 null-closure prior-release 中的两份历史快照。它们没有相邻的
`classic-support/visual-rebuild`，因此模块加载失败。Browser24、Browser23 与历史冻结证据保持不改。

修改前在默认机器锁内执行一次真实 Playwright 1.62.1 纯发现命令：

```sh
pnpm exec playwright test --list --reporter=json
```

该 RED 必须以非零退出重现上述两份历史路径的缺失导入。命令只做静态收集，不调用 `harness:classic`、不启动
webServer/Chromium、不写正式 receipt，也不消费 Browser lease。stdout、stderr、真实 exit 与窗口原样封存。

## 单一实现与 owner

`playwright.config.ts` 继续让顶层 `testDir: '.'` 保持 `FullConfig.rootDir` 为仓库根，供 Reporter 将绝对测试路径规范化为
`apps/web/tests/e2e/classic-runtime.spec.ts`。唯一 `chromium` project 增加
`testDir: './apps/web/tests/e2e'`，只把该 project 的文件收集限制到真实 E2E owner。顶层 `testMatch` 仍精确描述唯一 spec；
project name、`timeout: 60000`、main/visual/modular test timeout、workers、retries、trace、webServer、default selection、
Reporter 和 receipt 均不改。

禁止改顶层 `testDir` 后补 Reporter，禁止历史目录黑名单、绝对本机路径、第二 config、fallback 或新的通用抽象。
非 Classic 替代配置反例是另一个 project 可声明自己的 `testDir` 与 `testMatch`，同时复用仓库根 `rootDir`；本片不预建
该 project。

## GREEN 与兼容门禁

修改后在默认机器锁内仅执行一次同一 `--list --reporter=json`。GREEN 必须满足：

- exit 0，且没有启动 webServer、Chromium 或正式 Harness。
- `FullConfig.rootDir` 仍为仓库根；唯一 project 是 `chromium`，其 `testDir` 精确为 `apps/web/tests/e2e`。
- 只发现 `apps/web/tests/e2e/classic-runtime.spec.ts`，共三个既有 test identity：main、visual、modular。
- 输出不存在 `changes/`、`prior-release` 或 `predecessor-close15` 测试文件。
- main 的 file、project 和完整标题交给现有 `createCanonicalSelection` 后仍得到唯一 `CANONICAL_MAIN`。

再运行 Classic test types、root test types、`playwright.config.ts` 的 ESLint、授权 Markdown/JSON/TS 的精确正常
Prettier 与 scoped diff。既有 16 focused tests 和 145 行为测试复用，不机械重跑；本片不调用 Browser、build 或
artifact。若 project `testDir` 不能保持根相对 identity，或 `--list` 启动了产品资源，停止并报告，不改用其他方案。

## 保存、失败与验收边界

本片没有 save schema、运行时状态或失败兼容变化。RED 原件保留；GREEN 只证明静态收集边界和 selection identity，不能
声称 `onTestEnd`、terminal receipt、Browser25、C0-C5、V1/V2、视觉或产品行为通过。Browser24 保持
`FAIL_BEFORE_TEST_DISCOVERY`，Browser23 保持 `FAIL/TRACE_INCOMPLETE`。

## Ownership 与预算

允许修改 `playwright.config.ts`、当前 `spec.md`、本合同、`canonical-discovery-evidence.md`、必要的一句
`docs/ci-testing.md`，以及 `evidence/v2-canonical-discovery-boundary-close-17/`。历史 Browser/Close/BUILD/GIT39、
production、tests、runner、receipt 和配置其余字段只读。

传统工程量 `0.1-0.25 PD`；AI 目标 `<=1h`、硬上限 `2h`。按硬上限 120% 建议容量为传统 `0.3 PD`、AI
`2.4h`。credits、费率、API 等价费用、当前额度和预测占比均为 `unknown`。
