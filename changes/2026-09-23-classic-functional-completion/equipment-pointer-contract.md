# V2 Equipment Pointer 行为合同

阶段：`V2-EQUIPMENT-POINTER-01`（I2.1a）

状态：私有 pointer 候选与非 Classic registered 第一项 GREEN；station host 组合接线由 954 独立验收。

## Owner 与输入

- ECS `equipment.armor` 继续是四槽唯一权威 owner；槽位只使用既有 `ARMOR_SLOTS`：`helmet`、`chestplate`、`leggings`、`boots`。
- 本阶段不新增 action、protocol、projection 或公开 export。pointer 候选复用公共 spine 已提供的 equipment target/origin、完整 actor equipment projection 与 registered prepared actor replacement。
- 槽位合法性只读 `ItemDefinitionRegistry.capability(itemId, 'armor').slot`，不识别 Classic item ID。每个 equipment 槽最多一件；item instance 与 durability 必须逐层复制并冻结。
- 所有计算在 detached mutable candidate 上完成，返回时重新深冻结 equipment；调用方 actor、bag、cursor/crafting、armor 及 instance 均不得被修改。

## 命令语义

1. `click` 左/右键从 equipment 取出时都取得唯一整件并记录 equipment origin；向空 equipment 放置时最多放一件，剩余仍在 cursor。occupied slot 仅允许同槽 armor 原子交换；错槽、非 armor、unknown item 或不能放置时整体失败。
2. 无 station 的 `quick-move` 从 bag 发起时，armor 优先进入其匹配的空 equipment slot，再按既有 hotbar/main 背包分区处理剩余数量；槽已占用时不替换，继续既有背包目的地。从 equipment 发起时按既有背包 merge-first/empty-second 顺序取出，满包返回 `destination-full`。
3. `hotbar` 可把 equipment 移入指定 hotbar 空位，或以匹配该 equipment slot 的 armor 原子交换；hotbar 中非 armor或错槽 armor 不得写入 equipment。
4. `distribute` 只支持既有 bag/crafting/station targets；任一 equipment target 明确 `invalid-pointer-slot`，并在任何 candidate mutation 前拒绝。`collect` 以 equipment 为 seed 同样明确拒绝，且既有 collect 扫描不吸取已装备物。
5. `close` 对 equipment origin 先尝试放回仍为空的合法原槽，再沿既有 bag merge/empty 与 formal drop settlement。原槽已占用或 bag 满不改变既有合法 drop 语义。`drop` 继续只处理 cursor；从 equipment 取出的 instance/durability 必须原样进入单一 drop intent。
6. 空 cursor/crafting 且无变化的 `close` 保持 no-op：`changed=false`，inventory/cursor revision 不推进。所有校验失败均不返回 candidate，来源 bag/cursor/crafting/equipment/revision 零变。当前 pointer command union 没有独立 cancel 命令；prepared host cancellation/receipt 属 I2.1b，不由本候选层伪造。

## 验收与边界

- 小型非 Classic content 注册四种 armor capability，覆盖上述命令矩阵、满包、occupied swap、instance/durability、输入不变与递归冻结。
- `equipment-spine-red.test.ts` 只定向执行第一项 `sample:visor` registered pointer 行为并转 GREEN；第二项 armor-only revision 和第三项 death producer 继续由其他 owner 处理，本阶段不改预期。
- 既有 pointer model、registered pointer/cursor settlement 回归必须通过。I2.1b 的 host prepare/cancel/receipt/V4 restore 更广组合验证、I2.1c combat、I2.2 death 和 UI 均不在本阶段。
- 交接时 `RegisteredStationRuntime` actor replacement 尚未提交 `candidate.equipment`；root 已将真实 station host 接线独占交给 954。纯候选保留 station equipment target/source/close 的合法语义，本阶段不以永久 fail-close 掩盖该接缝，也不把并行 host 修改计作本片 registered station GREEN。
- 不运行 build、Browser、Cua、devserver 或 CI；不修改公共合同/protocol/projection/exports、registered host、Classic pack、UI、death 或 combat。
