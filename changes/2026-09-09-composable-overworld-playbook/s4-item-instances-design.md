# S4 物品实例与耐久候选设计

## 边界

本切片只扩展每世界物品定义与 `Inventory`。现有 Overworld 定义保持原样，没有物品在本切片获得耐久。GameplayRuntime、ECS/world-item codec、Pack 装配、工具消耗规则与 UI 由后续集成负责。

## 定义与实例

```ts
type ItemDurabilityDefinition = Readonly<{ max: number }>;
type ItemInstanceState = Readonly<{ durability: number }>;
type ItemStack = {
  itemId: ItemId;
  count: number;
  instance?: ItemInstanceState;
};
```

`ItemDefinition.durability` 是可选的显式定义。它只能用于 `itemType: 'tool'` 且 `stackLimit: 1` 的物品，`max` 必须是正安全整数。默认 Overworld 定义不增加该字段。

有耐久定义的 stack 必须带精确的 `instance.durability`，取值为 `1..max`。无耐久定义的 stack 禁止携带 instance。instance 只允许 `durability` 字段，避免未经校验的扩展状态被快照接受后静默丢失。

## 校验、迁移与复制

```ts
type ItemStackNormalizationOptions = Readonly<{
  migrateLegacyDurability?: 'initialize-at-max';
}>;

normalizeItemStack(items, value, options?): ItemStack;
cloneItemStack(stack): ItemStack;
sameItemStackIdentity(left, right): boolean;
```

`normalizeItemStack` 总是返回与输入脱离的规范副本，并验证当前每世界 registry。默认路径拒绝旧的无状态耐久工具；只有调用方显式传入 `migrateLegacyDurability: 'initialize-at-max'` 才补为满耐久。该选项是 codec 的版本化迁移入口，普通运行时不得使用。

registry 同时暴露同语义的 `normalizeStack` 与 `assertStack`。`assertStack` 不执行迁移，避免普通校验静默补状态；需要规范副本或迁移的 codec 可以调用 registry 方法或独立的 `normalizeItemStack` helper。

## Inventory 语义

- `contains(stack)`、`remove(stack)` 和堆叠合并按 `itemId + instance` 精确匹配；`count` 只是所需数量。现有无实例资源仍按 item ID 合并和跨栈移除。
- `containsAmount(itemId, count)` 明确提供忽略实例状态的数量查询，供只关心定义级材料数量的调用方选择使用。
- `add`、`canAdd`、`split`、`moveStack`、`remove`、`removeFromSlot`、`snapshot`、`replace`、`clear` 均复制 instance，并且不同耐久实例不合并。
- 所有候选先在完整副本上校验；失败不会替换 owner。`replace` 在全部 slot 归一化成功后一次替换。

## 测试设计

1. 定义拒绝非正/非整数上限、非 tool 耐久及 `stackLimit !== 1`；默认定义快照不变。
2. 正常归一化验证完整 instance，拒绝缺失、越界、未知字段、无耐久物品携带状态和未知物品。
3. 旧无状态工具只在显式迁移选项下补为 max；输入对象不被修改。
4. Inventory 的 add/move/split/remove/removeFromSlot/snapshot/replace/clear 保留深复制；不同状态不合并。
5. malformed replace 在替换前失败并保留当前 Inventory；detached candidate 失败不改变 owner。
6. 既有 item/inventory/recipe 与 per-world content 测试继续通过。
