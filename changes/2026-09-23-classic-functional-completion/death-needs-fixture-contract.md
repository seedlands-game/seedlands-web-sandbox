# V2 Registered Needs Fixture 收口合同

阶段：`V2-DEATH-NEEDS-FIXTURE-CLOSE-02`
状态：Classic policy dependency 已存在；fixture 接线与完整回归待本阶段完成。

## 唯一修改

- `gameplay-registered-needs.test.ts` 的 `setup(true)` 继续通过
  `classicGameplayDomainModules(roots, replacements)` 选择真实 Classic 模块。roots 必须显式加入
  `seedlands:overworld-death-inventory-policy`，因为该 helper 只沿 `descriptor.requires` 递归，不会自动选择 pack 中
  与 Needs 无 requires 关系的 death capability provider。
- 使用 `playbooks/classic/src/pack.ts` 已注册的真实 `classicDeathInventoryPolicyModule`；不得在测试内重新定义 policy、
  mock capability、增加 fallback 或修改 helper 的全局默认。`setup(false)` 继续不安装 Needs 或 death policy，保持
  “Playbook omits Needs module” 的原测试语义。
- 不修改现有十项行为断言、production、Classic pack/迁移、当前 spec、tasks 或 execution-state。

## RED 与 GREEN

- RED 复用已归档窗口 `v2-death-registered-needs-regression-01`：完整 suite 为 `8 passed / 2 failed`；两个 death
  case 均进入 registered schedule 后收到 `death-inventory-policy-unavailable`。测试源码 hash
  `5f014572301ecee20d2b665d8e0ee202d82545d6f058e426d03896de144e167f`，stdout SHA-256
  `df9c3acdad10b4405e4444f49f26463b75bb068ed5a35c3f7e4f3c4c4e74a5d4`，receipt SHA-256
  `9d5df8d21a7197d10a9926819928ffdd1b14571dc40b69295c23b32d81921a49`。
- 唯一行为变化是 `setup(true)` 的 selected module set 增加现有 Classic death policy。完整
  `gameplay-registered-needs.test.ts` 必须 `10/10`，原 death allocation 与 incoming combat effects 断言不得跳过或
  放宽。
- 静态门禁为该测试的 root/Classic test types、定向 ESLint/Prettier 和 scoped diff；所有命令经默认
  benchmark window，Vitest `--maxWorkers=1`。

## 边界

- 本片不准出整个 Classic policy 安装、迁移、production Needs、Direct Vitals、Combat、build、Browser、Cua 或
  CI。954-owned dependency 的源码与测试只读，其最终交付身份由 root/954 独立冻结。
- 长期 docs baseline 不更新：这是现有 test composition 的显式 root 修复，不改变公共接口、owner 或产品架构。
