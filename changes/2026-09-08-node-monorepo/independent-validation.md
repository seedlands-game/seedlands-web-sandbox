# 三包迁移独立验收报告（最终）

## 结论

**通过。** 本报告按 `changes/2026-09-08-node-monorepo/contracts/validation.json`（SHA-256 `c3b466b39ea42b9beec1a199eb89d33a86578aae4ef952778608d73b7c604299`）独立验收冻结提交 `47f3ad79c30a34cbb9ad02e7a21cbacfcafbf15a`，相对基线 `01bc758d9773085fe801d1f793eda1dff9a34e78`。未发现阻塞性或其他可复现缺陷。

验收方没有修改生产代码、测试期望或历史证据，也没有暂存、提交或推送；本报告是唯一写入。

## CI 增量（待修复 SHA 的 delta 复验）

- PR CI [run 34157691735](https://github.com/seedlands-game/seedlands-web-sandbox/actions/runs/34157691735) 的 head 为本报告所验 `47f3ad79c30a34cbb9ad02e7a21cbacfcafbf15a`，但 Static verification 失败；Package builds 与 Chromium regression 均成功。原始失败 job 日志已只读提取为 `/tmp/seedlands-monorepo/ci-34157691735-static.log`，SHA-256 为 `3929c971fff738861b5a5d55a5ed5a6e056ef57cd1ebe1c39833c920a7fa5858`。
- 唯一失败为 `tests/node/authority-capture-control-failure.test.ts:28` 的“真实 capture 已接纳时断开 control”正例：236 个文件中 1 failed、233 passed、2 skipped；1215 项中 1 failed、1210 passed、4 skipped。`capture` 实际拒绝为普通 `Error: Authority control port closed.`，未满足 `NodeRpcClosedError` 的关闭错误契约；该文件的负对照仍通过。
- 冻结源码显示可复现的时序分支：fixture 先确认真实 compute 已接纳，再关闭 bridge 的 inner control port；inner Authority worker 的 `controlPort.close` 处理器以普通 Error 调用 `fail()`，`fatal` 被 bridge 转回外层。若外层先收到该 fatal，`node-authority-lane` 立即以该普通 Error 调用 `rpc.close()`，在外层 MessagePort 的 `close` 处理器产生 `NodeRpcClosedError` 前结算在途 capture。`captureBaseline()` 直接返回 RPC request，只有 `stop()` 的 `settleStopError()` 做了端口关闭归一化，因此该时序会泄漏普通 Error。
- 这是既有 Authority capture/关闭分支的调度竞态，不是 `47f3ad7` 相对 `01bc758` 的迁移运行时代码改动；本地同 SHA 的 M3 static 日志为 1211 pass/4 skip，说明此前通过不能排除该真实 Worker 时序。此增量使远端 CI 仍待修复；本报告前述本地独立验收结论和已绑定行为证据保持原范围，修复 SHA 到达后须仅对该源码差异和定向关闭证据进行补验。

## e41aa17 control-close delta 复验（缺陷关闭）

- 最终冻结提交为 `e41aa174bcda0c237820509282d78c708e180920`，父提交为 `47f3ad79c30a34cbb9ad02e7a21cbacfcafbf15a`。Git diff 仅有 `apps/node-server/src/node/runtime/node-authority-lane.ts` 一文件、4 行新增/1 行删除。
- 修复只在 outer worker 的 `fatal` 处理器归一化两条精确的内层 control 终态：`Authority control port closed.` 和 `Authority control port failed.` 变为 `NodeRpcClosedError`；其他 `fatal` 字符串仍保留原普通 `Error`。`rpc.close(failureError)`、`markFailed(failureError)`、Worker error/exit、cleanup、`settleStopError()` 与资源终止路径均未改动。因此它恢复 capture 的关闭错误类型契约，不会放宽其他故障、stop 等待真实 cleanup 或资源结算语义。
- `/tmp/seedlands-monorepo/m3-control-close-race-green.log` 的 SHA-256 为 `efac0e7bcd97bb52bdea344639ff94ad25ada3b47836d3373006a4949f0c123e`，匹配交接值。该日志包含 5 次独立运行，每次 `authority-capture-control-failure.test.ts` 的正例和早期 cleanup 负对照均 2/2 通过，合计 10/10；原 CI RED 的错误类型与 cleanup 时序契约都被重复覆盖。
- `/tmp/seedlands-monorepo/m3-control-close-adjacent-green.log` 的 SHA-256 为 `b7a74821fe8053ae56430a270bd4807881e6c7fc6db1041df8409e17547c261f`，匹配交接值；相邻 Node suite 为 2 文件、10/10 通过。`/tmp/seedlands-monorepo/m3-control-close-typecheck.log` 的 SHA-256 为 `38ac890c60e7f38d59ddfb410325cdfb5fca83c9411765c5481754e01c021630`，匹配交接值，`tsc -p tsconfig.json --noEmit` 成功。
- 本验收方未重复运行上述 5 次或完整门禁；在工作树 HEAD 为 `e41aa17` 时只读复核源码、差异及原始 GREEN 日志。此前 `47f3ad7` 的 manifest 仍准确绑定其原始证据；本段单独绑定随后的单文件 delta。该 CI 缺陷据此关闭，最新 CI 终态不由本验收方监控。

## 冻结与证据绑定

- `validation-manifest.json` 中 13 个 `validatedPaths` 按 JavaScript 默认字典序逐项以 UTF-8 写入“路径、NUL、文件原始字节 SHA-256 的 ASCII 十六进制、NUL”后重算，所得工作树内容摘要为 `e0fab7f26dda9996bdf6cba5ec5c7c79aa863b51d343b9adcee656958968b31a`，与 manifest 一致。
- 18 份原始日志和 `node-isolation-report.json` 均重新计算 SHA-256，全部与 manifest 匹配。日志声明的环境为 macOS arm64、Node `v22.23.2`、pnpm `11.25.0`。
- `47f3ad7` 相对 `01bc758` 的源码/配置测试差异均在这组受绑定路径或验证记录中；Node build 日志标明它构建的运行时源为基线 `01bc758`，而冻结提交没有改动 core/Web/Node 运行时输入。故该构建和产物行为可绑定到最终冻结的运行时代码；新增的 Web fallback、adapter 与文档/工具变动由上述内容摘要单独绑定。

## boundary 与覆盖归属

- 三包 manifest、`@seedlands/game-core` exports、core 的 `ES2022` 无 DOM/WebWorker/Node ambient types 环境，以及 Web/Node 各自平台适配仍符合合同。`seedlands/package-boundary` ESLint 规则以 importer 的绝对路径判断包归属，拒绝跨 workspace 相对/file 路径、core 反向依赖、Web/Node 互依、未声明依赖和未导出的 core subpath。
- 独立执行过边界负向 probe：`vitest run tests/governance/monorepo-package-boundaries.test.ts --no-file-parallelism --maxWorkers=1`，1 文件 9/9 通过。正反例覆盖 Web/Node 到 core 的路径绕行、core 反向、Web 到 Node、未声明 PlayCanvas 与未导出 subpath。
- `tsconfig.active-node-tests.json` 继续包含 20 个 Active Node change-local 测试源码；`vitest.active-node.config.ts` 的显式 portable 集合只有 4 文件。该 4 文件由 `test:active-node:critical` 实际执行并在最终日志中为 35/35 通过；其余依赖外部 `/tmp` 冻结语料的 Active Node 用例只有类型检查，未被表述为已运行。
- 迁移前清单（`0380926`）为 `tests/` 239 路径和 change-local 101 路径；最终盘点仍为 239 和 102，新增的唯一 change-local 路径是本 change 的 `e2e/web-package-runtime.spec.ts`，没有删除冻结清单中的回归路径。

## isolation 与 Node 产物

- 实读 `scripts/verify-node-package-isolation.mjs`：它清空并重建 `/tmp/seedlands-monorepo/node-isolation`，仅复制 `packages/game-core`、`apps/node-server`、workspace/lock/基础 TS 配置；过滤 `node_modules`、`dist`，再在该目录安装、core typecheck、Node build，并复制 `apps/node-server/dist` 到无源码的 runtime 目录执行 CLI。
- 实查隔离目录只含 `apps/node-server`、`packages/game-core` 和其自有 `node_modules`；不存在 `apps/web`。结构化报告确认 `webSourcePresent=false`、`rootNodeModulesReused=false`、PlayCanvas/Svelte/Tone 产品依赖为空。Vite/Vitest 仅作为被显式列出的共享测试工具传递依赖。
- 最终隔离日志的 install、core typecheck、Node 五入口 build 和 `node-server.js --help` 均成功。验收方还在 `/tmp/seedlands-monorepo/node-runtime-only` 直接运行了无源码、无依赖目录的 `node node-server.js --help`，得到 `Seedlands Node 世界宿主`；五个 ESM 文件的字节数和 SHA-256 均与 `artifact-manifest.json` 相符。
- `m3-node-artifact-recovery.log` 为 2 文件、4/4 通过。源码审阅确认它首先调用正式 `buildNodeServer`，然后覆盖无依赖 help/manifest hash、worker-thread 与 child-process 的真实子进程启动、SIGTERM 关停和重启；独立 SIGKILL 用例只恢复最后 durable checkpoint、丢弃随后未保存动作并更换 epoch。故不是仅对 mock 或路径存在性断言。

## Web、Static 与行为证据

- 最终 static 日志通过：236 个 Vitest 文件中 234 通过、2 个既有 skip；1211 项通过、4 项 skip；world lines 96.89%。三包/root 类型检查与 Svelte 检查（0 errors、0 warnings）随该入口成功。
- Web build 通过（Vite 2,451 modules）；Node build 通过并生成五个 ESM 入口。
- `tests/worker/data-plane-adapter.test.ts` 不只是检查 adapter 字段：它构造真实 `worldKernelAdapter` 的 Wasm-off 状态、输入 canonical/fluid buffer，并真正调用 core `runWorldComputeTask({ kind: 'generate-mesh' }, …)`，断言返回 `mesh-result` 和非空 meshes。最终定向日志为 1/1 通过。
- 新增 Playwright 用例以 `wasm=off&simd=off` 启动真实世界，断言首块已加载、已渲染，并且 general Worker 为 `status=off`、`effectiveArtifact=off`；定向 Chromium 1/1 通过。完整 Chromium regression 同时含该 fallback 和默认路径，15/15 通过（22.3 秒）。
- 先前独立审阅的启动时钟与 Headless 微任务 checkpoint 修复仍在受检运行时代码中：Web/Dedicated 在 bootstrap 后重锚显式时钟，Headless 保持虚拟时钟和默认微任务 yield。最终 portable baseline 4 文件、35/35 的真实 runner 结果覆盖 Authority baseline、调度资源结算、reference 消费及 worker input settlement。

## 范围限制

- 20 个 Active Node change 测试均完成类型检查；其中 portable 的 4 文件实际执行，其余 16 个依赖外部 `/tmp` 语料的文件未宣称运行。
- 未把性能冻结、远端可玩或最新提交的 CI 状态冒充本地行为准出；性能/远端验收不在本独立报告的通过范围内，最新 CI 由 root 单独处理。
- 未重跑完整 static、build、Playwright、isolation 或性能门禁，以免重复同一冻结的已绑定证据；只作上述定向无写入产物和哈希复核。

## 报告字段

- 完成状态：最终独立验收通过。
- 冻结对象：`47f3ad79c30a34cbb9ad02e7a21cbacfcafbf15a`；基线：`01bc758d9773085fe801d1f793eda1dff9a34e78`。
- 缺陷：无。
- 验证：边界负向 probe 9/9；Static 1211 pass/4 skip；Web/Node build 成功；isolation install/typecheck/build/runtime 成功；Node artifact/recovery 4/4；portable Active Node baseline 35/35；Chromium regression 15/15，含 default 与 `wasm=off`。
- 写入：仅本文件；无生产代码、测试期望或历史证据修改，无 stage/commit/push。
