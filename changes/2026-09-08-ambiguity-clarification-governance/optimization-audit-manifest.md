# 优化实验历史审计 manifest

## 可复核基线

- 主线工作树基线：`4aefa4729583113bbfde646efd043e152b1be05f`。
- 索引日期：2026-09-08。
- 对象：基线中 75 个 `changes/*` 目录，另加未合入主线的 `origin/codex/node-dedicated-server@814413567b0754f20340aa216b219fff8cfeb294`。
- 索引方法：对每个 change 读取目录名、spec 的目标/范围/决策/验收和性能、资源、延迟、稳定性、选型、A/B、benchmark 关键词命中；命中且把优化或技术选择作为采纳依据的进入全文/结果深读。

分类不代表质量排名：`I` 是深读的优化/选型证据；`V` 是与测量、回归或运行稳定性相关，但主要验收是正确性或治理合同；`X` 是功能/视觉/正确性为主，不以优化声明采纳。

## I：深读的 15 个 change，12 条证据链

| 证据链                        | Change                                                                                                                                                             | 主要回收内容                                                  |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| 客户端延迟定位到 Worker-first | `2026-09-04-client-performance-observability`<br>`2026-09-04-worker-mesh-timing`<br>`2026-09-04-halo-snapshot-hot-path`<br>`2026-09-04-cooperative-chunk-snapshot` | 分段观测定位短板，候选独立 A/B 决定采纳                       |
| 世界修改事务                  | `2026-09-04-world-mutation-transaction`                                                                                                                            | pre-change 基线、同进程交错 A/B、结构计数与计时分工           |
| MVP 包体基线                  | `2026-09-05-mvp-bundle-baseline`                                                                                                                                   | 功能集合变化时保留旧基线身份，不隐藏增量                      |
| 体素渲染候选                  | `2026-09-05-voxel-rendering-pipeline-experiments`                                                                                                                  | 分项 A/A、A→B→A→B、主指标/否决项、`NOT_RUN` 与 `ABANDONED`    |
| 数据平面 SIMD                 | `2026-09-06-data-plane-simd-policy`                                                                                                                                | 相同算法/布局下分 micro、component 和任务层，拒绝内核倍率外推 |
| Wasm 工作量筛选               | `2026-09-06-moonbit-wasm-workload-experiment`                                                                                                                      | profile 排序、独立替换单元和完整 ROI 停止线                   |
| 太阳采样器复核                | `2026-09-06-stable-sun-and-break-drop`                                                                                                                             | 污染指标作废、负控制、重采而非离线回算                        |
| 独立循环与计算池选型          | `2026-09-06-independent-loops-unified-physics`                                                                                                                     | 分离权威循环与派生计算，池容量按同机 A/A、A/B 决策            |
| 数据平面采纳                  | `2026-09-07-data-plane-adoption`                                                                                                                                   | A/A′/B 拆分结构与语言贡献，组合回归后撤项                     |
| 默认客户端组合                | `2026-09-07-experimental-client-options`                                                                                                                           | 分项通过不代表默认组合有用户级收益                            |
| 首屏加载                      | `2026-09-07-loading-performance`                                                                                                                                   | 未取得 LCP/Navigation Timing 时不声称已验证性能               |
| CI 资源门禁                   | `2026-09-07-stabilize-ci-resource-gates`                                                                                                                           | 区分资源争用与业务失败，不靠弱化断言或盲重试变绿              |

## V：相邻的测量、回归与治理 change

以下 16 个 change 用于检查优化证据不得破坏的验收语义；它们本身不是因量化优化而采纳，因此未冒充分项性能 A/B：

```text
2026-09-03-e2e-test-layering
2026-09-03-harness-foundation
2026-09-03-input-physics-stability
2026-09-03-sync-main-quality-e2e
2026-09-04-sdd-testing-governance
2026-09-04-server-command-headless-harness
2026-09-04-stabilize-ci-regression
2026-09-05-harness-module-resolution
2026-09-06-browser-observation-stability
2026-09-06-ci-integration-workload
2026-09-06-context-engineering
2026-09-06-pr-handoff
2026-09-06-review-boundary-gaps
2026-09-07-agent-routing-contracts
2026-09-07-compute-worker-recovery
2026-09-08-async-monitor-routing
```

## X：功能、视觉或正确性为主的 change

以下 43 个 change 在基线索引中已检查，但它们的采纳依据是新能力、正确性、可视行为、组件边界或开源交付，而不是量化优化或技术优势：

```text
2026-09-03-foundation-hardening
2026-09-03-macro-worldgen
2026-09-04-app-module-boundaries
2026-09-04-center-of-mass-grounding
2026-09-04-chunk-persistence-storage
2026-09-04-client-server-foundation
2026-09-04-open-source-foundation
2026-09-04-player-ground-collision
2026-09-04-player-ground-collision-rebase
2026-09-04-player-support-stability
2026-09-04-step-down-depenetration
2026-09-04-step-down-stall-recovery
2026-09-04-survival-gameplay-entity-foundation
2026-09-04-visual-upgrade
2026-09-05-advanced-lighting-water
2026-09-05-background-world-pause
2026-09-05-browser-build-height
2026-09-05-creature-npc-algorithmic-foundation
2026-09-05-death-input-recovery
2026-09-05-desktop-xr-lifecycle
2026-09-05-entity-hit-volume
2026-09-05-entity-presentation-polish
2026-09-05-first-journey-guide
2026-09-05-first-person-lantern-mining-shadow-repair
2026-09-05-fluid-experience-repair
2026-09-05-game-shell
2026-09-05-mvp-experience-repair
2026-09-05-playable-world-mvp
2026-09-05-player-action-presentation
2026-09-05-pointer-release-ownership
2026-09-05-presentation-language
2026-09-05-retained-ui-bridge-foundation
2026-09-05-safe-world-entry
2026-09-05-stable-break-overlay-texture
2026-09-05-survival-presentation-integration
2026-09-05-water-depth-order
2026-09-05-world-audio
2026-09-06-long-term-alignment
2026-09-06-repository-codemap
2026-09-06-world-locked-water-reflection
2026-09-07-playbook-roadmap-docs
2026-09-07-prerendered-start-screen
2026-09-07-remove-moonbit-toolchain
```

## 当前 change

`2026-09-08-ambiguity-clarification-governance` 是本次治理修订本身，计入 75 个目录的完整性校验，但不作为历史经验样本。数量校验为 `15 + 16 + 43 + 1 = 75`。

## 主线外参考

Node 独立服务端分支只作方法参考，不混入 75 个主线 change 计数。当时读取身份为 `814413567b0754f20340aa216b219fff8cfeb294`；其中 WSS/JSON 是 reference，codec 争用样本已作废，N2–N4 与产品 A/B 未完成，因此不作最终技术采纳依据。
