# Headless Authority 适配进度

## 目标与边界

- Headless 入口只负责无 DOM 的本地传输与命令行适配，权威状态、固定物理步、gameplay/fluid lane、Logic 观察与意图均复用 `AuthorityRuntime`。
- 新世界出生点调用通用 `runWorldComputeTask(find-safe-spawn)`；未知 Chunk 调用同一 `generate-mesh` 计算入口后再由 Authority 接纳，不在 Headless 内复制世界生成规则。
- `/tick <seconds>` 保留秒语义，按最多 60 秒一段调用 `AuthorityRuntime.advanceSession()`，累计其返回的真实 lane 数；流体候选在每次调度回调中同步计算并提交，Logic 观察同步决策并回提意图。
- 除 `/tick` 外，命令经 `AuthorityRuntime.executeTransaction()` 和 `AuthorityRuntime.executeCommand()` 执行，共用同一来源身份和幂等序列。
- 持久化使用 `MemoryGamePersistence`，不访问浏览器 IndexedDB 或真实用户存档。

## 已冻结的主线接口

`runtime_integration` 已确认由主线提供：

```ts
AuthorityRuntime.advanceSession(elapsedMs: number): AuthorityAdvanceResult;
AuthorityRuntime.frequencies: Readonly<{
  physicsHz: 30 | 60 | 120;
  gameplayHz: 10 | 20;
  fluidHz: 20 | 30;
}>;

type AuthorityAdvanceResult = {
  snapshot: AuthoritySnapshot;
  lanes: {
    physicsSteps: number;
    gameplayPeriods: number;
    fluidPeriods: number;
  };
  gameplay: AuthorityGameplayView;
  commits: WorldCommitResult[];
};
```

单次 `elapsedMs` 必须是有限非负数且不超过 60,000；Authority 内部按固定量子推进并偿还物理 debt，lane 数来自真实调度结果，不由 Headless 根据墙钟估算。

## RED 用例设计

- `tests/server/headless-session.test.ts`
  - 相同 seed 经通用计算入口得到确定性脚底中心出生点，Headless 只持有一个 Authority。
  - `advanceSession(1000)` 在默认频率下返回 60/20/30 的真实 lane 数，并让高空世界物品通过 Authority 物理下落。
  - 水源在推进期间产生并提交流体候选；Logic 观察产生意图并回提 Authority，二者都不是空回调。
  - 30/60/120 Hz 下 `advancePhysics()` 使用同一墙钟语义，且 `/tick` 超过 60 秒时分段累计，不丢掉中间计算反馈。
  - 相同事务序列重放同一命令不会重复修改世界。
- `tests/server/server-headless-cli.test.ts`
  - 保留既有 JSON line 命令和实体命令兼容断言。
  - 新增 `/tick 1`，断言输出真实 physics/gameplay/fluid lane 数和旧式成功字段。

实际 RED：首次运行时 `HeadlessSession` 模块不存在，CLI `/tick 1` 仍返回旧 `advanceGameplay()` 的 `{ commits, pickups }`，两个测试文件失败。完成 Headless 适配主体后再次运行，既有两条 CLI 流程已通过；新增推进用例明确因 `AuthorityRuntime.advanceSession/frequencies` 尚未落地而失败，没有用估算或旧 gameplay tick 绕过。

## 当前状态

- 阶段：GREEN，Headless 适配与定向准出完成。
- 主线依赖：`687563a feat: expose deterministic authority advancement` 已提供冻结的 Authority advance API。
- 已通过：`pnpm exec vitest run tests/server/headless-session.test.ts tests/server/server-headless-cli.test.ts`，2 个文件、12 个用例通过；覆盖安全出生、真实实体下落、流体候选提交、Logic 回提、30/60/120 Hz、独立 lane helper、61 秒分段 `/tick`、事务去重和既有 CLI 兼容。
- 已通过：受影响文件 Prettier、ESLint、source TypeScript 与 `git diff --check`。
- 项目级 test TypeScript 的其他共享 WIP 错误不属于本模块；Headless 文件没有 TypeScript 错误。
- 构建：`pnpm build` 已执行，但被共享主线中与 Headless 无关的 test TypeScript 错误阻塞（`browser-authority-client.test.ts`、`snapshot-interpolator.test.ts`、Harness 类型、Logic observation fixture 与 compute worker fixture）；source TypeScript 和 Svelte 检查已通过。

## Delivery Snapshot

- 生产入口：`src/server/headless/headless-session.ts`、`scripts/server-headless.mjs`。
- 自动化证据：`tests/server/headless-session.test.ts`、`tests/server/server-headless-cli.test.ts`。
- Headless 不创建第二个 `GameServer`，不调用旧 `advanceGameplay()`，不访问真实存档；所有状态变更仍由 Authority 拥有。
- 已知边界：异步未知 Chunk 在每个 Headless advance 分段前后预载或排空；Authority 的同步 `advanceSession()` 内部不等待异步 Chunk 计算。
- 项目级生产构建仍需在上述共享 fixture 修复后重跑，不能由本模块的 Vitest 结果替代。
