# Living NPC GitHub 世界正确性修复报告

合同：`github-world-fix.json`

合同 SHA-256：`db46cbab4109254972edb26d90ddab8e4dfed5c26059732dd382710876dbfcd7`

冻结基线：`6a24891`

## 变更

- 通用 `CharacterControlRequest` 的 `intent` 新增可选 `expectedCursor`。Core 在任何 Action 中断、revision/goal/requestId/event/speech 写入前验证其为非负 safe integer；新请求的 cursor 与当前 `eventCursor` 不同则返回 `CHARACTER_REVISION_CONFLICT`。
- 重复 `requestId` 保持原幂等语义：先验证 cursor 的结构，再在 freshness 比较前返回已有请求结果。后续 dialogue 增加 cursor 后，合法重试不会重复动作或 speech。
- `BoundCharacterControlRequest` 将 intent 的 `expectedCursor` 收紧为必填。Browser Authority 在写入 binding `lastSequence` 前拒绝缺失、负数、超过 safe integer 或字符串 cursor，因此 malformed 请求不消费 sequence；正常 stale cursor 由 core 返回结构化 conflict。
- Character snapshot restore 在 records map 交换前查询已经恢复的 Action store，并验证 `actionId`：动作必须存在、属于角色自身、类型为 `move-to`、角色 goal 为 active，且 move-to/return-home 位置或 forage/follow execution target 与动作一致。follow 还要求当前目标 ref binding 对应同一 execution entity。
- Action 状态没有被错误限制为 pending/running。合法的 succeeded/failed/interrupted 终态 action link 可恢复，并由下一次 character tick 走原有终态收敛路径。
- 新 freshness 与 restore 用例拆到 `tests/server/character-control-correctness.test.ts`，原角色测试文件保持 480 行；`character-runtime.ts` 为 506 物理行，targeted ESLint 的 nonblank/effective 500 行门禁通过。

## 验证

- Meaningful RED：
  - dialogue 在 observation 后到达，带旧 cursor 的 intent 原先成功并改写角色；Browser bound 路径同样返回 `ok:true`。
  - Character snapshot 的 `actionId='action-missing'` 原先恢复成功。
- GREEN：`./node_modules/.bin/vitest run tests/server/character-control-runtime.test.ts tests/server/character-control-correctness.test.ts tests/client/browser-character-authority.test.ts`，3 files、17 tests 全部通过，9.17s。
- 加强 bound malformed cursor 表后：`browser-character-authority.test.ts` 4/4 通过，5.53s；同一 sequence 在多次 malformed 拒绝后仍可用于合法 intent。
- `./node_modules/.bin/tsc -p packages/game-core/tsconfig.json --noEmit`：通过。
- Root 更新 CharacterControllerPort 接缝后，`./node_modules/.bin/tsc -p tsconfig.test.json --noEmit`：通过。
- Targeted ESLint：通过。
- `git diff --check`：通过。
- Restore 测试分别覆盖 missing action、foreign actor action、同 actor 但 `wander` 类型 action；每次失败后现有 Character state 与原 Action 均不变。另覆盖合法 succeeded action restore，下一 tick 清除 action link。

## 风险

- 通用开发入口保留不携带 `expectedCursor` 的兼容行为；Browser bound/认知控制入口强制携带 cursor。旧开发脚本不会因新增字段立即失效，受限控制不会绕过 freshness。
- Action cross-reference 验证依赖 Autonomy restore 已先恢复 Action store；Gameplay 的候选 runtime 验证仍提供整体原子边界。此次没有改变 ActionRuntime 的生命周期或 terminal 状态规则。
- Root 负责 Web port/Bridge 传播、spec/docs、Browser、provider 与全局门禁。本修复未修改这些文件，也未执行 provider/browser/install/commit/push。

## 实际成本

- 墙钟约 25 分钟；位于原 A1 分配内，低于 1.5 agent-hour 上限。
- 外部 provider/API 调用为 0；未安装依赖或执行 Git 写入。
