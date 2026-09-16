# Delivery Snapshot

当前状态：**用户要求停止并推送；未完成最终验收**。批准 spec 的 SHA-256 保持 `c1d8ef071a3a48db32ee4750b7771df0dc934baada55567fb880da9e56f8041e`；用户追加目录要求见 [scope-amendment.md](scope-amendment.md)。最终源码、生产线路与远端 PR 身份将在准出后记录于本页。

## 交付范围

- 原 game-core 按责任拆为中性 Kernel、标准机制 stdlib 和显式 Classic Playbook；Web/Headless 经同一 Kernel owner 装配，移除默认玩法与继承式 GameServer facade。
- 注册分面、组件/模块 codec、provider、精确旧存档 admission、候选恢复和保存 frontier 均由明确 owner 负责。旧 ID、生成器结果和机制保留；未新增玩法、模型调用或渲染后端。
- ESLint 插件为独立 package，含独立规则测试与配置入口；根目录无测试。单元合同归各包/app，跨模块、工程、架构和唯一 Classic 全流程归 Web。
- Harness 按可信 base/head 与 owner 选择具体文件并核对实际执行报告；生产 source/lock/Pack/Wasm/artifact 身份、同次 C0–C5 回执和性能窗口分别校验。普通测试不写性能基线。

## 已取得证据与剩余工作

| 层级            | 当前真实结果                                                                                                                | 结论边界                                                         |
| --------------- | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| 冻结旧基线      | S0 world/station/真实认知配对 checkpoint 已保留                                                                             | 不是旧 CI 全绿声明                                               |
| 迁移断言        | 422 个确定性文件路径、源码摘要、标题和直接断言账本                                                                          | 机器计数不替代逐项语义复核                                       |
| 完整 static     | run `2026-09-11t15-18-56-226z-dee595cc`，444 files / 2295 tests PASS                                                        | 包含最后pause/provider/queued Block改动；world行覆盖率96.98%     |
| 工程与插件      | Web engineering/architecture 22 files / 107 tests；ESLint独立11 files / 66 tests PASS                                       | 不证明浏览器行为                                                 |
| 定向修复        | pause/debt真实2 RED→GREEN，加旧session/clock共13PASS；provider lease/quota及Authority定向通过                               | 旧公式真实RED：196 > 144；恢复后容量来源5/5 GREEN                |
| 独立审阅        | 固定tree定向审阅，owner/alias/save/event/lifetime/provider已闭合；最后queued Block P1已由真实RED/GREEN及主owner增量复核闭合 | 未逐行覆盖全部迁移，不表示可合并；见code-review                  |
| build / Classic | 697c7ae生产build PASS；runtime `2026-09-11t15-38-01-978z-d51aa333` C0–C3 PASS、C4活动失败、C5未跑                           | NPC存活但不自主移动，正采集只读Logic诊断；完整C0–C5待通过        |
| 性能            | local mesh 10样本已测量并生成候选；runtime窗口失败                                                                          | local候选未接受；runtime无候选；旧混合基线不可比，无性能提升声明 |
| Git / PR        | 本地合同c8ce4a4、实施697c7ae已提交；尚未推送                                                                                | 完整验收后创建PR交人类审阅，不自动合并                           |

失败和阶段日志保留在 `harness/results/`，中间日志清单为 `refactor-closure-evidence/manifest.json`；最终 run id 与 digest 将独立记录，不用重试结果覆盖早期失败。

## 当前保护与显式缺口

[断言迁移说明](assertion-migration.md)和 [Classic 覆盖表](classic-evidence-coverage.md)区分实际迁入与 `GAP_NOT_EQUIVALENT`、`LOWER_WITH_BROWSER_GAP`、`INTEGRATE_PARTIAL`。无 JS 首绘/hydration、专属视觉与工坊操作、长时间 soak、真实模型和外部网络等未被本次唯一线路完整覆盖，不能计为等价保护。性能 telemetry 未提供的端到端 input/save/load 延迟保持 `UNAVAILABLE`；滚动窗口数据不冒充独立阶段分位数或资源峰值。

## 长期 docs baseline

已更新代码地图、目录规范、可组合玩法架构、CI 测试边界、Harness 合同、性能执行窗口及 Evidence Skill，原因是 owner、公开入口、测试归属和证据身份发生变化。批准稿和旧原始 checkpoint 字节保持不变；没有把清晰源码逐段复制到长期上下文。工作量与费用边界见 [estimates.md](estimates.md)，任务独占费用和 API 等价成本未获可信归因，保持 UNKNOWN。

## 停止交接

用户因额度要求立即停止并push，后续不自动继续。无临时日志的Classic run `2026-09-11t16-04-41-114z-e0862a3f` C4失败；有临时有界日志的run `2026-09-11t16-11-42-168z-646faf04` C0–C5 PASS。日志代码已撤掉，未再验证最终源码，因此将NPC活动问题保持为未闭合，不能宣布稳定通过。停止时只读诊断与文档补充另行提交，PR以Draft交接；本地最新dist已过期，须重新build。

## 2026-09-16 阶段合同与拆分交接

本节覆盖上文当时的实施口径；原记录保留为历史证据，不代表当前门禁。用户批准的 [阶段验收修订](phase-gate-amendment.md) 要求 #33 完成 Kernel／stdlib／Classic 的完整生产架构分层，但只运行 Kernel 与 stdlib 确定性行为测试。Classic 内容行为、Web/Agent 集成、唯一浏览器线路、性能和原 Harness 运行证据转入新的 Draft PR 暂存；原始文件可从 `77857ca98fa1ec5e2618dea9cea815ada29e2b56` 找回。现有 Web/Agent 旧测试的包归属迁移仍留在 #33，但不执行、不计作本期行为 PASS。

在拆分后的本地工作树执行：`pnpm verify:static:ci` 为 exit 0，含格式、路径、Lint、Kernel／stdlib／Classic／ESLint／Web／Agent 生产类型、Kernel/stdlib 测试类型和 ESLint 插件 11 文件／66 条静态规则测试；`pnpm test:deterministic:ci` 为 exit 0，Kernel 4 文件／28 条、stdlib 82 文件／530 条。静态包方向另核对 `Kernel → 无仓内游戏包`、`stdlib → Kernel`、`Classic → stdlib`，活跃源码中未发现 `@seedlands/game-core` 或反向引用。上述结果只针对最终提交前的当前源码树；PR 推送后须读回远端 SHA，不能把它们外推为 Classic 产品可玩或全部测试通过。

未执行：Classic、Web/Agent 玩法行为、跨层集成、生产 build、Chromium、视觉、性能、真实模型/PG。主分支保护仍要求 `Production build` 与 `Chromium regression`，本次 CI 有意不运行也不造空绿，因此 #33 即使静态检查通过仍为 Draft/BLOCKED。没有改 ruleset、权限或部署；需要人类决定后续门禁迁移。长期 docs baseline 已更新代码地图、目录规范、CI 测试边界、Harness 延期说明和 Evidence Skill，原因是当前可执行入口及证据责任发生变化，未重写原 spec 或旧运行结论。
