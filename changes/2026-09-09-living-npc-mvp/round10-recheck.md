# Round 10 冻结增量独立复核

## 审阅对象

- Base：`b99b4b85b80f0decf82cd15320fcb479e36445ee`
- Head：`90650cdc8019e4dc2f129aaf087e8f478039d4d6`
- 范围：16 个 frozen 变更文件。按 base review 规则和当前 spec/docs 静态复核；未运行测试、Browser、provider、Git 或仓库写入。

## 变更

`CharacterRuntime.isVisible()` 现接收 resource kind，并只在相应的 perception collection 查询。提交 follow 的 `resolveVisibleTarget(..., 'entity')` 因而不会让同 ID POI 充当已离开 entity 的可见性证明；该检查仍位于 interrupt、revision、goal/event/requestId 变更之前，失败保持原子。

`CharacterGoalRuntime.advanceFollow()` 同样固定传入 `'entity'`。已开始的 follow 若实体离开可见范围，即以 `target-unavailable` 失败并清理当前 action，不再落入同名 POI 的假阳性。可见的普通 entity follow 未改变：提交时 `start()` 读取当前 entity position，随后每秒从 live entity 刷新路径。

`validateCharacterGoal()` 把 follow 的 target 限制为 entity；current/suspended goal 的 snapshot 校验共享该入口，既有 `validateFollowExecutionLink()` 继续要求 entity binding 与 executionTargetId 一致。因此 POI follow 不能经 API 或 checkpoint 混入。

## 验证与覆盖

- `tests/server/character-target-namespace.test.ts` 以同 ID player/POI 覆盖三条实际路径：提交前 entity 离开但 POI 留下时原子拒绝；已运行 follow 在 entity 离开时失败并清理 Action；POI follow 输入无状态写入。其正常路径还断言 entity follow 的 action 采用提交时真实 `[3.5,34,0.5]` 位置。
- `tests/agent-server/observation-plan-continuity.test.ts` 在四次 500ms self position/hunger/visible projection 更新、revision/cursor 不变期间保持一次 Flash 调用，并完成固定 `move-to` intent。它确认先前 `3969526942` 分诊结论没有被错误改成全投影 CAS。
- 旧 runtime 仍在模型完成边界检查 context generation、character revision、event cursor；事件/修订冲突路径没有改变。
- frozen evidence 记录 namespace RED 3/3、GREEN 6 files/31 tests；continuity 记录 2 files/8 tests。该审阅未重跑。
- 已逐项读取 16 个文件：`contracts/round10-observation-triage.json`、`contracts/round10-world-fix.json`、`delivery.md`、`evidence/round10-continuity.log`、`evidence/round10-github-comments.json`、`evidence/round10-world-green.log`、`evidence/round10-world-red.log`、`round10-observation-triage.md`、`round10-world-fix.md`、`spec.md`、`docs/living-npc-cognition.md`、`character-goal-runtime.ts`、`character-runtime-validation.ts`、`character-runtime.ts`、`observation-plan-continuity.test.ts`、`character-target-namespace.test.ts`。

## 风险

- 历史 checkpoint 中的 POI follow 会按当前明确的 entity-only 合同拒绝；这是一项有意的输入收紧，而非迁移。
- 固定坐标 `move-to` 仍允许跨普通位置/hunger 更新完成，并在 Authority 以当前 body/world 寻路；这不是 follow。以后新增引用型动作或定向 speech 时，需要将其资源条件在 Authority 单独校验。
- 原始 evidence 日志的尾部空行会令全差异 `git diff --check` 对非执行证据文本报格式项；不影响源码语义。

## 实际成本

约 0.15 agent 小时；无模型、测试、Browser、依赖或仓库写入。

## Findings（按严重度，最后）

未发现本 delta 中可复现、有明确位置与可观察影响的 P0、P1 或 P2。review `3969526952` 的 submitted 和 ongoing follow 路径均已由 kind-scoped 可见性修复；`3969526942` 的全投影 CAS 不成立且未被引入。
