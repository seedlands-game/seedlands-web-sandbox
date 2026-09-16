# Change — 并行架构门禁与确定性测试影响传播

> 状态：Agile / 本地验证通过、待远端读回；目标 PR：#33。此补充不修改原 Breaking spec、阶段验收修订或分支保护规则。

## 目标与范围

在 #33 已冻结的验收范围内缩短 CI 等待：始终执行的架构静态检查与按影响选择的 Kernel／stdlib 确定性行为测试分别占用独立 runner，同时让现有 required check `Static verification` 仅在两个前置 job 均真实成功后通过。生产构建、Classic、Web/Agent 行为、浏览器及性能验收仍不执行，也不制造同名空绿检查。

stdlib 直接依赖 Kernel；测试**可并发执行**不代表影响选择互不相关。PR 仅改 Kernel 时必须同时跑 Kernel 和 stdlib，PR 仅改 stdlib 时只跑 stdlib；共享 CI／工具配置、未知源码路径和 main push 跑两包。明确无相关行为 owner 的 PR 可以不跑两包行为测试，但架构静态检查不能跳过。Git diff、选择器或任一前置 job 失败、跳过或取消时汇总门禁失败闭合。

## 可验证行为与实施前测试设计

| 条件                                                                   | 预期                                       | 实施前 RED / 验证方式                                                                              |
| ---------------------------------------------------------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| PR 只改 `packages/kernel/`                                             | Kernel 和 stdlib 均选中                    | 现有 `.github/workflows/ci.yml` 仅分别匹配路径，Kernel 单改不会选 stdlib；先添加选择器测试取得 RED |
| PR 只改 `packages/stdlib/`                                             | 只选 stdlib                                | 选择器单测                                                                                         |
| PR 改根配置、CI、ESLint 插件或未知源码路径；main push；空或不可靠 diff | 两包均选中，或输入错误时显式失败；不能漏跑 | 选择器正反例、NUL 路径输入与失败输入测试                                                           |
| PR 仅改无关文档／宿主                                                  | 不运行两包行为测试，静态检查照常执行       | 选择器单测和工作流结构检查                                                                         |
| 静态或确定性 job 任一非 success                                        | `Static verification` 非 success           | 汇总条件四种状态的反例；检查 job `needs` 和 `always()`                                             |
| 两个前置 job 均 success                                                | `Static verification` success              | 本地结构检查与最终 SHA 的远端 check 读回                                                           |

实施前 RED：用 Kernel-only 路径执行现有条件得到 `kernel=true, stdlib=false`、exit 1；读取旧工作流 job 图发现只有单个串行 static job、无双路汇总，exit 1。新增未知源码路径反例在候选选择器上得到 7/8、exit 1。实现后运行选择器单测、格式、Lint、类型、ESLint 静态规则与两包确定性测试。最后读回 PR 的精确 head SHA 与当前 gate 状态；远端 job 结果属于后续 CI 跟进，不以本地模拟代替。旧版 run 仅作诊断基线，不当作同一 SHA 的严格 A/B。

## CI 效率实验边界

2026-09-16 旧串行方案 `57577b1` 的 [hosted run](https://github.com/seedlands-game/seedlands-web-sandbox/actions/runs/35072606954) 为 208 秒，其中架构静态约 90 秒、确定性行为约 90 秒。候选 B 为两个 runner 并行加真实汇总；主指标是同一 SHA 的 required-check 完成等待时间，次指标为所有 job 的 runner 秒数与失败／跳过状态。投产前应以同一源码、同 runner 规格做 A/A 噪声检查和交错 A/B；若没有这些样本，只报告 B 的真实耗时及与历史 run 的非等价诊断对照，不声明确定提速。测试集合或汇总状态有任何缩减／假绿则否决 B；节省小于 20% 且 runner 占用增加超过 25% 时优先保留简单串行方案。

## 任务与交付状态

- [x] 选择器与汇总条件取得可执行 RED。
- [x] 并行 job、Kernel→stdlib 传播及失败闭合实现。
- [x] 本地确定性验证、工作流结构检查与文档同步。
- [ ] 提交、推送并读回 PR #33 的新 SHA 与 gate 快照；不自动合并或修改 ruleset。

Delivery Snapshot：最终候选源码的本地 `pnpm verify:static:ci` exit 0（ESLint 11 文件／66 条及 CI 选择器 8 条）；`pnpm test:deterministic:ci` exit 0（Kernel 4 文件／28 条、stdlib 82 文件／530 条）；`pnpm build` exit 0。工作流结构检查确认两个前置 job 无依赖且并行、汇总 `needs` 两者并始终执行；汇总条件 16 组状态中仅 success/success 通过。远端新 SHA 运行时长、A/A、交错 A/B 均未取得，不声明提速。长期 docs baseline 已更新 `docs/ci-testing.md` 的本阶段调度与传播规则，原因是 CI 选择和门禁拓扑改变；原延期 Harness 设计不变。
