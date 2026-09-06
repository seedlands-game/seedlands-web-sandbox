# Living World：来源与资料缺口

更新日期：2026-09-06。此索引用于区分实际读取范围与研究目标，配合[长期对齐文档](living-world-alignment.md)。

## 一、当前覆盖边界

用户要求读取 [Living World Project](https://chatgpt.com/g/g-p-6a9693083c3c819188b16440a6c60089-project-living-world-game/project) 的所有上下文。当前实际取得：

- Project 页面呈现的 18 篇会话标题与末条预览，其中 16 篇取得了完整 URL；未证实是否还有分页、归档会话或更多项目来源。
- 《无职转生游戏设计》可见的后段正文：MVP 技术方案总结、开发 Harness 讨论、CLI/MCP 比较；更早对话、折叠用户消息与生成文件正文尚未完整读取。
- 本机已保存的 C/S 架构、Agent Runtime、Agent Authorization 文件；这些是历史设计输入，不代表当前实现与本轮批准。
- 远端 main 提交、README、关键源码与相关 change。未复跑历史产品测试。

尚未完成 Project 全量阅读。浏览器连接多次超时，原生 UI 后续动作返回 `noWindowsAvailable`；公开网页仅返回登录页。本记录不据此推断原对话不存在。

## 二、来源目录

| 编号 | 来源                                                                                                                                                     | 已读取范围与用途                                                                                                                                        |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S0   | 本次用户消息，2026-09-06                                                                                                                                 | 完整；长期方向、两路并行、异世界首个 MVP、长期对齐与 SDD 分工的直接依据                                                                                 |
| S1   | 仓库 main `3938eed27793cd342558165d061792ab9f12dd2a`                                                                                                     | 远端指针已核实；README、关键源码与交付记录用于当前进度；不是新一轮产品验收                                                                              |
| S2   | [浏览器体素竞品比较](https://chatgpt.com/g/g-p-6a9693083c3c819188b16440a6c60089/c/6a9cf124-5a00-83ee-8181-7390523922ad)                                  | 仅项目预览；明确提到本地网络 Node Dedicated、效率验证、packet/编解码/协议成本；完整后续路线待正文                                                       |
| S3   | [无职转生游戏设计](https://chatgpt.com/g/g-p-6a9693083c3c819188b16440a6c60089-project-living-world-game/c/6a7d65b8-383c-83ee-bce3-81eb8c1d7bf8)          | 已读后段正文；原世界观、前段设计过程、折叠消息和生成文件待补齐                                                                                          |
| S4   | 本机保存的 `Architecture Decision — Integrated Server to MMO.md`、`Change 10 — Agent Runtime & Game Integration Foundation.md`                           | C/S 与 Agent 文件已分段读完；两份 Agent 下载副本内容相同，SHA-256 为 `91329df789c0ee0fdc0ec56f7b37f4e74f53ba67207b7f13e3d889d7d4486406`；不是已实施状态 |
| S5   | [体素项目阶段规划](https://chatgpt.com/g/g-p-6a9693083c3c819188b16440a6c60089/c/6a9bef26-0334-83ee-8eaa-6eff00a330c5)                                    | 仅预览；用户强调人、AI、API 统一写入与世界记忆，完整控制面/插件关系待核对                                                                               |
| S6   | 本机保存的 `Change 11 — Agent Authorization Foundation.md`                                                                                               | 全文已读；Principal、Role、Capability、Resource Scope 同时约束观察与行为；历史方案                                                                      |
| S7   | [调研 Minecraft AI开发环境](https://chatgpt.com/g/g-p-6a9693083c3c819188b16440a6c60089-project-living-world-game/c/6a96940f-3bb0-83ee-ba6b-a41295b684f8) | 仅预览；用户提出摆脱完整本机 MC 客户端、类似 FaaS sandbox 的开发诉求                                                                                    |
| S8   | [分析EaglerPorts实现](https://chatgpt.com/g/g-p-6a9693083c3c819188b16440a6c60089-project-living-world-game/c/6a96991e-b094-83ee-8163-5dd58196335a)       | 仅预览；Java/JVM 到 WASM/Web 的平台边界讨论，未读完整论证                                                                                               |
| S9   | [设计2D网页游戏方案](https://chatgpt.com/g/g-p-6a9693083c3c819188b16440a6c60089-project-living-world-game/c/6a993983-d1c4-83e8-a394-64b18756f0f7)        | 仅标题及末条预览；不得据标题断定最终选择 2D，需补从此对话到 3D 体素的决定                                                                               |
| S10  | [Voxel Shader 实现](https://chatgpt.com/g/g-p-6a9693083c3c819188b16440a6c60089-project-living-world-game/c/6a9a5d8e-9924-83e8-aec1-3610b1d05418)         | 仅预览；仓库 MVP spec 另有当时读取与实现总结，本轮未读全文                                                                                              |
| S11  | [选择PlayCanvas原因](https://chatgpt.com/g/g-p-6a9693083c3c819188b16440a6c60089/c/6a9cf875-75e0-83e8-8698-11e0c582d2bc)                                  | 仅用户问题预览；Three.js / Babylon.js / PlayCanvas 等实际比较结论未读                                                                                   |
| S12  | [Godot Web与生产架构](https://chatgpt.com/g/g-p-6a9693083c3c819188b16440a6c60089-project-living-world-game/c/6a9a41b5-6570-83e8-b073-5cd0e81b8a32)       | 仅用户末条预览；workload 按模拟计算划分、模拟岛与 worker 分离的方向可确认，完整约束未读                                                                 |
| S13  | [WASM迁移可行性分析](https://chatgpt.com/g/g-p-6a9693083c3c819188b16440a6c60089-project-living-world-game/c/6a99760f-a60c-83e8-8b4b-938cb0bb9575)        | 仅用户末条预览；先 TypedArray/SoA，WASM 独立 A/B 后决定默认选项                                                                                         |
| S14  | [HUD框架选型比较](https://chatgpt.com/g/g-p-6a9693083c3c819188b16440a6c60089/c/6a9a996f-0334-83ee-a15b-8dead826f85a)                                     | 仅预览与仓库 MVP spec 的既有摘要；当前 Svelte/UiBridge 实现由仓库确认，完整选型过程待补                                                                 |
| S15  | [设计电子音乐系统](https://chatgpt.com/g/g-p-6a9693083c3c819188b16440a6c60089-project-living-world-game/c/6a9a3cf4-7194-83e8-a462-0059b955e626)          | 仅预览与仓库已有交付记录；完整音乐价值与风格讨论待补                                                                                                    |
| S16  | [体素世界引擎架构](https://chatgpt.com/g/g-p-6a9693083c3c819188b16440a6c60089-project-living-world-game/c/6a99952a-73c0-83e8-961b-1c04cc8b87c1)          | 仅标题与末条预览；需核对历史 Change 4–11 顺序及其论证                                                                                                   |
| S17  | [Voxel GitHub Sync](https://chatgpt.com/g/g-p-6a9693083c3c819188b16440a6c60089/c/6a9a6024-9838-83ee-a18f-ca435041ae43)                                   | 仅预览；用户说将 MVP 合入 main，实际合入已通过 S1 验证                                                                                                  |
| S18a | [Rustcraft图形技术栈解析](https://chatgpt.com/g/g-p-6a9693083c3c819188b16440a6c60089-project-living-world-game/c/6a7bf009-131c-83ee-92ce-517a9a80e21e)   | 仅预览；Pumpkin/MC 客户端网络栈探索，不能推断已实施                                                                                                     |
| S18b | [Minecraft 渲染优化调研](https://chatgpt.com/g/g-p-6a9693083c3c819188b16440a6c60089-project-living-world-game/c/6a70a374-fb34-83ec-98d4-f6cdba2d69dd)    | 仅预览；Distant Horizons、Voxy、Sodium、Iris 等角色比较的请求，未取得研究结论                                                                           |
| S18c | Minecraft 渲染优化研究                                                                                                                                   | 仅项目中标题及预览，完整 URL 未取得；不假定与 S18b 完全重复                                                                                             |
| S18d | 推荐村民AI机制Mod                                                                                                                                        | 仅项目中标题及简短预览，完整 URL 未取得                                                                                                                 |

## 三、待补齐的项目来源与附件

Project 的“来源”标签尚未打开核对，不将会话目录当作全部上下文。在 S3 已看到但尚未读取正文的文件包括：

- `world-design-foundation.md`：世界观与核心玩法基础方案。
- `mvp-technical-design.md`：早期 Minecraft MVP 技术方案。
- `minecraft-agent-harness-plugin-design.md`：自主开发 Harness 方案。

本机下载的历史文件位于用户 Downloads 的 `_sorted/documents/`，文件名实际以 URL 编码保存。文档不复制全部原始私有对话，只保存与方向有关的归纳和来源；后续如需将附件纳入仓库，应明确其版本、来源和适用阶段。

## 四、恢复阅读次序

1. 项目来源、S3 完整历史与世界观附件：恢复最终游戏体验、体素载体动机、自由度与世界规律。
2. S7 → S8 → S9 → S11：补齐 Minecraft → Web 自建与 PlayCanvas 的真实比较过程。
3. S16、S4、S12、S13：复核逻辑 C/S、数据布局、模拟岛及规模化的演进条件。
4. S5、S2：读取当前引擎/插件与 Dedicated/Agent 两路的完整结论，修正建议里程碑。
5. S14、S10、S15、S17、S18：补齐表现、工程和早期生态背景，识别已过期建议。
6. 遍历每篇会话历史分页、折叠消息及附件，核对是否有新增条目；完成后更新此索引和主文状态。

## 五、解释历史的规则

用户原话、助手建议、下载方案和已合并实现是不同证据。历史文件的 Accepted 标记不能替代新 change 的批准；标题和摘要不等于正文；代码证明采用了什么，不自动证明为何选择。

补全资料时优先找出用户纠偏、最后确认和前提变化。若两条资料冲突，保留时间与作用范围，不能仅取更符合当前设想的那条。
