# S3 Combat module candidate 证据

## 结果

已实现纯 Combat projection/candidate codec、registered Combat module，以及独立 Combat Ruleset before/after module。三个 registered operations 只读取 readonly projections 并返回类型化 candidate，state writes 始终为空；实际 Combat/Action/ECS owner 与产品接线仍由 root 持有。

稳定 ID：

- capability：`seedlands:combat`
- actor/world components：`seedlands:combat-actor`、`seedlands:combat-world`
- actor/world-clock resources：`seedlands.combat`、`seedlands.combat-clock`
- operations：`seedlands:request-combat`、`seedlands:resolve-combat`、`seedlands:advance-combat`
- every-advance system：`seedlands:combat-system`
- world projection：5 partitions × 128 sorted actor references

## 类型与 codec

`CombatActorProjectionV1` 只暴露 stable lifetime reference、kind、health/lifecycle、`mode { value, revision }`、宿主派生的 `meleeDefinitionId`、public `CombatSnapshot` 和 pending `{ token, targetId, baseDamage }` 摘要。它不含 durable origin、allocator 或 private frontier。pending 必须对应已完成 windup 的 public frontier。

候选：

```ts
type CombatRequestCandidateV1 = {
  version: 1;
  kind: 'request';
  actorId: string;
  targetId: string;
  definitionId: string;
  rulesetRevision: number;
};

type CombatResolveCandidateV1 = {
  version: 1;
  kind: 'resolve';
  actorId: string;
  targetId: string;
  token: string;
  damage: number;
  rulesetRevision: number;
};

type CombatAdvanceCandidateV1 = {
  version: 1;
  kind: 'advance';
  seconds: number;
  cancelTokens?: readonly string[];
};
```

主要 helper：`combatActorAddress`、`combatWorldAddress`、`combatCapability`、`validateCombatActorProjection`、`validateCombatWorldPartition`、`validateCombatCandidate`，以及 request/resolve raw/effective input validators。

普通 identity 上限 256。pending token 使用独立 8192 上限，测试覆盖两个 256 字符 Unicode identity 经 `encodeURIComponent` 后形成超过 2048 字符的合法 token。

world advance 保持旧 `{ seconds }` 输入兼容，并允许可选 `cancelTokens` 显式清理无法再授权 resolve 的 pending hit。tokens 最多 1024、必须唯一，每项复用 8192 token 上限；重复或越界在 operation 前拒绝。该入口仍是 system-only world operation，普通 actor 不能借用。

## Ruleset 行为

`defineCombatRulesModule({ moduleId, profile })` 接受显式 `{ damageMultiplier, immuneTargetModes }`。before rule 完整重建 effective input：request 注入当前 Ruleset revision；resolve 从 actor pending 和目标 mode 计算 damage。缺少 before rules 时，raw input 不满足 operation effective schema并失败。

after rule 读取第四个 candidate，重新读取 actor、target 和 Ruleset observation，核对 actor/target identity、actor projection 的 melee definition、token、Ruleset revision 和精确 damage。标准 Combat module 没有硬编码 creative；只有显式 profile 将配置的 mode 设为免伤。

## RED / GREEN

RED：

```text
pnpm exec vitest run tests/server/composition/combat-module-candidates.test.ts
# 1 suite failed before collection
# Cannot find module .../combat-model
```

GREEN：

```text
pnpm exec vitest run tests/server/composition/combat-module-candidates.test.ts
# 1 file / 5 tests passed

pnpm --filter @seedlands/game-core typecheck
# passed

pnpm exec eslint \
  packages/game-core/src/server/gameplay/modules/combat-model.ts \
  packages/game-core/src/server/gameplay/modules/combat-module.ts \
  packages/game-core/src/server/gameplay/modules/combat-rules-module.ts \
  tests/server/composition/combat-module-candidates.test.ts
# passed
```

测试通过真实 composition/registered engine 和 fake readonly owner 的 `prepareCommit` 检查候选，证明 request definition 来自 actor projection、resolve damage 来自显式 profile、creative exemption 由 profile 控制、缺失规则与伪造 raw damage 拒绝、advance 读取全部五片并携带合法 cancellation token、重复 token 拒绝，且三类 candidate 均为零 writes。

## 未验证

- 没有实现或验证真实 host owner、Pack/default exports、GameplayRuntime、Autonomy、Browser 或 Headless 接线。
- test project typecheck 当前被范围外 `tests/server/prepared-combat-effects.test.ts` 引用尚未存在的 `simulation/prepared-combat-effects` 阻塞；本切片自己的 source core typecheck 与 ESLint 已通过。
- 未运行 full static/build、Browser 或性能测试，符合合同限制。
