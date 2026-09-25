# V2 Canonical Equipment Journey 证据

阶段：`V2-CANONICAL-EQUIPMENT-FIXTURE-01`
基线：`484ddf39d7e3bb881dd3d3cbaec775bd091c220d`
状态：fixture、确定性合同与静态验证完成；未运行 Browser，不代表真实装备旅程或完整 V2 GREEN。

## 实施结果

- `canonical-runtime-v11.json` 在既有平坦 corridor 内声明 10 个固定资源格：3 个原木、3 个石块和 4 个铁块，
  另声明一个与 C0-C5/V1 坐标不冲突的工作台重放位置。创造目录只负责真实放置，切回生存后才真实采集、
  拾取与合成，没有向 inventory 注入物品。
- `equipment-journey-support.ts` 负责固定资源路径和工作台合成。它按当前 Classic 注册内容执行
  3 wood -> 12 plank -> sticks/wood-pickaxe，3 stone -> stone-pickaxe，4 iron-block -> 36 iron-ingot，最后
  合成四件铁甲和额外铁头盔。工作台在步骤结束时真实拆除并拾回。
- `equipment-journey.ts` 使用正式 DOM 和 pointer queue 覆盖 helmet click、三槽 Shift quick-move、错误槽零变、
  occupied helmet swap、equipment->bag 脱下、bag->equipment quick-move 以及 equipment-origin close settlement。
  每次成功都等待同 runtime/actor 下 `inventoryRevision + 1` 的 Authority oracle，并核对应 DOM；错误槽在可见错误
  反馈后比较完整 committed inventory 子树。
- `classic-runtime.spec.ts` 在完整 V1 后、C4 前执行 V2，并把分阶段 snapshot 持续写入原 `restoreEvidence`。C5
  保留原 V1 media/door 校验，随后严格比较 runtime epoch 与 actor epoch 换代、actor entityId/lifetime、revision、
  slots、armor、cursor、health/lifecycle、armorPoints 和 durability，再通过新 actor ref 做一次真实脱穿。
- `harness.ts` 只引用独立 owner 已提供的公开 `HarnessEquipmentSnapshot` 并声明现有只读方法；未修改 production
  Harness oracle、Authority、pointer、UI、V1 helper、aim、mouse、route、timeout 或测试重试。

## RED 与修正

- 954 的组合 Classic types 首次发现 `scenario.test.ts:72` 缺右括号，以及该测试错误地直接读取
  `StationRecipe.inputs`。本片修复括号，并按 `kind` 对 shaped pattern / shapeless inputs 做严格 union narrowing；无
  `any`、无弱化断言。该失败回执由 954 自己的 oracle 阶段保存。
- 本片首轮定向 ESLint 窗口 `v2-canonical-equipment-fixture-eslint-01` 为 FAIL：canonical spec 与 harness
  超过 500 effective lines，且初版 helper 有 3 个无效赋值。第二轮 `...eslint-02` 和第三轮
  `...eslint-03` 继续保留职责提取过程中剩余的 max-lines/unused/prefer-const 诊断。最终通过拆分
  `equipment-journey-support.ts`、复用 `classicPersistedPositions` 和移除 wrapper/无效状态解决；没有新增 ignore、
  修改规则或调高上限。
- 本阶段没有在实现前捕获有效的 scenario 行为失败，因此不伪称 fixture 行为 RED。当前可执行 scenario 合同是
  静态 GREEN；真实产品 RED/GREEN 必须由新 artifact 上后续唯一 canonical Browser 取得。

## 验证边界

- 确定性 scenario 合同覆盖资源数量、唯一坐标、既有路线隔离、真实 Classic item/block/recipe 闭包、工具 tier、
  29/36 铁锭预算，以及新 helper 的 post-baseline 禁止 Harness mutation/admin action。
- Classic test types 与 root test types 覆盖本 fixture 和并行 `equipmentSnapshot` oracle 的当前组合字节。定向
  ESLint、Prettier 与 diff 检查只覆盖授权文件，不清理其他 worker 的 dirty。
- 没有运行 build、Browser、Cua、devserver、CI 或完整测试。资源格可走/可瞄、真实 3x3 crafting、四槽 pointer、
  C4 后稳定性、save/return/continue 与 V1 共存仍待 954 提交、新 artifact 和 root 授予的唯一 Browser attempt。
- 实战 durability 损耗、死亡掉落、death overlay 与 respawn 为 `NOT OBSERVED`。当前 canonical 无无需
  Harness/admin 写状态即可确定致死的单一路线；木剑体验场内部使用管理写口，不可充当该证据。
- 本 smoke 只抽样铁甲四槽及同种铁头盔交换，不代表 16 件 armor 变体或 194 项矩阵。

## 实际窗口

| 门禁                       | window                                                    | 结果                                                    |
| -------------------------- | --------------------------------------------------------- | ------------------------------------------------------- |
| 首轮 scenario 合同         | `v2-canonical-equipment-fixture-scenario-01`              | PASS，1 file / 6 tests                                  |
| 首轮 Classic test types    | `v2-canonical-equipment-fixture-classic-types-01`         | PASS                                                    |
| 首轮 root test types       | `v2-canonical-equipment-fixture-root-types-01`            | PASS                                                    |
| 首轮 ESLint                | `v2-canonical-equipment-fixture-eslint-01`                | FAIL，5 个 max-lines/no-useless-assignment              |
| 第二轮 ESLint              | `v2-canonical-equipment-fixture-eslint-02`                | FAIL，2 个 max-lines/unused                             |
| 第三轮 ESLint              | `v2-canonical-equipment-fixture-eslint-03`                | FAIL，2 个 max-lines/prefer-const                       |
| release scenario 合同      | `v2-canonical-equipment-fixture-scenario-release`         | PASS，1 file / 6 tests                                  |
| release Classic test types | `v2-canonical-equipment-fixture-classic-types-release2`   | PASS                                                    |
| release root test types    | `v2-canonical-equipment-fixture-root-types-release2`      | PASS                                                    |
| release ESLint             | `v2-canonical-equipment-fixture-eslint-release`           | PASS                                                    |
| release format/diff        | `v2-canonical-equipment-fixture-static-release2`          | PASS                                                    |
| 首次组合最终门禁           | `v2-canonical-equipment-fixture-final-gate-02`            | FAIL：行为与两类 types 已通过，仅新增 evidence 待格式化 |
| 最终组合门禁               | `v2-canonical-equipment-fixture-final-gate-03`            | PASS：scenario 6/6 + 两类 types + ESLint + format/diff  |
| 最终 release 门禁          | `v2-canonical-equipment-fixture-release`                  | PASS：scenario 6/6 + 两类 types + ESLint + format/diff  |
| 冻结 release 门禁          | `v2-canonical-equipment-fixture-release2`                 | PASS：完整 Authority step evidence 后同一组合复验       |
| 交付证据格式首检           | `v2-canonical-equipment-fixture-delivery-01`              | FAIL：新追加的证据表格需 Prettier                       |
| 交付证据定向格式化         | `v2-canonical-equipment-fixture-delivery-format-write-01` | PASS：仅格式化本证据正文                                |
| 交付证据最终定向格式化     | `v2-canonical-equipment-fixture-delivery-format-write-02` | PASS：纳入最终窗口记录后格式化本证据正文                |
| 交付证据最终检查           | `v2-canonical-equipment-fixture-delivery-final-01`        | PASS：证据正文与 argv 归档格式/空白                     |

每个命令都经默认 `scripts/benchmark-window.mjs --wait-timeout-ms 600000` 全机锁运行，Vitest 使用
`--maxWorkers=1`；窗口 receipt 保留 UTC、exit code 与采样，stdout 使用 `/bin/bash -lc 'set -o pipefail; ... | tee ...'`
保存原字节。中间失败没有删除或覆盖。
交付证据格式窗口不重跑行为、types 或 ESLint，也不提升上述验证层级；首检失败原始回执保留。

## 预算与长期文档

预算为 AI 活跃 4-5 小时、120% 上限 6 小时、传统 1-1.5 PD；credits、API 等价费用、费率、当前额度分母
与占比 unknown。本片未改变长期 owner 或公共协议，因此不更新长期 docs；Harness oracle 的生产合同由独立 owner
交付。
