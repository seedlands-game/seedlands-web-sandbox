# 大规模变更的工作量与 AI 成本估算规范

状态：Delivered，Agile 文档治理变更；用户已明确要求沉淀工作区规则。本合同先于规则修改建立，不授权 Node 产品实施或创建 goal。

## 背景与目标

大型 change 缺少可比较的传统工程工作量、Agent 连续运行时间和实际费用预算。将双口径估算纳入 SDD，方便决策和后续设定 20% 缓冲预算。当前 Node 方案是首个应用样本。

## 范围与非目标

更新 `AGENTS.md`、开发治理和协作路由，新增统一的 `docs/change-estimation.md`。规则覆盖 PD、模型/计费假设、credits、API 等价费用、额度占比、连续时间、20% buffer、实际值回填与超支处理。不改运行时、测试 runner、计费账号或 goal 工具；不新增全库历史 spec 补写要求。

## 决策

正文集中一份规范，AGENTS 与 SDD 提供短门禁及链接。估算带范围、来源与置信度；credits、token、API 美元、订阅窗口各自记账。缺计费映射写 unknown 并规定校准步骤，不造精确值。当前工具只能以 token 设置 goal 预算，不能冒充 credits 硬限制。

## 可观察行为

- Given 新 change 达到大规模条件，When 提交实施方案，Then spec 链接版本化估算，含正常/保守值与保守值 × 1.2 的预算建议。
- Given 只有窗口使用百分比，When 估算账户成本，Then 不把百分比当 credits；记录分母未知和采样计划。
- Given 模型、范围或费率改变，When 恢复或继续工作，Then 保留旧估算并重算剩余成本，不能自动扩大原预算。
- Given 用户只是讨论 goal 预算，When 完成估算，Then 不自动创建 goal、购买 credits 或兑换 reset。

## 测试设计

Static：实施前原文缺少上述大规模门禁及规范文件，预期文档核查不满足。实施后检查链接、估算公式及单位、一致性、Prettier 与 diff。此为可逆文档规则修改，不增加镜像文案断言测试；产品 Vitest/Build/浏览器证据 N/A，无产品或执行配置变化。

## 准出与证据

| 准出                                          | 证据                       | 结果                                                         |
| --------------------------------------------- | -------------------------- | ------------------------------------------------------------ |
| AGENTS、SDD、路由指向同一估算规则             | Static                     | 已核验链接、正文和职责分工                                   |
| 单位、20% 缓冲、goal 能力边界与额度未知可恢复 | Static / Manual supplement | 已核验官方费率、额度快照、公式和工具 schema                  |
| Node 当前方案有分阶段双口径估算               | Static                     | 已核验分阶段合计、四种模型金额及保守值 ×120%；实际消费未采集 |

## 任务与当前状态

合同、规则与 Node 样本、文档和算术校验完成，创建语义化本地提交。仅本地文档交付；不 push。

## 交付快照

更新 AGENTS、`docs/development-governance.md`、`docs/collaboration-routing.md`，新增 `docs/change-estimation.md`；Node 样本在相邻 change 的 `estimates.md`。Prettier、相对链接、分阶段算术及 20% 缓冲核验通过，提交前执行 diff check。没有修改执行配置/产品/测试，没有复跑产品构建或浏览器，均为 N/A。文档治理准出不等于 Node 功能、性能或成本实测通过。

长期 docs baseline 本次更新，因为用户要求将大规模估算作为后续 change 的通用规则；产品能力和长期路线不变。规则当前只在此本地功能分支，未合入 main；提交 SHA 由 Git 记录，不写入提交自身内容。
