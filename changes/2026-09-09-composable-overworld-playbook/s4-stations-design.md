# S4 工作站与炉体候选设计

## 边界

本切片只提供纯候选计算。调用方传入脱离 owner 的格子/槽位快照和每世界物品定义；函数完整验证、在临时副本上计算，并返回新的候选快照。函数不持有 EntityStore、Inventory owner、墙钟或全局默认定义，也不会直接修改玩家、方块实体或存档。

根任务后续负责工作站/炉体实体 owner、方块生命周期、授权 operation、把成功候选一次提交到权威状态，以及把炉体 snapshot 纳入世界 checkpoint。

## 3×3 工作站

```ts
type StationGrid = readonly (ItemStack | null)[]; // runtime 强制长度 9

type ShapedStationRecipe = {
  kind: 'shaped';
  id: string;
  pattern: readonly (ItemStack | null)[]; // runtime 强制长度 9
  outputs: readonly ItemStack[];
};

type ShapelessStationRecipe = {
  kind: 'shapeless';
  id: string;
  inputs: readonly ItemStack[];
  outputs: readonly ItemStack[];
};

matchesShapedStationRecipe(grid, recipe, items): boolean;
matchesShapelessStationRecipe(grid, recipe, items): boolean;
createStationCraftCandidate({ grid, output, recipe, items }):
  | { success: true; grid: StationGrid; output: InventorySlot[] }
  | { success: false; reason: 'recipe-mismatch' | 'output-full' };
```

有序匹配要求 pattern 的 9 个位置逐一对应：pattern 的 `null` 要求 grid 同位置也为空；非空位置要求物品相同且数量足够。无序匹配按现有基础合成语义汇总各物品数量，允许格子中有未参与该配方的剩余物品。两种 matcher 分开导出，避免调用方把无序配方误送进有序路径。

`output` 是任意正容量的 Inventory 快照。候选先在临时 Inventory 中验证全部输出可加入，再在 grid 副本中消费；任何失败只返回原因，输入参数不变。未知物品、非法 stack、错误 grid/pattern 长度、空 ID 或空输入/输出作为 schema 错误抛出 `TypeError`。

## 炉体

```ts
type FurnaceSnapshotV1 = {
  version: 1;
  input: ItemStack | null;
  fuel: ItemStack | null;
  output: ItemStack | null;
  activeRecipeId: string | null;
  remainingFuelSeconds: number;
  progressSeconds: number;
};

createFurnaceDefinitions({ items, recipes, fuels }): FurnaceDefinitions;
emptyFurnaceSnapshot(): FurnaceSnapshotV1;
validateFurnaceSnapshot(raw, definitions): FurnaceSnapshotV1;
advanceFurnaceCandidate(raw, logicalSeconds, definitions): {
  snapshot: FurnaceSnapshotV1;
  completedRecipeIds: readonly string[];
};
```

配方为单个输入 stack、单个输出 stack 和正数 `durationSeconds`；燃料定义为物品 ID 与正数 `burnSeconds`。定义创建时验证所有引用，要求 recipe ID、输入物品及 fuel item 唯一，不注入默认配方/燃料。

推进只使用显式 logical seconds。每轮先确认当前输入匹配且输出槽可完整接收下一份产物，再消耗燃料或推进时间。输出阻塞时保留输入、燃料和进度；完成时在同一个脱离 owner 的状态中扣输入并加输出，因此不会产生只有消费或只有产出的中间候选。`activeRecipeId` 把中途进度绑定到明确配方，避免更换输入后继承旧进度。

推进循环设固定 transition 上限，并受单槽合法 stack 数量进一步约束；超大 logical seconds 在输入或燃料耗尽后停止，不使用墙钟或异步计时。所有时间按微秒精度舍入，snapshot 要求有限非负值且 `progressSeconds < durationSeconds`。

## RED 与验收设计

- 有序配方错误位置和应为空位置有额外物品时拒绝；无序 matcher 不依赖位置。
- output full、配方不匹配及 schema 错误均保持调用方 grid/output 不变。
- 两个物品 registry 使用不同自定义 ID，定义和候选不能跨世界混用。
- 炉体输出满时不扣输入/燃料、不推进；解除阻塞后只产出一次。
- 中途冶炼 JSON roundtrip 后继续推进，输入、燃料、输出、剩余燃料和进度守恒。
- 未知物品、坏版本、非法时间、重复定义和非有限 logical seconds 拒绝。
