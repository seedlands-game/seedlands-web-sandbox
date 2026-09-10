# S2b 玩家和 NPC 组件切换证据

状态：切片已集成，等待 S2 全量门禁。使用已批准主合同及 ECS 补充合同；此记录不代表 S2/S6 准出。

## RED

在 S2b 生产修改前运行 `pnpm test tests/server/actor-components-integration.test.ts`：3 项均按预期失败。玩家 Entity 投影缺少生命；NPC 调用已有 giveItem 被 `Unknown player: npc` 拒绝；跨世界生命写入因旧门面不允许玩家 health 而失败。该组验证公共 GameplayRuntime 的可观察行为，不把新增空组件视为迁移完成。

## 迁移边界

同一个 per-world ECS owner 创建 Needs、Inventory、Equipment、Control 和玩家动作/出生位置组件，字段不放进另一份 PlayerState 可写存储。现有玩家饱食值 0–20 与自主角色饥饿值 0–100 保留语义，组件用 maxHunger/hungerMeaning 显式区分，规则阈值不偷换。Inventory 实例只在内部组件持有，公共 GameplayRuntime 返回复制投影。

存档版本、合法在途动作恢复与 epoch/lifetime 重新绑定由 S2c 集成后验收；当前不能声称 NPC 库存和控制绑定已跨 checkpoint 保持。

## GREEN 与集成复核

组件集成测试扩为 7 项并通过：玩家生命、NPC 库存、跨世界隔离、两种需求语义、竞争拾取仅一次、恢复/移除后的陈旧组件访问拒绝、生成 ID 不复用旧 frontier。与 S2a 实体 owner 合并运行 3 文件 14 项通过；相关既有玩法测试 7 文件 52 项通过。

保留 EntityStore 既有复合 update 的顺序性合同：合法 position 可以先提交，再因非法 velocity 拒绝；既有 data-plane 测试明确覆盖该行为。S3 注册事务会用独立候选/提交协调表达原子边界，不能擅自改写该旧门面语义。

运行时 Inventory 只由组件持有，公开访问使用逐次复核 epoch/lifetime 的转发门面；这组 GREEN 尚不单独证明跨存档或 Browser 产品验收。
