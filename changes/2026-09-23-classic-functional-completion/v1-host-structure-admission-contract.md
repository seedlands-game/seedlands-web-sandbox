# V1 产品宿主 Structure 准入合同

状态：定向 GREEN，等待 root 准出

## 问题与边界

Classic `seedlands:overworld` 已正式安装 Structure definition/actions，其模块声明请求
`seedlands.structure` 的 `read`、`execute`。production Pack builder 与 headless host 使用
`scripts/product-pack-admissions.mjs` 的独立产品授权；该表尚未包含 Structure，因此经过摘要校验的
Pack 仍会在 `assembleProductPacks` 阶段被拒绝。Browser-02 已证明此前 presentation lock schema
问题关闭，但随后在 C0 命中本 host grant 缺口，V1 旅程仍全部 NOT OBSERVED。

本阶段只修改产品组合根的固定授权表，不修改 Kernel、stdlib permission 模型、Pack 请求、assembly
拒绝逻辑、Worker loader、操作系统/云/TCC 权限或凭据。

## 冻结行为

- `permissionsForProductPlaybook('seedlands:overworld')` 显式包含
  `seedlands.structure: ['read', 'execute']`。
- 不授予 `seedlands.structure/write`，也不从 Pack 请求自动派生 host grant。
- `seedlands:click-conversion`、`seedlands:builder` 与 `sample:modular-world` 不继承该授权。
- 未知 Playbook ID 继续 fail closed。
- 正式 Classic manifest 的全部模块权限必须由上述真实 host grant 覆盖，并通过
  `assembleProductPacks`；移除 Structure grant 后，同一正式 artifact 必须在 world composition 创建前拒绝。

## RED / GREEN

- RED：正式 Classic artifact 加载实际 `permissionsForProductPlaybook('seedlands:overworld')` 后，
  权限集合缺 `seedlands.structure`，`assembleProductPacks` 抛出 host 未批准错误。
- GREEN：只增加固定 Structure read/execute 后，完整正式请求集合无缺项并成功 assembly。
- negative：write 未获批，alternative/unknown 不继承，删去 Structure grant 的真实 assembly 仍拒绝。

## 证据边界

本阶段可证明产品 host admission 与正式 Classic Pack 闭合，不证明浏览器、门旅程、音频或 Cua
通过。需要新 source SHA 的 production artifact 和 root 唯一 browser lease 后才能重新执行 V1。
