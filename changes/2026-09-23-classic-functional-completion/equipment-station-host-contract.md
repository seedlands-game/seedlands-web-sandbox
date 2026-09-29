# V2 Equipment Station Host 合同

阶段：V2-EQUIPMENT-STATION-HOST-01  
状态：root 已冻结公共 spine 与 revision；本片只修 registered station host 对 equipment candidate 的提交。

## Owner 与最小修复

- registered-station-runtime.ts 是 station context inventory-pointer 的唯一 host adapter。纯候选仍由既有
  inventory pointer model 生成，actor equipment 仍由 ECS actor equipment.armor 唯一持有。
- host 的同一 prepared actor replacement 必须提交候选的完整 bag、cursor/crafting 与 equipment；不得只提交
  bag/cursor 后丢弃或复制 armor。修复只增加 equipment: candidate.equipment。
- station component 只在候选 station revision 实质变化时参与 mutation；纯 equipment/bag/cursor 操作不得
  虚增 station revision。actor interaction revision 仍由 prepared entity mutation 唯一计算。
- 继续复用既有 authorization、距离/LOS、actor/station lifetime、observation revision、capacity、tool
  cancellation 与 prepared validate/apply；不新增绕过提交路径。

## 验收

- 非 Classic armor + workbench 真实 composition，经 GameplayRuntime.inventoryPointer station context 证明
  四槽代表性穿入、脱下、占用交换与 equipment-origin close；保留 instance/durability，物品总量守恒。
- 每次实际 actor 交互 inventoryRevision 恰加一；纯 actor 变化不改变 station revision；成功 operation fact
  每次仅发布一次。
- authorization 拒绝、actor 或 station 在 prepare 后 stale、spawn capacity 失败均保持候选外的真实并发变化，
  且不部分提交 candidate 的 bag/cursor/equipment/station/drop 或新增 receipt。
- changed selected hotbar item 沿用真实 host cancellation，清理 actor breakAction；不伪造 cancellation port。

## 非目标

- 不修改 761 独占的 pointer model/slot-state/behavior test，不改变 equipment 规则。
- 不修改已准出的 revision、protocol、projection、death、combat 或 UI；不进入 I2.2。
- 不运行 build、Browser、Cua 或 CI。预算：AI 活跃 1-3h、传统 0.5-1 PD；保守 120% 为 AI 3.6h、
  传统 1.2 PD。credits、API 等价费用、额度分母与占比 unknown。
