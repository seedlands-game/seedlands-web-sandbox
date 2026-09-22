# 旧 94% 与剩余 6% 核销

## 结论

旧 Seed Reporter 的 93–94% 不是由 `coverage.json` 计算得到的可复核值，而是按当时阶段和提交进行的人工作量估算。它在后续 Stage 1–3 已交付后仍沿用相同文案，因此长期无法到 100%。

当前旧账的真实快照：522 个父项；`IMPLEMENTED=31`、`PARTIAL_IMPLEMENTED=439`、`NOT_AUDITED=52`；`HEADLESS_AND_BROWSER_PASS=31`、`HEADLESS_PASS=436`、`NOT_RUN=55`。其中 52 个 NOT_AUDITED 全部属于明确 `scope=存/排` 的保留或排除内容，不是当前范围缺失；55 个 NOT_RUN 也主要包含这些排除项，当前范围内真正未运行的是 M35-01/02/03 性能 A/A/A/B。

因此旧“剩余 6%”由三种不同性质的债务混在一起：

1. **账务未核销**：后续 worldgen v11、十六色羊毛、完整块光、视觉/生物与 C0–C5 已有新 change 证据，但旧 coverage 没有重算 implementation/reference 字段。
2. **有意保留的差异**：大量 PARTIAL 表示不宣称 Java Beta 的每个 variant、精确事件轨迹、主观盲测或所有浏览器动态表现；它们不能被自动“改成 IMPLEMENTED”来凑百分比。
3. **真实未完成证据**：M35-01/02/03 的性能 A/A/A/B，以及远端最新 HEAD 的 CI/PR gate；这些必须单独完成或明确不作性能声明。

## 新 100% 口径

不再从 522 项的原版等价度推导工程完成百分比。`scripts/classic-progress-ledger.mjs` 只读取当前 change 的冻结任务与证据，按权重计算：

- Reporter/reconciliation 1
- voxel semantics 2
- actor archetypes 1
- presentation manifest 2
- second Playbook 2
- exact-head browser 1
- CI / PR / review 1

全部为 COMPLETE 才输出 100%。Classic 原版精确等价度继续作为差异账，不冒充工程交付状态；排除范围不进入未完成分母。

## Reporter 修正

后续定时汇报必须运行 `node scripts/classic-progress-ledger.mjs` 并引用输出，不再自行估算 93–94%。需要汇报 Classic 原版等价度时，单独展示 coverage 的 IMPLEMENTED/PARTIAL/NOT_AUDITED 和 execution 分布，不与当前 change 完成度混算。
