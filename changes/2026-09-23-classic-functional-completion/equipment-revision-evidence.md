# V2 Equipment Revision 证据

阶段：V2-EQUIPMENT-REVISION-01（I2.1b）  
基线：7030adac5ea234319bfe032185828287ee07b85d  
状态：revision 子片 GREEN；未提交、未暂存、未推送。

## 实施

- prepared entity mutation 的既有 inventoryRevision owner 现在比较 bag、cursor/crafting 与固定顺序的四槽 armor。
- armor 比较规范为每槽 itemId/count/durability；历史 undefined armor 与显式空槽等价。
- 一次 actor replacement 中多项交互状态变化仍只增加一次 revision。selectedSlot/hotbarSize 继续不参与比较。
- 未编辑 761 独占的 inventory-pointer-model.ts、inventory-pointer-slot-state.ts、equipment-pointer-behavior.test.ts 或 equipment-pointer-contract.md。

## RED 与 GREEN

| 门禁                   | window                                         | 结果                            | 边界                                                                                                                                                                                                                |
| ---------------------- | ---------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 共享 RED 基线          | v2-equipment-revision-red-01                   | 预期 FAIL，1 failed / 2 skipped | armor-only replacement 后实际 revision 仍为 0、期望 1；测试已收集并进入行为断言                                                                                                                                     |
| 独立 revision 矩阵     | v2-equipment-revision-tests-final3             | PASS，1 file / 12 tests         | armor-only、bag+cursor+crafting+armor 单次 +1、cursor-only、crafting-only、durability、legacy 空槽等价、同值 clone、selectedSlot-only、abandon/cancel、invalid prepare、stale lifetime、stale apply、overflow/no-op |
| 共享第二项             | v2-equipment-revision-shared-final             | PASS，1 passed / 2 skipped      | 未修改共享文件，只运行并关闭原 RED 第二项                                                                                                                                                                           |
| prepared mutation 回归 | v2-equipment-revision-web-regression-final     | PASS，2 files / 14 tests        | 既有 mutation 与 series 原子行为                                                                                                                                                                                    |
| stdlib types           | v2-equipment-revision-stdlib-types-final       | PASS                            | 当前 revision 生产源码                                                                                                                                                                                              |
| root test types        | v2-equipment-revision-root-test-types-readback | FAIL，exit 2                    | 本片测试无诊断；被 761 并发 inventory-pointer-model.ts:190 的 TS2367 阻断，本片未越权修复                                                                                                                           |
| root test types 前序   | v2-equipment-revision-root-test-types-final    | PASS                            | 同一 revision 生产实现、早于新增两项测试与 761 最新并发 hunk；不冒充最终全树结果                                                                                                                                    |
| Classic test types     | v2-equipment-revision-classic-test-types-final | PASS                            | 当前 revision 生产实现；新增 stdlib 测试不在该配置                                                                                                                                                                  |
| 本片静态               | v2-equipment-revision-static-final2            | PASS                            | 两个本片 TS 的 ESLint、两 TS/三协调文档的 Prettier 与 scoped diff                                                                                                                                                   |

regression-01 使用 stdlib Vitest 配置时只收集独立 revision 测试，真实结果为 1 file / 8 tests；没有把命令行中的两个 Web 路径写成已运行。随后 web-regression-final 使用 Web 配置真实执行 2 files / 14 tests。所有原始 stdout 和 window receipt 均保留。

## 剩余边界

- 共享 equipment-spine-red.test.ts 在本片后未整体运行：第二项已定向 GREEN；第一项由 761 的 I2.1a 负责，当前不判定；第三项 death settlement 最近一次为 V2.0 RED，本片未改 producer、未重跑。
- root test types 的最新全树结果不是 PASS，须等 761 关闭 inventory-pointer-model.ts:190 的 TS2367 后由 root/组合阶段复验。
- 未运行 build、Browser、Cua、CI、完整 Classic headless 或性能；不宣称 V2 行为或产品 GREEN。
- 未接 death producer、UI 或 combat armor，不处理薄门限制；长期 docs baseline 未更新，因为这是 change 内局部实现 checkpoint。
- 实际活跃墙钟约 0.25h；原预算 AI 1-2h、传统 0.5-1 PD 未超出。credits、API 等价费用、额度分母与占比 unknown。
