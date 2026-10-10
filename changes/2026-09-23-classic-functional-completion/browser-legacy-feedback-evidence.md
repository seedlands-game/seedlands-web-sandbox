# Browser 旧存档来源失败反馈证据

状态：`BROWSER-LEGACY-FEEDBACK-01` 逻辑/UI state 测试闭包。未运行 build、browser、dev server、CI 或真实 GUI；最终 Cua 旅程仍由总负责人统一验收。

## 交付边界

- Browser 只对结构完整但没有可信来源的 Gameplay V1、V2、V3 抛出 typed code `LEGACY_GAMEPLAY_PROVENANCE_UNKNOWN`。V4、`null` 和畸形输入继续进入原校验路径。
- Worker fatal 字符串通道保留精确 code；Shell 启动和 Companion checkpoint 导入只按精确 code 或 `code:` 前缀映射，不使用英文 substring。
- 冻结中文反馈为：“无法确认此旧存档的玩法版本，原存档未修改。可返回世界列表，保留旧档并使用其他种子创建新世界。”
- 启动在 `AuthorityRuntime.create` 前读取并拒绝未知来源；拒绝时关闭该启动 persistence，不创建权威 runtime。导入通过公开 checkpoint port 构造候选并失败，未替换 active world。
- 未新增持久字段、数据库升级或 legacy identity；未修改 stdlib guard、Classic Pack、媒体或 `authority-worker.ts`。

## RED 与修复

首轮 4 个测试文件得到 `9 failures / 34 passes`：其中 7 个是缺少 typed 分类、启动映射和导入映射的预期 RED；2 个是并行 Media 后 Classic artifact 缺资源 receipt、以及 persistence fake worker 的固定 `worldId` 预期错误。夹具按真实 Pack resources 与实际公开 identity 修正，没有放宽产品断言。

GREEN 后的可观察行为：

- V1/V2/V3 完整旧 snapshot 精确拒绝；相似英文、prototype/getter、畸形对象不误归类。
- V4 snapshot 和 application checkpoint 编解码回归保持通过。
- Worker `authority-fatal` 到 `BrowserAuthorityClient.start()`、`onFatal`、Shell 菜单错误完整保留 code 并映射中文。
- Browser persistence 公共读取拒绝后没有 save，原 `seedText`、`worldId` 和已缓存 Chunk revision 不变。
- Companion 使用真实编码 application checkpoint 和公开 checkpoint port；失败后 active world identity 保持不变。真实集成里仅现有 pause/resume 使 `commitSequence +2`，没有 world replacement。
- 一般启动错误、一般 Companion 错误继续使用原反馈。

## 最终验证

所有重命令均分别通过默认 `benchmark-window` 全机锁执行；Vitest 固定 `--maxWorkers=1`。

1. 最终目标集合：`7 files / 68 tests PASS`。

```sh
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/tests/unit/client/legacy-gameplay-provenance-error.test.ts apps/web/tests/unit/worker/authority-worldgen-legacy-provenance.test.ts apps/web/tests/unit/client/shell-controller.test.ts apps/web/tests/unit/client/browser-chunk-persistence.test.ts apps/web/tests/unit/app/companion-session.test.ts apps/web/tests/unit/client/browser-authority-client.test.ts apps/web/tests/integration/runtime/app/companion-checkpoint-recovery.test.ts --maxWorkers=1
```

2. V4 / application checkpoint 窄回归：`2 files / 7 tests PASS`。

```sh
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/tests/unit/worker/authority-worldgen-legacy-provenance.test.ts apps/web/tests/integration/runtime/client/application-checkpoint.test.ts --maxWorkers=1
```

3. `@seedlands/web` typecheck：PASS；Svelte `0 errors / 0 warnings`。

```sh
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm --filter @seedlands/web typecheck
```

4. Root test typecheck：本任务文件无诊断；仅被并行 predecessor fixture 的两处 readonly 写操作阻塞，未越域修改。

```text
packages/stdlib/tests/server/gameplay-snapshot-predecessor.test.ts(98,42): error TS2540: Cannot assign to 'entryDigest' because it is a read-only property.
packages/stdlib/tests/server/gameplay-snapshot-predecessor.test.ts(101,40): error TS2339: Property 'pop' does not exist on type 'readonly Readonly<{ id: string; version: string; packId: string; }>[]'.
```

```sh
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec tsc -p tsconfig.test.json --noEmit --pretty false
```

5. 定向 ESLint：PASS。定向 Prettier：PASS。最终 scoped `git diff --check`：PASS。

```sh
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec eslint apps/web/src/client/persistence/legacy-gameplay-provenance-error.ts apps/web/src/worker/authority-worldgen-runtime.ts apps/web/src/client/shell/shell-controller.ts apps/web/src/app/gameplay/companion/companion-session.ts apps/web/tests/unit/client/legacy-gameplay-provenance-error.test.ts apps/web/tests/unit/worker/authority-worldgen-legacy-provenance.test.ts apps/web/tests/unit/client/shell-controller.test.ts apps/web/tests/unit/client/browser-chunk-persistence.test.ts apps/web/tests/unit/app/companion-session.test.ts apps/web/tests/unit/client/browser-authority-client.test.ts apps/web/tests/integration/runtime/app/companion-checkpoint-recovery.test.ts
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec prettier --check apps/web/src/client/persistence/legacy-gameplay-provenance-error.ts apps/web/src/worker/authority-worldgen-runtime.ts apps/web/src/client/shell/shell-controller.ts apps/web/src/app/gameplay/companion/companion-session.ts apps/web/tests/unit/client/legacy-gameplay-provenance-error.test.ts apps/web/tests/unit/worker/authority-worldgen-legacy-provenance.test.ts apps/web/tests/unit/client/shell-controller.test.ts apps/web/tests/unit/client/browser-chunk-persistence.test.ts apps/web/tests/unit/app/companion-session.test.ts apps/web/tests/unit/client/browser-authority-client.test.ts apps/web/tests/integration/runtime/app/companion-checkpoint-recovery.test.ts changes/2026-09-23-classic-functional-completion/browser-legacy-feedback-contract.md changes/2026-09-23-classic-functional-completion/browser-legacy-feedback-evidence.md
git diff --check -- apps/web/src/client/persistence/legacy-gameplay-provenance-error.ts apps/web/src/worker/authority-worldgen-runtime.ts apps/web/src/client/shell/shell-controller.ts apps/web/src/app/gameplay/companion/companion-session.ts apps/web/tests/unit/client/legacy-gameplay-provenance-error.test.ts apps/web/tests/unit/worker/authority-worldgen-legacy-provenance.test.ts apps/web/tests/unit/client/shell-controller.test.ts apps/web/tests/unit/client/browser-chunk-persistence.test.ts apps/web/tests/unit/app/companion-session.test.ts apps/web/tests/unit/client/browser-authority-client.test.ts apps/web/tests/integration/runtime/app/companion-checkpoint-recovery.test.ts changes/2026-09-23-classic-functional-completion/browser-legacy-feedback-contract.md changes/2026-09-23-classic-functional-completion/browser-legacy-feedback-evidence.md
```

## 文件 SHA-256

```text
8dcd13dda908c55b68a070a67e86f58633f705dab28cabc10b90caeb67edc897  apps/web/src/client/persistence/legacy-gameplay-provenance-error.ts
44b94481179a384e04ac6434fd28ccb974ff26f2717b1b658a2b594376f3fcb4  apps/web/src/worker/authority-worldgen-runtime.ts
e69cc95a2f8bbc47f74641aed316d64053f76912fd8e0bc02d6b618495a2ee49  apps/web/src/client/shell/shell-controller.ts
17711d6492d967336c2867c20ba6322079e744b905596e8e1ada9aa038458e31  apps/web/src/app/gameplay/companion/companion-session.ts
2197efb76a8502d537c629df5016081dff738e23ab1f35f193061c70164eb2e7  apps/web/tests/unit/client/legacy-gameplay-provenance-error.test.ts
cc43810da5d13d35c2bd4b58aa5c61256923a4694ddd7e3f1d14dd5a973c9f43  apps/web/tests/unit/worker/authority-worldgen-legacy-provenance.test.ts
9cb0112779aff57c8359ec98f17127311ea7d8c110fc1e948ffebd8e2210338e  apps/web/tests/unit/client/shell-controller.test.ts
4f4d58c6851f9baaa511b12174df6a97beb66ec938e75720febbc9903f63a075  apps/web/tests/unit/client/browser-chunk-persistence.test.ts
e9ad03da95e82a1ed4045a263f0db6990448fd2b83c5148ef2509b3bec1f8f84  apps/web/tests/unit/app/companion-session.test.ts
d0487b74fdebb2e48b882b75703d81954d94391d67db68f45321709648ba5201  apps/web/tests/unit/client/browser-authority-client.test.ts
093e291c3a66be2052aa27377e9f002a65758fa3e199861ea1e3ad1c0b747c79  apps/web/tests/integration/runtime/app/companion-checkpoint-recovery.test.ts
f5a016b093a90d15a9d4ab4a5ed148725bea7190a25533519b41e1f89147ef86  changes/2026-09-23-classic-functional-completion/browser-legacy-feedback-contract.md
```

本 evidence 自身 SHA-256 在最终格式检查后单独回报。
