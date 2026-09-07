# EntityStore 与导航 TS 修复证据

## 范围与审计依据

本次只落实 `changes/2026-09-06-data-plane-simd-policy/aos-soa-audit.md` 中两项低风险 TS 控制组：EntityStore 热写入的无用返回副本，以及 Logic terrain 重叠验证和 open 集合选择的临时分配。没有修改公开查询副本合同、权威状态规则、协议、Rust crate、mesh、buffer 所有权、E2E 或包脚本，也没有执行浏览器或性能基准。

## RED

生产修改前新增：

- `tests/server/data-plane-entity-store.test.ts`
- `tests/server/data-plane-navigation.test.ts`

执行：

```text
CI=true corepack pnpm exec vitest run tests/server/data-plane-entity-store.test.ts tests/server/data-plane-navigation.test.ts --no-file-parallelism --maxWorkers=1
```

结果为 2 个测试文件失败，12 个用例中 10 个失败、2 个通过：

- EntityStore 2 个预期失败：`update()` 仍调用会返回副本的公开 `move()`；`updateWithoutSnapshot()` 尚不存在。
- 导航 8 个预期失败：整数区间相交 seam、无排序的线性 open 选择 seam 尚不存在。

## 实现与静态分配账

### EntityStore

`EntityStore.updateWithoutSnapshot()` 复用私有 `moveEntity()` 完成校验、空间桶迁移、位置/速度/生命值写入，不返回实体。公开 `update()` 走同一 mutation 后只在返回边界 clone 一次；公开 `move()`、`get()`、`query()` 仍返回防御副本。`GameplayRuntime` 和 `GameServerGameplayFacade` 增加对应 void 入口，Authority 适配器使用该入口。攻击生命值的内部写入也不再生成被忽略的返回副本。

按审计中的旧代码路径静态计数：

| 路径                        | 修复前 `GameplayEntity` clone |         修复后 |       精确减少 |
| --------------------------- | ----------------------------: | -------------: | -------------: |
| 公开 `update()` 含 position |                     2 次/调用 |      1 次/调用 |      1 次/调用 |
| Authority 物理写回          |                2 次/实体/tick | 0 次/实体/tick | 2 次/实体/tick |
| 内部生命值写入              |                     1 次/调用 |      0 次/调用 |      1 次/调用 |

因此仅 Authority 物理写回在 60 Hz 下静态减少 `120N` 次 clone/s。沿用审计的浏览器完整稳定态上界，本项把 `300N + 120P` 次 clone/s 降为 `180N + 120P` 次 clone/s；剩余项来自查询快照等未纳入本次范围的路径。这是源码调用数，不是 heap bytes 或已测 CPU 收益。

### Logic terrain 与 open 集合

`terrainWindowsOverlap()` 使用三轴半开整数区间相交。`validateTerrainWindows()` 保持原校验和报错顺序，在每个窗口完成元数据、尺寸、总 cell 数和 occupancy 长度校验后才选择重叠算法：当累计 pair 数不超过累计 cell 数时做整数区间比较；海量小窗口使 pair 数超过 cell 数时，切换并保持逐 cell Set fallback。

- 旧重叠阶段始终对总计 `C` 个 cell 创建 `C` 个坐标字符串并写入 `C` 个 `Set` entry，协议上限 `C = 32,768`。
- 新重叠阶段的工作上界是 `min(W(W-1)/2, C)` 量级；审计中的 19 窗口、31,948 cell 样例走 171 次无分配区间比较，不再创建 31,948 个逐 cell 字符串/Set entry。
- 协议允许的 32,768 个单 cell 窗口会在第 4 个窗口切换到 Set fallback，保持 O(cells)，不会退化为 536,854,528 次 pair 比较。2,048 个单 cell 的对抗用例同时覆盖无重叠和末项重叠。

`NavigationPriority` 在节点创建时保留既有坐标字符串 key。`compareNavigationPriority()` 原样维持 `f → g → key.localeCompare`；`selectNavigationOpenNode()` 单次线性扫描 `Map.values()`，比较完全相等时保留首项，与稳定 `Array.sort()` 一致。

- 旧实现每次扩展创建 1 个 `[...open.values()]` 数组并全排序；一次 `nextStep()` 最多扩展 128 个节点，即最多创建 128 个 open 引用数组。
- 新实现每次扩展创建 0 个 open 引用数组，不调用排序，扫描次数仍等于当次 open 大小；坐标 key 从排序比较时反复创建改为每个发现节点创建一次。

可供独立 corpus/基准直接调用的生产 seam：

- `EntityStore.updateWithoutSnapshot()`
- `terrainWindowsOverlap()`
- `compareNavigationPriority()`
- `selectNavigationOpenNode()`

没有加入生产 benchmark toggle。

## GREEN 与回归

首次目标 GREEN：2 个测试文件通过，12/12 用例通过。审查补强后，导航文件为 11/11 用例通过；新增整条 `LogicTerrain.nextStep() + readRevisions()` 冻结旧输出语料，覆盖负坐标、封闭阻断和跨相邻窗口，并继续保留精确 priority comparator oracle。

相关服务器回归：

```text
CI=true corepack pnpm exec vitest run tests/server/data-plane-entity-store.test.ts tests/server/data-plane-navigation.test.ts tests/server/entity-player-runtime.test.ts tests/server/logic/logic-terrain.test.ts tests/server/logic/logic-decision.test.ts tests/server/authority-entity-physics.test.ts tests/server/authority-runtime.test.ts tests/server/authority-session.test.ts --no-file-parallelism --maxWorkers=1
```

结果为 8 个测试文件通过，58/58 用例通过。

目标文件 Prettier check 与 ESLint 通过；`corepack pnpm exec tsc --noEmit` 通过；`git diff --check` 通过。`CI=true corepack pnpm build` 已运行，但在本次范围外的并行新增文件 `changes/2026-09-07-data-plane-adoption/e2e/combined-profiler.ts:152` 被测试 TypeScript 检查报错阻断：`Promise<number | void>` 不能赋给 `Promise<void>`。本项没有以该构建失败伪报准出，需在根任务集成修复该文件后复跑生产构建。

本轮没有 Git commit。
