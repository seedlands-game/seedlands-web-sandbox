# 三包 monorepo 交付记录

## 可审核边界

功能分支 `codex/node-monorepo`，目标 `main`，PR [#15](https://github.com/seedlands-game/seedlands-web-sandbox/pull/15)。先合入 main 5557f34，再完成三包迁移；主要验收冻结在 47f3ad79c30a34cbb9ad02e7a21cbacfcafbf15a，随后以 e41aa174bcda0c237820509282d78c708e180920 修复 CI 捕获的 Node 控制端口关闭错误类型竞态。最终运行时冻结为 e41aa17，之后仅补充交付与评审文档。

- `@seedlands/game-core`：平台无关的世界、物理、权威规则、协议与纯计算，按职责导出 TS subpath。
- `@seedlands/web`：Svelte/PlayCanvas/Tone、客户端、浏览器 Worker/IndexedDB、Vite 与网页资产。
- `@seedlands/node-server`：Node CLI、线程/子进程、文件持久化与五入口独立产物。

三包使用一个 pnpm lockfile，两端只依赖核心。核心通过窄实例端口获得必要平台能力，独立类型环境没有 DOM/WebWorker/Node ambient types。非法依赖有可执行反例防护。Node 可在无 Web 源码和根完整依赖的临时环境构建，产物可脱离源码运行并保存、恢复。

此 PR 承接原 Dedicated Server 分支尚未合入 main 的基础实现；原大合同仍 Active。远端网络与 GUI、真实远端可玩、性能准出和部署没有随结构迁移交付，不改变游戏规则、存档或 wire 格式。

## 验收

独立 Terra/high 对冻结提交的源码、命令证据和产物复核通过，见 [独立验收报告](independent-validation.md)。过程中的失败与修复保留在 [架构审阅](architecture-review.md) 和 [实施记录](execution.md)。

新增 TS fallback 常规浏览器用例经实施者之外的 Sol/xhigh [独立基线评审](baseline-review.md)通过；保护显式关闭 Wasm 后的真实加载/渲染，与默认旅程互补。文件暂留 change，未来归档时必须迁移并更新执行入口。

| 证据                                                | 结果                                           |
| --------------------------------------------------- | ---------------------------------------------- |
| 完整静态验证、类型检查和覆盖率                      | 1211 项通过、4 项既有 skip；world lines 96.89% |
| 包边界正反例独立执行                                | 9/9                                            |
| Web 与 Node 构建、core 独立类型检查                 | 通过                                           |
| Node 隔离安装、构建和无源码 CLI                     | 通过；无 Web 输入或根 node_modules 复用        |
| 五入口产物、线程/进程启停恢复、SIGKILL durable 恢复 | 4/4                                            |
| 完整 Authority baseline、调度与 Worker 结算         | 35/35                                          |
| 真实 Chromium 默认路径与显式 wasm=off               | 15/15                                          |

Active Node 的 20 个专项测试全部类型检查，其中 portable 4 文件实际执行，其余 16 文件不宣称运行。迁移前 239 个 tests/ 和 101 个 change-local 路径均保留；新增 1 个 TS fallback 用例。历史 Delivered 截图没有重写提交。

## 可重算的证据绑定

[validation-manifest.json](evidence/validation-manifest.json) 包含命令、退出码、18 个原始日志 hash、隔离报告 hash 和源码绑定。独立复核全部匹配。

内容摘要以 manifest 的 `validatedPaths` 经 JavaScript 默认 `.sort()` 排序，对每项连续写入 `UTF8(path) + NUL + ASCII_HEX(SHA256(raw file bytes)) + NUL`，最后取 SHA-256 hex。重算结果为 `e0fab7f26dda9996bdf6cba5ec5c7c79aa863b51d343b9adcee656958968b31a`。未改动的运行时代码由基点 01bc758 绑定；自描述的 spec、执行记录、合同和报告不参与该摘要。原始日志保留在本机 `/tmp/seedlands-monorepo/`，远端可重复的静态、构建、隔离、关键 Node 和浏览器门禁见 PR 的 CI。

47f3ad7 的 CI run 34157691735 中构建和浏览器通过，Static 捕获一项真实 Worker 关闭通知顺序竞态。e41aa17 只将可信控制通道 closed/failed 两个精确终态归一化为 NodeRpcClosedError，其他 fatal 原因和资源清理保持不变。增量目标用例五次独立运行共 10/10、相邻用例 10/10 和 Node typecheck 通过；这组后续运行时差异单独记录，不能冒充已包含在旧 manifest 摘要中。日志 hash 和独立增量复核见独立验收报告。

## 文档与交棒

长期 docs baseline 已更新：README 中英文、代码地图、目录规范、AGENTS 与治理/长期对齐中的当前路径、依赖方向和产物入口。Wasm 冻结工具与 Harness bundle 统计同时兼容旧对照的 dist 和当前 apps/web/dist；没有重写历史测量结论。

阶段提交持续推送，原 Node 分支与原 worktree 保留。01bc758 的 CI run 34156587820 已三项全绿；最终文档提交推送后仍须核对最新 HEAD 三项必要 CI、无冲突并将 PR 转为 ready for review，最终状态记录在 PR。不会自动合并或部署。

工作量假设、实际墙钟观察、模型分工与未知费用见 [预算记录](estimates.md)。
