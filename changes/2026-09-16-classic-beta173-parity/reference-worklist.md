# Classic b1.7.3 逐项补证队列（v16）

本表从 [522 行父总账](reference-cases.json)确定性生成：没有绑定 expected 的 0 项（其中项目合同空白 0 项）；另列 19 项**已写候选、仍待审核**的项目治理/性能/原创体验合同。其余 353 项仍仅有局部原版事实、150 项仍是待复核配方候选；[618 变体与 8 开放状态族](variant-cases.json)另行审核。所有 1140 行均没有完整固定夹具。来源位置只供审查，不是已经证实的预期值。

处理每行时：静态核对固定版本的具体方法和边界 → 明确初态、RNG、tick 输入、逐字段期望和反例 → 记录可定位出处/来源等级与冲突裁决 → owner 审查；没有独立证据就继续保留缺口。视觉/音频需合法的同期画面/录音参照和用户指定评审者，不复制原版资产进产品。

| ID | 待锁定的行为 | 首选查证位置 | 最低交付 |
| --- | --- | --- | --- |
| M01-02 | 以固定 seed/初态/输入验证：固定 Seedlands Harness 环境、场景/输入/状态证据合同；记录正例、失败例、tick 和 owner 状态。 | harness-acceptance.md | 审核项目 expected 与定向负例，固定夹具/设备或人工签署；仍非原版玩法 oracle |
| M01-03 | 以固定 seed/初态/输入验证：方块/物品/实体元数据、掉落、配方、可获得性总账；记录正例、失败例、tick 和 owner 状态。 | harness-acceptance.md | 审核项目 expected 与定向负例，固定夹具/设备或人工签署；仍非原版玩法 oracle |
| M01-04 | 以固定 seed/初态/输入验证：例外、版权隔离、reference case 版本化；记录正例、失败例、tick 和 owner 状态。 | spec.md | 审核项目 expected 与定向负例，固定夹具/设备或人工签署；仍非原版玩法 oracle |
| M24-04 | 以固定 seed/初态/输入验证：物品 atlas、动画/透明/高 DPI 管线与 QA；记录正例、失败例、tick 和 owner 状态。 | experience-reference.md | 审核项目 expected 与定向负例，固定夹具/设备或人工签署；仍非原版玩法 oracle |
| M30-01 | 以固定 seed/初态/输入验证：材质造型语言/色板/原创资产生产标准；记录正例、失败例、tick 和 owner 状态。 | experience-reference.md | 审核项目 expected 与定向负例，固定夹具/设备或人工签署；仍非原版玩法 oracle |
| M30-04 | 以固定 seed/初态/输入验证：风格盲测、资产出处/许可与返工；记录正例、失败例、tick 和 owner 状态。 | experience-reference.md | 审核项目 expected 与定向负例，固定夹具/设备或人工签署；仍非原版玩法 oracle |
| M32-02 | 以固定 seed/初态/输入验证：独立原创采集/生成：步行、挖掘、放置、环境；记录正例、失败例、tick 和 owner 状态。 | experience-reference.md | 审核项目 expected 与定向负例，固定夹具/设备或人工签署；仍非原版玩法 oracle |
| M32-04 | 以固定 seed/初态/输入验证：音乐/唱片/静默节奏、动态触发与盲测返工；记录正例、失败例、tick 和 owner 状态。 | experience-reference.md | 审核项目 expected 与定向负例，固定夹具/设备或人工签署；仍非原版玩法 oracle |
| M34-01 | 以固定 seed/初态/输入验证：原版事件轨迹/黄金 fixture 与复现脚本；记录正例、失败例、tick 和 owner 状态。 | case-design.md | 审核项目 expected 与定向负例，固定夹具/设备或人工签署；仍非原版玩法 oracle |
| M34-02 | 以固定 seed/初态/输入验证：Kernel/stdlib/Classic 确定性行为矩阵；记录正例、失败例、tick 和 owner 状态。 | ../../docs/ci-testing.md | 审核项目 expected 与定向负例，固定夹具/设备或人工签署；仍非原版玩法 oracle |
| M34-03 | 以固定 seed/初态/输入验证：Browser 单人旅程、输入/存档 E2E；记录正例、失败例、tick 和 owner 状态。 | harness-acceptance.md | 审核项目 expected 与定向负例，固定夹具/设备或人工签署；仍非原版玩法 oracle |
| M34-04 | 以固定 seed/初态/输入验证：视觉/音频对照、人审/盲测、缺口回归；记录正例、失败例、tick 和 owner 状态。 | experience-reference.md | 审核项目 expected 与定向负例，固定夹具/设备或人工签署；仍非原版玩法 oracle |
| M35-01 | 以固定 seed/初态/输入验证：基准场景/低配机/指标/正确性停止线；记录正例、失败例、tick 和 owner 状态。 | ../../docs/performance-execution.md | 审核项目 expected 与定向负例，固定夹具/设备或人工签署；仍非原版玩法 oracle |
| M35-02 | 以固定 seed/初态/输入验证：区块/光照/液体/AI/渲染热点测量与 A/A；记录正例、失败例、tick 和 owner 状态。 | ../../docs/development-governance.md | 审核项目 expected 与定向负例，固定夹具/设备或人工签署；仍非原版玩法 oracle |
| M35-03 | 以固定 seed/初态/输入验证：不改规则前提下优化、逐项 A/B 与组合验收；记录正例、失败例、tick 和 owner 状态。 | ../../docs/development-governance.md | 审核项目 expected 与定向负例，固定夹具/设备或人工签署；仍非原版玩法 oracle |
| M36-01 | 以固定 seed/初态/输入验证：阶段集成与跨模块缺陷定位/修复；记录正例、失败例、tick 和 owner 状态。 | boundary-ledger.md | 审核项目 expected 与定向负例，固定夹具/设备或人工签署；仍非原版玩法 oracle |
| M36-02 | 以固定 seed/初态/输入验证：设计/代码/玩法评审与安全/版权核查；记录正例、失败例、tick 和 owner 状态。 | reference-provenance-audit.md | 审核项目 expected 与定向负例，固定夹具/设备或人工签署；仍非原版玩法 oracle |
| M36-03 | 以固定 seed/初态/输入验证：文档、分阶段交付、PR/门禁与最终差距表；记录正例、失败例、tick 和 owner 状态。 | ../../docs/development-governance.md | 审核项目 expected 与定向负例，固定夹具/设备或人工签署；仍非原版玩法 oracle |
| M36-04 | 以固定 seed/初态/输入验证：不确定性与原版边缘反例追补；记录正例、失败例、tick 和 owner 状态。 | contract-audit.md | 审核项目 expected 与定向负例，固定夹具/设备或人工签署；仍非原版玩法 oracle |

所有 522 行的逐项 `unresolved`、证据链接、审查和夹具状态以 JSON 为准；本文件不把候选当黄金事实。

