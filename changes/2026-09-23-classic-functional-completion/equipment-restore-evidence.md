# V2 Equipment Restore Regression 证据

阶段：V2-EQUIPMENT-RESTORE-REGRESSION-01
基线：`e0594e0260b54274db1e570f632ae4a9b9042152`
状态：restore 回归 GREEN；现有 Classic Web pointer suite 被测试 Pack receipt 阻断；未提交、未暂存、未推送。

## Web Pointer 9 项复核

GIT-21/BUILD01 没有留下该 suite 对当前已提交闭包的运行证据，因此在保留的 clean
`/private/tmp/seedlands-v2-acceptance-50a1e6ec` 上只运行一次：

```sh
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- /bin/bash -o pipefail -c \n+  'node_modules/.bin/vitest run --config apps/web/vitest.config.ts \n+  apps/web/tests/integration/runtime/server/composition/gameplay-inventory-pointer.test.ts \n+  --maxWorkers=1 2>&1 | tee .../web-pointer.stdout.log'
```

窗口 `v2-equipment-web-pointer-regression` 为 `FAIL/exit 1`，结果 `1 file / 9 failed`。九项全部在各自
`setup()` 调用 `assembleOverworldPacks` 时抛出
`Pack integrity receipt is missing or adds resources: seedlands:overworld`；栈顶在
`packages/stdlib/src/server/composition/assembly.ts:153`，未进入 pointer 或 restore 行为。该结果独立复现了旧
主树报告中的相同 fixture/Pack receipt 缺口，但不证明九项产品行为失败。本片未修改 Pack、Classic fixture
或 production。

## V4 Restore 验证

专属 detached test tree：`/private/tmp/seedlands-v2-equipment-restore-e0594e02`。测试只新增
`packages/stdlib/tests/server/equipment-pointer-restore.test.ts`，以非 Classic Pack 注册 visor/suit armor
capability 与正式 Inventory modules，所有状态都由真实 registered `inventory-pointer` action 建立。

最终 suite 窗口 `v2-equipment-restore-tests-final2` 为 `PASS/exit 0`，结果 `1 file / 4 tests`：

- V4 完整保留 bag、origin-bearing cursor、personal crafting、四槽 armor、instance durability 与
  `inventoryRevision`，且 restore 输入与权威状态无可变别名。
- 成功 restore 使旧 actor reference 和 retained inventory access 因 owner epoch 换代失效；新 reference
  继续完成 occupied swap、脱下、再次穿入，每次实质变化 revision 恰加一。
- 历史 V4 缺失 `equipment.armor` 恢复为完整四空槽，同时保持 bag、cursor、hotbar 与 selected slot。
- wrong-slot armor 与超出 max 的 durability 均在 candidate 校验期拒绝；目标 runtime 的完整 snapshot 不变，
  restore 前 reference 仍有效，证明无部分 actor/world/revision 安装。

首轮 `v2-equipment-restore-tests-01` 为 `3 passed / 1 failed`。唯一失败是测试直接变异
`createSnapshot()` 返回的 frozen durability 对象而触发只读属性异常，不是生产 restore 缺口；修正为先
`structuredClone` 传入 payload 后，`restore-tests-final` 通过 4/4。随后增加“再次穿入”和 armor 无别名断言，
最终 `restore-tests-final2` 仍为 4/4。所有原始结果均保留。

## 静态与边界

- `v2-equipment-restore-stdlib-types`：PASS；生产源码身份未再变化。
- `v2-equipment-restore-root-test-types-final`：PASS，覆盖最终新增测试身份。
- `v2-equipment-restore-classic-test-types`：PASS；最终增量只改变 stdlib test，不影响该配置。
- `v2-equipment-restore-static-final`：新增测试 ESLint、Prettier check、scoped diff 均 PASS。
- 在正式门禁前误直接执行过一次未加 `benchmark-window` 的 root test typecheck；它只报告测试的两个 readonly
  payload 赋值错误，随后通过局部 mutable test cast 修正。该预检不计作证据，正式锁内 root test types 已 PASS。
- 未发现需修改 production 的 restore 缺口；未修改 public restore/schema、combat、death、UI、Pack、Lighting、
  transport 或 `spec.md`。761 的 I2.1c registered combat armor 仍独立进行，本片未读取其未完成 dirty。
- 未运行 build、Browser、Cua、CI 或完整 GIT-21 矩阵。专属 test tree 保留给 root 审阅；既有 V2
  acceptance tree 与 dist 未改动。

本片传统估算 0.5 PD，AI 活跃约 1h；credits、API 等价费用、费率、额度分母与占比 unknown。
