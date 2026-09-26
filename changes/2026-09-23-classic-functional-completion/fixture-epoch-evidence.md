# V1 Fixture Epoch 身份域闭环证据

阶段：`V1-FIXTURE-EPOCH-DOMAIN-CLOSE-01`
结论：**fixture 修正与静态验证已获 root 准出，交 `GIT-15-FIXTURE-EPOCH` 合并；Browser 未验证。**

## Browser-07 RED

本阶段复用 Browser-07 唯一正式窗口 `e28f49a7-1346-4b0d-ae03-d324449ca752`，不重跑浏览器。Browser-07 机器诊断 SHA256 为 `342f7cab1e49a66fd0e4c935d29c8233f9f7057e3551cf1dcdcd8557d10bad57`，实际失败为：

```text
Expected: seedlands:classic-canonical-runtime-v11:1:world:0
Received: seedlands:classic-canonical-runtime-v11:1
```

前者由 fixture 的 `runtimeEpoch()` 调用 developer `world.identity()` 取得，属于 persistence/world owner epoch；后者由 `mediaSnapshot().worldEpoch` 返回，属于 Browser Authority runtime epoch。冻结 Harness 合同要求 rendered mesh、media controller 与 audio 使用后者。Browser-07 已在该断言前证明两格门提交、descriptor 与双 Chunk 闭门薄轴 mesh 到达，不能把 epoch fixture 失败写成 renderer/media 生产错误。

Browser-07 artifact 后验真实 runId 为 `9d4a2ab8-fd30-47db-b444-5cdc879b0048`；`7e4328c4d49966207e210c9e3be5fbd1d8895d045b54e56c4a55b42cb651bd02` 是该归档 receipt 的 SHA256，不是 runId。

## 实现

`apps/web/tests/e2e/classic-support/v1-slice.ts`：

- `runtimeEpoch(page)` 改为一次读取 `mediaSnapshot()`，严格要求 `worldEpoch` 是非空字符串。
- 同次 snapshot 若已有 audio，则严格要求 `audio.epoch === worldEpoch`；不截断、不拼接、不硬编码 epoch。
- `completeV1SliceBeforeSave()` 在任何门交互前捕获一次 runtime baseline，closed/open mesh 的 `worldEpoch` 与 media `worldEpoch` 均继续与该 baseline 精确比较。
- `verifyV1SliceAfterRestore()` 内部从同一观察面捕获 restore 后 baseline，先要求它严格不同于 pre-save baseline，再继续验证 media epoch、revision、resumePending、last batch 与 audio phase。

`apps/web/tests/e2e/classic-runtime.spec.ts`：

- 保留 `identityAfter.epoch !== identityBefore.epoch`，继续独立证明 developer persistence/world owner 的 restore 换代。
- 不再把 `identityAfter.epoch` 传给 V1 Browser runtime 验证，避免跨身份域比较。

未修改 production、Harness API、坐标、地形、timeout、通用 `walkTo` 或行为流程；所有门、媒体、C4/C5 与保存恢复断言保留。

## 验证

所有重命令分别通过默认 `benchmark-window` 机器锁运行，原始 stdout 与 window receipt 位于 `evidence/v1-fixture-epoch-close-01/`。

### Classic test 类型

```sh
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- zsh -o pipefail -c 'pnpm typecheck:classic 2>&1 | tee changes/2026-09-23-classic-functional-completion/evidence/v1-fixture-epoch-close-01/typecheck-classic.log'
```

PASS，exit 0；窗口 `e5daee68-9b4c-40c9-90a2-e20685bebb62`，`2026-09-25T04:32:49.227Z` 至 `04:32:53.145Z`。

### Root test 类型

```sh
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- zsh -o pipefail -c 'pnpm exec tsc -p tsconfig.test.json --noEmit 2>&1 | tee changes/2026-09-23-classic-functional-completion/evidence/v1-fixture-epoch-close-01/typecheck-root-test.log'
```

PASS，exit 0；窗口 `94e98cad-3032-476a-8c25-56f2b7a0b8fc`，`2026-09-25T04:33:10.011Z` 至 `04:33:13.088Z`。

### Harness owner 合同回归

```sh
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm --filter @seedlands/web test apps/web/tests/unit/app/game-harness-observability.test.ts --maxWorkers=1 --reporter=json --outputFile=changes/2026-09-23-classic-functional-completion/evidence/v1-fixture-epoch-close-01/game-harness-observability.json.log
```

PASS，`2 suites / 4 tests`；窗口 `8601fe6d-e225-4fd7-a8c4-df8662a68e38`，`2026-09-25T04:33:22.852Z` 至 `04:33:24.860Z`。该结果只证明 production owner 的 runtime/render/media/audio 同域合同，不替代 fixture Browser GREEN。

### ESLint

```sh
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- zsh -o pipefail -c 'pnpm exec eslint apps/web/tests/e2e/classic-support/v1-slice.ts apps/web/tests/e2e/classic-runtime.spec.ts 2>&1 | tee changes/2026-09-23-classic-functional-completion/evidence/v1-fixture-epoch-close-01/eslint.log'
```

PASS，exit 0；窗口 `13d4f352-0896-4ebb-8de6-71baeb88d23f`，`2026-09-25T04:33:34.703Z` 至 `04:33:36.585Z`。

### 格式与 diff

首轮四文件 Prettier 在窗口 `208a3197-a2dc-422a-85b3-61abda31fb01` 以 exit 1 仅指出 `v1-slice.ts` 格式；窗口 `b8fd286c-2418-4031-9965-9e49efcd61a8` 仅对该文件执行机械格式化。随后窗口 `90cff3fb-583e-4a69-a205-dc5b6405e803` 的四文件 Prettier PASS，窗口 `482444d3-a213-4dd6-8450-52a584280edc` 的 scoped `git diff --check` PASS。最终包含本 evidence 的复验窗口与 SHA256 见 checkpoint manifest。

## 边界

- 未运行 browser、build、Cua、dev server、CI、Git commit/push 或全仓测试。
- 未新增镜像 helper 测试；本改动的真实 mode/restore 时序只能由唯一 canonical Browser 验证。
- 当前只可称“fixture 修正与静态验证完成”。真正 GREEN 仍须 954 语义提交、生成新 identity artifact，并由唯一 Browser-08 继续验证 mesh 同域 epoch、碰撞/toggle、媒体、C4/C5 与保存恢复。

## GIT-15 隔离合并门禁

唯一 Git writer 从 `82f78952bc0063bca23fbafbe9880d7cbc963c89` 构造 39 路径 detached staged tree，
binary patch SHA-256 为 `13658af43db56e1de6f5381ea74faa586f37d367a92d0e2b27d7c720addf3fbf`；
根与 package 级 `@seedlands/*` 均物理解析到隔离树自身源码。所有命令使用默认机器锁，Vitest 固定
`--maxWorkers=1`，stdout 与 window receipt 在临时树清理前直接写入或复制到本 evidence 目录：

- Harness observability `1 file / 4 tests PASS`：window `fdf839ff-d139-4d08-a032-87cf3cf33dd7`，receipt SHA-256 `87c57627bd919b14d5b95c25ae62a029071faebc185dbb3251ba5ad4beb261e5`，stdout SHA-256 `35abea72c5ce6d1e8f50e1fcf1986d14ae2fa2a8da47a4e79993078c084e24b1`；
- Classic test typecheck PASS：window `146dc0cf-a328-45f1-809f-a3e13b8ae222`，receipt SHA-256 `7a59c34c6c65ef5940c570161e54937233bffe535ef7e3fcaa0754c0b15a9a7d`，stdout SHA-256 `d7c202ce0f0f4567e9230d280cc52c28922a9bf37c5b25740b2d6b8f11ad0bbc`；
- root test typecheck PASS：window `5031305c-b542-4374-9f7a-542eb9ad3029`，receipt SHA-256 `ef3fe74f66bca67da2488d3f92e85fc9f76ab23b68bb09088e5f97f7b8b4d4ef`，stdout 为空文件；
- 两个 fixture TS 的 ESLint PASS：window `1e1046f1-a33f-4e53-8457-d97febbfdb95`，receipt SHA-256 `6717fcaf5559f0b9ff795975073cceb7889f3cbf7f448d729dca55ec73ecd1e6`，stdout 为空文件；
- 两个 TS 与可格式化文档的 Prettier PASS：window `5ae58e5d-b0b8-4d56-9af0-785c66e506af`，receipt SHA-256 `3ce8b97038a4bc74bcb630ce460e4936c9fa1d29f03e545819e7172750eb0e7a`，stdout SHA-256 `17aa973d3f004560237d9a95171210b0671deff23d61628eecf7322ff5938f20`；
- 非原始证据 scoped cached diff PASS：window `a200666e-cbf3-42d8-8c17-d19c5eea9d54`，receipt SHA-256 `2bca67a5b43b7e5c1c5d957cb49ac2d6d55e9d3b8ba3986a5fe850b1c567ee49`，stdout 为空文件。

这些结果只证明 fixture 与既有 Harness owner 合同的静态/单元闭合，不替代 Browser-08。
