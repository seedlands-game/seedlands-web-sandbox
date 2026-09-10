# S4 工位接线进展

状态：Implementing；尚未到 S4 产品准出。

每世界 GameplayContent 可选 stations；缺定义的世界不创建工位 codec。目录在装配时校验并冻结，公开 defineContentModule 将配方、燃料与炉体输入输出的 content ID 映射到该世界 storage ID。根 GameplayRuntime 与 detached 快照验证使用同一世界 codec，保存 schedule 的读取移到队列排空后。

非 actor 的 ECS station 不进入 Mode、Needs、Inventory/Feeding/Combat actor 路径或 authority physics port。EntityStore snapshot 现为 V2；旧 V1 迁移空 stations。工位所有权由同一 ECS 保持。

新增注册 station-transfer / station-craft，actor/station 投影均归同一个 RegisteredStationRuntime。host 重算候选，检查 actor execute、工位引用、voxel、距离和 LOS；与原料、耐久、工位 revision 一起原子提交，并在最终 apply 前重检。选择物品变化沿既有 Action cancellation，并清玩家 breakAction。操作失败保留 actor/station 状态。

定向证据：

- 内容目录 RED 4/4 失败；接线后公开别名、隔离、冻结、非法原料等 5/5 通过。
- 工位/炉体配方实例身份 RED 3/3 失败；修复后连同既有纯候选共 13/13 通过。
- 普通 transfer count、重试 revision、合成、creative 限制与炉体槽约束纯候选 3/3 通过。
- 实际 GameplayRuntime 工位 V2 保存恢复、动态查询隔离、缺 codec 拒绝 1/1 通过。
- 实际注册 binding 扣料/工作台联合提交、重复 retry、craft、secondary actor deny、最终结果 clone 失败保持原状 2/2 通过。
- 当前 core 定向 TypeScript 通过。完整静态、build、Browser 未在本 S4 树运行。

尚缺：炉体 lifecycle、Block 放置/拆除与掉落、portable chunks 双向一致性、新 voxel/材质/矿石、第一方配方、普通 Browser 动线、跨宿主和 S5/S6。以上局部测试不替代这些验收。

## Browser 正常工位交互

玩家右键瞄准可达工位打开背包内工位面板。只投影当前玩家在 4.5 格内、视线无遮挡、已有 read 授权的工位；创造和死亡状态不展示可操作工位。面板不保存权威库存：每次转移/合成带上当前工位 ECS 身份与 revision，经既有 Actor module authority 提交，失败保留物品并显示反馈。工作台逐格摆放，默认转移一个以便排配方；箱子可选择一个或整组；熔炉输入/燃料/产出单独标注。关闭面板、走远、拆毁或切换模式时清除选择。

自动观察预期：拒绝旧 revision、旧 lifetime、权限不足和远距离操作；正常工位内容可实时读回且不出现在动态实体渲染列表。工具当前/最大耐久在背包及快捷栏显示。Browser 需通过正常右键、槽位点击和保存恢复完成产品验收，静态检查不能替代。

## 持久化与驻留补充

工位为当前全量运行的世界实体，本期不做 Simulation LOD。工位所在 canonical chunk 加入既有驻留 pin，仍受既有 hard limit 约束，不提高内存预算。拆除后释放；存档恢复先载入这些 chunk 并检查体素/组件双向对应，延迟载入其他持久化 chunk 时也检查孤立工位方块。这样远处仍在冶炼的工位和其体素不会因缓存逐出而分离，可移植导出包含其方块数据。此策略不宣称性能收益；远超基础玩法规模的工位数量仍可能触发既有驻留压力拒绝。

独立复核发现并修复旧版生成器保存标记：`createChunkSnapshot` 现由保存 owner 显式传入实际 generatorVersion，V2/V3/V4 脏块保存与可移植导出/重新读取各自保留版本。V2/V3 在修复前均有可执行失败，修复后 3/3 通过。新增工位还拒绝来自生成 Worker 的孤立工位体素，不能先接纳后等恢复阶段才发现。

## 2026-09-10 浏览器成长与复核

真实生产构建 Browser 第一次成长操作及保存重进完成，但新煤/铁像素模型被旧 tool-only 适配规则拒绝，页面异常使整项验收失败；新图标也指向不存在的静态 PNG。修正非放置资源像素准入，按已有 native texture 生成缓存图标，再跑同一实际鼠标/槽位旅程通过（1/1，约 1.2 分钟），新增图片 naturalWidth 检查；铁镐 250/250、旧木镐 57/60、箱子恢复均通过。截图已人工检查，工作台配方需要滚动，属于当前有界界面行为。

独立只读复核确认 `GameServer.edit()` 也必须守工位双向完整性。新增 raw 单项创建/删除 RED 后接入与 editBatch 相同 guard，保留正常 prepared Block 联合事务入口。相关资产和工位 3 文件 19 项通过。另一项旧生成器保存标记问题及 Worker 准入已关闭。该复核不是 S6 全量独立审阅。

全量静态第 4 轮：325 文件 / 1733 测试通过、4 skip，末尾验收脚本两处可选方法调用类型失败；修复后完整 typecheck 通过，Svelte 0 error / 0 warning。两次生产 build 分别通过。之后有 actor/provider 新改动，最终 frozen static/build 待重跑。

旧 Browser 外观存储两项测试直接 import `/src/*.ts`，在生产 preview 上因不存在源码路径失败，应在独立开发服务器复验，不据此判产品存储故障；木剑体验场连招第二段观察首次超时，保留日志并定向重查。原始本机日志为 `/tmp/seedlands-s4-browser-journey1.log`、`journey2.log`、`browser-regression1.log`（均以相同 seedlands-s4 前缀），后续交付快照须给出最终结果。

定向复验：`/tmp/seedlands-s4-browser-regression2.log` 的木剑体验场、两项创造模式和两项开发者来源用例 5/5 通过（17.5 秒）；体验场第一次第二段观察超时未复现。完成本批实际验证后，任务自有 preview 已停止，4173 无监听。两项需要 Vite 源码导入的外观用例留待代码冻结后的开发服务器验收。
