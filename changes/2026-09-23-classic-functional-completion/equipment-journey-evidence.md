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

## Close-02 收口证据

阶段：`V2-CANONICAL-EQUIPMENT-FIXTURE-CLOSE-02`。上一 release 的 `SOURCE-MANIFEST.sha256`、
`MANIFEST.sha256`、`delivery-validation.json`、本合同和本证据正文已在修改前逐字节复制到
`evidence/v2-canonical-equipment-fixture-close-02/prior-release/`；五份副本分别保持 SHA
`74ffab1a4d8fbe191dd3164935e519da41ae82721f3974c16c8c6ce1d3780051`、
`30bea97d0a8549ee9e4f79bd9649637d08c12369f9a61dd92ec748ee1e491138`、
`0a2eadc77f3d709517bbd6052f46b2a4326856a0133a97dcd574087a4f621f9d`、
`d45f3c7b641c10df7c086f8f063280b65d0c8606c6838d7377ea7acee8e601d7` 与
`ee71811105e288fdec50d54ce8140ebc5d1d3da5fe27fff0d94ed2e606139900`。

- 资源放置不再在 creative flight 中调用 `walkTo(..., { jump: true })`。每个固定资源格先在 survival 沿原
  approach 真实走位，再经正式 UI 切 creative、选择并右键放置；voxel readback 后立即切回 survival，并要求
  Authority physics tick 前进且 `onGround && !colliding` 才处理下一格。3/3/4 数量、坐标、timeout、瞄准预算与
  单一路线均未改变。
- equipment-origin close settlement 的 readback 现在同时要求关闭前后 runtime epoch 相同且
  `sameActor(entityId, epoch, lifetime)`，再检查 `inventoryRevision + 1`、cursor 清空与 boots 返回。
- C5 在实际保存前取得的 `equipmentBeforeSave` 明确写入 `restoreEvidence.before.v2EquipmentPreSave`；恢复比较
  继续使用同一个对象。C4 前 `before.v2Equipment` 的完整 steps 和原 before/after 证据没有覆盖或删除。

定向 source-contract 窗口 `v2-canonical-equipment-fixture-close-02-red-01` 在旧实现上为 1 failed / 6 passed，
首个失败是 placement 段缺少切回 survival 后的 grounded 条件；stdout SHA
`c7115448132fb47a802c071f7d83c96a84d515255b071cf3c0be515ce7216468`，receipt SHA
`0f06f703f89d842e3e0910a7ca2129b83e1b711ebd7a99a21a416fff4bf89634`。实施后三条顺序/身份/证据约束均由同一
用例覆盖。Classic types 首轮窗口 `v2-canonical-equipment-fixture-close-02-classic-types` 因新增调用缺
`sameActor` import 而 TS2304 FAIL，stdout SHA
`c8e826a11d2c1b1c024cda2ae291221893e8c3abef303c6ee2813b4ffe6695d3`，receipt SHA
`99c78030c278447c77d2960cff55e415f086c232792fd5e92910467a54490437`；补齐既有 helper import 后通过。

最终当前字节聚合窗口 `v2-canonical-equipment-fixture-close-02-final-02` 为 PASS，UTC
`2026-09-25T21:47:21.146Z` 至 `2026-09-25T21:47:32.397Z`：scenario 1 file / 7 tests、Classic test types、
root test types、定向 ESLint、Prettier 与 scoped diff 全通过；stdout SHA
`39e2006a4bf6da3d23e2a55a899ebf93558617a11c6ba90644dacaadb82b880a`，receipt SHA
`16be51ed25aa7bb2574e1275ab6221d5762216bc528624dc6ad8865278ad701f`。没有重跑 954 observability、服务端行为、
build、Browser、Cua、devserver、CI 或 Git。

Close-02 只证明 fixture/source-contract/types/static 收口。Browser-05 是 creative flight 与 grounded route 的既有
失败反例，不是本轮执行；资源路径、真实装备步骤、保存恢复仍需新 artifact 上后续授权的 canonical Browser 验证。
实战 durability-1、死亡、掉落和 respawn 继续为 `NOT OBSERVED`，且不保证由下一次装备 Browser 覆盖。本片没有
改变长期 owner 或公共协议，因此长期 docs 仍不更新。
