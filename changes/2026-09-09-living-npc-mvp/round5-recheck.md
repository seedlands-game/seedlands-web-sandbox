# Round 5 动作终态保留独立复核

冻结范围：`8f80eca..54d2b2bf83947b23712f4042abe3b139eb55ab43`。合同 `round5-recheck.json` SHA-256 `ca1930f4e53330451a272ba1066d19eb1867ea9015c9cba8b659f611adccd879` 已核对。仅做只读审阅，未运行测试、Browser、provider 或门禁。

## 结论

有界历史、活动/角色引用保护及完整联结验证后裁剪的主路径成立，但仍有一个 P1 和一个 P2，均已通知 Root。

### P1：恢复后新动作可覆盖已有动作 ID

**位置：** `packages/game-core/src/server/simulation/action-runtime.ts:49-64, 136-169`

**触发：** 恶意或损坏 checkpoint 可含 `sequence: 1` 与属于另一 Actor 的有效结构动作 `id: "action-2"`。恢复只要求 sequence 为非负整数、id 非空；下一次 `start()` 递增 sequence 后生成同一个 `action-2`，并以 `Map.set` 覆盖旧动作。旧 Actor 的 `currentByActor` 仍指向该 ID，因此随后会读取或结束新 Actor 的动作。

**影响：** 破坏动作 owner/current-action 关联和 checkpoint 恢复后的唯一 ID 合同，可能错误中断另一 Actor 的动作。

**最小修复：** 恢复时要求安全整数 sequence，并拒绝 canonical `action-N` 的 N 大于 snapshot sequence（Root 已采用）；`start()` 在 sequence 耗尽前拒绝，且用跨 Actor 的损坏快照断言 restore 原子失败。

### P2：同一完成时间的 checkpoint 不能保留真实完成顺序

**位置：** `packages/game-core/src/server/simulation/action-runtime.ts:163-168`

**触发：** 两个动作在同一个 simulation tick 完成，故 `endedAt` 相同；较晚创建的动作先完成、较早创建的动作后完成。运行期 `terminalOrder` 正确记录 finish 调用顺序，但 snapshot 按创建 Map 顺序写出；restore 仅按相同 `endedAt` 的稳定创建顺序重建。下一次裁剪可淘汰实际较晚完成的动作、保留较早完成的动作。

**影响：** checkpoint 后“最近 256 条完成终态”的语义不精确；不影响活动动作或世界执行。

**最小修复：** 持久化单调 terminal completion ordinal，或将一个明确的同 tick 总排序写入 snapshot；补一个相同 `endedAt`、反向完成的 restore+trim 回归。

## 已确认的正确路径

- `finish()` 将每个终态加入 `terminalOrder`，裁剪从最新向最旧计算 256 条未钉住终态；非终态不进入该集合，活动动作不被淘汰。
- `AutonomyRuntime` 为 ActionRuntime 注入 `characters.retainedActionIds()`；角色尚未 reconcile 的终态 `actionId` 不计入 256 普通历史，角色推进解除引用后才可裁剪。
- 恢复路径先校验 active combat/action 链接，再以 `deferPruning` 加载完整 Action 表，随后 `characters.restore()` 用完整表校验 owner/type/goal/target 链接，最后才 `pruneHistory()`。因此旧大 checkpoint 中合法但暂被角色引用的终态不被提前删掉。
- combat 只把 active attack 当作强链接；活动 Action 不可裁剪。其 `lastResult.actionId` 是历史结果字段，不被后续执行解引用。
- 新 focused 测试覆盖长运行完成、角色终态延迟释放、活动近战、400/800 秒 follow 重规划、Harness 查询/restore/后续新 ID；断言了 257（256 terminal + 1 active）及序列化体积上界。它们没有覆盖上述 P1/P2 触发。

## 变更覆盖

15 个冻结变更文件已计入：三个生产 runtime 文件、两项新增服务器测试、两份合同、两份证据、实现报告、spec/delivery/estimates 和两份长期文档。生产逻辑仅在 ActionRuntime、AutonomyRuntime、CharacterRuntime；其余均与本轮保留合同、RED/GREEN 记录或基线说明一致。

## 验证

实现记录称 2 文件 / 5 focused tests GREEN；Root 另行负责 static、build 与 Browser。本复核未执行这些检查。只读 `git diff --check` 在 `evidence/round5-green.log` 报告 EOF 新空行；这不影响运行时语义。

## 风险

在 P1/P2 修复冻结复核前，不能声称本轮动作历史合同已完全闭环。未独立运行 gate 是证据缺口，不替代上述明确逻辑问题。

## 实际成本

约 0.27 agent 小时；未派发、未修改仓库、未调用外部服务。
