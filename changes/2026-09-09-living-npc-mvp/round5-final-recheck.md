# Round 5 最终窄复核

冻结范围：`54d2b2bf83947b23712f4042abe3b139eb55ab43..3d1f5cd19c65a010dc007b21bfd767a963e1468f`。合同 `round5-final-recheck.json` SHA-256 `dc1b7ff0b7c2867597f28875a669d487088cc3f1206197ebb23b13bbb3b1d6e4` 已核对。仅审阅修复 delta，未运行测试、Browser、provider 或门禁。

## 结论

此前 P1 与 P2 均已解决。本窄范围未发现新的可证实 P0/P1/P2。

## 已解决项

- **P1，sequence/ID 碰撞与原子性：** `ActionRuntime.restore()` 在 `action-runtime.ts:151-167` 只构造临时 action/current Map 并验证后才在 168 行开始改变成员状态。header 要求 safe integer sequence；每个 canonical `action-N` 必须为 safe integer 且不超过 snapshot sequence。因此 understated 的 `sequence:1/action-2` 在 mutation 前拒绝。新回归随后核对失败后原 snapshot 仍在、下一动作仍为正确的 `action-2`、原 Actor current link 未被替换。
- **P1，耗尽中断：** `start():49-56` 在 `interruptActor()` 前检查 `Number.isSafeInteger(sequence + 1)`。恢复得到 `Number.MAX_SAFE_INTEGER` 后的新 start 只抛出、不会结束现有动作。测试覆盖 unsafe restore 与 exhausted start。
- **P2，同 tick 完成顺序：** `snapshot():117-125` 先输出所有非终态，再按运行期 `terminalOrder` 输出终态；restore 对 `endedAt` 排序，稳定排序在相同时间保留该序列化的 completion order。新增测试以“新动作先完成、旧动作后完成、相同 endedAt”穿过 restore 和下一次裁剪，正确淘汰先完成者、保留后完成者。

直接消费者未因本修复改变：`AutonomyRuntime` 继续把角色尚未 reconcile 的 `actionId` 作为受保护链接，并在 Character/Combat 全联结验证之后裁剪。新的 snapshot 排列不改变 active/current map 或 action sequence。

## 覆盖与验证

复核覆盖本 delta 的 `action-runtime.ts`、`action-history-retention.test.ts`、合同/实施报告/spec/证据记录。实现记录为 14 个 focused tests GREEN；Root 正在运行 static/build。本复核未执行这些命令。

## 风险

当前实现对旧 snapshot 中相同 endedAt 的终态只能采用其原始 actions 顺序作为历史顺序，因为旧格式没有保存真实 finish ordinal；这是不可恢复的历史信息限制。新格式的输出顺序已保留精确的运行期 completion order。

## 实际成本

约 0.12 agent 小时；未派发、未修改仓库、未调用外部服务。
