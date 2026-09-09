# Living NPC Round 3 世界正确性修复

合同 SHA-256：`3ee3eeae78bce86afa4c4494da6843350530c881fa9328588ecc5c6fc14fa130`

冻结基线：`0ce2bfc3b53e6be179f6d315016972d4be5e1885`

## 变更

- Character snapshot 的 follow cross-reference 验证不再依赖 `actionId` 存在。active/suspended follow 的 goal target ref 必须解析到 entity binding，并与 `executionTargetId` 一致。
- 危险期间同时校验 `currentGoal` 与 `suspendedGoal`；两者若为 follow，必须指向同一个合法 execution entity。无 action 的近距离持续 follow 仍可合法恢复。
- 既有 action link 验证保留：pending/running/terminal move action 均按原生命周期处理；forage、idle 与无 action 终态没有新增限制。
- `GameplayRuntime.spawnAutonomous` 在 canonical entity 生成后用 try/catch 注册 Actor；注册失败时立即从 EntityStore 移除刚创建的 entity，再原样抛出错误。`touch()` 仍只在 entity+Actor 都成功后执行，因此失败不增加 gameplay revision，也不改变既有 Actor。

## 验证

- Meaningful RED：
  - 合法 active、无 action 的近距离 follow snapshot 被篡改 `executionTargetId` 后原先恢复成功。
  - 使用真实 `MAX_RETAINED_ACTORS=512` 填满 Actor store 后，第 513 个 `spawnAutonomousActor` 抛容量错误但留下 `overflow` NPC entity。
- GREEN focused：`character-control-correctness.test.ts`、`character-creation-atomicity.test.ts`、`character-control-runtime.test.ts` 共 3 files、15 tests 全部通过，8.28s。
- Follow 测试先恢复合法 active no-action 状态，再验证错配 snapshot 原子拒绝；随后通过真实 `attackEntity` 形成并恢复合法 suspended follow，再验证相同错配原子拒绝。失败后当前 Character state 不变。
- 容量测试实际创建 512 个 Actor；溢出后 entity count、actor count、gameplay revision、首尾既有 Actor 均保持不变，且 `overflow` entity 不存在。同一个饱和 server 又通过产品 `character(create)` 入口连续失败两次，Character list、NPC/Actor 数和 revision 均保持不变。
- `./node_modules/.bin/tsc -p packages/game-core/tsconfig.json --noEmit`：通过。
- `./node_modules/.bin/tsc -p tsconfig.test.json --noEmit`：通过。
- 四个范围文件 targeted ESLint：通过；`git diff --check`：通过。
- 加强产品 create 入口后，`character-creation-atomicity.test.ts` 1/1 通过，test tsc 与该文件 ESLint 再次通过。

## 风险

- 回滚会移除失败调用刚生成的 entity；本修复不改变 Actor 注册内部协议或其他 `spawn` 路径。失败发生在显式 ID 缺省时仍可能消耗 EntityStore 的内部自增序号，但不会留下可见 entity、Actor 或 revision 变化；合同要求的真实容量失败边界已满足。
- 未运行 Browser、provider、global format、full static/build、commit 或 push；Root 负责最终全局门禁。

## 实际成本

- 墙钟约 18 分钟，低于合同 0.75 agent-hour。
- 外部 provider/API 调用 0；未安装依赖或执行 Git 写入。
