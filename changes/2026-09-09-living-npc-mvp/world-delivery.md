# A1 世界角色实现交付报告

日期：2026-09-09

合同：`changes/2026-09-09-living-npc-mvp/contracts/world.json`，SHA-256 `41e8f78e97346320537a053ea49d741785024781813c88d516b0b080f19c97bf`

## 变更

- 新增通用 `world.character(request)` 能力，支持 `create`、`list`、`inspect`、`observe`、`dialogue`、`intent`、`memory`。Headless/开发 Harness 经 `WorldHarnessResult` 使用同一 core Authority 实现。
- 新增持久 `CharacterRuntime`：保存角色 identity/incarnation、profile、home、连续 goal、control/policy revision、Inventory、memory revision/summary/cursor、有界事件、稳定且不泄露实体 ID 的 target ref、动作执行上下文及 `active/deceased` 生命周期。旧存档没有 character 段时迁移为空集合；损坏角色段先在候选 runtime 校验，不部分写入当前世界。
- Character 创建使用既有地面导航与占位检查选择玩家附近安全位置；显式位置也须可站立。创建后的无模型默认 goal 为持续 forage，未发现食物时保留既有 settler Logic 漫游，不以传送或文本动画伪造活动。
- 连续执行复用既有 GroundNavigator、Action、Physics、Logic、EntityStore 与 Inventory：move-to/return-home 终止目标，forage/follow 为连续目标；forage 正常拾取世界掉落、写入自身背包并食用，改变世界物品和饥饿；follow 完成一段后保留总目标并在玩家移动时继续；同一 goal 的新对话只记录回执，不重置底层 Action。
- 受击会中断当前 Action、暂存原 goal、执行真实 flee 运动，安全窗口后恢复；目标消失、路径失败和卡住均产生有来源事件及 fallback，且不瞬移。
- NPC 死亡不删除角色身份。角色进入 `deceased`，control/policy revision 失效，保留 profile、memory 与事件；自身 Inventory 通过正常 world-item 掉落清空；checkpoint 恢复后仍可在 list/observe 中读取终态，不能再次绑定或下发动作。
- 受限观察只投影自己、可见实体和 POI，实体以当前 observation 发放的 opaque ref 表示；伪造、过期、已消失及不可见目标统一返回 `CHARACTER_TARGET_UNAVAILABLE`。事件每页最多 32，实体/POI 各最多 16；`gap` 标识截断，cursor 只推进到本页最后实际发送事件。
- Browser Authority 新增可信 UI `BrowserAuthorityClient.character(request)`；UI 可 create/list/inspect/observe/dialogue，直接 intent/memory 被 Authority Worker 拒绝。`bindCharacter(entityId)` 返回绑定实体的 `BoundCharacterControlPort`，公开 `binding`、`observe`、`intent`、`memory`、`dispose`。Worker 强制实体、world/epoch/incarnation/policyRevision、严格递增 sequence 和当前角色 revision；恢复、死亡、解绑及 dispose 使旧端口失效。dialogue 仅允许角色与活玩家相距不超过 10m。
- `AuthorityRuntime`、`GameServerGameplay`、Authority Worker 协议、JSONL Harness 接到同一角色 owner；core/server 与角色消息未引入 Agent/provider/model 概念。
- 为维持文件职责和静态上限，拆出 `character-goal-runtime.ts`、`character-runtime-validation.ts`、`character-runtime-types.ts`、`gameplay-character-control.ts`、`authority-worker-character-control.ts` 和 `browser-character-control-port.ts`；主要新增文件均小于 500 物理行。

UI/Bridge 调用边界：

```ts
const listed = await authority.character({ kind: 'list' });
const created = await authority.character({ kind: 'create', profile });
await authority.character({ kind: 'dialogue', entityId, text });

const port = await authority.bindCharacter(entityId);
const observation = await port.observe(sinceCursor);
await port.intent(requestId, expectedRevision, goal, say);
await port.memory(expectedMemoryRevision, throughCursor, summary);
await port.dispose();
```

UI 只把 `character(list/create/inspect/observe/dialogue)` 当可信玩家页面入口；认知 Bridge 只持有 bound port。目标必须来自同角色 observation 的 ref。`create.position` 可省略以使用安全默认出生点。

## 验证

- meaningful RED：初始 focused server 测试以 `server.character is not a function` 失败，证明测试覆盖新增 API，而非预先为绿。
- 最近一次完整 A1 focused GREEN（最终小幅测试确定性调整与客户端 helper 拆分前）：`tests/server/character-control-runtime.test.ts`、`tests/client/browser-character-authority.test.ts`、`tests/client/browser-character-client.test.ts` 共 13 tests 通过，约 7.5s。
- 当前冻结源码在 helper 拆分和最后测试调整后，以下三项均 exit 0：
  - `./node_modules/.bin/tsc -p packages/game-core/tsconfig.json --noEmit`
  - `./node_modules/.bin/tsc -p apps/web/tsconfig.json --noEmit`
  - `./node_modules/.bin/tsc -p tsconfig.test.json --noEmit`
- 当前 targeted ESLint 在最终源码拆分后通过；`git diff --check` 通过。
- V01 core 证据：真实 Headless tick 完成移动、世界物品拾取、Inventory 食用、世界物品消失、hunger 下降；无食物 fallback 仍通过既有 settler roam 产生实际位移。
- V02 A1 边界证据：dialogue 与 intent 分离；相同 goal 加 speech 保留既有 Action。人格一致的真实模型回复属于 Root 的 A2/V08/V09 集成证据。
- V03 core 证据：受击后 flee 使与攻击者距离增大，安全窗口后恢复原 goal；目标消失产生 target-lost 和 fallback；follow 跨动作分段继续。
- V04 server/client 证据：不可见和伪造 ref 一致拒绝；浏览器 direct intent 拒绝；重复 sequence、旧 epoch、死亡后的旧 binding 和重新绑定均拒绝。
- V05 core 证据：完整 portable checkpoint 恢复 active 身份/profile/goal/inventory/memory/events；正常死亡掉落并恢复 deceased 身份与终态事件；旧存档迁移；损坏 riskTolerance/角色结构在候选验证阶段原子拒绝。
- 当前最后一次 focused tests 由 Root 接管执行；收到“源码冻结、接管所有后续验证”后未再启动测试、Browser、full build 或全量门禁。

旧回归补充：曾启动一组较宽旧回归，39 个已报告通过后 `gameplay-command-persistence` 子进程约 73s 失败，同时发现当时 `node_modules/.bin` 消失；该次输出仅在工具会话，没有持久日志文件，因此无可提供的日志路径，也不把它列为当前 A1 通过证据。Root 后续已恢复依赖并接管归因/最终门禁。

## 风险

- 当前冻结源码最后的测试确定性调整尚未由本线程重跑 focused tests；Root 已明确接管，须以 Root 后续无重试结果为最终证据。
- Browser 真实旅程、模型调用、保存重入、截图、全量 static/build/旧近战与 CI 属于 Root 的 V08-V10 集成门禁，本报告不声称其已经通过。
- 角色核心以现有单机 Authority 为 owner；不含 Dedicated、LOD、离线追赶、World AI、自定义规则或多模态。
- 无食物时基础生活复用现有 settler Logic 漫游；当前 A1 未新增食物生成规则。持续 forage 会在后续出现可见食物时重新执行拾取/食用。
- Root-owned `runtime/character-control-protocol.ts` 的 Hostwire 字段归属由 Root 核对；A1 server core/Authority 实现本身没有读取或编码模型/provider 概念。

## 实际成本

- 完成 core、Headless/Browser Authority、存档、连续行为、权限、死亡终态和 focused tests；未安装依赖、未运行 Browser/full build、未执行 Git 写入。
- 平台未提供本子任务精确 credits/API 等价费用与连续墙钟计量；可确认低于合同 24 agent-hours 上限，外部 API 调用费用为 0。
