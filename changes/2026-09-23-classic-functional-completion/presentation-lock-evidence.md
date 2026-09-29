# Pack Presentation Lock 收口证据

状态：V1-PRESENTATION-LOCK-CLOSE-01 定向实现与静态门禁 GREEN；候选等待 root 独立读回。未构建新 artifact，未运行 browser 或 CI。

## 根因与 RED

正式 builder 和 Worker 的当前合同为：manifest / entry 使用严格两字段 { path, sha256 }，resources 使用严格四字段 { path, sha256, size, contentType }。原 pack-presentation-loader.ts 只有一个两字段 lock()，并在 pack.resources.map(lock) 上解析全部资源。

首个正式 fixture 同时包含 presentation JSON、引用的 GLB，以及 Classic 音频 metadata：2,976,045 bytes、SHA-256 3c69ae745727607de266898ab68a92c7c75f7f08e27daf0c6cec463f7bd119c9、audio/mpeg。

RED 命令：

    node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm --filter @seedlands/web test apps/web/tests/unit/client/pack-presentation-loader.test.ts -t 'accepts an exact locked same-origin JSON resource' --maxWorkers=1

结果：1 failed / 8 skipped，在 pack.resources.map(lock) 报 Pack presentation resource lock is invalid。未到达任何资源下载上限逻辑。

## 实现

- fileLock() 只接受 manifest/entry 两字段；资源四字段或任意额外字段不能混入。
- resourceLock() 只接受四字段，最多 128 项；路径与 SHA 沿用既有严格校验，size 必须为正安全整数且不超过 32 MiB。
- MIME 精确跟随当前 builder：.json 为 application/json，.mp3 为 audio/mpeg，其他为 application/octet-stream。不保留旧两字段 resource 兼容分支。
- 每个 Pack 一次性构建 resource path 索引并拒绝重复路径。合法但未被 presentation 引用的 MP3 只验证 metadata，不 fetch、不创建 Object URL，也不应用 presentation 1 MiB 下载上限。
- Presentation JSON 和实际引用资产继续由既有 same-origin 流式 reader 读取，1 MiB 限制不变；下载完成后额外验证实际 byteLength 等于 lock size，再验证 SHA-256。
- Blob 的浏览器解码类型仍由既有 presentation 资源扩展名映射决定；lock contentType 只用于验证正式 builder metadata，没有扩大 presentation 可加载类型。

## 负例与生命周期

- Manifest 四字段被两字段 file lock 拒绝。
- Resource 旧两字段、缺字段、额外字段、零 size、超过 32 MiB、错误 MIME 均在资源 fetch 前拒绝。
- Presentation 实际字节数与 lock size 不符拒绝。
- Digest 不符、未锁路径、presentation 引用未锁资源继续拒绝。
- 1 MiB streamed response 立即 cancel。
- Verified Object URL 只释放一次，后续 Pack 失败释放已创建 URL。

## 最终验证

所有重命令分别通过默认 benchmark-window 全机锁，Vitest 固定 maxWorkers=1。

    node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm --filter @seedlands/web test apps/web/tests/unit/client/pack-presentation-loader.test.ts apps/web/tests/unit/client/pack-presentation-lock-contract.test.ts apps/web/tests/unit/client/pack-loader.test.ts apps/web/tests/unit/client/pack-media-loader.test.ts --maxWorkers=1

结果：4 files / 27 tests PASS。其中 presentation 两文件 12/12；邻接 Worker Pack 与 Media loader 15/15。

    node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm --filter @seedlands/web typecheck
    node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec tsc -p tsconfig.test.json --noEmit

Web typecheck 首轮仅本域 contentType: unknown 报错，补显式字符串收窄后两条最终 PASS；Svelte 为 0 errors / 0 warnings。Targeted ESLint、Prettier 和 scoped git diff --check 最终 PASS。

## 文件 Manifest

    0653bf32c98736d7a0e6b2e60a48f8fa1ff4cbd549d95ed0cfb86b672140b838  apps/web/src/client/presentation/pack-presentation-loader.ts
    997d44839d0ce11afb724bf7c49aacf3c684863038b7daae1e858b6aa74c50cb  apps/web/tests/unit/client/pack-presentation-loader.test.ts
    de6ba13e25d4dfcbc0676b8133403d0a7d2f2f0a23bc94380dfe9df751fe983e  apps/web/tests/unit/client/pack-presentation-lock-contract.test.ts
    15566ec16d2c2a29f01102045280df3781cc5f4ebb3fbaabb2d9c38950c59b62  changes/2026-09-23-classic-functional-completion/presentation-lock-contract.md

本 evidence 自身 SHA-256 在最终格式检查后单独回报。

## 未执行

- 未修改 Worker Pack loader、builder、manifest wire、Media loader 或其他 owner 文件。
- 未运行 full build、browser、dev server、CI、Git commit/push 或部署。
