# Delivery Snapshot

当前状态：**Implementing**。批准 spec 的 SHA-256 保持 `c1d8ef071a3a48db32ee4750b7771df0dc934baada55567fb880da9e56f8041e`；用户追加目录要求见 [scope-amendment.md](scope-amendment.md)。最终源码、生产线路与远端 PR 身份将在准出后记录于本页。

## 交付范围

- 原 game-core 按责任拆为中性 Kernel、标准机制 stdlib 和显式 Classic Playbook；Web/Headless 经同一 Kernel owner 装配，移除默认玩法与继承式 GameServer facade。
- 注册分面、组件/模块 codec、provider、精确旧存档 admission、候选恢复和保存 frontier 均由明确 owner 负责。旧 ID、生成器结果和机制保留；未新增玩法、模型调用或渲染后端。
- ESLint 插件为独立 package，含独立规则测试与配置入口；根目录无测试。单元合同归各包/app，跨模块、工程、架构和唯一 Classic 全流程归 Web。
- Harness 按可信 base/head 与 owner 选择具体文件并核对实际执行报告；生产 source/lock/Pack/Wasm/artifact 身份、同次 C0–C5 回执和性能窗口分别校验。普通测试不写性能基线。

## 已取得证据与剩余工作

| 层级            | 当前真实结果                                                                                                                | 结论边界                                                     |
| --------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| 冻结旧基线      | S0 world/station/真实认知配对 checkpoint 已保留                                                                             | 不是旧 CI 全绿声明                                           |
| 迁移断言        | 422 个确定性文件路径、源码摘要、标题和直接断言账本                                                                          | 机器计数不替代逐项语义复核                                   |
| 完整 static     | run `2026-09-11t15-18-56-226z-dee595cc`，444 files / 2295 tests PASS                                                        | 包含最后pause/provider/queued Block改动；world行覆盖率96.98% |
| 工程与插件      | Web engineering/architecture 22 files / 107 tests；ESLint独立11 files / 66 tests PASS                                       | 不证明浏览器行为                                             |
| 定向修复        | pause/debt真实2 RED→GREEN，加旧session/clock共13PASS；provider lease/quota及Authority定向通过                               | 旧公式真实RED：196 > 144；恢复后容量来源5/5 GREEN            |
| 独立审阅        | 固定tree定向审阅，owner/alias/save/event/lifetime/provider已闭合；最后queued Block P1已由真实RED/GREEN及主owner增量复核闭合 | 未逐行覆盖全部迁移，不表示可合并；见code-review              |
| build / Classic | 最新生产build PASS；Classic `2026-09-11t15-01-42-528z-5a574ade` C0–C3 PASS、C4 NPC死亡、C5未跑                              | fixture已移开拆台误伤范围，新build与完整C0–C5待执行          |
| 性能            | 窗口/候选/接受正反例通过                                                                                                    | 真实local/runtime样本和候选尚未运行；无性能提升声明          |
| Git / PR        | 功能分支已建立，尚未提交或推送                                                                                              | 验收后交给人类审阅，不自动合并                               |

失败和阶段日志保留在 `harness/results/`，中间日志清单为 `refactor-closure-evidence/manifest.json`；最终 run id 与 digest 将独立记录，不用重试结果覆盖早期失败。

## 当前保护与显式缺口

[断言迁移说明](assertion-migration.md)和 [Classic 覆盖表](classic-evidence-coverage.md)区分实际迁入与 `GAP_NOT_EQUIVALENT`、`LOWER_WITH_BROWSER_GAP`、`INTEGRATE_PARTIAL`。无 JS 首绘/hydration、专属视觉与工坊操作、长时间 soak、真实模型和外部网络等未被本次唯一线路完整覆盖，不能计为等价保护。性能 telemetry 未提供的端到端 input/save/load 延迟保持 `UNAVAILABLE`；滚动窗口数据不冒充独立阶段分位数或资源峰值。

## 长期 docs baseline

已更新代码地图、目录规范、可组合玩法架构、CI 测试边界、Harness 合同、性能执行窗口及 Evidence Skill，原因是 owner、公开入口、测试归属和证据身份发生变化。批准稿和旧原始 checkpoint 字节保持不变；没有把清晰源码逐段复制到长期上下文。工作量与费用边界见 [estimates.md](estimates.md)，任务独占费用和 API 等价成本未获可信归因，保持 UNKNOWN。
