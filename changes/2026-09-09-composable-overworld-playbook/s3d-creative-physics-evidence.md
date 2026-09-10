# S3d 创造飞行与安全落地物理证据

## 结果

- `AuthorityServerPort` 新增可选只读查询 `getActorModeState(id)`。`AuthoritySession` 只在该权威状态同时为 `creative` 且 `flight.enabled` 时启用受控飞行；未提供端口、survival 或 creative 禁飞均继续执行原重力路径。
- 受控飞行复用现有 `verticalIntent`，竖直速度采用实体配置的 `maxHorizontalSpeed`（玩家当前为 4.5）；上升、下降和零输入悬停仍进入同一个 `stepBody` swept-AABB、接触和未知 Chunk blocker 流程。网络输入不能直接设置内部 `controlledFlight` 字段。
- 新增纯查询 `findSafeModeLanding(entity, voxelSource)`。它使用已注册实体 body config 和 AABB，只检查实体当前 x/z 正下方、至多 8 个体素距离的候选碰撞面；候选必须来自已加载的 `voxel:` 碰撞几何、通过现有 swept reachability，并在目标位置形成真实向上接触。未知体素只会成为 blocker，不会成为支撑面。
- helper 不修改实体或模式。宿主只有在模式切换事务决定提交后才应应用返回坐标，并清零竖直速度。

## RED

生产源码修改前，飞行合同首次执行：

```text
pnpm exec vitest run tests/server/creative-authority-physics.test.ts

Test Files  1 failed (1)
Tests       3 failed | 2 passed (5)
```

失败项分别证明：creative+flight 仍向下受重力；向上飞行未产生预期速度，因此天花板与未知区域用例无法到达受控碰撞状态。两个通过项是 survival 与 creative 禁飞的既有重力基线。

加入安全落地合同但尚未新增生产入口时，同一命令在模块加载阶段因 `creative-physics` 不存在而失败，0 项测试加载。这证明落地负例并非由默认空实现假绿。

## GREEN 与回归

定向合同：

```text
pnpm exec vitest run tests/server/creative-authority-physics.test.ts

Test Files  1 passed (1)
Tests       7 passed (7)
```

覆盖创意飞行上升、下降、悬停；墙体和天花板碰撞；生存与创意禁飞重力；飞行遇未知空间阻挡并请求 Chunk；灯笼实际 0.94 高碰撞面落脚；未知支撑、无支撑和超过 8 格支撑均拒绝。

物理与 Authority 相邻回归：

```text
pnpm exec vitest run tests/physics tests/server/authority-session.test.ts tests/server/authority-runtime.test.ts tests/server/authority-entity-lifetime.test.ts tests/server/creative-authority-physics.test.ts

Test Files  7 passed (7)
Tests       59 passed (59)
```

生产与测试类型检查、owned lint/format、diff whitespace 均通过：

```text
pnpm --filter @seedlands/game-core typecheck
pnpm exec tsc -p tsconfig.test.json --noEmit
pnpm exec eslint <S3d owned TypeScript files>
pnpm exec prettier --check <S3d owned TypeScript files>
git diff --check -- <S3d owned files>
# all exit 0
```

## 集成 API 与未验证边界

```ts
type AuthorityActorModeState = Readonly<{
  mode: 'survival' | 'creative';
  flight: Readonly<{ enabled: boolean }>;
}>;

interface AuthorityServerPort {
  getActorModeState?(id: string): AuthorityActorModeState | null;
}

findSafeModeLanding(entity: AuthorityEntity, voxelSource: LoadedVoxelSource): [number, number, number] | null;
```

根任务需要让真实 `GameServer` 从该世界的 mode component 返回最小模式投影。落地适配器必须把未加载体素映射为 `null`，并为已加载体素提供真实 `voxel`、`chunkKey`、`revision`；不能把 `undefined` 当空气。`ModeRuntime.findSafeLanding` 可调用 helper，但应用坐标和清零速度仍由其候选提交负责。

本切片没有修改 `GameServer`、`GameplayRuntime`、模式组件、命令或 UI；没有运行全量 static/build 或浏览器飞行验收，也不声明完整 S3d 已交付。落地点搜索刻意只做同 x/z 的竖直 8 格物理检查，不提供水平传送或并行导航器。
