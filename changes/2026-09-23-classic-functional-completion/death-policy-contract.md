# V2 death policy spine 合同

状态：`V2-DEATH-POLICY-SPINE-01` 实施冻结。本文只冻结 stdlib 公共策略能力与纯 settlement participant；不安装 Classic 策略，不修改 death producer、Needs、Combat、Vitals、Autonomy、Web 或存档 schema。

## Owner 与接口

- `death-inventory-policy-module.ts` 拥有无状态 capability `seedlands:death-inventory-policy@1.0.0`。定义只有 `version: 1` 与精确的 `player | creature | npc` 三项策略；每项策略只有 `inventory/cursor/crafting/armor/actor` 五个字段。
- `defineDeathInventoryPolicyModuleV1({ moduleId, definition })` 在模块创建时严格校验、脱离输入并深冻结定义。固定字段顺序的 canonical definition 进入 `definitionIdentity`。模块不注册 state、resource、operation、snapshot child 或全局可重配状态。
- capability 暴露冻结的 `definition` 与 `policyFor(kind)`。composition resolver 仅在 definition map 声明该 capability 时读取 provider；缺失返回 `null`。非法 provider、重复 provider 或未批准替换继续由既有 assembly fail closed。
- `DeathInventorySettlementCandidateV1` 分开保存原始权威 source frontier 与拟结算 components。source 固定包含 actor lifetime reference、health 与完整 actor components 的深复制；拟结算 components 可包含 post-hit armor/needs 与已清空 break action，但绝不能被当作 expected source。
- `prepareDeathInventorySettlementSeriesV1` 接收一个或多个 candidate 与显式 intrinsic drops。它在调用底层 prepare 前完成 source reference 唯一性、source health/完整 components 新鲜度以及 replacement/despawn 互斥检查，再按既有 `prepareEntityMutationSeries` 的 `128` entries/segment 和 `192` segments 总预算打包，且只调用一次共享 allocator/frontier。
- `prepareDeathInventorySettlementParticipantV1` 仅委托上述 series，不能保留较弱的单 actor 绕过路径。candidate builder 与 participant 都是纯候选/准备步骤，不自行 apply。

## 行为与失败

- drop 顺序对每个 candidate 固定为 inventory slot、cursor、crafting slot、armor slot；candidate 按调用者提供的稳定顺序处理，最后追加显式 intrinsic drops。每个非空 stack 产生一个 spawn，durability 原样复制，不合并来源。
- drop/retain 以拟结算 components 为准，因此命中中已经破碎的 armor 不掉落，未破碎 armor 使用命中后 durability。`actor: despawn` 禁止任一容器 retain。
- retain actor 写入 `health: 0`、`lifecycle: dead`；despawn actor不产生 replacement。inventory/cursor/equipment 的交互变化仍由既有 ECS owner 统一把共享 `inventoryRevision` 推进一次。
- duplicate source、source health/needs/armor/revision/epoch/lifetime 漂移、replacement/despawn 冲突、最后一个 spawn capacity 失败、segment 或 series 总预算越界，必须在 prepare 或 validate 阶段失败且零写。prepare 成功后继续由既有 series 检查 owner、epoch、sequence、lifetime/order high-water 与 touched snapshot。
- 本片不定义 producer failure receipt。后续 composed 致命 producer 缺 capability 时必须返回稳定 `death-inventory-policy-unavailable` 且零提交；非致命路径不变。该失败尚未接线，不能宣称已实现。

## 可替代配置反例

非 Classic fixture 必须证明两份合法定义可为 `creature` 或 `npc` 选择不同 retain/drop/despawn 组合，并因此产生不同 composition identity。stdlib 不根据 Classic item ID、actor item ID 或隐式 player 身份选择策略。Classic 目标配置留后续串行安装：player 四容器 drop + retain；creature/npc 四容器 drop + despawn。

## 测试设计与阶段 done_when

1. RED：当前单 participant 在 build 后仅发生 health 或 needs 漂移时仍可 prepare，测试必须以行为断言失败，不使用 missing import/collection。
2. Capability GREEN：精确字段/类型、detach/deep-freeze、`policyFor`、canonical identity、缺 capability=`null`、非 Classic 替代 identity，以及既有 assembly 对重复/provider 冲突 fail closed。
3. Settlement GREEN：多 actor、超过 128 个 drops 的一次 series；post-hit proposed components；四容器稳定顺序和 durability；explicit intrinsic drop；duplicate actor；health/needs/armor/revision/epoch/lifetime stale；prepare 后 frontier stale；最后 spawn capacity；总预算；单 participant 委托。全部失败检查 actor/world/revision 零污染。
4. 静态门禁：stdlib 与 root test types、mod-api 导出边界、改动 TS lint、可编辑文件 format、scoped diff；所有命令经默认 benchmark window，全局串行，Vitest `--maxWorkers=1`。
5. 证据收口：原始 RED/GREEN/stdout/receipt 保留；`SOURCE-MANIFEST` 只列本片源码/测试/合同/证据文档，`MANIFEST` 列证据目录内除自身外全部文件。root 准出前不 Git、不安装 Classic、不接 producer。

## 工作量与预算

- 传统人工估算：2.5–3.5 PD（能力合同与装配 0.5–0.75，source frontier/series 1–1.5，正反例与边界 0.75–1，证据/复核 0.25）。
- AI 实施预算：单个不超过 5h 的活跃窗口，预计 3–5h；保守 `×120%` 建议上限 6h。
- 模型 credits、API 等价费率、当前额度与额度分母：当前均未知，不换算 token 或金额，不虚构占比；范围若扩到 producer/Classic/Web，必须另行重估并重新准出。

## 明确未完成

Classic pack 策略注册、composition predecessor、Combat/Needs/Vitals/Autonomy death producer、稳定 producer failure receipt、NPC intrinsic drop/despawn、UI、Browser/Cua、build、CI 和发布均不属于本片。`needs-state-port` 的非 player health/lifecycle 禁令保持不变。
