# 一致保存基础设施进度

## 已核对的旧行为

- `GameServerGameplayFacade.save()` 先创建 Gameplay 快照并等待 `saveGameplaySnapshot()`，之后才调用 `flushDirtyChunks()` 创建 Chunk 快照。保存等待期间继续发生的世界编辑会进入较新的 Chunk 快照，导致一次保存混合两个权威时刻。
- Gameplay 与 Chunk 通过两个独立持久化调用写入；即使两次调用各自成功，也不能证明浏览器崩溃时整体原子。
- Chunk 旧 ACK 已按 revision 重检，能够保留保存期间产生的较新 dirty revision；Gameplay 也记录 persisted revision，但旧链路没有共同的 commit token。
- Chunk 快照已经包含独立复制的 `voxels` 与 fluid sidecar；Gameplay V3 已包含脚底坐标与身体注册表 schema。

## 冻结合同与边界

- `freezeSaveSnapshot(commitSequence)` 必须同步完成，返回当前 Gameplay、所有 dirty Chunk、fluid sidecar、世界 revision、seed/generator 与物理/流体 schema 的独立副本。
- `saveFrozen(snapshot)` 只能保存本 GameServer 创建的冻结 token。异步等待期间权威状态可继续推进，成功 ACK 只确认冻结 revision；较新 revision 继续 dirty。
- 同时保存 Gameplay 与 Chunk 时，持久化端必须提供单次原子写入口。缺少该入口时 fail closed，禁止退回两个独立写调用并宣称保存成功。仅 Chunk 的旧持久化端仍可保存 Chunk。
- 失败不得推进 persisted revision，也不得覆盖已有有效 checkpoint；成功 ACK 必须晚于持久化事务真正完成。
- 不读取、修改或覆盖真实用户存档。浏览器 IndexedDB 的单事务实现由主线集成任务接入，本任务提供共享协议与内存实现。

## RED 用例设计

- 阻塞冻结快照的原子持久化，在等待期间继续修改 Gameplay、实体物理和同一 Chunk；释放后重载必须只看到冻结时刻，当前实例的后续 revision 仍 dirty。
- 修改冻结后权威数组，冻结快照的 voxel/fluid/Gameplay 内容不得变化。
- 持久化失败后 persisted revision 不推进，重载仍得到上一个完整 checkpoint；重试可保存新 checkpoint。
- 持久化 Promise 未完成前不得 ACK；完成后 Gameplay 与 Chunk 一起 ACK。
- 具有 Gameplay 端口但缺少原子入口时必须在任何旧写入前拒绝。
- 最早期独立玩家位置 `[4, 42, 8]` 恢复为脚底 `[4, 40.4, 8]`。

## 当前状态

阶段：服务端冻结、内存原子持久化与 Facade 迁移完成；等待主线接入 Authority 和浏览器单事务端口。

首次 RED（2026-09-06）：新增 4 个一致保存用例全部失败，旧独立玩家迁移用例同步失败。代表性结果：

```text
server.freezeSaveSnapshot is not a function
promise resolved instead of rejecting（旧链路仍分两次写）
Expected legacy player y 40.4, received 42
```

## GREEN 证据

- `tests/server/game-save-persistence.test.ts` 覆盖保存阻塞期间继续编辑与物理位置推进、公开 token 篡改隔离、voxel/fluid/Gameplay 深复制、失败保留旧 checkpoint、重试、缺失原子端口拒绝、无持久化不误 ACK，以及新 Authority 会话的 commit sequence 重置。
- 相关 Vitest：8 个文件、65 个用例全部通过；范围包含 GameServer、Gameplay/Simulation 持久化、Chunk ACK 并发、fluid sidecar、库存和命令保存。
- 所属文件 Prettier、ESLint、隔离 TypeScript 编译与 `git diff --check` 全部通过。
- 完整生产构建已执行，但当前被其他并行主线改造中的 `game.ts`、`game-harness.ts` 与 `browser-logic-client.ts` 类型错误阻塞；输出没有指向本任务拥有的文件。

## 已实现接口

- `GameServer.freezeSaveSnapshot(commitSequence)` 同步创建公开 token，并在内部保存不受调用方修改影响的独立 structured-clone 副本。
- `GameServer.saveFrozen(snapshot)` 串行落盘，只接受本实例创建的 token；成功后按冻结 revision ACK，失败保留 token 与 dirty 状态。
- `FrozenGameSaveSnapshot` 明确携带 save schema、commit sequence、world revision、seed/generator、Gameplay V3、physics schema、fluid schema 及带 fluid sidecar 的 dirty Chunk。
- `GameplayPersistence.saveFrozenSnapshot()` 是 Gameplay+Chunk 的原子端口；内存实现先完成全部复制，再一次切换 checkpoint。带 Gameplay 的持久化若缺少该端口会 fail closed。
- `flushDirtyChunks()` 仅保留给不保存 Gameplay 的 Chunk-only 端口；防止它绕开整体原子 checkpoint。
- Facade 恢复最早期独立玩家位置时调用统一的 `legacyPlayerPositionToFeet()`，出生和重生坐标均进入脚底中心语义。

## 主线待接入

- `AuthorityRuntime.save()` 应在当前 `session.currentCommitSequence` 边界先同步 freeze，再异步调用 `saveFrozen()`。
- `BrowserChunkPersistence` 与 Persistence Worker 需增加一个请求，在同一 IndexedDB `readwrite` 严格持久化事务中同时写 `worlds` 的 Gameplay/commit metadata 与全部 Chunk records；只有 transaction complete 才响应成功。
