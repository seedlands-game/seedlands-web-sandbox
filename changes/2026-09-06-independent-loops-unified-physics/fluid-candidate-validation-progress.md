# 流体候选结构验证进度

## 合同绑定

- 已批准合同：`changes/2026-09-06-independent-loops-unified-physics/spec.md`
- 合同 SHA-256：`c14711d82070e0b9c255eda0bfc5b2bbd134d130a8c45dacf662480e9b953512`
- 范围：只补强 `FluidTransactionAuthority` 对计算 Worker 候选的短有界结构验证；不在 Authority 内重跑传播算法，不改世界生成、持久化、客户端或流体传播规则。

## 行为与边界

Given Authority 已租出一个最多 128 个消费位置的流体快照，When Worker 返回候选，Then 接纳前必须在线性上界内验证：

- `writes` 坐标为有限整数、互不重复、位于已租 Chunk，且仅落在已消费 frontier/cleanup 的一跳局部邻域；写集条数不得超过该邻域的唯一格数量。
- 旧值与新值遵守体素/流体字节 schema。Air 必须配 `0`；Water 可读取等级 `1..8` 或合法 source `0x81..0x88`，但传播写入只允许非 source 等级 `1..8`；其他实体方块必须配 `0`。合法既有 `0x88` 源水不得因作为旧值被误拒绝。
- `nextFrontier` 与 `nextCleanupFrontier` 坐标为有限整数、互不重复、处于有效 Y 范围，并只来自本次局部计算可触及的有界扩展；候选不能借下一队列注入任意远端或无界工作。
- 结构失败返回明确拒绝结果并原样归还 lease；现有 epoch、work id、read set revision 与逐格旧值冲突验证继续生效。

此验证证明候选属于已租、有界、合法字节的局部结果，不宣称在 Authority 内重新证明完整传播算法。

## TDD 证据

预置 `tests/server/fluid-transaction.test.ts` 反例：越权远端非法写、重复坐标写、无界或远端 next frontier、非有限坐标；并保留合法 source、水平流、下落和撤源/cleanup 路径。生产修复前定向运行应为 RED，记录实际失败数后再实现。

实际 RED：`pnpm exec vitest run tests/server/fluid-transaction.test.ts --reporter=dot` 为 3 项失败、16 项通过。越权写、重复/非法字节与非法 next frontier 三组均被旧实现接纳。

实现增加独立 `fluid-candidate-validator.ts`，从 Authority 保存的 lease 构造唯一的一跳写入集合与两跳后继集合；先以集合大小拒绝过长数组，再各遍历一次候选内容，因此验证成本由最多 128 个消费位置及其固定邻域约束。它不读取世界、不生成 Chunk、不执行传播算法。

实际 GREEN：

- `tests/server/fluid-transaction.test.ts`：19 项通过。
- `tests/server/fluid-transaction.test.ts`、`tests/server/voxel-fluid-runtime.test.ts`、`tests/server/fluid-interactive-priority.test.ts`、`tests/server/world-collision-delta.test.ts`、`tests/server/authority-game-server-port.test.ts`：5 个文件、47 项通过。
- `/tmp/seedlands-fluid-candidate-validation.test.ts`：独立反例 1 项通过。
- 修改文件 Prettier 与 ESLint 通过，`git diff --check` 通过。
- 全项目源码/测试 TypeScript 检查暂被并行任务正在修改的 `headless-session.ts`、`world-compute-task.ts` 与 `compute-worker-task.test.ts` 可选字段收窄错误阻塞；报错路径不属于本补丁，须在共享改动提交后重跑。

## 当前状态

- [x] 正式反例达到预期 RED。
- [x] 实现短有界结构验证。
- [x] 独立 `/tmp` 反例与正式合法/拒绝路径全部 GREEN。
- [ ] 静态检查与生产构建完成。
