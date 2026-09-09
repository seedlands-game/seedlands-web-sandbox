# 产品定位与浏览器 Living World 基线

2026-09-09，经用户在本次任务明确确认。本文沉淀产品方向，不宣称下述未来能力已实现。现有能力看 README，开发顺序看[长期路线](living-world-alignment.md)。

## 玩家最终获得什么

**把玩家当下的幻想，变成可以立即进入、持续体验并留下真实后果的体素开放世界。** 产品定位是 Promptable Living World Platform：创作者定义世界观、规则与初始局势，玩家可以从自己的视角生活和介入，而不是只能沿预写剧情前进。体素、开放世界和系统玩法是质量与可组合性的边界；“AI 原生开发”是实现方式，不能替代可感知的产品价值。

长期核心体验：玩家行动 → 世界内部因果传播 → 持久变化 → 再次进入并发现后果。例子是玩家把矿井污染线索告诉 NPC 朋友，后来发现镇长遭到调查甚至审判；结果必须有信息传播、行动、规则与证据链，不能由 LLM 直接编造历史再 patch 世界。

“NPC 像另一个玩家”指正式身份、真实身体、局部感知、背包、可失败和可中断的动作，以及与玩家同样的世界规则和物理约束。它可以有自己的性格、承诺与目标，也可以拒绝玩家的建议。它不需要模拟 WASD/鼠标；它也不能拥有开发者全局 inspect、任意状态写入或无限物品。

## 产品形态与部署边界

- 长期形态：开源引擎底座 + 上层创作与游玩平台。Web 是正式产品载体，不只是最终要替换的原型。
- 入口：精选世界/UGC 游玩大厅，可直接进入体验；输入自己的想法或随机想法，再进入创作对话。创作先明确视觉、设定、目标与局势，支持引导澄清、自动选择和基于已授权历史偏好的委派模式。
- 生成方向：Fantasy → Design Interview → LivingWorldPackage → 静态验证 → 世界 Harness → 浏览器体验验证 → 修复 → Playable。声明式世界定义、已有玩法模块优先；任意代码扩展与公开 UGC 安全模型在开放前另做独立评议。
- 世界模拟、游戏渲染及创作/Agent Harness 重计算优先使用用户浏览器。早期云侧可以承担认证、鉴权、模型代理、积分账本、支付、元数据与对象存储/CDN 等普通 Web 服务，不托管每用户常驻游戏世界、重型 Agent Sandbox 或构建计算。
- 本机 Agent Server 是早期研发与验证宿主，提供模型调用与认知会话；它不持有权威世界，也不要求恢复 Node Dedicated Server。长期可把认知编排移到浏览器，云侧保留模型网关，协议语义不依赖本机部署。

## 商业与验证假设

引擎核心保持开源。上层 AI、Harness 编排、自动修复、质量保障、个性化与平台应用是否开源仍未决定，不在本次擅自改变许可证。Credits 的定价价值来自整套可靠体验，不以模型 API 差价作为护城河。

创建成本与运行时智能成本必须分开统计。单人游玩消耗当前用户预算；未来多人设想由服主预算承担，但多人不属于当前阶段。SaaS 普通用户路径不提供自带 API key；本机开发的供应商配置属于开发环境，不外推为 SaaS 产品入口。模型调用频率、上下文、重试和超时均有上限，耗尽时以可观察的算法 fallback 保持世界可玩。

第一个可对外的可玩 MVP 后开展小范围内测，用免费 Credits 收集反馈并验证 marketing pipeline。可使用 B 站、YouTube、小红书、微信公众号、X、字节圈等渠道；这只是后续计划，本次不发布外部宣传、不承诺平台已上线。

内测优先观察：玩家能否讲出 NPC 独立完成并留下的事件，能否干预和再次发现后果；再统计首次可玩等待、重复游玩、无人工修复成功率、每玩家小时模型成本、非法动作与状态不一致。具体量化阈值在相应体验 change 预注册。

## 当前阶段与明确后置

| 阶段                   | 本阶段必须证明                                                              | 不能据此宣称                           |
| ---------------------- | --------------------------------------------------------------------------- | -------------------------------------- |
| Node 研究归档          | 固定已合并 MVP，退出活跃代码与强制门禁                                      | 后续兼容、持续编译运行或托管承诺       |
| DeveloperWorldHarness  | Headless / Browser 世界语义一致，持续 REPL 可重复调试                       | Headless 能验证画面、输入、音频或 GPU  |
| 浏览器单 NPC Agent MVP | 一个玩家与一个有性格、目标、身体、动作、记忆及后果的 NPC 共处，能保存后继续 | 完整社会、无限行动空间、多人或离线进展 |
| Simulation LOD         | 距离/精度切换与有界离线追赶仍保持身份、存量和因果                           | 关浏览器仍真实常驻运行                 |
| World AI               | 区域、聚落和事件级目标通过受约束效应器影响世界                              | 宏观 Agent 全知全能或能直接改个体记忆  |
| 创作与平台化           | 从幻想到可靠可玩作品，再逐步开放分享与 UGC                                  | 仅接入一个 LLM 就完成生成平台          |

浏览器关闭时模拟停止。首个 Agent MVP 保存并恢复事实，不补算下线时间；离线追赶由后续 LOD change 实现。长期“回来发现世界推进”需要该阶段的真实因果模拟验收，不能用本期加载存档冒充。

## 固定技术方向

1. Headless Developer Harness → Browser Single-player Agent MVP → Simulation LOD → World AI。
2. DeveloperWorldHarness 统一世界身份/revision、inspect voxel/Chunk/Entity/Actor、场景与命令、显式时间、Logic observation/intents、Action、barrier、trace、checkpoint 导出恢复。BrowserProductHarness 另外负责玩家输入、摄像机、渲染、音频、性能与视觉断言。
3. 同一 REPL 生命周期只创建一次世界；pause/run/advance 使用同一个权威调度，不允许脚本获得第二个写者。支持多轮脚本 Logic、进程内调用或 JSONL 子进程。
4. 浏览器主动连接本机 Agent Server；Browser Bridge 将受限 observation/事件/Action 回执转出，将 intent/action 转入 Authority Worker。Bridge 检查 session、actor、sequence、capability，Authority 在执行处再次检查。
5. 首个纵向切片一起交付执行、反射、基础 fallback、Agent 决策、Authority 回执与持久化。通用行为树、复杂规划与完整认知系统不是先决条件。
6. 保留 core/Web 分离、单 Authority 写者、平台端口、协议/事务/checkpoint/存档合同与包边界；Node 专项 Worker、文件存储、WebSocket 世界宿主和 Dedicated 生命周期退出产品基线。

## 来源与解释优先级

下一阶段的可交付切面、共享 Harness、Agent 协议与权限、恢复合同及验收矩阵见[浏览器单 NPC Agent MVP 设计](../changes/2026-09-09-browser-agent-mvp-design/spec.md)。H1/H2 的实现与运行证据见[世界开发 Harness](developer-world-harness.md)；下一阶段按[通用权限与认知回路修订](../changes/2026-09-09-developer-world-harness/agent-harness-design.md)和[框架实测决策](../changes/2026-09-09-developer-world-harness/framework-decision.md)推进。Agent MVP 尚未实现，当前能力以对应交付证据为准。

本轮用户明确决策优先于旧路线中“先 Dedicated 再 Agent”的安排。已通过 `read_thread` 阅读 [评估 Node Server 交付边界](thread://01a07cf1-b14e-7630-8f1d-88128cd69104) 与[产品定位分析](https://chatgpt.com/c/6aa02f13-6608-83e8-ab45-0ee41a489c6e) 的可访问文本。本次没有取得后者生成文档附件的独立正文，不声称逐字迁入附件；本页以用户原话、当前任务的正式决策和现行源码为依据。旧助手的市场、性能和成本判断不是已核验事实，也不是新强制约束。
