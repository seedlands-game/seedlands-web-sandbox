# S3 注册 Combat 真实消费者

采用独立复核确定的窄协议：module 读取严格投影并返回类型明确的 transition candidate，after 规则验证冻结 candidate；host prepareCommit 才分配并准备实际 Action/Combat/ECS。候选不是 state write；不得保存第二份 intent 或在 facts 中伪装状态写入。宿主提交接缝见 [提交上下文](s3-combat-host-context-design.md)。

## 模块与投影

- Combat module 提供 capability `seedlands:combat`，actor component `seedlands:combat-actor`、world component `seedlands:combat-world`（5 个各至多 128 actor 的分片）。actor resource 为 `seedlands.combat`，world resource 为 `seedlands.combat-clock`。两者由同一 host owner 持有。
- actor 投影为版本 1、稳定 lifetime reference、kind、health/maxHealth/lifecycle、mode、宿主从当前物品/角色定义派生的 meleeDefinitionId、可选 pending 摘要（token/targetId/baseDamage）。不暴露 origin、allocator 或完整私有 frontier。
- world 分片按当前 128 player +512 retained autonomous actor 的稳定 ID 排序，条目只有 reference、active/pending 标志。观测 token 由 owner 覆盖实际 Combat frontier 与 ECS 生命周期；不能用相同 gameplay revision 恢复绕过新鲜度检查。
- actor request operation `seedlands:request-combat`：入口 target 是目标实体，input 仅 targetId；读取原 actor 和 target 投影。返回 `{version:1, kind:'request', actorId, targetId, definitionId, rulesetRevision}`，definitionId 来自原 actor 投影。
- actor resolve operation `seedlands:resolve-combat`：入口 target 为 pending target，input 仅 token。读取原 actor 的 pending 摘要、target 和 Ruleset；返回 `{version:1, kind:'resolve', actorId, targetId, token, damage, rulesetRevision}`。damage 由 before 规则提供、operation 限制有效范围、after 再比较预期。不得接受输入自带 origin/actor/principal/damage。
- world operation `seedlands:advance-combat` 和 every-advance system `seedlands:combat-system`：读取全部 5 片，返回 `{version:1, kind:'advance', seconds}`，seconds 范围 0..1；可选 `cancelTokens`（至多 1024 个不重复、当前存在的 pending token）供 actor resolve 拒绝后在同一注册系统通道明确取消，通常 seconds 为 0。不借 actor 权限进行伤害，不用隐式取消队列或 legacy cancel 旁路。
- 三种 operation 均不写 state。模块严格校验上下文 kind/target、字段、引用和输入。定义导出 address/codec/type helper，避免 host 与 module 复制 schema。

## Ruleset 与 host owner

独立 Combat rules module requires Combat + immutable Ruleset，参与 request/resolve before/after。before 重建全部 effectiveInput，观察当前 Ruleset 和 actor/target；默认规则由 Overworld 显式选择，伤害倍数 1，creative target 免除伤害。规则可用明确 profiles 配置伤害倍数和免除模式。标准机制本身不硬编码 creative；after 读取第四个冻结 candidate 参数，核对身份、武器来源、规则 revision 和准确伤害。无规则时 raw input 不满足 operation 的 effectiveInput schema，拒绝。

host 要求真实 execution envelope；检查 operation/resource/kind/target/provenance、完整 observed projection 和 candidate 精确对应。request 从真实 envelope 捕获 durable origin，prepare Action start + Combat request，返回真实 actionId/buffered。resolve 按 pending 保存的来源重新授权；一次 Combat prepareMutation 合并 resolveHit 与致死取消，再准备所有 Action settlement、ECS 生命/掉落/删除、Autonomy 变化。所有 owner validate 完成后才 apply，结果 clone/fact 构造也在写前完成。

Autonomy effects 接受这一次已准备的 Combat plan，不能自行再次准备 Combat。它预构造 Action 终态、NPC 行为/移除、完成/受击的短期观察事件以及计数；Perception 提供有界记录候选，复制和旧记录检查在写前进行。外层按 Combat/ECS/Action/Autonomy/Perception 全部预备校验后安装；Action 初始 target 保留原始请求语义，连招当前目标以 Combat 为准，不以重复 target 字段建立第二份状态机。

调度仅产生 pending。transactionScope 释放后逐项按当前 origin resolver 绑定 actor resolve；撤权/失去主体映射时通过显式 world Combat 操作取消，不借管理员。stable snapshot 前有界 drain 完整 pending/模块队列。当前未发布 V4 继续完善；旧无来源在途攻击确定性取消。

Browser player 和 Headless player 用同一稳定 subject、不同当前 alias；NPC 用普通 actor service principal 与真实 originalActor lifetime，system 仅持有 world combat-clock。宿主显式配置当前来源映射，不保存 authorizer，不复制 Pack permission 请求为宿主 grant。实际 attack/Actor action/Browser input/Headless command 均需接通；composed world 无 Combat provider 时关闭旧隐式分支并明确 unavailable。独立 legacy 无 composition 路径维持已承诺行为。

## 准出

先取得纯 module/规则候选 RED/GREEN，再验证真实 Gameplay owner 的攻击/延迟命中/连招、死亡掉落失败全回退、origin 恢复/撤权、无 Combat 组合、零 windup、pending drain，以及 Browser/Headless 当前普通身份。之后冻结 full static/build、真实输入回归与独立审阅。模块候选测试通过不等于宿主接线完成。

## 实际消费接线与补充验收（2026-09-10）

- 默认 Pack 装入 Combat 和 Overworld Combat Rules；无 provider 的组合禁止玩家/NPC 回落到旧攻击。候选不是状态组件，宿主 prepareCommit 在最终值 clone 后安装已有 Combat、Action、ECS 和观察参与者。
- Browser/Headless 提供稳定玩家主体、NPC actor service 与当前脚本策略；命令入口保留实际绑定，脚本不借默认玩家身份。恢复的临时校验实体存储也使用当前策略生成的 origin 端口。
- 每个注册 system 之后与稳定快照前有界结清 pending；规则拒绝的命中经注册 world clock 取消。无活动攻击、冷却或 lifecycle 的 Combat 空时钟不消费 gameplay revision。整个多 system advance 不承诺回滚，原子性边界是单个注册 operation。
- `gameplay-registered-combat.test.ts` 覆盖移除 provider、玩家/NPC 真伤害、after 拒绝零写入、resolve 拒绝零伤害、死亡掉落、跨别名恢复，以及撤销来源后取消玩家 Action。
- 本轮可执行 RED：真实消费缺失、临时 restore 缺 origin port、恢复取消后玩家 Action 残留、空 Combat 消耗最后一个 revision；均保留 `/tmp/seedlands-s3-*` 局部日志。局部组合/恢复/Headless 回归 24 文件 149 用例通过；基础准出和 Browser 结果另行记录。
- 仍须在 S3 收口前复核：连击更换目标时 Action 与 Combat 目标身份的 owner/恢复一致性；Mode/Inventory 的取消操作是否全部完成注册事务迁移；外部脚本拒绝/恢复的真实入口证据。此记录不代表 S3 完成。
