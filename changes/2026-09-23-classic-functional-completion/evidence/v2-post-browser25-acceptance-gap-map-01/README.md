# V2 Post-Browser25 Acceptance Gap Map 01

状态：`MAP ONLY / NO IMPLEMENTATION`。本阶段只读分析 committed HEAD、BUILD16 Pack 与已封存 Browser25 证据，
没有修改生产源码、测试、spec、tasks、execution-state、历史 evidence 或长期 docs，也没有运行行为测试、build、
artifact、Browser、Cua、CI、Git、部署或合并。

## 冻结输入与结论

- 当前 committed HEAD 为 `01c650793c79ac34e6184da48b5a4c94a5f161c2`，tree 为
  `e20a8b1d85520c960096b5c898c3ffdd7e241b2a`。所有源码判断均从该 commit 的 `git show` 字节取得，
  不是从同名 working 文件推断。
- BUILD16 acceptance 为 `/private/tmp/seedlands-v2-acceptance-fdb53c07`，source
  `fdb53c07c0da14c7f523473e4f33060a385f23ff`，tree `ecc7940708bca8ea1d01e8df50337fa536d27d18`。
  冻结 Pack 静态枚举得到 194 个唯一 item、134 个唯一 recipe；这只证明注册闭包，不证明每个物品的真实入口、
  表现、保存或失败原子性。
- Browser25 在该 BUILD16 artifact 上为 `2 passed / 1 skipped`，唯一 canonical main attempt 0 PASS；C0-C5、
  完整 V1、V2 的 19 个 checkpoint 与保存恢复通过。它没有断言旧 object reference 失效、玩家死亡/四容器掉落/
  复活、16 件护甲全矩阵或 194 item 行为闭包。石镐耐久 `132 -> 128 -> 127` 不是护甲受击耐久证据。
- 早期 I2.2 的 death RED 已由后续提交闭合。HEAD 已有 direct Vitals、registered Combat、registered Needs 与
  Classic death policy 的原子结算及定向 GREEN；当前缺口是正常产品入口与 Browser 可观察证据，不是重做 death
  transaction。
- 推荐下一片仅为 `V2-BROWSER-DEATH-REFERENCE-01`：在 3 小时硬上限内闭合 restore 旧引用拒绝，以及真实敌对
  actor 经 Logic -> Authority -> registered Combat 导致玩家死亡、掉落和正常 UI 复活的 Browser 证据。16 armor
  全矩阵、194 catalog family closure、V3/V4 分别留给后续独立阶段。

## 四列缺口矩阵

| 域                         | HEAD 已提交生产能力                                                                                                                                                  | 已有确定性证据                                                                                                                                                                    | Browser25 实际证明                                                                                      | 尚未证明                                                                                     |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| restore 引用换代           | `EntityStore.restore()` 安装新 owner 后 dispose 旧 owner；reference 为 `entityId/epoch/lifetime`，runtime 可 `createReference/resolveReference`                      | 非 Classic restore suite 明确断言旧 ref resolve 为 null、旧 retained access 抛 stale、旧 pointer 返回 `actor-reference-stale`，新 ref 继续交换，`1 file / 4 tests PASS`           | runtime epoch `:1 -> :2`、actor epoch `1 -> 2`、lifetime 保持 1，恢复数据相等并由当前 UI pointer 再脱穿 | Browser 未把 pre-restore ref 交回 Authority 判 stale；epoch 变化不能替代 reference 断言      |
| death inventory settlement | direct Vitals、registered Combat、registered Needs 都调用 composed death settlement；Classic policy 对 player 清空并 drop bag/cursor/crafting/equipment，保留 player | registered Combat `11/11`、direct Vitals `11/11`、Needs `12/12` 加 mixed series `13/13`；Classic lineage `4/4`、Pack `3/3`、Web aggregate `18/18`、no-duplication `9/9`           | 未触发玩家死亡；未观察 death overlay、四容器清空/掉落或重复死亡不复制                                   | 正常产品因果链、world-item 精确集合、命中后 armor durability、死亡 UI                        |
| respawn                    | `ActorVitalsRuntime.respawnPlayer()` 要求 dead，恢复 player 并移动到 spawn；Web `respawn()` 走正式 action 并保存                                                     | 既有 survival、pointer persistence、difficulty respawn 等定向测试覆盖不同子边界                                                                                                   | 未点击死亡 overlay 的“复活”，未观察复活后空容器与遗留掉落                                               | 真实 UI action、位置/lifecycle/health、drop 不回灌、随后可操作                               |
| 16 armor                   | Classic 以 4 材质 x 4 槽机械生成 16 定义和 16 recipe；四槽 pointer、减伤、durability、death/save owner 已存在                                                        | 注册测试只抽 5 件；iron chestplate 受击/恢复、iron helmet lethal、armor math 与 iron recipe 已测；通用 pointer 已测满包 `destination-full` 原子拒绝，非 Classic 四槽 restore 已测 | 真实采集/合成 5 件 iron armor，四槽、wrong-slot、swap、quick-move、close、恢复与新 pointer 通过         | leather/gold/diamond 和全 16 注册/配方/槽位矩阵；Browser 实战 armor 受击耐久、满包、死亡掉落 |
| 194 catalog                | BUILD16 Pack 注册 194 unique items、134 recipes；能力分布 `none60/consume10/place79/mine15/melee5/till5/fluid3/ranged1/armor16`                                      | 各域有零散 integration/unit；旧 spec 的 `96/53/21/23/1` 是初始 RED 分类，不是 HEAD 完成状态                                                                                       | 只覆盖 C0-C5、V1 与 V2 的具体路线，不是逐族或逐项矩阵                                                   | 按族的正/负真实入口、表现、保存及失败原子性；`none` 不能自动等同材料或缺失行为               |

完整族级索引见 `coverage.tsv`。

## I2.2 与 owner 纠正

早期共享 death test 的 RED 已被 `74628290`（连接 death policy producers）和 `c3ba7ea9`（安装 Classic
composed death policy）及其后 GIT27 组合覆盖取代。当前 HEAD 的关键调用链是：

1. `logic-decision.ts:194-211` 仅在夜间让可见、存活、范围内 player 成为 hostile 的 move/attack 目标。
2. `authority-logic-intent-acceptance.ts:31-68` 重查 observation identity、pose/chunk freshness，并为当前 entity
   重新取得 reference。
3. `actor-authority-gameplay.ts:36-63` 校验 attacker profile、player lifecycle、距离与 LOS，然后请求 registered
   combat。
4. `registered-combat-runtime.ts:220-230` 在命中结算前再次验证 actor/target lifetime；`231-317` 计算 post-hit
   armor，lethal 分支消费 Classic death policy，并把 combat/entity/effects 放进同一 prepared commit。
5. `browser-gameplay.ts:194-266` 投影伤害与死亡、关闭背包并释放输入；`death-overlay.svelte:9-14` 提供“复活”，
   `browser-gameplay.ts:409-418` 通过正式 `respawn` action 恢复并排队保存。

因此下一阶段不得新写第二套 death 规则，也不得以 `/damage`、Harness `apply-damage` 或直接 runtime
`applyDamage` 作为 Browser 因果。Kernel 无改动；stdlib 只允许通用只读 Harness reference probe；Classic 场景只声明
本世界验收前置；Web 只投影已有 Authority 状态。非 Classic 反例是：任意非 Classic Pack 的 actor restore 也能得到
`current -> stale/new-current` 的通用 reference 结果，而没有 Classic death policy 时仍应 fail closed 为
`death-inventory-policy-unavailable`，不能由 stdlib 隐式注入 Classic 掉落规则。

## Restore 的真实可观察边界

`HarnessEquipmentSnapshot.actor` 已公开 reference 值，Browser 可以在 save 前保留它。当前
`equipmentSnapshot()` 只在当前 Authority/runtime epoch 上复制新投影；`WorldInspectRequest` 只有 voxel/chunk/entity/actor，
没有把旧 `EntityLifetimeReference` 交给 Authority owner 解析的入口。因此 Browser25 的 actor epoch 变化只说明 owner
换代，不等价于旧 ref 已被拒绝。

最小接口是给既有 `WorldHarnessPort.inspect` 增加一个通用只读 variant：

```ts
{ kind: 'entity-reference'; reference: EntityLifetimeReference }
  -> { kind: 'entity-reference'; reference: EntityLifetimeReference; status: 'current' | 'stale' }
```

它复用 `AuthorityServerPort.resolveEntityReference`，授权仍映射到 `world.entity/read` 和 reference 的 `entityId`；严格校验
有限安全整数、非空 id 与 exact keys。stale 是成功读取到的状态，不以 unavailable 异常掩盖；malformed/未授权必须
结构化失败且不改变世界。无需新增 protocol version、第二 snapshot、Classic ID、写命令或 gameplay action。Browser RED
必须保存旧 ref，restore 后得到 `stale`；再对新 ref 得到 `current`，并通过正式 UI pointer 完成一次操作。

## 真实死亡入口现状

现有 canonical fixture 在 `harness.ts:179-187` 用 developer `apply-damage` 预伤玩家，并用 `spawn-creature` 创建无
archetype 训练目标；它服务 C3 玩家攻击，不会证明 hostile 反向攻击。`spawn-actor` 虽能创建 registered zombie，也仍是
developer world command，不能冒充玩家可达入口。

已提交产品链存在自然刷怪：每 20 秒 tick，按固定 seed/tick 在玩家 26-32 格外寻找表面；夜间、光照 <=7、非
peaceful 才选 hostile，随后走正式 autonomous Logic。Classic zombie/spider/creeper/slime 有 melee definition；skeleton
当前没有 melee definition，不能预设任一随机 hostile 都可致死。自然生成还依赖 loaded voxel、biome、路径与 LOS。
下一阶段首先应在固定 scenario 上得到可复现 RED，证明在不使用 Harness/debug 改时、spawn 或 damage 写口时，选中的
自然 hostile 是可攻击 profile 且能在现有 60 秒局部上限和 900 秒 main 总预算内进入攻击链。若只能依赖 fixture
`setWorldTime`、方括号改时、Alt+T 加速或 developer spawn/damage 才能稳定复现，则说明“产品可达的固定敌对场景”尚缺，
本 slice 必须停止并交回 root 独立裁剪；不得增加 timeout/路线容差或临时增加第二 fixture/helper。

## 推荐下一最小 Slice

阶段：`V2-BROWSER-DEATH-REFERENCE-01`，AI 基准 2.5h、硬上限和 120% 建议均为 3h。先生产/定向 RED-GREEN，
再由 root 独立准出 artifact 与唯一 Browser；本 MAP 不执行这些步骤。

### 唯一 ownership

- stdlib Harness owner：`packages/stdlib/src/server/harness/world-harness-contract.ts`、
  `world-harness-validation.ts`、`world-harness-operations.ts`、`authority-world-harness.ts`；对应
  `world-harness-session.test.ts` 和 Browser worker RPC 单测。只实现上述 reference-status read。
- Web observability owner：`apps/web/src/app/app-contracts.ts`、`game-harness-observability.ts` 及其既有单测。只给
  equipment snapshot 增加 Authority 已投影的 `worldItems` 精确只读 `id/stack/position` 列表，供 death drop 比对；
  world-item 不需要额外 lifetime reference，也不新增写口。
- Classic acceptance owner：`playbooks/classic/scenarios/canonical-runtime-v11.json`、既有
  `equipment-journey.ts`/`equipment-journey-support.ts` 与 `classic-runtime.spec.ts`。不新建第二 fixture/helper；只在既有
  restore 后追加 reference 和 death/respawn journey。公共 exports、Pack composition root、CI 与 runner 不需要修改。
- Kernel、保存 schema、death policy、combat rules、armor math、路线/aim/pointer cooldown、900s/60s 预算均只读。

### RED、GREEN 与 done_when

1. RED-A：通用 Harness 单测保存当前 ref，成功 checkpoint restore 后 old=`stale`、new=`current`；malformed、无权、
   失败 restore 均 fail closed，失败 restore 后 old 仍 current。当前缺 variant，应为可执行 RED。
2. RED-B：observability 单测要求 snapshot 精确复制当前 world-item id/reference/stack/position 且无可变别名；不泄露 ECS
   owner。当前无该字段，应为可执行 RED。
3. RED-C：canonical 静态/定向测试要求 death journey 只接受 `natural-hostile` 因果，不包含 `apply-damage`、
   `spawn-creature`、`spawn-actor`、Harness/debug 改时或直接 runtime 调用；在固定 seed 的正常世界时钟下选择带 melee
   definition 的 hostile。
4. GREEN：先在定向测试中证明旧/new ref、drop projection、失败原子性和非 Classic 反例；再跑受影响 static/types/format。
   不运行全量 194、V3/V4 或无关 suite。
5. Artifact 前置：从新的 clean committed source 构建并校验同一 artifact identity；当前 BUILD16 不能代表未来改动。
6. Browser 前置：仅 root 另行租约后运行项目唯一 canonical 线路。实际输入链必须为自然 hostile
   Logic -> Authority -> registered Combat；death 前用正式 UI 保留 bag、cursor/crafting 与至少一件 armor，命中后断言
   armor durability 变化及 exact world-item stacks、四容器为空、lifecycle dead、overlay 可见；点击“复活”后断言 alive、
   spawn position、空容器、drops 保留且正式输入重新可用。restore old ref 必须由 Authority probe 返回 stale，新 ref current
   且 UI pointer 成功。

done_when：上述定向 RED 先失败于明确缺口并在不扩大 owner 后 GREEN；失败/未授权/坏 ref 不变更状态；成功 restore
使旧 ref stale、失败 restore 不换代；death/drop 事务精确且不复制，respawn 不回灌；新 artifact 身份独立封存；未来
唯一 Browser 在既有 900s/60s 内 PASS。Cua 对这些状态断言不是前置；若另需视觉/人类观感再单独准出，不得用 Cua
替代 Authority/DOM 断言。

停止线：若自然 hostile 在 3h 内无法以固定 seed/tick、正常世界时钟、正常路径和现有预算稳定到达并致死，则保留 RED
后退出，交回 root 决定独立“产品可达 spawn 场景”阶段；不得降级为 developer/debug command、延长 timeout、放宽
LOS/距离或修改 combat 数值。
若 reference probe 需要新增协议版本、公共写接口或无消费者 framework，也停止并重新裁剪。

## 后续独立阶段

- `16 armor matrix`：机械枚举 4 tier x 4 slot 的定义、recipe、slot/points/max durability；定向覆盖 wrong-slot、满包、
  combat break、death drop、save；Browser 只抽代表族，不再把四件 iron 外推为 16 件。
- `194 catalog family closure`：按 `coverage.tsv` 的能力族和 domain runtime 逐族一正一负，明确 materials/ammunition 的
  `item-no-interaction`；不能仅由 capability count 宣称行为完整。
- V3 依赖结构/攀爬/route/transport committed owner 后再验收。当前相关文件仍为他人 untracked working 内容。
- V4 依赖 lighting committed owner 和真实多帧视觉/质量档矩阵。当前 lighting working 修改不属于 HEAD。

## Dirty 边界

预检共有 38 项现有 dirty，主 index 为空。本阶段相关但未交付的 9 个 tracked 修改与 20 个 untracked 文件逐项记录在
`dirty-boundary.tsv`；它们仅是 working snapshot，不参与 HEAD capability 判断。其余 9 项为既有 CI/README/index/package、
两个无关 change 目录和两份 browser report，同样未读取内容、未修改、未暂存。后续 owner 必须先与原编辑者交接；不能
恢复、删除、搬移或覆盖这些字节。

## 预算与非声明

本 MAP 传统估时 `0.1-0.25 PD`，AI 目标 `45-60min`、硬上限 `2h`；120% 建议为 AI `1.2h`、传统
`0.3 PD`。推荐下一 slice 传统基准 `0.5-0.75 PD`、AI 基准 `2.5h`；120% 建议为传统 `0.9 PD`、AI `3h`，
同时也是该 slice 硬上限。credits、费率、API 等价费用、当前额度和预测占比均为 `unknown`。长期 docs 不更新，
因为本片只冻结现状与下一验收切片，没有改变 owner/API。

Browser25 PASS 仅代表其既有覆盖；本 MAP 不声明完整 V2 或产品 GREEN。Browser24 仍为 discovery 前 Chromium 0 FAIL，
Browser23 仍为 timeout FAIL / `TRACE_INCOMPLETE`；Browser25 成功按 retain-on-failure 得到
`NOT_RETAINED_BY_CONFIG`，不是 trace 损坏。
