# V2 Equipment 公共 Spine 合同

阶段：`V2-EQUIPMENT-SPINE-01`
状态：接口与可执行 RED 冻结；不代表 equipment 行为、死亡策略或浏览器 UI 完成。

## Owner 与边界

- `EntityStore` 的 actor `equipment.armor` 是四槽唯一权威 owner；槽位固定复用
  `ArmorSlot` / `ARMOR_SLOTS`：`helmet`、`chestplate`、`leggings`、`boots`。
- stdlib pointer 只增加通用 `{ kind: 'equipment', slot: ArmorSlot }` target/origin 与完整 armor
  candidate/projection；不增加 equip action，不识别 Classic item ID。
- Authority 与 reference projection 只深复制当前已提交 armor，保留 item instance/durability；Web UI
  后续只消费该投影，不持第二份装备状态。
- 本阶段不安装 equipment pointer 行为、不修 armor-only `inventoryRevision`、不接 death policy、不改变
  combat armor reduction。它们分别属于 I2.1、I2.1b、I2.2 与 I2.1c。

## Pointer 与投影

`InventoryPointerSlotRef` 与 `InventoryCursorOriginV1` 增加：

```ts
Readonly<{ kind: 'equipment'; slot: ArmorSlot }>;
```

输入 validator 必须拒绝未知字段、非法 armor slot、数字 equipment slot 与 inventory/crafting/station
形状混用；network action copy 复用同一 validator，不能保留调用方引用。当前 actor pointer projection、
`AuthorityInventoryView`、inventory action candidate 与 network gameplay player reference 均携带完整四槽
armor；每个非空 `InventorySlot` 连同 `instance.durability` 深复制并冻结。V4 存档缺失 armor 仍由现有
ECS restore 迁移为空四槽，当前投影不使用 optional armor。

候选表示一次完整 `bag + cursor/crafting + armor` replacement。现阶段 equipment target 在现有注册
`inventory-pointer` 动作进入行为层后仍失败，作为 I2.1 的可执行 RED；不得用 missing import、类型错误或
test collection failure 代替。非 Classic `sample:visor`/`sample:suit` 只通过 `armor` capability 声明槽位，
证明公共层没有 Classic ID switch。

## Revision 与失败

- bag、cursor/crafting 或 armor 任一实质变化，整个事务的 `inventoryRevision` 恰好 `+1`；同事务多项
  变化仍只加一次。armor-only 变化必须使旧 pointer revision stale。
- no-op、校验拒绝、cancel 与准备/提交失败均不推进 revision，不部分改变 bag/cursor/armor/drop。
- selectedSlot/hotbarSize 保持现有语义；本阶段不以通用深比较改变 select 的 revision 行为。
- 当前 `prepared-entity-mutation.ts` 只比较 inventory/cursor，armor-only revision RED 留给 I2.1b 修复。

## Death Settlement 候选

stdlib 提供纯通用 `buildDeathInventorySettlementCandidateV1` 与
`prepareDeathInventorySettlementParticipantV1`：输入当前可信 actor reference/snapshot、位置和显式 policy；
候选覆盖 bag、cursor stack、四格 crafting grid 与四槽 armor，按稳定顺序生成每个实际 stack 一次的
drop intents，并保留 item instance/durability。policy 明确每个容器 `drop | retain` 以及 actor
`retain | despawn`，不内置 Classic 死亡规则。

participant 只把候选映射到同一个现有 prepared actor replacement/despawn + world-item spawn 事务；
helper 不拥有状态、不自行 apply。actor lifetime/revision 陈旧、allocator/spawn capacity 不足或任一校验失败
时，actor、drops、receipt 与 revisions 必须零提交。`prepared-death-effects` 继续只负责 action/combat/
perception cleanup，是额外 participant。

`prepared-combat-damage`、`actor-vitals-runtime` 与 `needs-state-port` 当前仍分别拼 death inventory；
combat/vitals 漏 armor，needs 还漏 cursor/crafting。I2.2 必须让三条 producer 共享该候选，禁止复制实现。
本阶段仅以现有 producer 的真实失败固定 RED，不安装新 policy，也不改变 legacy `classic-armor` 死亡保留预期。

## 验收与后续所有权

- GREEN：equipment slot/origin strict validate/copy、四槽 actor/Authority/network projection 的 detach/freeze
  与 durability 保真、death candidate/participant 的纯构造和 stale/capacity 原子性。
- RED：非 Classic 注册 pack 经正式 inventory-pointer action 把 `sample:visor` 放入 helmet；当前必须在
  行为期失败而不是 collection/import 失败。现有 combat death 对 bag+cursor+crafting+两件 armor 的完整
  settlement 也必须形成可执行 RED。
- 761 后续独占 I2.1 equipment pointer 私有行为与 I2.2 Classic policy/三 producer 接线；I2.1b 修
  armor-only revision，I2.1c 接 registered combat armor reduction/durability。公共协议、projection、exports、
  composition root 仍由唯一 Git writer 持有。

本阶段计划 AI 活跃 2-4h、传统 1-2 PD；保守乘 120% 后为 AI 4.8h、传统 2.4 PD。credits、
API 等价费用、额度分母与占比 unknown，不伪造。本增量不改变总 change 已登记预算。
