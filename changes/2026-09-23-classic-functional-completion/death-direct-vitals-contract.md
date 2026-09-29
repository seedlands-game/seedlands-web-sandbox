# V2 Direct Vitals Death 合同

阶段：`V2-DEATH-DIRECT-VITALS-01`
状态：本片实现、确定性行为与静态 GREEN；Classic 策略安装及其他 death producer 待后续阶段。

## Owner 与入口

- `GameplayRuntime.applyDamage` 保持唯一 direct player damage facade：difficulty 先调整 hostile damage，survival
  正伤害再调用通用 `prepareArmorDamage`。facade 不再在 Vitals 成功后 `replaceArmor`；它把实际 damage 与完整
  post-hit armor 一起交给同一个 `ActorVitalsRuntime` transaction。
- `createGameplayDomainAdapters` 在构造 Vitals 时只解析一次 `callbacks.composition` 的只读 death inventory policy
  capability。无 composition 明确传 `{ kind: 'legacy' }`；有 composition 明确传
  `{ kind: 'composed', capability }`，其中 `null` 不得回退 legacy。不得增加外部可变 policy callback 或 Classic ID
  switch。
- Vitals 只处理 player。heal、nonfatal damage、creative immunity 与 uncomposed `advanceNeeds` 保持既有 owner；
  不接 NPC/creature death、不修改 registered Needs state port。

## 单一事务

- 每次 commit 先捕获原始 actor reference、health 与完整 components。nonfatal proposed components 可同时包含
  needs 与 post-hit armor，并通过一次 `PreparedEntityMutation` actor replacement 写入；armor 实质变化由既有 owner
  统一令 `inventoryRevision +1`。
- composed alive→dead 使用原始 snapshot 作 settlement source；post-hit armor、拟提交 needs 与
  `player.breakAction=null` 作 settlement components。按 `policyFor('player')` 构造一次 candidate，并只准备一个
  settlement entity participant。破损 armor 不掉落；未破损件以命中后 durability 掉落或保留。
- legacy lethal 明确保留当前 player 兼容：inventory、cursor、crafting 掉落并清空，actor retain/dead，armor 使用
  post-hit replacement 但不加入 legacy drops。composed 缺 capability 的 lethal 返回
  `{ success:false, reason:'death-inventory-policy-unavailable' }`；`advanceNeeds` 无返回通道时抛同名 Error，均零写。
- lethal 同时调用一次真实 `simulation.prepareDeaths([id])`。entity 与 effects 必须全部 validate 后才首次 apply；按
  既有 Needs 安全顺序 entity→effects→touch。禁止事后 `cancelCombat/cancelTarget/unregister`，也不创建第二 Action、
  Combat 或 perception owner。

## 失败与测试

- source component/revision、entity epoch/lifetime/allocator/capacity 或 effects frontier 任一 stale，以及 prepared
  candidate abandon，都不得部分写 health、needs、armor、bag、cursor、crafting、drop、combat、Action、perception 或
  gameplay revision。重复 dead damage 不新增 drop。
- 正式 RED 使用非 Classic composition 与 `GameplayRuntime.applyDamage`：drop policy 下现实现不掉 post-hit armor 且
  revision 分步推进；retain policy 被忽略；missing policy lethal 被接受。测试必须正常 collection 并实际到达 Vitals。
- GREEN 覆盖 composed drop/retain/no-policy、post-hit 破损与耐久、单 revision、combat/action cancellation、source/
  lifetime/capacity/effects stale、abandon、nonfatal/creative、legacy lethal、heal 与 `advanceNeeds` 回归。已有
  `gameplay-atomic-vitals` 继续覆盖真实 allocator failure；新增测试不得把真实 effects participant 替成 no-op。

## 预算与停止线

- 传统工程量 1–1.5 PD；AI 连续墙钟预计 3–5 小时，硬上限 6 小时；120% 保守建议 1.2–1.8 PD、3.6–6 小时。
- credits、API 等价费用、费率、当前额度分母与占比均 unknown，不伪造换算。
- 若必须修改公共 death settlement、registered combat、Needs/Autonomy producer、Classic pack、public exports 或
  persistence schema 才能完成，保留 RED 并交 root 裁决，不越域实施。
