---
name: seedlands-code-review
description: Explain and independently review an exact Seedlands branch, commit, or pull-request diff, producing a human-readable logic report, change codemap, diagrams when useful, and evidence-backed P0/P1/P2 findings. Use for code review or understanding a specific change; do not use for implementing fixes or general repository tours.
---

# Seedlands Code Review

针对一个精确代码变更工作。默认同时完成“协助人类理解”和“独立审阅”；用户只要求其中一种时缩小范围。审阅本身是只读任务，不修改代码，不向 PR 发布评论，不批准或合并。

## 冻结审阅对象

先读仓库 `AGENTS.md`、目标 change spec、相关源码与测试。涉及职责或运行链路时再读 `docs/code-map.md` 和 `docs/repository-structure.md`；不要读取 `.env` 或密钥。

把输入解析为不可变 review identity：仓库、来源类型、base/head 或 commit、merge-base、精确 SHA、文件集和生成时间。分支比较审阅 merge-base 到 head；普通 commit 审阅父提交到该提交；merge commit 必须明确比较哪条父线，不自行猜测。PR URL 是易变入口，须 live check base/head SHA 和当前文件集。除非用户明确纳入，不把未提交工作区改动混入目标 diff。

受改文件及其邻接源码必须从冻结的 head tree 读取，不能从可能漂移的当前工作区读取。审阅规则默认取冻结 base tree 的 `AGENTS.md` 与长期 docs；head 对规则的修改是待审提案，不能用来豁免同一变更。当前 skill 只决定审阅方法。

详细的输入解析、阅读报告结构和覆盖账本见[审阅工作流](references/review-workflow.md)。

## 先解释，再独立审阅

第一阶段只重建代码事实：按领域能力而非文件顺序归组，定位主入口，沿调用、数据、状态所有权、异步边界和失败链路解释变更。给人类一条高信息密度阅读顺序；跨三个以上组件或存在关键时序/所有权变化时用 Mermaid 流程图或时序图，否则用短文，避免装饰性图表。Codemap 只描述本 diff 及必要邻接上下文，不复制全仓代码地图。

第二阶段重新以 reviewer 视角检查每个变更文件及必要上下文。读取[项目语义规则](references/project-rules.md)，只应用与当前 diff 相交的规则；先读现有静态检查和测试的真实结果，再关注它们不能证明的语义正确性。对用户可见 UI、Worker/网络、持久化或性能结论，按项目证据层级核对，不从代码外观推断已验证。

维护或审阅本 skill 时读[调研依据](references/research-basis.md)；普通代码 review 跳过。该文档是设计依据，不替代当前仓库事实。

## 报告合同

报告正文先帮助阅读，末尾才放独立审阅结论。至少包含：

1. Review identity 与范围：精确 SHA、diff 边界、已读上下文、未覆盖项。
2. 一句话结果与风险热点。
3. 变更分层：目的、核心逻辑、调用/数据/状态变化、失败与回退。
4. 推荐阅读顺序、必要图示和 diff codemap。
5. 测试与证据：绑定 exact SHA 的已有结果、实际运行、不可得与未运行，以及各自能和不能证明什么。
6. 人类复核建议：最值得亲自核对的 1–3 个位置及原因。
7. `独立审阅 Findings`：必须是报告最后一个实质章节，coverage 只作该章节末尾短注。

Finding 按以下语义排序：

- **P0**：已证实会破坏正确性、安全、数据完整性、兼容性或项目硬不变量，当前必须处理。
- **P1**：有具体触发路径和未来故障风险，最好在当前变更处理；不是单纯偏好。
- **P2**：清晰度、维护性或效率优化，不处理也不会造成严重后果，不得阻塞交付。

每个 issue 写清 `[P?] 标题`、文件与行、触发条件、可观察影响、违反的规则/合同、证据、建议修复方向和置信度。只评论代码，不评价作者。相同根因合并，纯格式或静态检查已精确报告的问题不重复。证据不足时写入“待确认问题”，说明缺什么证据，不升级成 finding。

没有 finding 时明确写“未发现可证实的 P0/P1/P2 问题”。若没有逐文件完成或关键上下文不可用，必须声明审阅不完整，不能给出等价于 LGTM、可合并或运行时已验证的结论。

## 人类交接

在 Findings 之前给出人类最值得亲自核对的 1–3 个位置及原因。只有用户明确要求发布 review 时，才将已确认 findings 转成平台评论；发布、修复、push、批准和合并分别遵守各自授权门。
