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

## A1/A2 收尾审计

新世界安全出生仍先以旧相机眼睛坐标返回 `groundY + 2.6`，再由计算任务硬编码减 `1.6` 得到脚底；这与 V3 和身体注册表确定的脚底中心合同重复。测试先把平坦地面的预期改为直接返回 `groundY + 1`，旧实现预期 RED；实现应从玩家注册身体推导净空格数，计算任务不得再做眼高迁移。

Logic 指标为零不等于 AI 停止：审计用固定 seed 的真实 Headless 会话推进 5 秒，要求产生 100 个 Logic batch，且至少一个 starter actor 的 Authority 脚底位置净移动超过 0.1 格。现实现预期已具备该行为；新增用例是缺失的端到端不变量证据，不以旧 `AutonomyRuntime` 的计数器替代活体位置验证。旧指标迁移另由主线定义新 Logic 诊断合同。

安全出生 RED 实测 2 项失败：旧函数仍返回眼睛高度 `72.6`，地面断言也读到空气。实现后 `findSafePlayerSpawn()` 直接返回注册身体脚底原点，净空格数由玩家 `localAabb` 高度推导，计算任务删除 `-1.6` 二次转换。Headless 5 秒用例同时确认 100 个 Logic batch 与 starter actor 的真实 Authority 位移。安全出生、计算任务、Headless 共 3 个文件 21 项通过，受影响 ESLint、源码 TypeScript 与 `git diff --check` 通过；测试 TypeScript 暂被并行流体优先级测试对已变更接口的 4 项调用阻塞，本阶段文件没有诊断。

组合 coverage 并发执行时，安全出生与五秒 Logic 活体旅程保留全部世界生成和 100 个 batch 断言，但默认五秒 runner 上限先于断言完成。两项重型集成用例显式使用十五秒上限；这只修正测试运行预算，不改变游戏频率、推进时长、性能阈值或验收内容。

## Delivery Snapshot

- 生产入口：`src/server/headless/headless-session.ts`、`scripts/server-headless.mjs`。
- 自动化证据：`tests/server/headless-session.test.ts`、`tests/server/server-headless-cli.test.ts`。
- Headless 不创建第二个 `GameServer`，不调用旧 `advanceGameplay()`，不访问真实存档；所有状态变更仍由 Authority 拥有。
- 已知边界：异步未知 Chunk 在每个 Headless advance 分段前后预载或排空；Authority 的同步 `advanceSession()` 内部不等待异步 Chunk 计算。
- 项目级生产构建仍需在上述共享 fixture 修复后重跑，不能由本模块的 Vitest 结果替代。
