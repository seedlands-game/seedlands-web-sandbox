# Classic b1.7.3 开工审核单

结论：**全范围清单和验收环境已有可审查的 v15 候选快照，但不能批准玩法开工（`NO-GO`）**。这不是“只做了一个小切面”：固定总账覆盖 97 方块、106 非方块物品、30 实体/派生态、150 工作台配方、10 熔炼配方、129 机制子项，共 522 父项；618 个有限变体单列；另有 8 个开放状态族。38 个排除父项另有依赖闭包候选。所有 522 个父项都有局部、项目或排除范围 expected 候选，但**没有任何一项已经取得完整来源审查、固定夹具和 owner 签署**。不得把候选清单当作 b1.7.3 原版真值或 Classic 产品验收通过。

另外运行 `node changes/2026-09-16-classic-beta173-parity/verify-recipe-fixture-candidates.mjs` 检查 150 条工作台和 10 条熔炼候选的表内冲突，运行 `node changes/2026-09-16-classic-beta173-parity/verify-exclusion-dependency-candidates.mjs` 检查 38 条排除依赖候选的内部闭包；它们只证明候选表内部不矛盾，不证明原版行为或人审通过。

从这里读：

1. [范围与边界](spec.md)：单人 Survival；排除红石电路、多维度、联机；原创音画维持时代风格/体验。音符盒手动、TNT 普通点火、唱片机、主世界雷击猪变僵尸猪人保留；发射器/红石火把/动力与探测轨整体排除；黑曜石框架点火不生成传送门是明示偏离，须由用户在整份合同审核时确认。
2. [逐项父案](reference-cases.json)、[有限变体与开放状态族](variant-cases.json)：每项有 ID、范围、候选 expected、来源级别、未定项和审核/夹具状态。[排除依赖 38 项](exclusion-dependency-audit.md)与[67 条玩法机制源码复核](mechanism-play-source-review.md)单列；方块、物品、实体、配方、世界/其他机制的补充候选见 [合同审核](contract-audit.md) 所列附件。这些附件只改善追踪深度，不重复计入分母。
3. [固定 Harness 与产品验收](harness-acceptance.md)：CI/浏览器/seed/tick/产物身份、P0–P5 旅程、Headless/Browser/人工/性能各自证据。该 Harness 当前是设计合同，尚无可执行 Classic 产品 job，也没有运行原版。
4. [工作量与预算](estimates.md)：未来完整实现的保守估算 1114.05 PD；含 20% 管理缓冲为 1337 PD。逐物品分摊和其他内容/共用机制不能双计；这不是施工授权或交付日期承诺。
5. [分层门禁](boundary-ledger.md)：本期 Kernel 零改动；需要 Kernel 变更先出 ERROR 缺陷/方案报告并单独审批。stdlib 扩展记 WARNING，Playbook 定义/组装记 NORMAL，Web/原创资产/工程另列。

当前的硬阻断不是“清单还没编号”，而是：

- [来源链](reference-provenance-audit.md)：Mojang 元数据只固定官方客户端身份；固定重构 Java 与官方客户端逐方法等价未证。独立技术资料也不能直接代替该证明。若用户接受“重构源码 + 社区资料”作为有误差风险的代理对照，须明确签署；否则无法把这些候选升为原版黄金 expected。**本任务不运行、下载或复用原版程序与资产**。
- 1140 个逐行案例的 reviewer 均为 `PENDING`，夹具均为 `NOT_FIXED`，执行均为 `NOT_RUN`；8 个开放状态族的分区/负例也尚未审定。逐项来源、具体初态、RNG/tick、owner-state expected、负控和保存/音画层须补齐；不能以统一模板伪造逐案完成。
- 原创视觉/音频体验的合法参照、评审者与资产供应，以及独占性能设备/驱动/阈值尚未确定。它们不阻止继续写行为合同，但阻止宣称整份体验合同已可冻结或最终 1:1 验收。
- [全合同六项审核门](harness-profile.json)（范围偏离、原版对照、逐案预期与夹具、Harness 设计、原创音画对照、性能环境阈值）均为 `PENDING`，profile 的参考状态仍为 `PARTIAL_REFERENCE_GAP`；严格预检会逐项拒绝未批准的门，不能只把案例状态改成 `REFERENCE_READY` 就声称可开工。

审核命令：`node changes/2026-09-16-classic-beta173-parity/verify-preflight.mjs` 检查全量编号、候选附件与 JSON 来源 URL 是否钉版；加 `--require-ready` 则在上述阻断未关闭时必须失败。`node changes/2026-09-16-classic-beta173-parity/audit-source-anchors.mjs` 只读检查固定重构源码行锚点是否存在，**不检查断言语义或官方等价**。v14 撤回了 M15-01 由未固定 Fandom 链接支撑的“无饥饿值”断言，保留为待独立确认的验收目标；v15 为 160 条配方/熔炼登记源码候选定位，但逐条语义审核仍未完成。[候选快照](contract-snapshot.json)记录所有本目录合同文件的 SHA-256，可用 `node changes/2026-09-16-classic-beta173-parity/build-contract-snapshot.mjs --check` 检查漂移。**快照 hash 只锁文件，不授予实施许可。** 当前这些离线检查跑在 macOS/Node 24，不是尚未建立的 Ubuntu/Node 22 Classic BrowserProductHarness。完整版本裁决及下一门见 [contract-audit.md](contract-audit.md)。
