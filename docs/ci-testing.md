# CI 测试边界与核心保障

CI 绿色表示当前 `headSha` 在已声明环境中通过被计划选中的断言，不能证明没有缺陷。运行入口以根 `package.json` 为准；GitHub required check 名保持 `Static verification`、`Production build`、`Chromium regression`。本 change 不修改 ruleset、权限或分支保护。

Harness 的 owner、计划、执行回执和生产产物字段见 [Harness 合同](harness-contracts.md)。

## 三个 required check

| Check               | 实际责任                                                                                            | 不能由此推导                                                          |
| ------------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Static verification | 校验计划身份，执行格式、路径、Lint、类型和受影响 owner 的 Vitest 合同；非文档变更同时检查生成起始页 | 未选中的 owner 已在当前 SHA 重跑；浏览器或产品行为正确                |
| Production build    | 对 `productionBuild: true` 的计划执行一次 `pnpm build`，生成带身份回执的 `apps/web/dist`            | 产物已在浏览器运行；部署或外部服务可用                                |
| Chromium regression | 下载 build job 的同一份 `dist`，由 `pnpm harness:classic` 校验身份并运行唯一 Classic 生产旅程       | 其他浏览器、实体 GPU、音频主观体验、WAN、真实模型或所有玩法排列均通过 |

`documentationOnly: true` 可明确跳过 Production build 和 Chromium 的运行步骤，但三个 required check 仍产生可读结果。scope 失败、计划无效、产物缺失或上游 job 失败必须让对应 check 失败，不能借 job-level skip 变绿。

## Base / Head 影响计划

PR 固定 GitHub base SHA 为 `baseSha`、实际 checkout 的 PR head SHA 为 `headSha`。若 base tree 已有 `scripts/harness/plan.mjs`，CI 从 base commit 解出完整 `scripts/harness/` 到临时目录，连接当前安装依赖后运行该可信 planner；planner 同时读取 base/head 的 registry、文件与依赖图。候选分支不能仅靠修改自己的 selector 或 registry 降低验证范围。

scope 与 static job 都获取完整 Git 历史：static runner 会独立重建 base/head 的必要集合并拒绝缩减计划；仅下载计划而浅检出 head 无法完成这次复核。

若 base 尚无 selector，这是一次明确的 `missing-base-selector` bootstrap：CI 使用 head planner 的 `--all`，并硬校验结果为 `full-new`、需要生产构建和 Classic、且至少选中一个实际合同。main push 始终使用 `--all` 生成 `full-new`；仍保留实际 before/head 和诊断，缺失可靠 before 不会降级为空计划。

普通 PR 使用 `affected` 模式。计划同时考虑两侧 owner、删除、移动、type-only/barrel 消费、声明的动态 capability、构建配置和反向消费者闭包。以下情况进入 `full-new`：

- selector、runner、registry、包边界、根构建、锁文件、CI、AGENTS、Evidence Skill 或 Harness 合同变化；
- 缺失/无效 base 或 head registry、未知路径、无可靠 diff、未解析依赖；
- 显式 `--all`。

`full-new` 表示完整的当前有效合同基线，不重新执行 `changes/*/e2e` 历史矩阵。缺 owner、选中 pattern 无匹配、base 必需测试在 head 消失、计划身份不等于 checkout，或非文档计划得到 `No effective tests selected` 时必须 BLOCKED。

## 测试 owner 与执行位置

| Owner                         | 独立入口                                  | 责任                                                                                          |
| ----------------------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------- |
| `@seedlands/kernel`           | `packages/kernel/vitest.config.ts`        | 无默认玩法的状态、注册、事务、执行与恢复合同                                                  |
| `@seedlands/stdlib`           | `packages/stdlib/vitest.config.ts`        | world、physics、runtime、compute、server 与标准模块合同；world 行覆盖率映射到迁移后的真实目录 |
| `@seedlands/playbook-classic` | `playbooks/classic/vitest.config.ts`      | 内容身份、Pack 装配和 Classic 选择，不启动第二个浏览器                                        |
| `@seedlands/eslint-plugin`    | `packages/eslint-plugin/vitest.config.ts` | 包方向、公开 exports、纯逻辑、UI/Authority 目录等静态反例；不依赖根 ESLint/Vitest 配置        |
| Web / Agent / integration     | 各 app 的 `vitest.config.ts`              | 客户端、宿主、协议和跨 owner 的非浏览器集成                                                   |

Runner 按计划中的 concrete test files 分组到所属 package config，拒绝跨根路径、空匹配、todo、pending 和未实际执行的 selected file。测试应位于 owner 包或明确 integration owner；`changes/` 保存需求合同与证据，不再是活跃测试运行目录。

Web 的 engineering/architecture 合同会启动独立的编译器或全源 Lint，因此与运行时测试分进程顺序执行，避免把子进程负载叠在功能用例的固定超时上。运行时组保持 world coverage；工程组仍用 Web 配置，ESLint 组仍走独立插件包。本地每组最多 2 个 Vitest worker，CI 最多 1 个；此分组不缩减计划选中的文件，也不放宽测试超时。

## 唯一 Classic 线路

全仓长期维护一个 Playwright spec：`apps/web/tests/e2e/classic-runtime.spec.ts`。`playwright.config.ts` 只匹配该文件；根 package scripts、CI 和 Evidence Skill 不直接列历史 spec，也不增加第二个 `playwright test` 调用。唯一启动实现使用生产 `dist` 的 preview、严格端口、一个 browser context 与版本化 Classic scenario。

build job 只执行一次 `pnpm build`。`apps/web/dist/harness-artifact.json` 记录 source、lock 与每个产物文件的摘要；Chromium job 下载该 artifact 到相同路径，`pnpm harness:classic` 在启动前后调用 `verifyArtifact`。重新构建、缺 receipt、source/lock 不一致或任一字节变化都失败。

真实操作通过 Playwright 输入进入产品；Harness 只观察正式完成边界，不能代挖掘、代移动、途中补给或直接修状态。输入 ack、全局计数增加、HTTP 200 或单张截图不能独立证明目标动作完成。保存恢复、Worker/Wasm/backend、资源加载与 stale epoch 必须对齐本次 run id、source SHA 和目标操作状态。

## TDD 与证据边界

新增功能先在实际 owner 的最低充分边界取得可执行 RED，再让生产路径 GREEN。纯规则、非法输入、旧 epoch/sequence、取消与资源释放优先固定 seed/clock 的 Vitest；输入、Worker、IndexedDB、Pointer Lock、WebGL2 和生产资源接线进入 Classic。真实模型、PG、WAN、实体 GPU、移动端手势和音频主观体验是显式 opt-in 或专用环境证据。

关键回归要有能触发故障的反例。删除校验、重放旧消息、丢弃保存、调用错误 Worker、删除 selected test 或增加第二条 Playwright 线路时，至少一项门禁应失败。覆盖率数字不替代这些反例；子集覆盖率不得标作全仓覆盖。

浏览器重试一次只用于取得 trace，`failOnFlakyTests` 使重试通过仍然失败。超时是资源上限，不是性能阈值。FPS、CPU/GPU/RSS 或“更快”结论必须进入独占性能窗口，以 A/A 和交错 A/B 取证；hosted runner 时长只能用于诊断。

## 失败与证据保留

- scope、static、build、Chromium 各自保留精确失败；下游不得在上游失败时以 skipped 冒充成功。
- Harness 结果写入 `harness/results/<runId>/result.json`，记录 stage、plan、steps、artifact 与 Classic receipt；失败步骤同样保留。
- CI 上传计划、生产 `dist` 和浏览器/Harness 报告。计划与产物均绑定 `headSha`，浏览器只消费 build job 上传的字节。
- skipped、todo、pending、flaky 或外部依赖不可用不能计作 PASS。环境/身份/数据缺口标注 BLOCKED，并保留下一项可执行诊断。
