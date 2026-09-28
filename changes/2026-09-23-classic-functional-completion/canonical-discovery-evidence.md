# V2 Canonical Discovery Boundary 证据

阶段：`V2-CANONICAL-DISCOVERY-BOUNDARY-CLOSE-17`

结论：**STATIC GREEN。** 唯一实现只在 `chromium` project 增加
`testDir: './apps/web/tests/e2e'`。顶层 `testDir: '.'`、`testMatch`、Reporter、canonical identity、900s/60s、
workers/retries/trace、runner、receipt 和三条测试业务均未修改。证据只证明静态收集范围与 canonical selection identity，
不证明 Browser25 或产品行为。

证据目录：`evidence/v2-canonical-discovery-boundary-close-17/`。

## RED

修改前在默认机器锁内执行 `pnpm exec playwright test --list --reporter=json`，runId
`v2-canonical-discovery-close-17-red`，exit 1。JSON 中 Playwright 版本为 `1.62.1`，`rootDir` 与唯一 project
`testDir` 均为仓库根；errors 精确包含 Close15 predecessor 与 Close16 null-closure prior-release 两份历史
`classic-runtime.spec.ts` 对缺失 `classic-support/visual-rebuild` 的导入失败。stderr 为空；没有 test-results、HTML report、
webServer、Chromium attempt 或正式 receipt。

RED stdout SHA-256 为 `11868b8dd64dd70fc9ad6aa68d0a67eb2ebdf8b38ed8e4233b7b792d41a39995`，窗口
SHA-256 为 `872159d442da42e9d9e0a76d33a348f2c6d5de2611df756153d2840e05785386`。

## GREEN

修改后在默认机器锁内执行同一命令一次，runId `v2-canonical-discovery-close-17-green`，exit 0。公开 JSON
保持 `rootDir` 为仓库根；唯一 project 为 `chromium`，`testDir` 为 `apps/web/tests/e2e`，`testMatch` 未变，
timeout `60000`、retries `0`。suite 只包含 `apps/web/tests/e2e/classic-runtime.spec.ts` 的三个既有标题：

- `Classic 生产旅程以真实输入完成 C0-C5，并复用同一运行时性能场景`
- `Classic 视觉 v3 生产素材、连续帧与单击破坏回归`
- `非 Classic Playbook 从锁定 production artifact 启动并消费自定义 worldgen/voxel/presentation`

没有 `changes/`、`prior-release` 或 `predecessor-close15` 测试文件。GREEN stdout SHA-256 为
`cc2073e1edfda8b4b162f7c77f352f618c7a91165f2d873ef11d80eac9047c1c`，窗口 SHA-256 为
`ef78caa2005f1777e66e27a23de419ff326785fae8057310b2e93e76be380729`。stdout 中三个 test 的 `status=skipped`
是 Playwright `--list` 的非执行表达，不能解释为产品 skip 或运行结果。

现有 `createCanonicalSelection` 对上述真实 suite 的输出为 `mode=CANONICAL_MAIN`、
`canonicalMainSelected=true`、`canonicalMainMatches=1`、`modularSmokeMatches=1`，且 main file/project/title 与冻结
identity 一致。selection 输出 SHA-256 为 `3df639d4f6e633e5f8d791e9e6f20c9f8762ac35caaf31c58996a207c829d61f`。

## 静态门禁与边界

- `pnpm typecheck:classic`：PASS。
- `pnpm typecheck`：PASS。
- `pnpm exec eslint playwright.config.ts`：PASS。
- 授权 TS/Markdown/JSON 的精确正常 Prettier、scope、SOURCE/MANIFEST 与 final selfcheck：见 delivery。
- GIT39 已通过的 pure receipt `8/8`、Reporter `5/5`、performance-window consumer `3/3`，以及此前
  `14 files / 145 tests` 行为闭包均复用，未机械重跑。

本片未运行 Browser25、build、artifact、Cua、CI、部署或 Git。Browser24 仍为
`FAIL_BEFORE_TEST_DISCOVERY` 且实际 Chromium attempt 为 0；Browser23 仍为 `FAIL/TRACE_INCOMPLETE`。
