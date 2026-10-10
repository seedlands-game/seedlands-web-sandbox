# GIT-40 Canonical Discovery

阶段：`GIT-40-CANONICAL-DISCOVERY`。baseline 为
`549dfecad3f6a8c6ba5c5179382f1af39101c1ff`。第一笔精确 4 路径只交付唯一 Chromium project 的 discovery
boundary 与合同；第二笔交付 Browser24/Close17 evidence、累计报告和状态。

隔离 detached tree 在默认机器锁内重新执行真实 Playwright 1.62.1
`pnpm exec playwright test --list --reporter=json`，只证明静态收集和 identity，不运行 webServer、Chromium 或
产品行为。Classic/root types、配置 ESLint、第一笔 4 路径正常 Prettier 与 scope 同窗串行；GIT39 已冻结的 16 focused
tests 和此前 145 行为测试只复用，不机械重跑。

Browser24 保持 `FAIL_BEFORE_TEST_DISCOVERY`、实际 Chromium attempt 0；Browser23 保持
`FAIL/TRACE_INCOMPLETE`。BUILD16、Browser25、artifact、Cua、devserver、CI 修复、deploy 和 merge 均不在本阶段。

## Manifest closure

已发布 `460545bc` 的根 `MANIFEST.sha256` 第 12 行把 `selection.stdout.json.log` 的真实 64 位 SHA-256
`7156c9366d06b66ae5649a39176b3ddbdb9658de6a63267e2a25f455baee57` 错写成 62 位。旧 `shasum -c` 对该行只
告警并跳过、仍 exit 0，因此旧 manifest SHA
`289b0c5f8441d8272e386ca2f42131be26425e2a62ba8e7de24129a2017dfb6d` 与旧 delivery
`5ff72f342e65195b604d28b7f791ae0aba918e6f246badb2f461b26b9c2dd641` 已由本 closure supersede，不能再作为
17/17 严格验签依据。

`manifest-closure/prior/` 原样保存旧 README/MANIFEST/delivery，路径与 SHA 由 `PRIOR-MANIFEST.sha256` 验证。
`strict-manifest.mjs` 逐行要求 64 位小写十六进制摘要、规范相对路径、无重复，并拒绝 missing、非普通文件与
hash mismatch；旧 62 位 manifest 的真实负例非零退出，修正后的根 manifest 全部条目严格通过。当前根 manifest 的
SHA 与条目数记录在 `delivery-validation.json`；根 manifest、根 delivery 和当前 strict GREEN 输出按有向关系排除，
没有形成哈希回环。旧 `final-selfcheck.stdout.log` 第 21 行 warning 保持原字节，其准出效力由 strict GREEN 取代。
