# S4 物品实例与耐久候选证据

## 结果

- `ItemDefinition` 新增可选 `durability: { max }`。定义只允许正安全整数上限、`itemType: 'tool'` 和 `stackLimit: 1`，并拒绝 durability 中的未知字段。
- `ItemStack` 新增可选只读 `instance: { durability }`。有耐久定义的 stack 必须携带 `1..max` 的完整状态且 count 必须为 1；无耐久定义的 stack 禁止携带 instance。
- 默认 Overworld 定义没有添加耐久，既有无状态资源、方块、食物和工具数据保持不变。
- 每世界 registry 的 `normalizeStack` 与独立 `normalizeItemStack` 都返回脱离输入的规范副本；未知 item、坏 count、缺失/越界/多字段 instance 和未知 stack 字段均在 owner 替换前拒绝。
- 旧无状态耐久工具默认拒绝。只有显式传入 `{ migrateLegacyDurability: 'initialize-at-max' }` 才补为满耐久，供根任务按存档版本调用一次。
- Inventory 的 `contains`、`remove`、合并与移动按 `itemId + instance` 精确身份工作；新增 `containsAmount(itemId, count)` 供明确忽略 instance 的定义级数量查询。既有无实例资源行为不变。
- `add`、`canAdd`、`moveStack`、`split`、`remove`、`removeFromSlot`、`snapshot`、`replace`、`clear` 均使用深复制的 instance。不同耐久实例不合并；坏 replace 与 detached candidate 不替换当前 owner。

## 稳定 API

```ts
type ItemDurabilityDefinition = Readonly<{ max: number }>;
type ItemInstanceState = Readonly<{ durability: number }>;
type ItemStackNormalizationOptions = Readonly<{
  migrateLegacyDurability?: 'initialize-at-max';
}>;

normalizeItemStack(items, value, options?): ItemStack;
cloneItemStack(stack): ItemStack;
sameItemStackIdentity(left, right): boolean;

ItemDefinitionRegistry.normalizeStack(value, options?): ItemStack;
ItemDefinitionRegistry.assertStack(stack): asserts stack is ItemStack;
Inventory.containsAmount(itemId, count): boolean;
```

`assertStack` 永远使用严格模式，不执行旧数据迁移。普通运行时调用 `normalizeStack(value)`；只有已确认版本的 legacy codec 调用 migration option。

## RED 与 GREEN

- 先写 `s4-item-instances-design.md`，再新增测试。
- RED：首次运行 `item-instance-inventory.test.ts` 时 `item-instance` 模块不存在，1 个 suite 失败、0 项测试加载。
- 初次实现后 8/9 通过；唯一失败是测试尝试修改已冻结的 snapshot instance。测试改为验证不同引用和冻结状态，没有降低行为要求。
- 最终 owned 测试 9/9 通过。
- 扩展回归包含 item instance、根任务真实 owner、既有 item/inventory/recipe、per-world content、station/furnace、inventory interaction、ECS snapshot/player/actor：10 个文件、53 项通过。
- 根任务的真实 owner 测试覆盖 damaged tool 的 give → drop → ECS world item → V4 restore → pickup，并覆盖 registered inventory candidate 的状态保留和坏耐久拒绝；本次读回为 2/2 通过。
- owned ESLint、`pnpm --dir packages/game-core typecheck`、Prettier 与 `git diff --check` 通过。
- 额外尝试的全测试 TypeScript 入口被并行 UI fixture `tests/client/creative-mode-ui.test.ts:114` 阻断：构造的 `CommandResult` 缺少 `CommandResultBase.message`。该文件不在本切片权限内，因此这里只声明 owned/core 类型证据。

## 根任务集成边界

- Gameplay/ECS/world-item/registered inventory codec 必须对每个 stack 调用当前 world registry 的 `normalizeStack`，并保留返回值的 instance；不能再重建为只有 `itemId/count` 的对象。
- V1/V2/V3 等旧存档只有在根任务判定其 schema 明确缺少耐久时，才可调用 `normalizeStack(value, { migrateLegacyDurability: 'initialize-at-max' })`。V4 当前 schema 的坏或缺失 instance 必须失败，不得静默迁移。
- Pack/content definition proxy 必须透传 `durability`，lazy registry 必须透传 `normalizeStack(value, options)` 到同一个 per-world registry。
- 工具使用时的耐久扣减、耗尽移除、品质/tag、实际第一方耐久工具与 UI 不在本切片；跨方块/实体/Inventory 的扣减仍需根任务使用候选校验后的一次提交。
- 未运行完整 static/build、浏览器或性能验收，不声明 D5 或 S4 产品集成完成。
