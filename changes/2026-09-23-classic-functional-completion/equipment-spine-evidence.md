# V2 Equipment 公共 Spine 证据

阶段：V2-EQUIPMENT-SPINE-01  
基线：7030adac5ea234319bfe032185828287ee07b85d  
状态：公共合同、copy/validate/projection 与 death candidate/participant GREEN；三项后续行为保持可执行 RED；未提交。

## 实施边界

- 复用 ECS actor equipment.armor 唯一 owner 和既有 ArmorSlot / ARMOR_SLOTS，未建立第二套槽位或状态。
- 扩展现有 inventory-pointer target/origin；未新增 equip action，未加入 Classic item ID switch。
- actor、Authority 和 network projection 携带完整四槽 armor；bag/armor 的 instance/durability 深复制，公开数组、对象和 instance 冻结。
- 新增纯 buildDeathInventorySettlementCandidateV1 与 host-only prepareDeathInventorySettlementParticipantV1；不自行 apply，不安装 Classic death policy，不修改 prepared-death-effects。
- mod-api.ts 只新增 ArmorSlot 与 pointer 合同 export；death participant 不向 mod 暴露。该文件中已有 route/transport diff 属于其他 owner，本阶段未修改其语义。
- 为满足现有 ESLint 行数门禁，将既有 pointer slot 访问辅助机械拆到 inventory-pointer-slot-state.ts；equipment 分支仍显式返回 invalid-pointer-slot，未提前闭合 I2.1。

## 最终证据

所有命令均通过默认 benchmark-window 机器级锁执行；Vitest 使用 --maxWorkers=1。原始 stdout 和
window receipt 位于 evidence/v2-equipment-spine-01/；receipt 只从 .json 改名为 .json.log，内容字节未改。
最终集合由 MANIFEST.sha256 校验。

| 门禁                      | window                                                            | 结果                                      | 证明边界                                                                                                                                                                         |
| ------------------------- | ----------------------------------------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 最新全闭包尝试            | v2-equipment-spine-green-final4                                   | **FAIL**，5 files 中 27 passed / 1 failed | 新增深冻结断言准确发现 actor replacement 的 player.spawnPosition 未冻结；不能作为 GREEN                                                                                          |
| 受影响合同闭合            | v2-equipment-spine-contract-green-final5                          | PASS，1 file / 9 tests                    | 唯一修复将 actorComponents 返回改用既有 deepFreeze；闭合 final4 唯一失败                                                                                                         |
| 当前有效公共 GREEN        | final4 未受修改的 4 files / 19 tests + final5 的 1 file / 9 tests | PASS，组合 5 files / 28 tests             | strict pointer copy/validate、Authority/network durability 投影、death candidate/participant、stale/capacity/深冻结零提交及既有 pointer/action 回归；没有把 final4 本身写成 PASS |
| 行为 RED                  | v2-equipment-spine-red-final3                                     | 预期 FAIL，1 file / 3 tests               | 非 Classic equipment 返回 invalid-pointer-slot；armor-only revision 为 0 而非 1；combat death 后 helmet/chestplate 仍保留；final5 只改未被该文件使用的候选深冻结                 |
| stdlib types              | v2-equipment-spine-stdlib-types-final5                            | PASS                                      | final5 生产类型                                                                                                                                                                  |
| root test types           | v2-equipment-spine-root-test-types-final3                         | PASS，未重跑                              | final5 不改变公开类型或测试调用点                                                                                                                                                |
| Classic test types        | v2-equipment-spine-classic-test-types-final3                      | PASS，未重跑                              | final5 不改变公开类型或 Classic 调用点                                                                                                                                           |
| 目标 ESLint/Prettier/diff | v2-equipment-spine-static-final5                                  | PASS                                      | 仅 final5 受影响的 2 个文件                                                                                                                                                      |

早期失败也原样保留：green-01 两项测试断言自身错误，stdlib-types-01 为 discriminated union 推断错误，
eslint-01 为两个既有大文件被新增行推过 500 行阈值；均已修复。green-final4 是本轮恢复时的最新真实
失败，不属于早期可忽略结果；它由 final5 的同一受影响 suite 9/9 精确关闭。上述调试/合同失败都不是产品 RED。

## 可执行 RED 与后续 owner

- I2.1 建议交 761 独占：inventory-pointer-slot-state.ts 与 inventory-pointer-model.ts 的 equipment read/write/place/swap/pick/quick-move/close 私有行为，以及 equipment-spine-red.test.ts 第一项。依赖本阶段已冻结的 pointer union、完整 equipment candidate 与 registered commit 接线；不得修改 protocol/exports/composition root。
- I2.1b 保留唯一 Git writer：仅修 prepared-entity-mutation.ts 的 interactionChanged，使 armor-only 实质变化恰推进一次 inventoryRevision，关闭 RED 第二项；不得改变 selectedSlot/hotbarSize 既有 revision 语义。
- I2.1c 后续独立 owner：registered-combat-runtime.ts 的 armor reduction/durability；不混入 pointer UI。
- I2.2 建议交 761 独占：prepared-combat-damage.ts、modules/actor-vitals-runtime.ts、modules/needs-state-port.ts 与 Playbook death policy 接线，三条 producer 共享本阶段 helper，关闭 RED 第三项；death-inventory-settlement.ts 的公共合同变更仍回唯一 Git writer。
- UI equipment slots/拖放绑定属于后续 mod presentation；只消费 committed Authority projection，不持第二 owner。

## 未验证与风险

- 本阶段按冻结要求未运行 build、Browser、Cua、人类听觉、CI、性能或完整 Classic headless；不得外推为产品 GREEN。
- 非 Classic sample:visor / sample:suit 已通过正式注册与 action 路径进入行为层，但 equip 仍 RED。
- 三条 death producer 尚未接新 helper；legacy classic-armor 死亡保留预期未改变。
- near-contact 薄门 origin-cell adjacent=null 产品限制仍未修，与本阶段无关。
- 长期 docs baseline 未更新：当前只是 change 内的局部公共合同与 RED checkpoint，尚未完成 V2 行为。
- 实际活跃墙钟约 0.5h；传统估算仍为 1-2 PD，保守 120% 为 2.4 PD，AI 保守预算 4.8h。credits、API 等价费用、额度分母与占比仍为 unknown。
