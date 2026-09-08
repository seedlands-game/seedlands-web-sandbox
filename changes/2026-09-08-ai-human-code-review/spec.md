# AI 与人类协作代码审阅 Skill

状态：Agile follow-up；仓库侧 GitHub Codex 接入已提交 PR #23，自动审阅开关等待登录 Codex Settings。

## 目标与范围

为 Seedlands 创建项目专用 `seedlands-code-review` skill，接收分支到分支、单个 commit 或 PR 的精确 diff，先帮助人类建立对变更的分层理解，再依据项目不变量做独立语义审阅。交付物包含变更身份、核心逻辑、阅读顺序、必要的流程/时序图、diff 专属 codemap、证据边界，以及位于报告末尾的 P0/P1/P2 issue。

本 change 新增仓库内 skill、依据与合同，并在根 `AGENTS.md` 增加 GitHub Codex 可发现的 `## Code Review Rules`，要求自动审阅读取并遵循该 skill。它不修改产品代码、CI 或外部 GitHub/Codex 设置；仓库内配置不等于自动审阅开关已启用。Skill 的普通调用不授权修改被审代码、发布 PR 评论、批准或合并；GitHub 集成被明确启用后可按其平台职责发布 review，但仍不得批准或合并。

## 调研结论与决定

- 现代 CR 的主要瓶颈之一是理解变更目的和上下文；仅显示 diff 不足以支持深层缺陷发现。因此报告先建立 change identity、调用/数据/状态链路和阅读路径，再开始独立裁决。
- AI review 必须补充而非替代静态检查与人类判断。项目规则目录只记录需要上下文、例外、状态所有权或证据解释的语义规则；格式、简单 import 边界等已自动化规则只读回结果，不由 AI 重复刷屏。
- AI 反馈的误报和低价值评论会侵蚀信任。因此 issue 必须绑定具体代码位置、触发条件、可观察影响、项目规则和置信度；证据不足的疑问不得伪装成缺陷。
- 人类拥有最终接受权。报告明确审阅范围、未覆盖项和证据层级；静态/构建/测试通过不自动推导运行时、产品体验或可合并状态。
- 严重度遵循本需求：P0 为当前必须处理的正确性/安全/数据或硬不变量问题；P1 为最好在当前变更处理、否则未来可能出问题的风险；P2 为不处理也不会造成严重后果的优化项。
- GitHub Codex 官方以 `AGENTS.md` 的 `## Code Review Rules` 作为仓库自定义入口，并在标准 GitHub review 中只发布 P0/P1。仓库不假设该集成会自动发现 `.agents/skills`；由根规则显式指向 `seedlands-code-review/SKILL.md`，GitHub 模式只执行独立审阅与高严重度输出，完整阅读报告/codemap/P2 保留给显式调用。

完整来源与其对 skill 的影响记录在 `references/research-basis.md`。

## 行为与测试设计

最初实施前 RED：`.agents/skills/seedlands-code-review/SKILL.md` 不存在，文件存在性检查退出码为 1。GitHub follow-up RED：根 `AGENTS.md` 没有 `## Code Review Rules`，skill 也没有 GitHub review 模式，官方集成无法从其受支持的仓库入口获知要读取该 skill。

| Given / When                        | Then / 验收                                                                           |
| ----------------------------------- | ------------------------------------------------------------------------------------- |
| 输入两个分支                        | 记录 base/head/merge-base 与不可变 SHA，只分析 merge-base 到 head 的目标变更          |
| 输入普通 commit 或 merge commit     | 普通 commit 使用父提交到该提交；merge commit 不猜父线，先明确比较基线                 |
| 输入 PR URL                         | live check base/head SHA、文件集和当前状态；报告绑定读到的 SHA，不把 URL 当不可变输入 |
| 人类需要理解 AI 代码                | 从 frozen head tree 读取代码，先产出核心逻辑、阅读顺序、必要图示和 diff 专属 codemap  |
| AI 独立 review                      | 读取当前 spec、相关源码/测试和项目规则；报告末尾按 P0/P1/P2 输出可复核 issue          |
| 没有可证实 issue                    | 明确写“未发现问题”，同时保留范围和未验证项；不制造建议填满报告                        |
| review 范围不完整                   | 不得声称完整审阅或给出等价 LGTM 结论                                                  |
| GitHub Codex 自动或 `@codex review` | 从根 `AGENTS.md` 发现规则并读取本 skill；只发布有证据的 P0/P1，不发布 P2、批准或合并  |

## 准出与证据

- Skill 结构：系统 `quick_validate.py` 通过，无脚手架占位符。
- 文档：`pnpm exec prettier --check` 覆盖本 change 和 skill 文件。
- 行为：用一个真实、只读的仓库 commit diff 做前向试跑，检查输入冻结、分层解释、codemap、项目规则、issue 末置和范围声明。
- Baseline：`pnpm verify:static` 与 `pnpm build`；Playwright/Midscene N/A，没有浏览器行为变化。
- GitHub 接入：检查根 `AGENTS.md` 存在唯一 `## Code Review Rules` 并引用本 skill；检查 skill 明确区分 GitHub 高严重度 review 与完整人类阅读报告。自动审阅开关需在 Codex Settings 真实读回，不能由仓库文本冒充。

## 任务状态

- [x] 调研社区与一手资料
- [x] 编写 skill 入口、工作流、项目语义规则与调研依据
- [x] 结构校验、格式检查和真实 diff 前向试跑
- [x] Delivery Snapshot 与语义化交付
- [x] 补充 GitHub Codex `AGENTS.md` 自定义入口与 skill 的 GitHub 模式
- [x] 复验 Skill 结构、格式、静态基线和生产构建
- [x] 推送更新并读回 PR #23 的 branch/head/mergeability
- [ ] 登录 Codex Settings 后确认/启用本仓库 Automatic reviews

## Delivery Snapshot

真实 commit `599bf787be5bea09f8f3b8d3e63364c56d58e36f -> 9ef0982537438d5bb86b1e67166e2469eb26b1e3` 已由独立 Terra/high reviewer 只读前向试跑。报告正确冻结 identity、排除当前未提交工作区，先产出状态机解释、流程图、阅读顺序与 codemap，再按 STATE-01/OWNER-01/TEST-01 独立审阅；未为凑数制造 finding，并明确没有 exact-SHA 运行时/CI 证据。

试跑发现并已修复四项 skill 歧义：邻接源码也必须从 frozen head tree 读取；规则取 frozen base，避免自我豁免；测试/CI 绑定 exact SHA 并区分 `NOT_AVAILABLE`/`NOT_RUN`；人类复核建议置于 Findings 前，调研依据只在维护 skill 时读取。

此 change 不更新产品代码地图或长期运行时 baseline；项目专用审阅规则由 versioned skill 自身维护，项目不变量继续以 `AGENTS.md` 和 `docs/` 为权威来源。Playwright/Midscene N/A，没有浏览器行为变化。

最终本地准出：官方 `quick_validate.py`、Prettier、`ls-lint` 与 `git diff --check` 通过；`pnpm verify:static` 通过（249 个测试文件通过、2 跳过；1266 个测试通过、4 跳过；Svelte/TypeScript 零错误）；`pnpm build` 通过，Rust artifact/源码 fingerprint 与 SSG 均匹配。Build 只证明仓库基线未被文档型 change 破坏，不扩张为新的产品运行时证据。

GitHub Codex follow-up 已按 OpenAI 官方入口接入：根 `AGENTS.md` 新增唯一 `## Code Review Rules`，用三条简洁规则显式要求读取本 Skill，并将自动 review 收敛到可证实的 P0/P1；Skill 新增 GitHub 模式，保留 frozen base 规则、exact-SHA 证据边界和不批准/不合并约束。完整阅读报告、codemap、图示和 P2 仍由显式人类协作调用产生，避免在 GitHub 自动 review 中刷低价值评论。

Follow-up RED 已确认根规则和 GitHub 模式原先均不存在。更新后 `quick_validate.py` 通过；Prettier、`ls-lint`、`git diff --check`、`pnpm verify:static`（249 个测试文件通过、2 跳过；1266 个测试通过、4 跳过；Svelte/TypeScript 零错误）与 `pnpm build` 再次通过。Codex Settings 的只读检查停在登录页，因此尚未取得本仓库 Automatic reviews 开关的真实状态；仓库配置完成不等于外部开关已启用。

仓库侧 follow-up 已作为 PR #23 提交；首次读回 source 为 `codex/github-codex-code-review`、target 为 `main`，远端 head 与本地一致为 `de3e685254ffcec170a2a725e1818fb8453169d2`，当时 mergeability 为 `MERGEABLE`。该状态仍可能随新提交、review 和保护规则变化，最终准出以 GitHub live state 为准。
