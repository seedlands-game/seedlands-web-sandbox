# Harness 合同

本页定义 `harness/contracts.json`、`scripts/harness/plan.mjs`、`scripts/harness/run.mjs` 与 `apps/web/dist/harness-artifact.json` 之间的机器合同。它描述当前可执行入口；change 目录中的历史报告不是运行依赖。

## Owner registry

`harness/contracts.json` 的 `schemaVersion` 当前为 `1`。每个 owner 必须提供唯一 `id`、至少一个 `paths` pattern 和 `contracts` 数组。

| 字段                | 约束                                                                             |
| ------------------- | -------------------------------------------------------------------------------- |
| `paths`             | 相对仓库根、不能包含 `..`；覆盖 owner 的源码、配置、资产与测试                   |
| `contracts[].id`    | 全 registry 唯一且稳定                                                           |
| `contracts[].kind`  | `contract` 或 `integration`                                                      |
| `contracts[].files` | 相对路径 pattern；选中后必须匹配 head 中真实 `.test.ts` 文件                     |
| `dependencies[]`    | 指向已声明 owner；kind 为 `required`、`optional`、`capability` 或 `build`        |
| `classic`           | 此 owner 或其反向消费者变化是否需要唯一 Classic 旅程                             |
| `localBenchmarks`   | 可选的局部 benchmark ID，不自动变成浏览器线路                                    |
| `documentation`     | 只有全部受影响 owner 与 changed paths 都满足文档条件时才允许 `documentationOnly` |

源码 import 能推导的依赖由 dependency graph 读取；动态 capability、资产、生成输入和构建边必须在 registry 明示。`dynamicPaths` 仅允许具体文件，须同时提供 `dynamicReason` 和显式依赖；它只声明该文件的非字面加载边界，不豁免无法解析的静态导入。条件 exports 分支不同或任一活跃消费者依赖无法解析时，保守进入完整新基线，`unresolvedDependencies` 保留具体位置。新增活跃路径没有 owner 时进入 `full-new`，不能以“尚未登记”跳过。

## Plan 输入与输出

标准入口：

```sh
pnpm harness:plan --root "$PWD" --base <baseSha> --head <headSha> --out <plan.json>
```

`--all` 强制完整新基线。省略 `--head` 时读取当前工作树，并用 `worktreeDigest` 区分未提交内容。CI 总是传精确 `baseSha`/`headSha`；PR checkout 与 `headSha` 必须相同。

计划至少包含：

| 字段                                         | 含义                                                  |
| -------------------------------------------- | ----------------------------------------------------- |
| `schemaVersion`                              | 当前为 `1`                                            |
| `baseSha` / `headSha`                        | 两侧 snapshot 身份；runner 拒绝 head 不等于当前源码   |
| `status`                                     | `READY` 或 `BLOCKED`                                  |
| `mode`                                       | `affected` 或 `full-new`                              |
| `changedOwners` / `affectedOwners`           | 直接 owner 与反向消费者闭包                           |
| `selectedContracts` / `selectedIntegrations` | 每项带 `id`、`kind`、`ownerId` 与展开后的真实 `files` |
| `classic.required` / `classic.reasons`       | 是否运行唯一 Classic 旅程及 owner 理由                |
| `productionBuild`                            | 是否需要生成生产 artifact                             |
| `documentationOnly`                          | 是否只执行格式与路径基线                              |
| `localBenchmarks`                            | 被选择的局部 benchmark；不在普通 affected 中自动运行  |
| `reasons` / `fallbackReasons`                | 每个 owner 的选择原因和 `full-new` 原因               |
| `errors` / `diagnostics`                     | 阻塞问题与 snapshot/diff 诊断                         |
| `worktreeDigest`                             | 非提交 head 的工作树摘要；提交 snapshot 为 `null`     |

`status: BLOCKED`、无效 schema、选中 test pattern 无匹配、head 删除 base 必需测试、未知路径，或非文档计划出现 `No effective tests selected` 均不可执行为 PASS。

## Trusted base 与 bootstrap

PR 先检查 `baseSha` 是否包含 `scripts/harness/plan.mjs`。存在时，CI 从 base tree 解出完整 `scripts/harness/` 到临时目录，以当前 checkout 为 `--root` 运行；base/head registries 的并集确保候选不能删除自己的保护。

base 尚无 selector 时，只允许一次显式 `missing-base-selector` bootstrap：head planner 必须带 `--all`，并由 CI 额外确认 `mode: full-new`、`productionBuild: true`、`documentationOnly: false`、`classic.required: true` 且至少有一个 selected contract/integration。main push 始终使用 `--all`。

## Runner stages

| 根命令                               | stage      | 行为                                                                                   |
| ------------------------------------ | ---------- | -------------------------------------------------------------------------------------- |
| `pnpm verify:affected --plan <path>` | `affected` | 校验计划/current source；执行必要静态门禁和 selected tests                             |
| `pnpm verify:all`                    | `all`      | 生成/校验 full-new，执行完整新合同基线并按计划构建、运行 Classic                       |
| `pnpm test`                          | `tests`    | 只执行 plan 中 selected tests，仍拒绝空或未执行项                                      |
| `pnpm harness:classic`               | `classic`  | 先 `verifyArtifact`，只运行 canonical Playwright config，再复验 artifact               |
| `pnpm bench:runtime`                 | `runtime`  | 与 Classic 使用同一旅程，仅打开其已定义的真实路径 benchmark 观察，并经性能窗口串行取得 |

Runner 只接受 `packages|apps|playbooks/<owner>/tests/**/*.test.ts`，游戏测试通过根 convenience runner 加载各 workspace 自己的 `vitest.config.ts`；ESLint 测试通过独立 `pnpm --filter @seedlands/eslint-plugin test` 执行，不进入游戏 Vitest projects。游戏测试编排限制本机最多 4 个 worker，CI 保留原串行上限 1；不提高测试超时或增加重试来掩盖负载问题。每个报告必须 `success`、至少执行一个测试、没有 pending/todo，且每个 selected file 都出现在实际结果中。`documentationOnly` 可以没有测试；其他空选择抛出 `No effective tests selected`。

每次执行写 `harness/results/<runId>/result.json`，记录 `configHash`、`planHash`、真实命令、时间和 exit code。`phases` 分别记录 selection、static、contracts、build、artifact、classic；未选择为 `NOT_SELECTED`，失败后的未运行项为 `BLOCKED`。选择/产物校验失败整体为 `BLOCKED`，已执行检查或路线失败为 `FAIL`。失败回执保留已完成步骤和 Classic 的部分阶段，重试不能抹去失败 attempt。

## Production artifact

`pnpm build` 是 CI 唯一生产构建入口，并在 `apps/web/dist/harness-artifact.json` 写入：

| 字段             | 校验                                                                             |
| ---------------- | -------------------------------------------------------------------------------- |
| `sourceSha`      | 当前 Git snapshot SHA                                                            |
| `sourceDigest`   | apps/packages/playbooks/crates/wasm/scripts 与构建配置等相关源文件摘要           |
| `lockDigest`     | `pnpm-lock.yaml` 摘要                                                            |
| `files`          | 除 receipt 自身外，dist 每个普通文件的 SHA-256；必须包含 HTML、Wasm 和 Pack lock |
| `artifactDigest` | canonical `files` map 的摘要                                                     |
| `builtAt`        | 构建完成时间，只作追踪，不作等价判断                                             |

`sourceDigest` 覆盖 workspace 中所有已纳入 snapshot 的输入，包括 app 根的 HTML、配置、资产和测试；不只匹配 `src/` 或脚本扩展名。`dist` 等构建/测试产物排除，避免 receipt 把自己纳入源码身份。`verifyArtifact` 重新计算 `sourceSha`、`sourceDigest`、`lockDigest`、`files` 和 `artifactDigest`。dist 中的 symlink、缺失 HTML/Wasm/Pack lock、下载后任一字节变化、不同 source 或 lock 都失败。

CI build job 上传完整 `apps/web/dist`；Chromium job 在相同 `headSha` checkout 下载到同一路径，不重新构建，然后调用 `pnpm harness:classic`。Classic receipt 必须包含同次 `runId`、source SHA、scenario/version、实际 Worker/Wasm/backend 和各阶段完成证据。

`classic-receipt.mjs` 在 runner 汇总处再次拒绝畸形回执：必须恰有一次成功且未重试的 attempt，source/lock/artifact/file map 与本次预检一致，固定 seed/generator/Playbook/scenario version 和 C0–C5 全部匹配。必须有实际 WebGL2 上下文、匹配产物的 Wasm、路线内任务与内核调用增量，以及同 trace 的 Worker 完成到 postrender 消费链。错误账本为空、采样模式和窗口身份相符后才能汇总 PASS；单个 `status: PASS` 不构成有效回执。

## 证据边界

Contract、Headless Integration 与 Classic Runtime Journey 是三种证据。Vitest 不能替代生产浏览器接线，Classic 也不重复所有规则排列；Harness receipt、HTTP 成功、输入 ack、计数增长或截图都不能单独替代正式 owner 的状态结果。具体适用场景、CI 跳过规则和 TDD 反例见 [CI 测试边界](ci-testing.md)。

## 局部与真实路径测量

`pnpm bench:local --owner stdlib-world` 通过机器性能窗口执行固定 mesh 工作负载，保存准备、计算、整体分段、bytes、原始样本、源码/锁文件/构建 bundle 摘要与环境。`--owner stdlib-server --scenario world-mutation` 和 `--owner stdlib-world --scenario chunk-codec` 为从默认测试退出的显式局部性能配置，使用独立 benchmark Vitest config；普通回归不跳过测试再声称完整通过。

`pnpm bench:runtime` 复用完整 C0–C5，只有窗口锁已取得时记录 `MEASURED`。普通 Classic 为 `NOT_MEASURED`；直接绕过窗口的诊断不具有性能准出含义。保存分阶段 frame、streaming、worker/Wasm、资源与存储原始观测，计数不等于性能收益。

窗口 wrapper 默认写独立 receipt，并向 child 传入 window ID、receipt 路径和 measurement declaration 路径。child 记录实际采样起止，结束后声明本次 local/Classic 文件；wrapper 在子进程退出和清理后读取测量、计算摘要并记录窗口终态。候选与接受都核对窗口成功退出、起止时间包围样本、run/owner/scenario/source/artifact 和测量摘要。`--run` 必须等于记录内 runId；只有环境 flag 或自报 `MEASURED` 的对象不能晋升。

Classic 的 frame 数值是各阶段边界的有界滚动窗口，并非互斥阶段的独立分位数；资源是阶段边界读数，并非连续峰值。当前未暴露的 input→authority、input→visible 和独立 save/load 延迟显式标 `UNAVAILABLE`。恢复前后 trace 标注各自 epoch，不能混成一条连续时间线。

`pnpm harness:baseline:candidate --run <measured-run-id>` 只创建不可覆盖的候选并输出摘要。`pnpm harness:baseline:accept --run <measured-run-id> --candidate-sha <digest> --reason <reason>` 单独校验候选与当前源码/产物身份后写入 accepted owner/scenario/runId 路径。运行测试/测量不会自动更新 accepted baseline；旧 `harness/baseline.json` 保留为 `NOT_COMPARABLE` 的历史边界，不混算新旧样本。
