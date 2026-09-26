# 旧存档 Lineage 合同补充

状态：已冻结，供 `LEGACY-LINEAGE-CLOSE-01` 实施。本文只补充当前 change 的旧存档兼容合同，不修改 `spec.md`、`tasks.md` 或 `execution-state.md`。

## 可验证行为

1. `GameplaySnapshotMigration` 可声明最多 16 条 `GameplaySnapshotPredecessorV1`。每条包含非空、密集、无重复且只含 `1 | 2 | 3 | 4` 的 `gameplayVersions`，以及完整、可规范序列化的 `CompositionCheckpointIdentity`。注册时完整 clone、deep-freeze；重复 identity 或畸形数据拒绝。
2. V1–V3 gameplay snapshot 没有 embedded composition。composed host 必须提供独立观测到的 `legacyCompositionIdentity`，且该 identity 必须精确命中当前 Pack migration capability声明并包含当前 snapshot version；缺失、版本不符或任一 digest/definitionMap字段变化均拒绝。调用方不能用同一个输入同时充当 observed identity 和 allowlist。
3. V4 使用 snapshot 内嵌 composition作为 observed identity。只有当前 identity、既有明确 predecessor或当前 Pack声明的精确 predecessor可进入迁移；Pack migration把已批准的旧 composition投影到当前 identity，随后通用guard再次确认。失败发生在 live owner 替换前。
4. Classic production源码冻结 `c18a890c7f97f76421e13565ec628d8c50a942da` capture的完整 identity：Pack `seedlands:overworld@1.0.0`、manifest `e3c199e87d101672c1635d481771972edbf39deb43c336063ab3753d0b01bb89`、entry `924d61fc72f253c85e191caa79f1c7ff51f83bc6237ad613a7c0c5595c2c169f`、空resources及完整definitionMap。生产不得读取 `apps/web/tests` 或 `changes/`。
5. 现有 `gameplay-registered-needs.test.ts` 保持真实 `GameServer.restore()`、synthetic V3 payload和captured host lineage；不替换为当前 identity，不删除 shared phase → per-actor迁移断言。`autonomy-restore-capacity.test.ts` 的 V3候选必须穿过 identity gate并在actor limit拒绝。
6. 保留现有 inventory-pointer、NPC-composable、pre-change、pre-Media与retired actor兼容正负例；本阶段不重构全部历史前驱。非Classic composition不继承Classic predecessor；篡改manifest/entry/definition graph任一字段均fail closed。

## 证据边界

- 本阶段证明 codec/composed-host 对精确 Classic lineage 的恢复与拒绝，不证明真实浏览器 IndexedDB 能判定无 embedded identity 的 V1–V3 来源。Browser provenance由独立任务处理。
- 不恢复 `allowLegacyCompositionMigration` 布尔开关，不允许 `legacy === explicitLegacy` 自批准，不继续给 current-target subtraction追加字段过滤。
- 不修改 GameServer/ServerWorldCommitHost restore owner、Web production、Pack builder、Git、browser/build/CI。
