# V2 Equipment Combat 合同

阶段：`V2-REGISTERED-COMBAT-ARMOR-01`（I2.1c）
状态：fixture、确定性行为与静态验证完成；尚未提交，不代表 death/UI/Browser 或完整 V2 GREEN。

## 行为与 owner

- registered combat 保持 request、origin、range、LOS、authorization、lifetime 与 ruleset owner 不变。ruleset
  继续生成 raw damage 并处理配置化 mode immunity；host 不新增 Classic ID 或第二套 combat policy。
- 只有已通过上述门禁、outcome 为 hit、raw damage 为正且目标当前 mode 为 `survival` 时，host 才读取
  `equipment.armor`。减伤只依赖注册物品的通用 `armor.points`，沿用每点 4%、最多 20 点的现有纯策略。
- 本次减伤按命中前装备能力计算；随后每个带 instance durability 的已装备物品恰好损耗 1。原 durability
  为 1 的物品在本次命中贡献减伤后清槽，其他 item/count/durability 精确保留。无 instance 的合法装备不
  伪造 durability。
- `EntityStore` 仍是 health 与 armor 的唯一 owner。`prepareCombatDamage` 只接受已选出的 armor replacement，
  并在同一个 prepared actor replacement 中携带 health 与 armor；不得先扣血再 `replaceArmor`。一次 armor
  实质变化只由既有 prepared entity owner 推进一次 `inventoryRevision`，旧 pointer revision 因而 stale。

## 失败与兼容

- 无装备的 survival 命中与旧行为等价；creative/zero/miss 不扣 health 或 durability。无效目标、无权限、
  origin/range/LOS/lifetime/ruleset 拒绝继续沿既有 fail-closed 路径。
- prepared participant 捕获目标 lifetime、entity、完整 actor component 与 entity-store sequence；validate 或
  apply 前 armor/revision/lifetime 改变必须拒绝，且不得提交本候选的 health、armor、revision、combat result
  或 fact。候选被放弃同样零写。
- lethal combat 仍沿既有 death producer。I2.1c 只允许把本次 armor durability candidate 拼入同一 actor
  replacement，不补做死亡时 bag/cursor/crafting/armor 的 drop/retain 策略；共享 death RED 继续属于 I2.2。

## 测试与证据

- 可执行 RED 使用仅注册 `sample:*` 内容的正式 Playbook、registered combat request→resolve 和真实 ECS
  transaction，证明当前 health 仍按 raw damage 扣除且 armor durability/revision 未变化。不得用 import、类型或
  collection failure 代替。
- GREEN 覆盖非 Classic capability、无装备等价、20 点封顶、耐久保真与到零清槽、receipt/lastResult/health
  一致、health+armor 同事务 revision 只 `+1` 且旧 pointer stale。
- 反例覆盖 miss、creative zero、无效 target、无授权、resolve rule cancel、prepared 后 armor/revision 或
  lifetime 改变及未 apply candidate；各反例检查所有相关 owner 与 combat result 零部分提交。正式 request
  receipt、combat owner 的 committed lastResult 与实际 health delta 必须精确一致。
- 执行定向 registered combat、prepared damage/entity mutation 与 pointer 回归，随后 stdlib/root/Classic test
  types、改动文件 ESLint/Prettier/scoped diff。所有命令独立使用 benchmark window，Vitest `maxWorkers=1`。
  不运行 build、Browser、Cua、devserver 或 CI。

## 预算与停止线

- 传统工程量：0.5-1 PD；AI 连续墙钟：2-4 小时，本阶段硬上限 6 小时。
- 保守 120% 建议：0.6-1.2 PD、2.4-4.8 AI 小时。模型 credits、API 等价费率、当前额度分母及占比均
  unknown，不伪造换算。
- 若必须修改 combat protocol/ruleset、公共 exports、composition root 或 death policy 才能闭环，立即停在
  可复现 RED 并交 root 裁决，不越域实施。
