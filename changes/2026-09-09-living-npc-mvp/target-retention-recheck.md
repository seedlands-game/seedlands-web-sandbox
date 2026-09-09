# Target retention 最终窄复核

冻结范围：`5dc9c0f..5ee5b05`。合同 `target-retention-recheck.json` SHA-256 已核对为 `40261bf373c124290144f65e2b75358ad0cae15a2732bf1379aaaef511cc4943`。审阅全部 3 个 delta 文件：`packages/game-core/src/server/simulation/character-runtime.ts`、`tests/server/character-target-retention.test.ts`、`changes/2026-09-09-living-npc-mvp/spec.md`。未运行测试、浏览器、provider、Git 写入或外部操作。

## 结论

此前 P2 已解决；未发现残余具体 P0/P1/P2。

- `protectedTargets(record, perception)` 集中生成当前最多 16 个 visible entities、16 个 visible POIs 和 `executionTargetId` 的保护集合。observe 传入既有 perception；`reference()` 在**任意**满表新分配而未显式传入集合时，都会调用该 helper。故 `recordAttacked()` 和 goal pickup 等不再使用空保护集合；128 cap、单调 `target-N` 分配和已淘汰 ref 不复活的原有规则保持。
- 最多 33 个可能受保护目标，小于 128，因此满表分配仍必有可淘汰项；fallback `splice(0)` 不会在当前 constants 下走到。分配后仍恰为 128，未出现超过上限的窗口。
- 新回归先取初始 player follow ref，填满 table，再以 `attackEntity('attacker', entityId)` 触发真实 `recordAttacked()` 分配。随后只 `inspect` 状态并以**原始** ref 递交 follow retry；没有重新 observe 生成 ref。该测试直接覆盖先前的淘汰条件和固定后 128 条目不变式。
- `spec.md` 已记录 target retention 与原子输入的验收约束，未扩大玩法或协议范围。

实现者报告的 RED 为原始 ref `CHARACTER_TARGET_UNAVAILABLE`，GREEN 为 12 个 focused tests；本只读复核未独立执行这些命令。
