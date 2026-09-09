# Living World：来源与覆盖边界

更新日期：2026-09-06。此索引用于区分实际读取范围与研究目标，配合[长期对齐文档](living-world-alignment.md)。

2026-09-07 补充 S19：玩法路线讨论与世界观原稿补读结果已纳入[详细路线](playbook-roadmap.md)。下文 2026-09-06 的读取记录保留当时口径；已补齐的原稿范围在第三节单独注明。

## 一、当前覆盖边界

用户要求读取 [Living World Project](https://chatgpt.com/g/g-p-6a9693083c3c819188b16440a6c60089-project-living-world-game/project) 的所有上下文。目前已建立页面列出的 18 篇会话清单与完整链接；仍未证实是否存在更多项目来源或隐藏条目。

本轮重试有实质进展：用户明确允许 AppleScript 后，使用 Chrome 原生“选择全文 / 复制 / 保存完整网页”取得多篇正文，不需要打开“允许 Apple 事件中的 JavaScript”。另从本机此前任务的工具回执恢复 HUD、音频、渲染讨论中的原始消息与摘要。已补齐：

- 最初选择 Minecraft 的三项理由、三项产品核心、2D 与 3D 体素重新比较、自建世界模型的用户原话。
- PlayCanvas 完整问答中的回顾性解释；与当前实现交叉核对。
- 插件与统一控制面的后段讨论、用户对模拟岛及 WASM 的最终收敛、Agent change 必须形成独立可验证产物的纠偏。
- HUD 的历史用户消息，以及两篇早期 Minecraft 生态讨论的当前正文。
- 本机历史 C/S、Agent Runtime、Agent Authorization 文件和主分支实现证据。

**仍未完成 Project 全量阅读。**页面会只加载部分消息；展开早期提问后还会有中段缺失，个别正文中的代码区也没有完整保存。若读取结果只有项目页或首页，不记为会话正文。Project“来源”页与世界观附件仍缺失。本索引逐篇记录实际覆盖，不能以会话标题、已取得 URL 或成功保存网页替代全文读取。

2026-09-06 范围收敛：用户提出材料足够则无需继续阅读。现有材料已覆盖宏观目标、载体选择、关键决策方法、当前进度与两路路线，研究阶段据此结束。下列未读项是资料覆盖边界，不是本次未完成任务，也不要求后续会话逐项补齐。只有具体设计需要这些细节时才继续查证。

## 二、来源目录

| 编号 | 来源                                                                                                                                                     | 已读取范围与用途                                                                                                                                                    |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S0   | 本次用户消息，2026-09-06                                                                                                                                 | 完整；长期方向、两路并行、异世界首个 MVP、长期对齐与 SDD 分工的直接依据                                                                                             |
| S1   | 仓库 main `3938eed27793cd342558165d061792ab9f12dd2a`                                                                                                     | 远端指针已核实；README、关键源码与交付记录用于当前进度；不是新一轮产品验收                                                                                          |
| S2   | [浏览器体素竞品比较](https://chatgpt.com/g/g-p-6a9693083c3c819188b16440a6c60089/c/6a9cf124-5a00-83ee-8181-7390523922ad)                                  | 项目预览已读；多种地址导航返回项目页/首页，未取得完整正文。明确的 LAN Dedicated、包与编解码成本来自预览；两路方向以 S0 为直接依据                                   |
| S3   | [无职转生游戏设计](https://chatgpt.com/g/g-p-6a9693083c3c819188b16440a6c60089-project-living-world-game/c/6a7d65b8-383c-83ee-bce3-81eb8c1d7bf8)          | 已保存后段正文，补齐此前折叠的自主开发 Harness 用户消息；早期世界观与三份生成附件仍缺失                                                                             |
| S4   | 本机保存的 `Architecture Decision — Integrated Server to MMO.md`、`Change 10 — Agent Runtime & Game Integration Foundation.md`                           | C/S 与 Agent 文件已分段读完；两份 Agent 下载副本内容相同，SHA-256 为 `91329df789c0ee0fdc0ec56f7b37f4e74f53ba67207b7f13e3d889d7d4486406`；不是已实施状态             |
| S5   | [体素项目阶段规划](https://chatgpt.com/g/g-p-6a9693083c3c819188b16440a6c60089/c/6a9bef26-0334-83ee-8eaa-6eff00a330c5)                                    | 已读后段 5 条消息：Simulation LOD / Agent 原生 / 单一事实的助手归纳、插件建议、用户对统一写入/语义化/权限的明确要求及回复；前段未补齐                               |
| S6   | 本机保存的 `Change 11 — Agent Authorization Foundation.md`                                                                                               | 全文已读；Principal、Role、Capability、Resource Scope 同时约束观察与行为；历史方案                                                                                  |
| S7   | [调研 Minecraft AI开发环境](https://chatgpt.com/g/g-p-6a9693083c3c819188b16440a6c60089-project-living-world-game/c/6a96940f-3bb0-83ee-ba6b-a41295b684f8) | 已读当前页面 2 组问答：Web 式快速开发环境、FaaS/容器/WASM sandbox 诉求及当时调研回复；外部工具现状未重新核验                                                        |
| S8   | [分析EaglerPorts实现](https://chatgpt.com/g/g-p-6a9693083c3c819188b16440a6c60089-project-living-world-game/c/6a96991e-b094-83ee-8163-5dd58196335a)       | 仅项目预览；多种地址导航未取得正文，不能将 Java/WASM 平台探索当作已采用路线                                                                                         |
| S9   | [设计2D网页游戏方案](https://chatgpt.com/g/g-p-6a9693083c3c819188b16440a6c60089-project-living-world-game/c/6a993983-d1c4-83e8-a394-64b18756f0f7)        | 已取得开头的 2D 提案、用户 Minecraft 动机与三项产品核心、自建世界模型理由，以及最后 3 个 change 讨论；页面目录为 14 个提问，中段仍缺失                              |
| S10  | [Voxel Shader 实现](https://chatgpt.com/g/g-p-6a9693083c3c819188b16440a6c60089-project-living-world-game/c/6a9a5d8e-9924-83e8-aec1-3610b1d05418)         | 从历史 MVP 工具回执恢复部分用户消息与助手片段；本轮直接导航未取得正文。只用于确认曾讨论的渲染边界与线程取舍                                                         |
| S11  | [选择PlayCanvas原因](https://chatgpt.com/g/g-p-6a9693083c3c819188b16440a6c60089/c/6a9cf875-75e0-83e8-8698-11e0c582d2bc)                                  | 当前问答完整取得；这是回顾性选型解释，区分于最初决策原文和本轮第三方技术评测                                                                                        |
| S12  | [Godot Web与生产架构](https://chatgpt.com/g/g-p-6a9693083c3c819188b16440a6c60089-project-living-world-game/c/6a9a41b5-6570-83e8-b073-5cd0e81b8a32)       | 已取得末段 5 条消息，含用户完整的模拟岛/Worker/写权限/拆合条件与前期单岛设定；页面目录 11 个提问，前段与最终技术方案附件待补                                        |
| S13  | [WASM迁移可行性分析](https://chatgpt.com/g/g-p-6a9693083c3c819188b16440a6c60089-project-living-world-game/c/6a99760f-a60c-83e8-8b4b-938cb0bb9575)        | 已取得末段 5 条消息，包含用户从提前考虑 WASM 到最后要求数据布局先行、独立 A/B 的纠偏；前段未核完                                                                    |
| S14  | [HUD框架选型比较](https://chatgpt.com/g/g-p-6a9693083c3c819188b16440a6c60089/c/6a9a996f-0334-83ee-a15b-8dead826f85a)                                     | 历史任务回执恢复 10 轮用户消息及截断的助手回复；本轮另取得末段正文。可确认 Svelte/CSS/素材、不同频率 Store、放弃 GPU UI 叠层与暂缓 Godot 抽象；完整助手比较仍有缺口 |
| S15  | [设计电子音乐系统](https://chatgpt.com/g/g-p-6a9693083c3c819188b16440a6c60089-project-living-world-game/c/6a9a3cf4-7194-83e8-a462-0059b955e626)          | 历史任务回执恢复音频风格、电子合成、世界实例生命周期与独立音频 change 的部分讨论；本轮直接导航未取得完整正文                                                        |
| S16  | [体素世界引擎架构](https://chatgpt.com/g/g-p-6a9693083c3c819188b16440a6c60089-project-living-world-game/c/6a99952a-73c0-83e8-961b-1c04cc8b87c1)          | 取得末段 5 条消息；用户明确要求 Runtime/Context/Bridge 合成一个可独立验证的 Change 10，权限另作 Change 11。部分代码区缺失，早期 4–9 论证未完整读取                  |
| S17  | [Voxel GitHub Sync](https://chatgpt.com/g/g-p-6a9693083c3c819188b16440a6c60089/c/6a9a6024-9838-83ee-a18f-ca435041ae43)                                   | 仅预览；用户表示 MVP 合入 main，合入事实由 S1 验证；本轮未取得正文                                                                                                  |
| S18a | [Rustcraft图形技术栈解析](https://chatgpt.com/g/g-p-6a9693083c3c819188b16440a6c60089-project-living-world-game/c/6a7bf009-131c-83ee-92ce-517a9a80e21e)   | 仅预览；Pumpkin/客户端网络栈探索，不能推断已实施；本轮未取得正文                                                                                                    |
| S18b | [Minecraft 渲染优化调研](https://chatgpt.com/g/g-p-6a9693083c3c819188b16440a6c60089-project-living-world-game/c/6a70a374-fb34-83ec-98d4-f6cdba2d69dd)    | 仅预览；未取得本篇正文，不将另一篇相似研究自动视为同一来源                                                                                                          |
| S18c | [Minecraft 渲染优化研究](https://chatgpt.com/g/g-p-6a9693083c3c819188b16440a6c60089/c/6a70a355-95f8-83ec-826b-9ca1a88a2b4b)                              | 已取得当前一组问答；用于理解用户希望厘清 LOD、渲染后端与优化职责的背景，助手的技术判断未重新验证                                                                    |
| S18d | [推荐村民AI机制Mod](https://chatgpt.com/g/g-p-6a9693083c3c819188b16440a6c60089/c/6a839a3b-944c-83ee-ab58-6f75ee73fffd)                                   | 已取得当前一组问答；历史建议围绕个体、聚落、生产物流、环境反馈与行动执行分层；不代表采用任何 Mod，亦不将旧版本/功能描述当作当前事实                                 |
| S19  | 2026-09-07 玩法讨论：[路线基线](playbook-roadmap.md)、[ECS 研究](ecs-animation-research.md)                                                              | 完整；玩法路线逐轮确认、官方资料研究与历史世界观补读；具体决策和证据见来源链接，均不代表功能已实施或依赖已准入。                                                    |

## 三、项目来源与附件的补读状态

Project 的“来源”标签尚未成功打开核对，不将会话目录当作全部上下文。S3 中附件的覆盖状态如下：

- `world-design-foundation.md`：2026-09-07 已补读本机原稿；世界公理、六界、身份/转生、自由探索及历史完整 MVP 的摘要见[详细路线第 15 节](playbook-roadmap.md#demos)。原稿未整份发布，Minecraft 实现映射不成为当前 Web 合同。
- `mvp-technical-design.md`：早期 Minecraft MVP 技术方案。
- `minecraft-agent-harness-plugin-design.md`：自主开发 Harness 方案。

本机下载的历史文件位于用户 Downloads 的 `_sorted/documents/`，文件名实际以 URL 编码保存。文档不复制全部原始私有对话，只保存与方向有关的归纳和来源；后续如需将附件纳入仓库，应明确其版本、来源和适用阶段。

## 四、具体任务需要时的查证顺序

1. 项目来源、S3 完整历史与世界观附件：恢复最终游戏体验、体素载体动机、自由度与世界规律。
2. S9 的其余历史提问、S8 与原始 Foundation 附件：已读原话解释了 Minecraft 与体素选择，继续补齐 Web 技术落地与最初比较的细节。
3. S16、S4、S12、S13：复核逻辑 C/S、数据布局、模拟岛及规模化的演进条件。
4. S2 完整后续路线、S5 前段：复核建议里程碑；S5 后段已读，统一控制面动机已补齐。
5. S14、S10、S15、S17、S18：补齐表现、工程和早期生态背景，识别已过期建议。
6. 如具体任务仍缺关键依据，只读取相关历史分页或附件，并更新本索引；不为追求完整率而遍历全部会话。

## 五、解释历史的规则

用户原话、助手建议、下载方案和已合并实现是不同证据。历史文件的 Accepted 标记不能替代新 change 的批准；标题和摘要不等于正文；代码证明采用了什么，不自动证明为何选择。

补全资料时优先找出用户纠偏、最后确认和前提变化。若两条资料冲突，保留时间与作用范围，不能仅取更符合当前设想的那条。

## 六、本轮替代读取的可恢复记录

- 浏览器 JavaScript 读取被 Chrome 设置拒绝；没有开启该设置。原生网页保存与复制可以读取已加载内容。
- 同一任务建立的 Chrome 阅读标签页为 `1263506518`；原始用户标签页为 `1263506398`。这些仅是当次会话标识，不是长期自动化接口。
- 本地临时阅读材料位于 `/private/tmp/living-world-context-recovery/`。它们未纳入仓库，不作为永久唯一来源；正文归纳仍引用原会话。
- 历史工具回执取自 2026-09-05 的 MVP 任务 `01a06e0e-a50c-76d3-b9c5-efeb302f3a58`；其中第 104 行保存 HUD 的 10 轮摘要，第 46、57、64 行保存音频/渲染的部分原始文本，第 94 行补齐两个早期会话 URL。摘要截断处没有被补写成原文。
- 本轮读到的原始消息、历史助手建议、下载方案与主分支代码继续分别标注；旧研究中的外部软件能力与性能数字不进入本文作为当前事实。

## 2026-09-09 产品定位与路线覆盖

S20：本轮用户正式决定与引用任务 [Node 交付边界](thread://01a07cf1-b14e-7630-8f1d-88128cd69104)、[产品定位分析](https://chatgpt.com/c/6aa02f13-6608-83e8-ab45-0ee41a489c6e)。已通过 read_thread 读取可访问文本，生成附件独立正文未取得；只以用户明确原话与本轮决策沉淀[现行产品基线](product-positioning.md)。Node 退出当前产品路径，Headless 世界 Harness、浏览器单 NPC Agent、LOD、World AI 依序推进；旧 S0/S2 的部署顺序变为历史背景。
