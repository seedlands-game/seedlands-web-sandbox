# S2 独立审阅修复

审阅对象：`2e858980401a05e583deb4ed1b144b2bc599b268..22b68c9774d4fa7e6ef085b1a9ecc55cd7ac8786`，只读冻结 Git tree。S3 工作树不属于该审阅结论。

## 已证实问题

1. Action snapshot 接受低于已有 `action-N` 的 allocator sequence，后续新动作可能覆盖另一角色的旧动作；同时 pathIndex/repathCount 的非法边界未在 restore 拒绝。
2. Combat v1/v2 的 actionSequence 未覆盖 active/lastResult 的 `combat-N`，后续攻击可能复用 ID，并把旧命中结果误认为当前结果。

两项分别新增 4 个真实 RED。修复在替换候选前验证 allocator 高水位，Action 还验证路径索引和重算次数；新的自动 ID 分配在安全整数上限明确拒绝。Combat 保留由 ActionRuntime 生成的独立 `action-N` 身份来源。

此外补充 V2/V3 Gameplay wrapper 内的 active、缺失 target、已删除角色/目标的 terminal history 和旧 Combat v1 取消 fixture。V1 Gameplay 格式没有 simulation/actions 字段，按其原合同迁为空模拟；没有为覆盖表捏造不存在的 V1 动作字段。

## 验证范围

根任务集成工作树上定向 5 文件 / 45 tests 通过；受改文件 ESLint 通过。此时 S3 内容适配已在并行工作树，结果明确不是干净 S2 tree 的全量复跑；这组修复单独提交给 reviewer 静态复核，最终 S3 基础门禁仍需串行运行。

npmjs 项目配置有用户后续明确授权「直接从npmjs公共源拉取依赖 本项目都走npmjs 记住了」，reviewer 已据此撤销供应链范围疑问；不是绕过旧门禁或要求重复审批。
