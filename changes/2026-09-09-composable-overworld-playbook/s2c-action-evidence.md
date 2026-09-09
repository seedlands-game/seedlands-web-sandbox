# S2c Action / Combat 身份与恢复证据

## 范围

本切片只实现 ActionRuntime、CombatRuntime 的可选宿主身份端口与版本化 codec。EntityStore、GameplaySnapshot V4、AutonomyRuntime、Authority 接线由主任务负责；这里不声明端到端存档集成完成。

## 精确 API

`packages/game-core/src/server/simulation/action-identity.ts` 导出：

```ts
type EntityLifetimeReference = Readonly<{
  entityId: string;
  epoch: number;
  lifetime: number;
}>;

type EntityIdentityPort = Readonly<{
  referenceFor(entityId: string): EntityLifetimeReference | null;
  resolve(reference: EntityLifetimeReference): string | null;
  rebind(reference: EntityLifetimeReference): EntityLifetimeReference | null;
}>;
```

- `referenceFor` 在动作接受时从宿主稳定 ID 捕获 epoch/lifetime；Action payload 中出现 `actorIdentity` 或 `targetIdentity` 会被拒绝。
- `resolve` 在运行、路径推进、成功结算、combat retain/advance/hit 检查点核对当前绑定。
- `rebind` 只用于 checkpoint 内保存的引用：lifetime 相同才迁移到当前 epoch。
- `ActionRuntime` 构造函数为 `(cloneValue, identity?: EntityIdentityPort)`。
- `CombatRuntime` 构造函数为 `(callbacks, registry?, identity?: EntityIdentityPort)`。

无 port 的 standalone runtime 继续写 V1；有 port 时 Action 写 V2，Combat 写 V2。V2 active 记录必须包含 actor/target binding；combat 还保存 phase、phase elapsed、完整 buffered target/binding、lastResult/resultSequence。V2 缺 port 或缺 binding 直接拒绝，不回退到 V1。

## 恢复与失效语义

- V1 Action 在有 port 的宿主中按当前存活实体一次迁移并在下一次写出时成为 V2。
- V2 active actor 缺失或 lifetime 不同会在替换前拒绝整个 restore；已有 runtime 状态保持不变。
- active target 缺失结算为 `restore-target-missing`；lifetime 不同结算为 `restore-target-lifetime-mismatch`。buffered target 使用对应的 `restore-buffered-target-*` 原因。
- terminal Action 与 Combat history 不要求 actor/target 仍存活，原始稳定 ID 和已有 result 保留。
- 执行期旧绑定按 `actor|target-missing`、`actor|target-lifetime-mismatch` 或 `actor|target-epoch-mismatch` 失败/取消。
- Combat V2 的 hit/recovery 必须携带与 action/definition/target/comboStep 一致的非 cancelled `lastResult`；恢复后从已保存 phase 继续，不会重复施加已经记录的 hit。
- Combat V1 继续在 restore 后产生 `restore-cancelled`，保留旧 cooldown 行为。

## RED / GREEN

RED（实现前）：

```text
pnpm vitest run tests/server/action-identity-restore.test.ts tests/server/combat-identity-restore.test.ts
Test Files 2 failed (2)
Tests 8 failed (8)
```

失败覆盖 V2 未生成、宿主绑定未捕获、恢复阶段未保留、缺失目标未结算、actor 未原子拒绝、旧 binding 未在执行期拒绝，以及 combat 仍走 V1 restore-cancelled。

最终定向验证：

```text
pnpm vitest run tests/server/action-identity-restore.test.ts tests/server/combat-identity-restore.test.ts tests/server/action-runtime.test.ts
Test Files 3 passed (3)
Tests 13 passed (13)
```

此外：

- 六个本切片源码/测试文件的定向 ESLint：通过。
- 本切片初次完成时 `pnpm --filter @seedlands/game-core typecheck` 通过；最终复跑时被并行 V4 接线的 `src/server/game-server.ts(87): GameplaySnapshotV4 not assignable to GameplaySnapshotV3` 阻塞，因此不声明当前全包 typecheck green。
- `tests/server/gameplay-foundation.test.ts` 的其余行为通过；主任务注入 port 后，3 个把当前 checkpoint 当作旧 V1 并断言一律 `restore-cancelled` 的旧用例需由集成方改成显式 V1 fixture。V2 恢复进行中阶段是本期批准的新合同。

## 未验证与集成缺口

- 未运行全量 `verify:static`、build、浏览器或性能验证。
- `tsc -p tsconfig.test.json --noEmit` 当前被并行 V4 fixture 的 `tests/server/ecs-component-snapshot.test.ts(131): GameplaySnapshotV3.entityStore` 中间态错误阻塞；该文件不在本切片写入范围。
- 主任务仍需把同一 `EntityIdentityPort` 注入 ActionRuntime/CombatRuntime，并让 Gameplay V4 保存候选世界的 V2 action/combat 快照；恢复顺序必须先建立候选实体身份，再调用 runtime restore。
