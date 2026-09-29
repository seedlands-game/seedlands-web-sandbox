# V2 Equipment Station Host 证据

阶段：V2-EQUIPMENT-STATION-HOST-01  
基线：7030adac5ea234319bfe032185828287ee07b85d  
状态：station host 子片 GREEN；未提交、未暂存、未推送。

2026-09-25 执行 `V2-STATION-EVIDENCE-RECONCILE-01`：root 撤销了旧 GIT-21 冻结清单。此前本 agent
在收到 GIT-21 后误删除了已通过的第 11 项真实 combat cancellation 测试；本次严格按此前工具 diff 恢复
`defineCombatModule`、`sample:punch`、模块注册和合法 NPC target 测试。恢复不以任何旧 hash 为目标；
当前测试 SHA 按实际文件重新计算，并由新的 reconcile window 独立验证。原 30 个证据文件全部保留。

## 实施与 RED

- 非 Classic sample armor 与 workbench 的正式 GameplayRuntime station-pointer 路径先取得 RED：operation 与
  candidate 成功、actor revision 前进、cursor 清空，但 actor armor 仍为空，durable visor 从权威状态丢失。
  `v2-equipment-station-host-red-01` 为 1 file / 1 failed，失败位于最终 armor 断言，不是 import、collection
  或 pointer guard。
- 唯一生产修复是在 registered-station-runtime.ts 的 station pointer prepared actor replacement 中加入
  `equipment: candidate.equipment`。没有修改候选、revision、protocol、projection、death、combat 或 UI。

## 最终验证

| 门禁                    | window                                          | 结果                           | 边界                                                                                                                                                                                                           |
| ----------------------- | ----------------------------------------------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| station host 矩阵       | v2-equipment-station-host-tests-final2          | PASS，1 file / 11 tests        | helmet 穿入、boots 脱下、chestplate 交换、leggings origin-close、durability/总量守恒、actor revision、station revision、单次 fact/drop、authorization、actor/station stale、capacity、真实 combat cancellation |
| registered station 回归 | v2-equipment-station-host-regression-final      | PASS，1 file / 4 tests         | 既有 transfer/craft/furnace/authorization host 行为                                                                                                                                                            |
| pointer 依赖回归        | v2-equipment-station-host-pointer-regression    | PASS，3 files / 32 tests       | 761 当前 model/behavior/station candidate 组合                                                                                                                                                                 |
| 共享 V2 行为            | v2-equipment-station-host-shared-01             | 预期 FAIL，2 passed / 1 failed | equipment 与 revision 已 GREEN；仅 combat death armor settlement 仍 RED                                                                                                                                        |
| stdlib types            | v2-equipment-station-host-stdlib-types-01       | PASS                           | 当前并发组合生产类型                                                                                                                                                                                           |
| root test types         | v2-station-evidence-reconcile-root-types        | PASS                           | 当前恢复后测试身份与并发 pointer 组合测试类型                                                                                                                                                                  |
| Classic test types      | v2-equipment-station-host-classic-test-types-01 | PASS                           | Classic 测试类型                                                                                                                                                                                               |
| reconcile 完整矩阵      | v2-station-evidence-reconcile-tests-final       | PASS，1 file / 11 tests        | 恢复第 11 项后的当前最终 test 身份，包含真实 combat cancellation                                                                                                                                               |

`tests-01` 的 7 passed / 2 failed 是测试夹具在 transaction 内调用 GameplayRuntime.createSnapshot 导致
queue flush 重入，回调未完成赋值；改为只读 EntityStore snapshot 后 `tests-02` 10/10。`tests-final` 的
10 passed / 1 failed 是真实 combat fixture 使用 player target 被规则拒绝；改为合法 NPC target 后
`tests-final2` 11/11。两次失败均保留，不伪装为产品失败。
GIT-21 误续阶段产生的原始 `format-final`、`tests-final` 和 `tests-final2` 输出同样保留，未删除或改写；
本次 reconcile 新增独立 window/stdout，不把旧结果冒充新运行。receipt 仅从 `.json` 改名为 `.json.log`，
保留原字段与原字节。
一次混合 Web 回归 `v2-equipment-station-host-regression-01` 中 registered station 4 项通过，但 Classic
gameplay-inventory-pointer 9 项在 setup 阶段因并行 Classic Pack 新增资源尚未同步 fixture integrity 而失败。
它不是 station host 行为失败；本片没有修改 Pack 或其测试，随后独立 registered station 回归 4/4 通过。

## 边界与未验证

- equipment/revision/station host 三片当前组合后，共享三项实际为 2 passed / 1 death RED；death producer
  仍待 I2.2，本片不修改或宣称通过。
- 成功 close-drop 证明一个 fact 与一个 world-item；拒绝路径比较完整 owner snapshot，未观察到新增 fact。
  事务内部 fact 发布由既有 registered operation owner 执行，本片未新增 receipt owner。
- 未运行 build、Browser、Cua、CI、完整 Classic headless 或性能；长期 docs baseline 未更新，因为当前仍是
  change 内局部 V2 子片。
- 实际活跃墙钟约 0.5h；预算 AI 1-3h、传统 0.5-1 PD，保守 120% 为 AI 3.6h、传统 1.2 PD。credits、
  API 等价费用、额度分母与占比 unknown。
- stdlib 与 Classic types 的既有 PASS 回执晚于 `tests-final2`，对应恢复后的相同 runtime/test/pointer
  源码身份；本次 reconcile 明确复用，不为单纯补日志重跑。root test types 使用本次
  `v2-station-evidence-reconcile-root-types` 新窗口，结果 PASS。
