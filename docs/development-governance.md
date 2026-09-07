# 开发治理与证据基线

本页保存跨 change 复用的准出规则；运行方式仍以 README 和 `package.json` 为准。

## 轻量 SDD

每个改变生产代码、产品行为、架构、配置或测试口径的需求，先建立 `changes/YYYY-MM-DD-kebab-name/spec.md`。它至少写清目标、范围/非目标、关键决定、Given/When/Then 行为、实施前测试设计、逐项证据、任务状态和 Delivery Snapshot。

大规模 change 还必须在实施前加入「工作量与预算」或链接本 change 的 `estimates.md`，遵守[双口径估算规范](change-estimation.md)：传统 PD 与 Agent 工时/24h 连续完成时间分别估算；分模型列 credits、API 等价费用、当前额度占比、置信度和保守值 ×120% 预算。范围/模型变化与阶段结束重估，Delivery Snapshot 回填实际和缺失证据；未知不能写 0，也不自动授权创建 goal 或支出。

简单且已澄清的需求走 **Agile**：短 spec、RED、实现、GREEN 和本地准出连续完成。安全、权限、持久化格式、世界生成/Chunk、渲染管线、公开契约、跨模块重构或不可逆数据走 **Breaking**：先写 spec 与用例，用户审核精确 SHA-256 后实施。目标或方案不清楚时走 **Exploration**：仅在 `/tmp` 或独立非生产位置试验，不导入产品，方向稳定后以新 spec 和新审核正式实现。

审核本身不自动授权超出合同的发布、其他外部写入、权限变更或删除。项目默认交接由本用户长期授权：验收后的 change 可将功能分支推送至已配置 `origin`，并以目标分支为 base 创建或更新 PR；用户指定 `local-only`、不发 PR 或其他范围时优先。不得自动合并或绕过分支保护。`Scope`、`Decisions`、`Behaviour`、`Test Design` 或 `Acceptance` 的实质变化会使原 hash 审核失效，必须重新审核。每次准出记录 docs baseline 是否更新：跨 change 的难重建规则更新 docs；只影响局部行为时写明不更新理由。

大规模 change 在派发前必须给出双口径估算：传统 PD，以及分模型 agent 工时、按 24 小时连续执行的关键路径、credits/API 等价和当前额度占比。估算包含上下文、协调、验收与返工，20% buffer 只计一次；无法取得的数字写 `unknown`，credits、token、API 价格和订阅额度不得混作同一单位。只有用户明确要求时才创建 goal。格式可参考[本次估算](../changes/2026-09-07-agent-routing-contracts/estimates.md)，但费率与额度必须按当时状态核对。

## E2E 生命周期

`tests/e2e/` 只放长期核心基线；`changes/<change>/e2e/` 和 `midscene/` 保存当次需求证据。`pnpm test:e2e`、`pnpm harness:e2e` 与 `pnpm harness` 只执行基线；当前需求由显式 change 路径运行。

- **Active**：合同和需求用例由当前 change 维护、显式执行。
- **Delivered**：用例随 spec 保留为当次证据，不承诺随未来 API 变化维护。
- **Archived**：spec 和用例一起冻结在 ZIP 中；复用时由新 change 重新定义预期。

需求用例进入长期基线前，必须有实施者之外的高智能模型独立评审，覆盖长期价值、重复度、确定性、成本与维护负担；当前项目路由为 Sol/xhigh，并在 spec 记录请求的模型/effort 与结论。缺少或不通过时 fail closed，继续保留在 change。基线提炼后的目标、旅程或成本发生实质变化时原评审失效；基线提炼后要去重，并在 Delivery Snapshot 区分当前保护和历史证据。

## 证据边界

Vitest 证明纯逻辑、数据、算法和确定性不变量；Playwright 证明真实浏览器的可观察行为和输入；Midscene 证明视觉/语义旅程；手工检查只补充不能稳定自动化的体验项。一个验收项可需要多种证据，不能以一种替代另一种；不适用时写 `N/A` 和理由。

可程序化的 UI 行为优先 Playwright，视觉语义使用 Midscene；Midscene 在用户预算规划中可按近零增量成本估算，但真实运行仍可能依赖模型、密钥或服务，不能宣称免费。只有明确的单步诊断才直接使用 CDP/UI 调试，不把临时诊断代替可重复准出。

性能证据由 `seedlands-performance-validator`（默认 `Terra/high`）按[性能执行窗口](performance-execution.md)协调。采样命令必须持有机器级阻塞窗口；普通功能测试、等待时的负载、并发采样和未关联的历史结果都不构成当前性能证据。

`?harness=1` 只能通过生产 `World.edit()`、Store 或 streaming 路径构造确定状态，不替代真实 Pointer Lock 输入。`src/world/**` 的 V8 行覆盖率不低于 80%；静态、构建、浏览器、Harness 和手工游玩要在 spec 中分别陈述真实结果。

## 交付

确认在明确功能分支后，只暂存本 change 的文件，使用语义化本地 commit；按已授权的 PR 交接推送、创建或更新 PR，并持续跟进本 change 相关 CI 与合并冲突。最新 HEAD 的必要 CI 通过、无合并冲突且 PR 为 `ready for review` 时可交棒；人类审核仍待完成，单个 `MERGEABLE` 字段不代表所有门禁通过。CI 失败只修复本 change 相关原因后复验；状态无变化时不重复通知。历史 evidence 不因目录/API 演进而静默改写。具体源码职责与可执行 ESLint 规则见[目录规范](repository-structure.md)。
