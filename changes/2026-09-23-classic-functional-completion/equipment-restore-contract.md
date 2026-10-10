# V2 Equipment Restore Regression 合同

阶段：V2-EQUIPMENT-RESTORE-REGRESSION-01
基线：`e0594e0260b54274db1e570f632ae4a9b9042152`

## 范围与 owner

本片只验证已提交 equipment core 的保存恢复边界，不修改 V4 schema 或任何生产实现。权威装备仍是
`entityStore.actors[].equipment.armor` 的固定 `helmet/chestplate/leggings/boots` 四槽；bag、cursor/crafting、
armor 和 `inventoryRevision` 由同一个 actor snapshot 保存并恢复。测试使用真实注册的非 Classic armor
capability 与既有 `inventory-pointer` action，不包含 Classic item ID switch。

761 正在实现的 registered combat armor 文件、`armor-equipment.ts`、`prepared-combat-damage.ts`、相应测试与
`spec.md` 不属于本片。本片也不修改 restore protocol、Pack、death、UI、Lighting 或 transport。

## 可执行场景

1. 经正式 registered pointer 将非默认 durability 的 visor 穿入 helmet，同时保留 bag、origin-bearing cursor
   和 personal crafting grid；V4 snapshot 必须完整编码这些字段，restore 后逐项保持且不共享可变别名。
2. target runtime 在 restore 前取得的 actor reference 与 retained actor access 必须因 owner epoch 换代失效；
   restore 后取得的新 reference 可继续通过正式 pointer 穿、脱、occupied swap，每次实质变化使同一
   `inventoryRevision` 恰加一。
3. 历史 V4 actor 的 `equipment.armor` 缺失时恢复为完整四空槽，不改变 bag、cursor、hotbar 或 selected slot。
4. armor 放错 capability slot，或实例 durability 越界时，restore 必须在候选 owner 内拒绝；当前 actor、world
   entity set、gameplay revision、inventory revision 与旧 reference 均不发生部分提交。

## 证据与判定

- 先在已保留 clean V2 tree 上运行一次现有 Web `gameplay-inventory-pointer.test.ts` 9 项回归。若仍在
  `assembleOverworldPacks` 的 resource integrity setup 失败，则记录为独立 Pack fixture 缺口，不将其解释为
  pointer 或 restore 行为结果，也不越域修 Pack。
- 新测试只放在专属 detached test tree 的
  `packages/stdlib/tests/server/equipment-pointer-restore.test.ts`；行为已由已提交 core 提供，预期直接 GREEN，
  不制造无意义 RED。失败时保留真实行为 RED 并停止生产修改。
- 仅运行新增 suite、stdlib/root test/Classic test types 与目标 lint/format/diff；全部命令使用默认
  `benchmark-window`，Vitest `--maxWorkers=1`。不重跑 GIT-21 全矩阵，不运行 build、Browser、Cua、CI。

## 完成条件

Web 9 项的实际结果与 Pack 归因已归档；新增非 Classic restore suite 覆盖上述四类不变量；源码未修改，
新增 test、合同、证据及 `tasks.md`/`execution-state.md` 可供 root 审阅。当前片不 Git、不暂存、不推送。
