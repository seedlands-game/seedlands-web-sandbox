# S4 工作站与炉体纯候选证据

## 结果

- 新增纯函数 3×3 工作站候选：有序 matcher 精确比较 9 个位置和 `null`，无序 matcher 按现有 Inventory 语义汇总所需数量并保留无关格子内容。
- 合成先完整验证 grid、recipe、每世界物品引用和 output Inventory，再在脱离 owner 的副本中加入全部输出并消费输入。失败只返回 `recipe-mismatch`/`output-full`，调用方输入不变；坏 schema 或未知物品抛出 `TypeError`。
- 新增炉体 definitions 与 snapshot V1 codec。definitions 必须显式注入 per-world `ItemDefinitionRegistry`、recipes、fuels；不存在内建 recipe/fuel fallback。
- 炉体仅接受显式 logical seconds，以有界同步循环推进。每一步先证明 output 可完整接收，随后才消耗燃料和推进；产出完成时在同一候选中消费 input 并增加 output。
- output 阻塞时 input、fuel、remaining fuel 和 progress 全部保留。`activeRecipeId` 将中途 progress 绑定到明确配方；V1 JSON roundtrip 后继续推进不会重复产出。

## API

```ts
matchesShapedStationRecipe(grid, recipe, items): boolean;
matchesShapelessStationRecipe(grid, recipe, items): boolean;
createStationCraftCandidate(input: StationCandidateInput): StationCraftCandidate;

createFurnaceDefinitions(input: FurnaceDefinitionInput): FurnaceDefinitions;
emptyFurnaceSnapshot(): FurnaceSnapshotV1;
validateFurnaceSnapshot(raw, definitions): FurnaceSnapshotV1;
advanceFurnaceCandidate(raw, logicalSeconds, definitions): FurnaceAdvanceCandidate;
```

`StationCandidateInput` 包含 `grid`、`output`、单个 shaped/shapeless `recipe` 和 `items`。成功结果返回新的 9 格 grid 与 output Inventory snapshot。

`FurnaceSnapshotV1` 精确字段为 `version`、`input`、`fuel`、`output`、`activeRecipeId`、`remainingFuelSeconds`、`progressSeconds`。`FurnaceDefinitions` 提供 `recipe`、`recipeForInput`、`fuel`、`listRecipes`、`listFuels` 和绑定的 `items`。

## RED 与 GREEN

- 设计先写入 `s4-stations-design.md`。
- RED：新增两个测试文件后首次运行，`station-candidates` 与 `furnace-candidates` 模块均不存在，2 个 suite 失败、0 项测试加载。
- 实现后的首次测试有 8 项通过；唯一失败是测试把正确返回的 9 格数组写成 4 格精确期望。修正测试形状后候选行为转绿。同期 owned lint 指出的两处异常因果链已通过 `cause` 修复。
- 最终新增测试：2 个文件、9 项通过。
- 扩展回归包含 station、furnace、既有 item/inventory/recipe 与 per-world gameplay content：4 个文件、20 项通过。
- owned ESLint 与 `pnpm --dir packages/game-core typecheck` 通过；`git diff --check` 通过。
- 最终复核时全测试 TypeScript 入口被并行中的 Web 文件 `apps/web/src/client/prediction-buffer.ts:59` 两处 `movementRevision` 类型错误阻断；该文件不在本切片权限内。阻断前本切片同一实现曾通过该入口，且最终 20 项运行时回归保持通过，因此这里只声明 core 类型与定向运行时证据，不把当前全测试类型入口记为绿色。

## 根任务集成边界

- 根任务需要为工作站/炉体建立真实实体或方块组件 owner，并在候选计算后校验 owner revision 未变化，再一次提交 grid/input/fuel/output/progress，避免并发陈旧候选覆盖。
- Pack/content 装配需要注册 shaped/shapeless/furnace/fuel definitions，并把 exact per-world item registry 传入；本切片没有新增第一方物品、配方或生成数据。
- 炉体推进应接入权威 gameplay logical delta，并将 `FurnaceSnapshotV1` 纳入候选 checkpoint；不得改接墙钟或离线追赶。
- registered operation/authority 负责交互距离、主体权限、station identity/lifetime 和提交授权。本切片没有公开用户命令。
- 工作站/炉体随方块销毁时的内容掉落/结算仍需真实 owner 实现；本切片不声明 S4 产品集成完成。
- 未运行完整 static/build、浏览器或性能验收。
