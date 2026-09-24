# V1 Canonical Browser 正式验收证据

阶段：`V1-CANONICAL-BROWSER-01`
结论：**FAIL，启动门禁阻塞；V1 旅程未执行。**
浏览器租约：本阶段唯一 Playwright/Chromium owner；只执行一次正式 attempt。

## 身份与入口

- 保留干净树：`/private/tmp/seedlands-v1-acceptance-60843904`
- HEAD：`60843904909b2439725a40bc1d4e725de8fcda18`
- `git status --short`：无输出。
- artifact source SHA：`60843904909b2439725a40bc1d4e725de8fcda18`
- artifact digest：`3700a6551d1d359a099bfd757b1820ba84f891233d00a53c029b75bef5b30e5c`
- artifact receipt SHA256：`79f9cce2743a66f2598076540a88b351165fa7e8a085fe33952a274405839656`
- dist：276 个文件，约 21 MiB；未重建、未修改。
- 唯一入口：根 `pnpm harness:classic`；内部调用 `playwright test --config playwright.config.ts`。配置只匹配 `apps/web/tests/e2e/classic-runtime.spec.ts`，`workers=1`、headless、严格端口 4273，并由 Playwright 管理既有 dist 的 preview。
- `harness:classic` 自身不持有机器锁，因此本次只在外层使用一次默认 `benchmark-window`，没有嵌套锁。

## 正式 Attempt

精确命令：

```sh
env SEEDLANDS_HARNESS_RUN_ID=v1-canonical-browser-01-60843904 node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm harness:classic
```

时间：`2026-09-24T21:28:56.064Z` 至 `2026-09-24T21:29:28.495Z`。
机器窗口：`6a28eddc-274a-4684-a71a-55bf63f905ff`，`waitedMs=1`，`exitCode=1`，`measurement.status=NOT_RECORDED`。
Playwright 结果：2 failed，1 skipped；没有 retry 或第二次 Harness 调用。

- 主 canonical：C0 启动步骤约 11.4 秒失败。
- Classic 视觉回归：同一启动入口约 11.2 秒失败。
- 非 Classic smoke：按既有条件 skipped。
- Harness receipt：`status=FAIL`，主 canonical `stages={}`、`current=null`。

## 首个根因

两条 Classic 测试都在点击“进入世界”后返回开始页，页面显示：

```text
Pack presentation resource lock is invalid.
```

`startClassicWorld()` 随后等待 `#start-card` 隐藏 10 秒超时。超时是表象；首个产品根因是 Pack presentation loader 与正式 Pack lock resource schema 不兼容：

1. dist `packs/packs.lock.json` 中 presentation/audio resource 使用正式四字段结构：`{ path, sha256, size, contentType }`。
2. `apps/web/src/client/presentation/pack-presentation-loader.ts:84-86` 的 `lock()` 只接受精确两字段 `{ path, sha256 }`。
3. `loadBrowserPackPresentationCatalog()` 在约第 224 行执行 `pack.resources.map(lock)`，因此第一个四字段 resource 在读取 presentation bytes 前即被拒绝。
4. 网络 trace 显示 `packs.lock.json` 和 `overworld.manifest.json` 都返回 HTTP 200；dist presentation 文件实际 SHA256 为 `a1e379e5e8a9d5f5d41ef7ce204863af0d0cfe41b9e3081e138d87d2517d9f5b`、大小 720，与 lock 一致。故障不是网络、缺文件、digest 不匹配或等待时间不足。

本租约不授权修改 production/test，也不授权第二 attempt，因此没有放宽 validator、改 timeout、修改 dist 或重跑。后续修复应让 loader 对 manifest lock 和 resource lock 使用各自精确 schema，并继续验证 resource 的 `size`/`contentType`，不能丢弃正式字段或放宽成任意对象。

## V1 关键结果

以下均为 **未观测（NOT OBSERVED）**，原因是世界未通过 Pack presentation 启动门禁，不能据此判断功能通过或失败：

- water-bucket 倒 source 与空桶收回；
- 木门两格跨 Chunk 实际 mesh、epoch、关闭碰撞和打开穿越；
- jukebox/record-13 的单次 fact、projection 与真实 audio phase；
- save/return/continue 的新 epoch、门/slot 恢复与 resumePending；
- 手势续播、eject stop；
- 离开世界后的 audio 清理。

## 原始证据

目录：`changes/2026-09-23-classic-functional-completion/evidence/v1-canonical-browser-01/`

- `381e0504e63d62f4c305dfe8ed3e4667a110baf92d40429178c31fe0567b5bf2` `classic.json`
- 原始内容 SHA-256 `bbed198ebd90402211c7e3e556437f00c6581a11bcf149830fa96098ce4bcf65`，deterministic gzip `e6ed91f11a34e29b83983154a5013863ea36023bd85df7fe7805364782cafe18`，`canonical-error-context.md.log.gz`
- 原始内容 SHA-256 `0d99cf273b9711d76686f2f3a2365a08b278e0835a247ed8c18e4721ec7ecff4`，deterministic gzip `892da560b5752b0267e60404ca33f5cd076778842dd05996920c6f2f7e1e4fc8`，`visual-error-context.md.log.gz`
- `3240718b41843027e04a6fd79a5b90e447e8b2250d39b7ac693413ed9e1aa095` `canonical-trace.zip`
- `11d82d6fbc4931f535993451a5195374887016d9248b9f52662ca013be89178e` `visual-trace.zip`
- `79f9cce2743a66f2598076540a88b351165fa7e8a085fe33952a274405839656` `harness-artifact.json`
- `2a5994f2d745b9d873d6099c50d62e94c2b66cf467458be03a2ff87261040cdf` `performance-window.json.log`

## 运行后状态

- `harness:classic` 在失败后仍执行了 artifact 后验校验；没有报告 source、lock、files 或 artifact digest 漂移。
- 运行后 HEAD 仍为 `60843904909b2439725a40bc1d4e725de8fcda18`，`git status --short` 无输出，artifact receipt SHA256 仍为 `79f9cce274...9656`。
- `lsof -nP -iTCP:4273 -sTCP:LISTEN` 无输出；本次 preview 已由 Playwright 清理。
- 没有启动 Cua、第二浏览器路线或第二 attempt；没有 build、CI、Git commit/push、部署、依赖安装或全局配置修改。
