# V2 Equipment Revision 合同

阶段：V2-EQUIPMENT-REVISION-01（I2.1b）  
状态：root 已准出公共 spine，本片只闭合共享 inventoryRevision 的 armor 变更语义。

## Owner 与范围

- 唯一 revision owner 仍是 prepared-entity-mutation.ts；不增加 equipment 专用 revision，也不增加 equip action。
- 变化判断覆盖 actor 的 bag、cursor（含 crafting grid）与规范化四槽 armor。一次 prepared actor replacement 无论一项或多项变化，inventoryRevision 都只从当前权威值增加一次。
- armor 的缺失历史形状按现有 ECS 迁移语义规范化为空四槽，因此 undefined armor 与显式四空槽等价。
- armor item 的 instance/durability 属于实质状态；durability 改变必须推进 revision。
- selectedSlot 与 hotbarSize 不纳入本次比较，保持既有选择与布局 revision 语义。

## 失败与原子性

- 同值 clone、规范化后等价的空 armor、no-op 不推进 revision。
- stale prepared participant 在 validate/apply 时拒绝，actor 与 revision 零提交。
- 实质 inventory/cursor/armor 变化遇到当前 inventoryRevision 为 Number.MAX_SAFE_INTEGER 时在 prepare 阶段拒绝；无变化不因 revision 已满而失败。
- cancel 或其他 participant 的 prepare/validate 失败沿用既有事务协调边界，本片不新增 apply 或回滚机制。
- armor-only 提交后，使用旧 expectedInventoryRevision 的正式 inventory-pointer 请求必须被 stale-inventory-revision 拒绝。

## 验收与非目标

- 独立测试覆盖 armor-only、bag+armor、durability、缺失 armor 与显式空槽等价、同值 clone、selectedSlot-only、stale participant、MAX_SAFE_INTEGER 变化拒绝和 no-op 容许。
- 不编辑 pointer model/slot-state 或共享 equipment RED，不实现穿脱/交换/UI。
- 不接 death producer、death policy 或 combat armor reduction/durability。
- 761 同期只拥有 I2.1a pointer 私有行为文件；本片与其写路径互斥。公共 protocol/projection/death helper 冻结。
- 预算为 AI 活跃 1-2h、传统 0.5-1 PD；保守 120% 为 AI 2.4h、传统 1.2 PD。credits、API 等价费用、额度分母与占比 unknown。
