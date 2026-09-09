# Round 10 观察投影陈旧性独立分诊

## 审阅对象

- 冻结 SHA：`b99b4b85b80f0decf82cd15320fcb479e36445ee`
- 发现：review `5155644015` / comment `3969526942`
- 已读：Agent runtime/graph/tools、Bridge、Character applyIntent/goal execution/navigation、当前 spec 与 cognition baseline。
- 未运行测试、浏览器、provider、Git 或仓库写入。

## 结论

该评论指出的事实成立：500ms observe 可在 Flash 等待时更新 self position、可见列表、距离或 hunger，而不改变 `character.revision` 或 event `cursor`。但它没有给出当前协议下会违反的可观察行为，因此 **P1 未成立**。现有设计明确将模型输出限制为异步语义目标，而非以整个观察投影为 compare-and-swap 的即时操控命令。

把每份 observe 的投影序号并入 `runDecision()` 的完成门槛会让持续移动时的慢模型每 500ms 失效、重新调度，并可能永远无法提交；这会破坏当前“模型一次决定，Authority 持续执行”的基线，且没有解决一个已证明的世界写入错误。

## 证据

1. `apps/agent-server/src/runtime.ts:349-393` 在模型返回后已经拒绝 context generation、角色 revision 或 event cursor 改变的结果；Bridge 将这两个 observed 值传入 Authority（`apps/web/src/client/character/controller-bridge.ts:227-248`）。
2. 新对话、目标变更、目标完成/失败、受击等角色事实会增加 event cursor 和/或 revision，故模型等待期间到达的对话不能提交旧结果。若收到 `CHARACTER_REVISION_CONFLICT`，runtime 保存原 observed cursor/revision，等待一份真正更新的观察再重试。
3. `follow` 不是位置快照：工具层只接受原观察中可见的 entity ref；`CharacterRuntime.applyIntent()` 在任何 interrupt/revision/event 写入前调用 `resolveVisibleTarget()`，以当前 Authority perception 重新验证绑定和可见性（`character-runtime.ts:287-318,403-420`）。目标离开视野则原子拒绝 `CHARACTER_TARGET_UNAVAILABLE`；仍可见但移动时，`CharacterGoalRuntime.start()` 读取当前 entity position，`advanceFollow()` 后续也每秒读取 live target position 重规划（`character-goal-runtime.ts:66-75,103-118`）。
4. `move-to` 的 schema 只有绝对 `position`，没有 entity/ref（`character-control-protocol.ts:14-17`；`cognition-tools.ts:166-178`）。它表达“去这个世界坐标”，不表达“追踪刚才看见的玩家”。提交时 `startMovement()` 从当前 NPC body 重新规划到该固定坐标，并拒绝当前不可达路径（`character-goal-runtime.ts:141-155`；`ground-navigator.ts:15-50`）。
5. `forage` 在执行时重新观察和选择当前可用食物；`idle` 与 `return-home` 没有外部可见目标。speech 没有 recipient/target 字段：玩家仅移动、未产生 dialogue event 时，旧观察生成的说话可以被记录，但协议并不宣称它是“对仍在原位玩家”的定向消息。若玩家真的发送对话，事件 cursor 会推进并拒绝旧 completion。
6. 已保存的真实 Browser body evidence 也显示 follow 是 live entity 行为：玩家从 `[0.5,58.6,0.5]` 移至 `[0.5,58.6,-7.9167]`，NPC 的 running action target 是后续 live player position `[0.5,57,-2.7833]`，不是初始位置（`changes/.../evidence/round9-hold-and-follow-bodies.json`）。

## 需要保留/补充的回归边界

无需生产修复。建议补三项确定性回归，防止后续重构把当前语义改坏：

1. 模型等待期间玩家移动但仍可见：同 revision/cursor 的旧 `follow` 可提交，首次 Action 使用提交时玩家位置，后续移动继续刷新路径。
2. 等待期间目标离开可见范围：`follow` 返回 `CHARACTER_TARGET_UNAVAILABLE`，Character revision/currentGoal/action/requestIds 均不变。
3. 等待期间地形或 self 位置变化：`move-to` 仍是固定坐标目标，但 route 以提交时 body/world 重新规划；当前不可达必须走既有失败路径，而不是复用观察时路径。

若产品要承诺“NPC 的任何话语必须只对仍在场的某个玩家说”或“move-to 必须跟随一个观察实体”，需先扩展目标/recipient 的世界语义和 Authority 验证；那是新增产品合同，不是为本评论添加泛化投影序号。

## 风险

- 当前有意允许动态世界中基于稍早感知选择独立目标，例如走向一个固定地点；这会产生行为选择上的时滞，但没有绕过 Authority、泄露全局信息或写入已失效的 entity ref。
- 用无差别 observe sequence 取消所有慢 completion 会把正常的 500ms body 变化放大成取消洪峰，并消耗更多 Flash 预算；不得以此替代 target-specific Authority 校验。
- 上述结论依赖现有窄目标集合。以后新增“对实体说话”“采集指定可见物”或引用型 move goal 时，必须在提交处加入相同的 live binding/availability 校验，并取得对应异步 RED。

## 实际成本

约 0.2 agent 小时；未执行模型调用、测试、浏览器、依赖或仓库写入。

## Findings（按严重度，最后）

- **review5155644015 / 3969526942：无效，P1 未成立。** 触发前提“body/visible projection 变而 revision/cursor 不变”真实存在，但给出的 `move-to`、speech 例子没有违反当前语义；引用型 `follow` 已在 Authority 提交和持续执行时使用 live visibility/position 校验。最小正确动作是补上述三项边界回归，不是加入每 500ms 失效的全观察序号。
