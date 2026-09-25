# V2 Equipment Core Artifact Build 证据

阶段：V2-ARTIFACT-BUILD-01
状态：production build 与 artifact verification 通过；未运行 Browser、Cua 或 CI。

## 源码与隔离

- 已推送 source SHA：`50a1e6ec72583ad4f5feef057a692709da577b19`。
- clean detached worktree：`/private/tmp/seedlands-v2-acceptance-50a1e6ec`。
- 构建前 HEAD 匹配，tracked diff/index 为空，`apps/web/dist` 不存在。
- 根、stdlib、Web 与 Classic 的 `@seedlands/*` 均解析到 acceptance tree 自身；只复用主工作树的第三方
  `.pnpm` store，`.pnpm-task-run-state-v1` 是 acceptance tree 内真实目录。

## 唯一构建与复验

唯一 production build：

```sh
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- /bin/bash -o pipefail -c \n+  'pnpm build 2>&1 | tee .../evidence/v2-artifact-build-01/build.stdout.log'
```

窗口 `v2-artifact-build-01` 从 `2026-09-25T12:03:56.658Z` 到 `12:04:19.684Z`，
`PASS/exit 0`。Pack build、Rust artifact、SSG、Web typecheck 与 Vite production build 均成功；Svelte
为 `0 errors / 0 warnings`。本树没有第二次 build。

对同一树和同一 dist 的唯一 artifact 复验：

```sh
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- /bin/bash -o pipefail -c \n+  'pnpm harness:artifact 2>&1 | tee .../evidence/v2-artifact-build-01/artifact-verify.stdout.log'
```

窗口 `v2-artifact-verify-01` 从 `2026-09-25T12:04:27.860Z` 到 `12:04:29.723Z`，
`PASS/exit 0`。build 与复验输出的 identity 完全一致：

```text
sourceSha=50a1e6ec72583ad4f5feef057a692709da577b19
sourceDigest=147101872e3de0ce5f4a793bef4fe334a91c1dd9aecbf27ebcc961ef708b1131
lockDigest=44db46fb0f159ebe6d88435c8cfb5d46127d1c7f363a50d19217d454c30e1169
artifactDigest=94d72b2fd976fe58f5a0e9a09870853c6e9e2358dc4fc2026a7b39b344c507f6
files=276
builtAt=2026-09-25T12:04:18.160Z
```

磁盘 `apps/web/dist` 共 277 个文件，其中 276 个是 artifact map 条目，另一个是 receipt 自身。
`harness-artifact.json` SHA-256 为
`924b33af48a6919c7ba6ec1fe8d3772e7182daa2369923ebbdad8dd363b1ed15`；dist `packs.lock.json` SHA-256
为 `fd4054012073c1252f7f8a63d9d9d09ac968620c6859cff9ca78aaebda3d2332`。

## 媒体与后验

源与 dist 的 `playbooks/classic/assets/audio/to-far-shores.mp3` 均为 `2976045` bytes、SHA-256
`3c69ae745727607de266898ab68a92c7c75f7f08e27daf0c6cec463f7bd119c9`；Pack lock 条目记录
`contentType=audio/mpeg`。构建后 acceptance tree tracked diff/index 仍为空，端口 4273 无监听且无本树残留进程。
该 tree/dist 按要求保留，不清理九棵 V1 acceptance tree。

本证据只证明 `50a1e6ec...` 的 production artifact 可重复验证，不证明共享 death RED、equipment UI、combat
armor、V4 restore、Browser/Cua、人类听觉、性能、CI/review 或完整 194 项矩阵。
