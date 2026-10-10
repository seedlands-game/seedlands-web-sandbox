# V2 Registered Needs Death 合同

阶段：`V2-DEATH-REGISTERED-NEEDS-01`
状态：本片实现、正式 registered schedule 行为与静态 GREEN；Classic policy 接线待后续阶段。

## 策略与 Owner

- `GameplayRuntime` 构造 Needs port 时从同一 `callbacks.composition` 解析一次只读 death inventory policy。无
  composition 显式传 `{ kind:'legacy' }`；有 composition 显式传 `{ kind:'composed', capability }`，其中 `null`
  不能回退 legacy。不新增 `GameplayCallbacks` 可变策略、不按 Classic ID 分支。
- registered Needs 继续只允许 player health/lifecycle 变化；creature/npc 的 health/lifecycle 保持 readonly，只有其
  needs 数值可按既有 deficit profile 更新。无死亡批次不要求 policy，仍走一次普通 prepared entity series。
- composed player `alive→dead` 必须选择 `policyFor('player')`。当前 public settlement 可 despawn ECS，但
  `GameplayRuntime.players` membership 只有 imperative `despawnGameplayEntity` 清理，无法加入本事务；因此
  `actor:'despawn'` 在本片稳定返回 `needs-player-despawn-policy-unsupported`，整批零提交，不静默 retain。

## Mixed 单一事务

- commit 先为每个 changed actor 捕获原始 reference、health、完整 components。存活变化构造
  `additionalActorReplacements[{source,replacement}]`；死亡 player 以拟 needs、原 armor 和
  `player.breakAction=null` 构造 public death candidate。
- 批次含至少一名死亡时，所有 survivor 与 death 统一调用一次
  `prepareDeathInventorySettlementSeriesV1`；不得内联 bag drops，也不得再创建第二 entity participant。无死亡批次
  保持一次 `prepareEntityMutationSeries`。四容器 drop/retain 与共享 inventory revision 完全由公共 owner 决定。
- 同批另准备一次 `prepareDeaths(deathIds)`。entity 与 effects 必须全部 validate 后才按既有安全顺序
  entity→effects→changed apply。source/revision/lifetime/epoch/capacity/effects stale 或 abandon 均不能部分写 needs、
  health、inventory、cursor、armor、drops、Combat、Action、perception 或 revisions。

## 兼容、失败与测试

- composed 缺 capability 的首次致死返回 `death-inventory-policy-unavailable`，包含 survivor needs 在内整批零提交；
  同 composition 的无死亡批次继续成功。uncomposed legacy 保留当前 player bag-drop 行为与单一普通 series。
- 正式 RED 使用非 Classic content + ruleset + registered Needs schedule，真实 `advanceRules(1)` 同批推进 survivor
  与 dying player；失败必须发生在四容器 policy、retain 或 missing-policy 行为，而非 import/collection。
- GREEN 覆盖 survivor+death 同批、drop/retain/no-policy、真实 Action/Combat effects、>128 drops 跨 segment 的末端
  capacity fail-close、source/revision/lifetime/effects stale、nonplayer readonly、重复 dead tick、无死亡回归和
  player-despawn fail-closed。公共 mixed-series 单测可作为 dependency 回归，但不能替代正式 schedule。

## 预算与停止线

- 传统工程量 1–1.5 PD；AI 连续墙钟预计 3–5 小时，硬上限 6 小时；120% 保守建议 1.2–1.8 PD、3.6–6 小时。
- credits、API 等价费用、费率、额度分母和占比 unknown，不伪造换算。
- 若必须新增 prepared player-membership owner、修改公共 settlement、Autonomy/Needs producer、Classic pack 或公开
  exports，保留证据并交 root 裁决，不越域实施。
