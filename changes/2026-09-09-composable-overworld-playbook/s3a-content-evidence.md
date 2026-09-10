# S3a 每世界玩法内容实施证据

## 结果

- `GameplayRuntime` 现在接受可选的 `content?: GameplayContent`，并把同一个只读物品注册表传给 `Inventory`、ECS actor inventory、`EntityStore` 以及 V1/V2/V3/V4 候选存档恢复。
- 显式提供的内容是精确集合：不会回退到内建物品或配方。未知物品在 inventory、world item 或存档候选验证阶段拒绝，候选恢复失败不会替换当前运行时状态。
- 自定义命名空间物品和配方已覆盖 give、craft、drop、pickup 与 V4 恢复；V4 恢复同时保留合法进行中的攻击阶段及命中去重。
- 两个同时存在的 runtime 可对同一物品 ID 使用不同 stack limit 和配方输出，彼此不共享可变注册表状态。
- 旧默认构造、旧自由 helper 和既有内建 ID 暂时保留，以维持迁移期兼容。

## 集成 API

```ts
type GameplayContent = Readonly<{
  items: ItemDefinitionRegistry;
  recipes: RecipeRegistry;
  meleeDefinitions: readonly MeleeDefinition[];
}>;

createGameplayContent(input: {
  items: readonly ItemDefinitionInput[];
  recipes: readonly Recipe[];
  meleeDefinitions: readonly MeleeDefinition[];
}): GameplayContent;

type GameplayCallbacks = {
  content?: GameplayContent;
  // existing callbacks omitted
};
```

`ItemDefinitionRegistry` 提供 `get`、`require`、`has`、`list`、`capability`、`assertStack`。`RecipeRegistry` 提供其绑定的 `items`、`get` 和 `list`。`Inventory` 构造函数第三个参数接受 `ItemDefinitionRegistry`；`EntityStore` 构造函数接受同一注册表。配方执行要求 inventory 与 recipe registry 绑定到同一个 item registry，避免跨世界内容混用。

`ItemId` 已扩展为字符串身份，并在注册时用 `^[a-z0-9][a-z0-9._-]*(?::[a-z0-9][a-z0-9._/-]*)?$` 验证。注册表仍负责拒绝未注册物品和非法堆叠。

## RED 与验证

- RED：先加入 `tests/server/gameplay-content-integration.test.ts`，运行时因 `gameplay-content` 模块不存在而失败，测试文件未能加载。
- 新行为定向：`gameplay-content-integration.test.ts` 5 项通过，覆盖自定义 give/craft/drop/pickup、V4 inventory/world item/in-flight combat 恢复与命中去重、双 world 隔离、未知内容原子拒绝、只读列表与无效引用验证。
- 回归集合：11 个测试文件、62 项测试全部通过，包含 content、inventory、interaction、EntityStore、ECS owner/component snapshot、player runtime、V1-V4 migration、action/combat identity restore 与 gameplay foundation。
- `pnpm exec eslint` 对全部 owned 源码和新增测试通过。
- `pnpm --filter @seedlands/game-core typecheck` 与 `pnpm exec tsc -p tsconfig.test.json --noEmit` 通过。
- `git diff --check` 通过。

## 尚未集成的边界

- 根任务仍需由 Pack/composition 显式构造并传入 `GameplayContent`，再移除产品启动对临时默认内容的依赖；本切片不声明 S3 完成。
- `authority/logic-observation-builder.ts` 与 `gameplay/actor-authority-gameplay.ts` 仍调用内建 `getItemDefinition`；自定义内容进入这些观察/权威路径时，应由根任务注入当前 runtime 的 `content.items`。
- 命令层仍有旧自由 helper 消费者；根任务接入 Pack 内容时应从当前 runtime/server 暴露的 registry 解析，而不是默认内建注册表。
- `voxel-gameplay.ts` 的掉落仍引用内建物品 ID。精确自定义 Pack 若启用这些体素规则，Pack 组装必须同时声明相应掉落物品，或由后续组合层把体素规则纳入内容依赖验证。
- `gameplay-content.ts` 位于现有嵌套 server 路径；若 Pack 作者需要从包顶层导入，根任务需在包导出面添加正式入口。
