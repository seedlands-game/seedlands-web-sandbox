# V2 Registered Combat Death 合同

阶段：`V2-DEATH-COMBAT-INTEGRATION-01`
状态：本片实现、确定性行为与静态 GREEN；Classic 接线和完整产品验收待后续阶段。

## Owner 与选择

- `RegisteredCombatRuntime` 在构造时从自己的 `WorldComposition` 解析一次只读
  `seedlands:death-inventory-policy@1.0.0` capability；不向 `GameplayCallbacks` 增加策略，不创建第二状态 owner。
- registered ruleset 继续决定合法 hit 的 raw damage、mode immunity 与 revision；现有 origin、authorization、
  range、LOS、target lifetime 和 cancel 门禁不变。非致命命中继续使用 I2.1c 已验证的 health+armor 单 actor
  replacement。
- 只有实际 `alive -> dead` 时才按目标真实 `player | creature | npc` kind 调用 `policyFor`。composed world
  缺 capability 时返回稳定 `death-inventory-policy-unavailable`，且在 combat plan、entity participant 与 effects
  任一 apply 前拒绝；非致命命中不要求该 capability。
- `prepareCombatDamage` 的私有调用合同必须用 discriminant 区分 `{ kind: 'legacy' }` 与
  `{ kind: 'composed', capability }`；`capability: null` 不得回退到 legacy 默认。现有 uncomposed 直接调用显式
  选择 legacy 兼容。

## 单一事务与死亡语义

- 致命命中先捕获原始 target reference、health 与完整 actor components 作为 source。I2.1c 的
  `prepareArmorDamage` 已用命中前 points 得出实际伤害与 post-hit armor；settlement components 覆盖该 armor，
  player 同时清空 `breakAction`。破损件不进入掉落，未破损件以命中后 durability 进入掉落或保留。
- 仅调用一次 `buildDeathInventorySettlementCandidateV1` 与一次
  `prepareDeathInventorySettlementSeriesV1`。player retain/dead；NPC/creature 按 policy retain/dead 或 despawn。
  bag、cursor、crafting、armor 按 policy 每个实例恰好一次。
- `actorDeathDrop` 是 inventory settlement 之外的 intrinsic drop，只求值一次，并作为同一 series 的末尾 spawn
  加入；不得与 actor inventory 重复。`deaths` 固定来自实际致死，`removals` 从 candidate 的 despawn 结果推导。
- 所有 combat/action/perception/entity participants 必须先全部 validate 再按既有 commit 顺序 apply。source
  health/components/revision、actor lifetime/epoch、allocator/capacity 或 effects 任一 stale，以及 abandon/cancel，
  都不得部分提交 health、armor、inventory revision、drops、combat result 或 receipt。重复攻击已死/已移除目标
  不得增加 drop。

## 测试与边界

- 可执行 RED 使用非 Classic `sample:*` content、正式 registered request→resolve 与显式 policy capability；
  必须实际到达 lethal host，失败在 drop/retain/missing-policy 行为，不使用 missing import/collection。
- GREEN 至少覆盖：player drop+retain、NPC drop+despawn、bag/cursor/crafting/armor、命中后 durability 与破损、
  intrinsic 恰一次、revision 一次、receipt/lastResult/health 一致；missing policy、无装备非致命、invalid target、
  unauthorized、resolve rule cancel、prepare 后 component/revision/lifetime/effects stale、capacity 与 abandon。
- 既有 legacy prepared damage 测试显式选择 legacy，并继续保持旧行为；共享 death RED 可适配为显式 policy
  的纯模型用例，但不能替代 registered producer RED。Needs/Vitals/Autonomy 混合 death series、Classic policy
  安装、UI、Browser/Cua、build、CI 均不在本阶段。

## 预算与停止线

- 传统工程量 1-1.5 PD；AI 连续墙钟预计 3-5 小时，阶段硬上限 6 小时；120% 保守建议 1.2-1.8 PD、
  3.6-6 小时。
- credits、API 等价费用、费率、当前额度分母与占比均 unknown，不伪造换算。
- 若必须修改 public protocol/projection/exports、composition root、Classic policy 或其他 death producer 才能
  完成，保留 RED 并交 root 裁决，不越域实施。
