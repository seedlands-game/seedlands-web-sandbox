# V2 Registered Needs Fixture 收口证据

阶段：`V2-DEATH-NEEDS-FIXTURE-CLOSE-02`
基线 HEAD：`5fcdc1dffe3b4a7fbcf5e43c91ae45189ed10708`
状态：fixture 与完整十项回归 GREEN；未暂存、未提交、未推送。

## 修改与依赖

- `gameplay-registered-needs.test.ts` 的 `setup(true)` roots 显式增加
  `seedlands:overworld-death-inventory-policy`。`classicGameplayDomainModules` 仍只选择明确 roots 及其
  `descriptor.requires` 闭包，没有修改 helper 默认行为。
- 使用当前 Classic pack 内真实 policy：player 四容器 drop + actor retain，creature/npc 四容器 drop + actor
  despawn。测试没有重新定义 policy、mock capability、fallback 或修改十项既有断言。
- 本片自身唯一源码变化是上述测试一行。954 并行 dependency identity：
  `death-inventory-policy.ts` SHA-256
  `8a0e10f1c84949a8d9c49d99466b8699c93a623e51f07f53c35ca342d8a1c02d`，`pack.ts` SHA-256
  `18f5cc832e27bf3cdf5c336604db58e1bbd3bba32c7af30680b77014d1fc3374`；migration/predecessor hashes 见 delivery
  metadata。它们只记录依赖，不属于本片 SOURCE ownership。

## RED 与 GREEN

- RED 复用 `V2-DEATH-REGISTERED-NEEDS-01` 的窗口 `v2-death-registered-needs-regression-01`：完整 suite
  `8 passed / 2 failed`，两个 death case 均进入 registered schedule 后收到
  `death-inventory-policy-unavailable`。旧测试 SHA-256
  `5f014572301ecee20d2b665d8e0ee202d82545d6f058e426d03896de144e167f`；stdout SHA-256
  `df9c3acdad10b4405e4444f49f26463b75bb068ed5a35c3f7e4f3c4c4e74a5d4`；receipt SHA-256
  `9d5df8d21a7197d10a9926819928ffdd1b14571dc40b69295c23b32d81921a49`。
- GREEN 窗口 `v2-death-needs-fixture-green-01` 为 `PASS/exit 0`，完整 `1 file / 10 tests`，没有 skip/retry。原
  death allocation 与 incoming combat effects 用例均通过，其余 revision/cadence、无 Needs module、NPC needs、
  restore/migration 和 creative 行为保持。stdout SHA-256
  `4b1847913f9630e389cd180bcf68bab1404eb40ccde287f74e4bd0a862ad34fa`；receipt SHA-256
  `43fb4e90a9f98fdb20ea58520caa16317f67de58d36822c780da1acf710e14eb`。
- root test types 窗口 `v2-death-needs-fixture-type-root-01` PASS；Classic test types 窗口
  `v2-death-needs-fixture-type-classic-01` PASS；单文件 ESLint 窗口
  `v2-death-needs-fixture-eslint-01` PASS。最终 format/diff 窗口
  `v2-death-needs-fixture-diff-delivery-frozen-02` 另行记录。

所有新命令都从仓库根目录经默认机器级锁运行；Vitest 显式 `--maxWorkers=1`。

## 边界

- 冻结的 Needs12 与 public mixed13 没有生产变化，本片未重跑。旧
  `evidence/v2-death-registered-needs-01/` 全部 raw/metadata 保持原字节。
- 本片不修改 production、spec、Classic pack/迁移、helper、tasks 或 execution-state；不准出整个 Classic policy
  安装、迁移、build、Browser、Cua、CI 或完整 V2。
- 长期 docs baseline 未更新：这只是 test composition 的显式 module selection，不改变公共 API、owner 或产品
  架构。
