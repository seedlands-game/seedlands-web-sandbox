# H1/H2 世界 Runtime 实施记录

状态：实现冻结，等待 Root 执行最终 Browser / build / 全量静态验收。固定实现合同 `contracts/world-runtime.json` SHA-256：`db6a7554aad683ed68608239de266f97a02350e70801743d8a34071c527eb9af`。

## 变更

- `WorldHarnessPort` 提供 `identity / inspect / prepare / command / clock / logic / actions / barrier / trace / checkpoint`。Headless 的 `session.world` 与 Browser 的 `window.__seedlandsHarness.world` 使用同一合同；Browser 请求由现有 Authority Worker 内唯一 `AuthorityRuntime` 执行。
- `WorldResourceAuthorizer` 以宿主绑定的 `principal + resource + operation + target/scope` 默认拒绝。命令来源字符串只用于审计；玩家输入、world edit、gameplay action、server command、Fluid、Logic 与开发 Harness 都在 owner 入口使用同一资源策略。动作读取先从真实 action 派生 owner；未知和越权 action 对受限 principal 返回同一权限失败。break/place/pickup/attack/start-action 同时校验动作主体与真实交互目标。
- `query-observation / query-pois / query-path` 是全局开发查询，要求 world scope，不能由 self Actor grant 获得；显式 range/radius/path target 限制在 256 blocks。Logic mode 与 batch 在任何状态变更或候选消费前完整验证。
- Headless 保持单个持续 world，支持 Node REPL、旧 slash command 与白名单 JSONL。wall clock 经同一串行队列推进，`startClock / stopClock / dispose` 使用独立 generation 防止停止或销毁后复活。暂停态显式 advance 按 Physics → Gameplay → Fluid → Logic 的生产 lane 执行。
- barrier 不占用 Authority 操作队列，等待由提交、推进、Fluid、Logic、保存和恢复事件唤醒。`settled` 只等待捕获 frontier 前的有限 Logic/Fluid 工作；Physics frontier 表示已经完成的 tick，因此不读取后来 wall clock 新增的全局 debt。当前 Fluid owner 严格单 lease，issued/settled 计数是连续水位。每次重检都会验证 worldId/epoch。
- checkpoint export 冻结完整 `FrozenGameSaveSnapshot` 后经 Authority persistence 持久化；只有成功的 durable export/restore 才推进 checkpoint ACK。恢复先在 Memory persistence 构造并验证完整候选 Runtime，再原子替换 IndexedDB 的目标 manifest、gameplay、checkpoint 与完整 chunk key 集；提交后只切换无失败的 persistence delegate 和 owner。
- Browser 将固定连接 epoch 与可更新 runtime epoch 分开。旧普通 RPC、输入、Harness 操作和 Logic 候选不会重标到新世界；成功恢复后重新绑定 Logic、snapshot gate、player/controller/gameplay、世界 seed/generator getter、派生 mesh 与音频。旧 compute 结果按 generation 丢弃；恢复后的真实输入继续使用新 runtime epoch。
- Browser Authority 诊断增加 nullable `storageBytesMeasurement`；首次真实保存前以及恢复后为 `null`。Logic 诊断保留 block 计数，并投影单槽观察队列、提交/完成数和 wall round-trip 时间。

## API 示例

```ts
const identity = await world.identity();
await world.clock({ kind: 'pause' });
await world.prepare({ kind: 'chunk', chunk: [0, 0, 0] });
const edit = await world.command({ type: 'set-block', position: [1, 30, 1], voxel: 4 });
const advanced = await world.clock({ kind: 'advance', elapsedMs: 1_000 });
const settled = await world.barrier({ kind: 'settled', frontier: advanced.frontier!, timeoutMs: 2_000 });
const frozen = await world.checkpoint({ kind: 'export' });
```

所有方法返回 `{ ok, data, frontier }` 或 `{ ok:false, error, frontier? }`。`inspect` 不生成未知 Chunk；先显式 `prepare`。`advance` 只在 paused 状态可用，单次上限 60 秒。restore 成功后旧 frontier、排队请求和候选均以结构化 stale/conflict 失败。

## 验证

- `CI=true corepack pnpm exec vitest run tests/server/world-harness-session.test.ts tests/server/world-resource-authorization.test.ts tests/server/gameplay-command-persistence.test.ts tests/server/simulation-command-persistence.test.ts tests/server/fluid-transaction.test.ts tests/client/browser-authority-world-harness.test.ts tests/client/browser-chunk-persistence.test.ts`：7 files / 73 tests 通过；覆盖无效 Logic 请求不改变状态、开发查询 world scope、未知 Chunk 准备后刷新 Browser canonical、旧命令显式策略迁移与新增 Fluid 水位字段。
- `CI=true corepack pnpm exec vitest run tests/client/browser-authority-client.test.ts tests/server/server-command.test.ts`：2 files / 19 tests 通过，确认既有 Browser Authority 与 slash command 接口兼容。
- Root 已执行真实 JSONL/CLI 子进程测试：9/9 通过；覆盖 malformed 后继续、1 MiB/96 MiB 增量 framing、单请求背压、U16LE/U8 base64 checkpoint 往返、损坏后继续与 EOF 清理。
- Root 已执行真实 TTY：多行与 top-level await、持续 world 改块/查询、run 到 tick 400、pause、799383 bytes checkpoint、`.exit` clean 0。
- `@seedlands/game-core` typecheck、`@seedlands/web` typecheck、`tsconfig.test.json`、`tsconfig.tools.json` 均通过；Web typecheck 仅报告 Root 所有 UI 的既有非阻断 Svelte a11y warning。
- 受影响 core/Headless/Authority/Browser adapter、恢复接线和定点测试 ESLint 通过；新增 owner 拆分后所有受影响生产模块满足有效代码不超过 500 行。`git diff --check` 通过。
- Browser parity fixture：`e2e/browser-world-parity.spec.ts`。它使用不同 seed 的 Browser target，验证 Headless → Browser 恢复、源 seed 首个新 Chunk、旧 extra Chunk 删除、旧/新 Logic、同 ticks 的 Physics/Gameplay/Fluid lane 和 frontier、Voxel/Actor/Action，并执行 Browser → Headless 往返及恢复后 `run + Pointer Lock + KeyW`。按 Root 协调，本实现者未再次启动 Browser；最终无重试结果由 Root 写入总实施报告。

## 风险与限制

- 本期支持现有玩家、脚本 Logic 与现有 NPC/Actor 模拟的共享 Authority 能力；没有模型 NPC、模型 provider、长期认知存档、LOD、离线追赶或 World AI 产品能力。
- Browser 最终 parity、全量 `verify:static`、独立 build 和旧浏览器回归尚由 Root 串行执行；在这些终态证据写入前，不声明 H07 总验收完成。
- Fluid barrier 的连续计数依赖当前“最多一个在途 lease”调度不变量；未来若支持并发 Fluid lease，必须改成按 lease sequence 的 pending-through 水位。

## 实际成本

- 外部 SDK 安装、真实模型调用、外部写入：0。
- 任务级 tokens、credits 和 API 等价费用没有可归因账单，记为 unknown；不从账户共享额度差值推算。
- 墙钟时间没有独立任务计时器，记为 unknown。实现复用既有 AuthorityRuntime 与 FrozenGameSaveSnapshot，没有新增产品存档版本。
