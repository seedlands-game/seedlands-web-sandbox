# Living NPC 第八轮冻结复核

- 冻结范围：`9964bed8e15932b685b327fd7904e1ca1a600bf9..2405493f0f75efdbda3fc3b225b67950b5ea31c9`
- 合同：`round8-recheck.json`，SHA-256 已与给定值一致。
- 方法：仅用冻结 `git show` 阅读；未运行测试、浏览器、provider 或写入仓库。

## 覆盖

8 个差异文件均已阅读：

1. `packages/game-core/src/server/simulation/character-runtime-validation.ts`
2. `packages/game-core/src/server/simulation/character-runtime.ts`
3. `tests/server/character-target-retention.test.ts`
4. `changes/2026-09-09-living-npc-mvp/spec.md`
5. `changes/2026-09-09-living-npc-mvp/delivery.md`
6. `changes/2026-09-09-living-npc-mvp/evidence/round8-red.log`
7. `changes/2026-09-09-living-npc-mvp/evidence/round8-header-red.log`
8. `changes/2026-09-09-living-npc-mvp/evidence/round8-green.log`

## 复核结论

没有发现新的具体 P0/P1/P2。

`validateCharacterSnapshotRecord()` 现在对会在正常写路径递增的 `revision`、`policyRevision`、`memory.revision`、`eventCursor` 要求安全整数且 `value + 1` 仍为安全整数；对应 `recordAttacked()`、`applyIntent()`、终态策略版本更新、`updateMemory()` 与 `record()` 均不会在已恢复的值上越过安全整数上界。角色集合 header `sequence` 同样要求非负且保留下一次注册的增量空间，对应 `register()` 中 `++this.sequence`。

事件尾部校验恢复了运行时的实际合同：`eventCursor - events.length` 必须非负，随后每项恰为前项加一并最终不超过 head。因此非零 head 且空尾、零号伪事件、跳号或末尾不匹配都会在构造并写入 `records` 之前失败。特别是 `eventCursor: 0` 与一条 `cursor: 0` 事件先得到 `previousCursor = -1`，立即由负值检查拒绝；它不会被导入。

`CharacterRuntime.restore()` 先构造独立 `next` 映射，完成 record、动作链接和 actor 生命周期校验后才替换 `records` 和 `sequence`。本轮 GameServer 回归进一步检查 restore 拒绝后的完整冻结快照不变，再继续对话、观察、重新冻结及成功 restore，覆盖了外层事务可观察性。正常快照的初始 `sequence/eventCursor/revision/memory.revision = 0`、`policyRevision = 1` 和从 cursor 1 开始的事件尾仍被允许。

## 验证与缺口

提交内 `round8-red.log` 记录修复前 5 个递增字段的 restore 被错误接受；`round8-header-red.log` 记录集合 header 的耗尽/负数 RED。`round8-green.log` 记录修复后受影响文件、角色控制和 host 相关共 69 项通过。按合同我没有重跑这些检查，也没有独立执行静态检查、构建、浏览器或真实 provider；这些仍应以 Root 的最终门禁记录为准。

实际审阅成本：约 0.12 小时；无模型调用、无外部写入。
