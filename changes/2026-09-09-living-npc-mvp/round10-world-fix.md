# Living NPC 第十轮世界目标命名空间修复

## 变更

- `CharacterRuntime` 的目标可见性检查现在显式接收 `entity | poi` 种类，只在对应感知列表中查找 ID；同名 POI 不再替不可见 entity 授权。
- `CharacterGoalRuntime` 的持续 follow 固定按 entity 命名空间复核目标可见性；目标离开感知范围时，在寻路前以 `target-unavailable` 结束目标并清理当前动作。
- `validateCharacterGoal` 在输入与快照复用的统一校验入口限定 follow 只接受 entity 引用。既有快照交叉引用中的 entity 约束保持不变。
- 新增 `character-target-namespace.test.ts`：在明确可通行的平地上构造同 ID entity/POI，覆盖旧引用提交、持续 follow、POI follow 输入，以及普通可见 entity follow 的动作目标与提交时位置。

## 验证

- RED：`/tmp/living-npc-round10-red.log`，新文件 3/3 失败：旧 entity 引用被接受；持续 follow 越过可见性后才以 `path-unreachable` 失败；POI follow 未在 goal 校验入口拒绝。
- GREEN：`/tmp/living-npc-round10-green.log`，6 files / 31 tests passed。包含目标命名空间、角色控制、目标保留、存档交叉引用、危险恢复、Logic 目标所有权回归。
- `node_modules/.bin/tsc -p packages/game-core/tsconfig.json --noEmit`：通过。
- `node_modules/.bin/tsc -p tsconfig.test.json --noEmit`：通过。
- 4 个变更文件定向 ESLint：通过；`git diff --check`：通过。
- 未运行 Browser、全量门禁或全局格式化，按合同由 Root 集成。

## 风险

- 行为边界：可见 entity 的 follow 仍会被接受，并以该 entity 提交瞬间的真实位置创建普通 `move-to` 动作；entity 后续离开感知范围时，目标以 `failed/target-unavailable` 结束并发出既有失败/fallback 语义。本修复不改变固定坐标 `move-to` 的新鲜度或异步观察 CAS。
- 历史中把 POI 引用写成 follow goal 的快照现在会被统一快照校验拒绝；这符合当前协议已明确的 follow-only-entity 合同。
- 工作树还含 Root 拥有的 spec/docs/evidence/host 测试改动，本轮没有编辑这些文件。

## 实际成本

- 约 0.12 agent-hour；2 次 focused GREEN 尝试（首次暴露测试地形不可通行，改为显式平地后通过），未触发三次同因升级线。
