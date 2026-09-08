# AI 与人类协作 CR 调研依据

核对日期：2026-09-08。以下资料用于设计本 skill，不表示其工具或组织流程直接适用于 Seedlands。

## 结论如何进入工作流

1. **先解决理解，再找缺陷。** Microsoft 对现代代码审阅的观察、访谈与调查发现，理解变更原因和陌生文件是最突出的挑战；上下文更充分时，反馈更快、更深入、更可执行。由此要求报告先产出逻辑分层、阅读顺序、流程/时序和 codemap，再开始独立 finding。
2. **审阅 diff，但必须读取系统上下文。** Google 的工程实践要求逐行覆盖被分配代码，同时查看完整文件和系统级影响，并建议先读主要逻辑文件。由此建立 changed-file coverage ledger，并按入口和逻辑切片组织，而非只按文件列表复述。
3. **AI 补充静态检查，不复制它。** Google 的 AutoCommenter 工业实践表明，细微规则、合理例外、注释清晰度等大量实践超出传统静态分析；同时“技术上正确但低价值”的评论会产生负价值。由此只沉淀语义规则，去重格式/lint，并要求每个 issue 有触发和影响。
4. **管理误报与信任。** AutoCommenter 的部署经验强调真实使用反馈、阈值和低价值规则抑制；离线指标不能替代实际有效性。由此要求置信度、待确认区、相同根因合并和“无问题时不凑数”。
5. **AI 不是最终 reviewer。** GitHub 明确说明 Copilot code review 可能漏报或出错，反馈应仔细验证并由人类审阅补充。由此保留人类最终判断，不让 skill 自动批准、合并或把 review 等同质量保证。
6. **严重度必须显式。** Google 建议区分 required、optional、nit/FYI，避免作者把所有评论都理解为强制。由此采用用户指定的 P0/P1/P2，并规定 P2 不阻塞。
7. **保持可审阅的变更单元。** Google 建议自包含的小变更，并指出大型变更更难被彻底审阅、也更易遗漏问题。Skill 不用固定行数拒绝大 diff，而是按逻辑切片分批、保留覆盖账本，未覆盖时明确声明。
8. **规则基线不能由待审变更自我定义。** GitHub Copilot review 使用 PR base 分支的自定义指令。Seedlands 同样以 frozen base 的已接受合同为审阅基线，把 head 对规则的修改作为待审提案。

## 一手与权威来源

- Alberto Bacchelli、Christian Bird，[Expectations, Outcomes, and Challenges of Modern Code Review](https://www.microsoft.com/en-us/research/publication/expectations-outcomes-and-challenges-of-modern-code-review/)，ICSE / IEEE，2013。经验研究；支持“理解、知识传递和上下文决定 review 深度”，不用于声称 AI 工具效果。
- Google Engineering Practices，[What to look for in a code review](https://google.github.io/eng-practices/review/reviewer/looking-for.html) 与 [Navigating a CL in review](https://google.github.io/eng-practices/review/reviewer/navigate.html)。支持设计/功能/复杂度/测试/上下文、逐行覆盖和先读主要逻辑。
- Google Engineering Practices，[Small CLs](https://google.github.io/eng-practices/review/developer/small-cls.html)。支持自包含、小变更和大型变更分解；其中行数示例不作为 Seedlands 硬门槛。
- Google Engineering Practices，[How to write code review comments](https://google.github.io/eng-practices/review/reviewer/comments.html)。支持解释原因、评论代码而非作者，以及明确 required/optional/nit 的严重度语义。
- Manushree Vijayvergiya 等，[AI-Assisted Assessment of Coding Practices in Modern Code Review](https://doi.org/10.1145/3664646.3665664)，AIware / ACM，2024。Google AutoCommenter 的工业部署研究；支持 AI 补充静态分析、真实反馈校准和抑制低价值评论。其语言与组织环境不同，不能把具体比例外推为本项目效果。
- GitHub Docs，[About GitHub Copilot code review](https://docs.github.com/en/copilot/concepts/agents/code-review)。支持全仓上下文能改善 review，以及 AI 可能漏报/出错、必须由人类验证。产品能力和费用会变化，本 skill 只采用其责任边界。
- GitHub Docs，[Using GitHub Copilot code review](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/request-a-code-review/use-code-review)。支持 review 使用 base 分支的仓库指令；本项目只借鉴其避免规则自我豁免的边界，不依赖 Copilot 产品。
- Luca Pascarella 等，[Code Review Automation: Strengths and Weaknesses of the State of the Art](https://arxiv.org/abs/2401.05136)，2024。支持自动 review 对不同变更类型表现不一，通用模型不能被假定等同人类 reviewer；该研究的工具和数据集限制不外推到当前模型。

## 未采用的做法

- 不用 AI finding 数量、评论接受率或“覆盖每条规则”当质量目标；这些指标会奖励噪音。
- 不让生成代码的作者说明成为正确性证据；说明只帮助定位，裁决仍回到源码、合同和可复验证据。
- 不以静态/单测绿色取代 UI、并发、持久化、真实浏览器、网络或性能证据。
- 不自动把 AI 评论发布到 PR，也不自动修复；这两者是独立的外部写入和实现授权。
