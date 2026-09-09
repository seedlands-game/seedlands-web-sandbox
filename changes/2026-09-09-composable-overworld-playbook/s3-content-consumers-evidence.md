# S3 每世界内容消费者接缝证据

## 范围与结论

本记录只覆盖仍直接读取全局物品 registry 的服务器消费者。`GameServer` 现在接受可选 `content: GameplayContent` 并传给 `GameplayRuntime`；未传时继续使用既有默认内容。`GameServerGameplayFacade.itemDefinitions` 只读返回当前 `gameplay.content.items`，命令查询、give/remove/spawn、actor authority 的食物判断与逻辑观察物品投影均使用这一世界实例的 registry。

Slash parser 只按 `isItemId` 校验并规范化物品 ID 的语法，因此可接受合法的 namespaced ID，也接受语法合法但当前世界未知的 ID。命令执行在任何库存或世界实体效果前调用当前 `server.itemDefinitions.require`，未知物品会被该世界拒绝。parser 不再把进程级默认定义集合当作世界内容。

低层 actor authority 和 observation builder 的纯入口新增显式只读 `ItemDefinitionRegistry` 参数；真实 `GameServer` facade 传入与 EntityStore/GameplayRuntime 相同的 `content.items`。这两个入口不保留全局 fallback，避免 fixture 或宿主遗漏内容绑定时静默读取另一世界的定义。

## RED

在生产接线前执行：

```text
pnpm exec vitest run tests/server/gameplay-content-consumers.test.ts

Test Files  1 failed (1)
Tests       4 failed (4)
```

四项分别精确失败于：parser 以全局 registry 拒绝合法 `example:moon-fruit`；item definitions 查询仍返回默认 11 项；真实 GameServer 忽略 custom content，导致 custom world item 被默认 registry 拒绝；facade 没有 per-world `itemDefinitions`。

## GREEN

新增定向合同：

```text
pnpm exec vitest run tests/server/gameplay-content-consumers.test.ts

Test Files  1 passed (1)
Tests       4 passed (4)
```

覆盖：

- parser 接受并规范化 custom namespaced ID，拒绝多冒号等非法语法；语法合法的未知 ID 进入执行期验证。
- 真实 custom GameServer 的 item inspect、give 与玩家 consume 使用 custom definition 和 hunger restore。
- grazer authority consume 与 `AuthorityLogicObservationBuilder` 对同一 custom food 使用当前世界 registry，观察投影给出正确 edible/hungerRestore。
- custom/default 两个世界的定义互不泄漏；默认 berry 路径保持可用；custom ID 在默认世界的 give 执行前拒绝且 inventory 不变。

受影响的默认命令、actor authority、未知 Chunk、observation 与 Authority 回归：

```text
pnpm exec vitest run tests/server/gameplay-content-consumers.test.ts tests/server/gameplay-command-persistence.test.ts tests/server/server-command.test.ts tests/server/authority-actor-rules.test.ts tests/server/gameplay-action-identity.test.ts tests/server/gameplay-unknown-chunk.test.ts tests/server/logic-observation-builder.test.ts tests/server/authority-runtime.test.ts

Test Files  8 passed (8)
Tests       42 passed (42)
```

生产 core 与测试类型检查：

```text
pnpm --filter @seedlands/game-core typecheck
# exit 0

pnpm exec tsc -p tsconfig.test.json --noEmit
# exit 0
```

拥有文件 lint 与格式检查：

```text
pnpm exec eslint <S3 consumer owned TypeScript files>
# exit 0

pnpm exec prettier --check <S3 consumer owned files>
# All matched files use Prettier code style
```

## 集成 API 与仍未验证

- 直接构造入口为 `new GameServer({ ..., content?: GameplayContent })`；公开 `GameServerOptions` 仍定义在主任务拥有的 `game-server-types.ts`，主任务组合 composition options 时需要同步该显式类型。
- `ActorAuthorityGameplayContext.items` 和 `buildLogicObservation(...).items` 现在是必填 registry。既有低层测试 fixture 需要显式传 `defaultItemDefinitionRegistry` 或其被测 EntityStore 对应 registry；本接缝有意不提供全局 fallback。
- 本子任务不修改 `GameplayRuntime`、composition、Combat 或其他测试，也不运行全量 static/build、Browser 验收或性能测量；由主任务集成后统一验收。
