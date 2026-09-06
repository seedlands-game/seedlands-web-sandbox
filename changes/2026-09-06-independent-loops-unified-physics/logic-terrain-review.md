# 逻辑地形窗口与导航审查记录

## 已确认的合同边界

`LogicObservation` 的地形窗口采用每批累计 `MAX_LOGIC_TERRAIN_CELLS = 32,768` 的冻结预算：单轴仍最多 32、单窗仍最多 32,768、窗口互不重叠。累计预算不是“每个窗口各自 32,768”；达到预算后构造方不得继续追加窗口，缺失区域由对应 actor 保持。

## 已复现并修复

- 两个不重叠的 `32 × 32 × 32` 窗口此前可同时通过单窗验证，累计 65,536 cell。现在在第二窗加入时明确拒绝。两个不重叠的 `16 × 32 × 32` 窗口累计恰为 32,768，仍保持合法，未缩小冻结的合法总范围。
- 原重叠检查随窗口数量平方增长，并且每个 actor 构造 `LogicTerrain` 时都会重新执行完整验证。现在验证以累计 cell 枚举检查重叠，工作量至多与 32,768 cell 成正比；同一 observation 数组且结构签名不变时缓存验证结果，避免同批 actor 重复扫描。签名覆盖窗口对象、key、revision、origin、size、occupancy 缓冲区身份和长度；结构变化会重新验证。
- 起点和目标落在同一解析格时，原 `firstStep()` 返回零 wish。目标仍可能在 POI 到达半径外，导致 NPC 停在格内角落。现在返回朝真实目标点归一化的水平意图；实际连续移动和抵达仍由 Authority 的统一物理处理。
- 相邻一格上跳此前只验证候选格可站立，未验证身体从当前格上升一格时的头部空间。现在用 `bodyConfigFor(kind)` 的真实 AABB 在当前水平位置检查上升后的完整身体体积；低顶会使导航拒绝该上跳，不输出越过 Authority 碰撞的坐标。此检查复用玩家和所有注册实体的通用 AABB，不含模型特例。

## 定向证据

- RED：`tests/server/logic/logic-terrain.test.ts` 在修复前 3 项失败，分别对应累计窗口、同格目标和低顶上跳。
- GREEN：`pnpm exec vitest run tests/server/logic/logic-terrain.test.ts tests/server/logic/logic-decision.test.ts` 通过，2 个文件、11 个用例。
- `pnpm exec eslint src/server/logic/logic-terrain.ts tests/server/logic/logic-terrain.test.ts`、`pnpm exec prettier --check src/server/logic/logic-terrain.ts tests/server/logic/logic-terrain.test.ts`、`pnpm exec tsc --noEmit` 与 `git diff --check` 通过。

## 保守边界

逻辑层的上跳检查只做低成本的当前柱体头部净空筛选，并不替代 Authority 的连续扫掠、接触和跳跃轨迹判定；未知地形仍被视为阻挡并产生保持意图。导航仍是最多 128 个节点的离散规划，不能保证在复杂连续几何中找到路径，也不拥有任何位置、速度或体素写入权。
