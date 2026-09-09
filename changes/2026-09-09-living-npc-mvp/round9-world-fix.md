# Living NPC Round 9 世界目标所有权修复

## 变更

- 在 `ActorState` 增加通用派生投影 `persistentGoal?: { kind, status }`。它只表达 Character 是否持有 active/suspended 持久目标，不含 Agent、模型或 provider 概念。
- `AutonomyRuntime.snapshot()` 每次从 `CharacterRuntime` 的真实记录生成该投影；`cloneActor()` 在恢复候选中删除存档投影，因此旧存档缺字段可迁移，合法但伪造的字段也不能覆盖 Character owner。畸形枚举仍被结构校验拒绝。
- Logic 决策顺序保持：不活跃 hold → 已记录攻击者/可见威胁逃离 → 已跟踪 move Action → 持久目标无 Action 时 hold → 旧生物/居民规则。`forage` 明确保留既有“无食物时普通 settler roam”委托。
- 新增真实 Headless/Authority 回归：显式 idle 跨多轮 Logic/Physics 保持；普通非 Character actor 不获得派生所有权；follow 到达后保持且目标移动后重建正式 Action；checkpoint 恢复后从 Character 重建 idle 所有权；伪造 forage 投影不生效。
- 在现有 Logic 避险用例上加入 suspended idle 持久目标，确认逃离反射仍优先；现有普通 settler 日程与 Character forage roam 回归保持。

## 验证

- RED：`/tmp/living-npc-round9-red.log`。基线实现 3 项中 2 项失败：idle Character 没有所有权投影；checkpoint 中伪造的 forage 投影被原样信任，未从 idle Character owner 重建。
- GREEN：`/tmp/living-npc-round9-green.log`，5 files / 27 tests 全过。覆盖新增目标所有权、Logic decision、observation builder、Character 连续目标/forage 和危险恢复。
- `node_modules/.bin/tsc -p packages/game-core/tsconfig.json --noEmit`：通过。
- `node_modules/.bin/tsc -p tsconfig.test.json --noEmit`：通过。
- 目标文件 ESLint、Prettier check、`git diff --check`：通过。
- Root 独立真实 Browser 最终消费者证据：follow 到达后 90 Physics ticks 水平位移小于 0.02 且无新 Action；真实 WASD 令玩家移动超过 4 格后，NPC 身体移动超过 1 格并靠近玩家。该证据补齐了本地平地 fixture 只证明重新规划、Authority 接纳 `wish`，未证明身体位移的层级边界。

## 风险

- `persistentGoal` 是 snapshot/Logic observation 的派生控制投影，不是第二份 Character 权威；恢复时必须继续以 Character snapshot 为 owner。
- 本地 flat Authority follow 用例验证目标移动后生成绑定玩家的 running Action，并连续收到 accepted `wish: {x:1,z:0}`；该 fixture 中身体未产生位移，未作为身体跟随证据。身体续跟由 Root 的真实 Browser 平地路径验证。
- 本次不修改协议版本、Browser/provider、动作执行、导航或物理规则，也不宣称性能收益。

## 实际成本

- 约 0.45 agent 小时；2 次测试夹具修正。未安装依赖、未运行 Browser/全局门禁、未写 Git。
