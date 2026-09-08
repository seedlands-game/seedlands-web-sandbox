# Node 文件持久化实施记录

## 接口计划

- `FileGamePersistence.open({ directory, seedText, generatorVersion, worldId?, limits?, faultInjector? })` 异步获取单写者锁并校验当前检查点。
- `loadSnapshot(key)` 只同步读取已准备缓存；`ensureSnapshot(cx, cy, cz)` 与 `ensureNeighborhood(...)` 异步校验、解码不可变 Chunk blob 并填充缓存。
- `loadGameplaySnapshot()` 与 `loadGameCheckpoint()` 返回同一 manifest 绑定的数据；旧的分步保存入口拒绝写入，只有 `saveFrozenSnapshot(snapshot)` 发布完整检查点。
- `inspectPreviousCheckpoint(...)` 只读校验上一代检查点，不修改 `CURRENT`；`close()` 核对锁身份后释放。

## RED / GREEN 记录

### RED

- 命令：`pnpm exec vitest run tests/node/file-game-persistence.test.ts --no-file-parallelism --maxWorkers=1`
- 结果：失败；测试文件因 `src/node/persistence/file-game-persistence.ts` 尚不存在而无法导入，`0 test`，符合先写合同再实现的预期 RED。

### GREEN

- 聚焦命令：`pnpm exec vitest run tests/node/file-game-persistence.test.ts --no-file-parallelism --maxWorkers=1`
- 首轮结果：`1` 个测试文件、`15` 项测试全部通过。覆盖重启恢复、同步缓存/异步准备、两次增量检查点保留旧 Chunk、六个发布故障阶段、活动锁竞争、损坏锁 fail closed、已确认过期的本机 PID 锁回收、冻结 token 隔离、大小限制、CURRENT/manifest/blob 损坏与显式旧检查点检查。
- 独立评审修复后结果：同一命令得到 `1` 个测试文件、`17` 项测试全部通过。新增覆盖启动校验后将 Chunk 换成目录外同内容符号链接仍拒绝读取，以及同一 `commitSequence` 的完全相同检查点幂等成功、内容变化拒绝且重启仍恢复原检查点。
- 锁竞争复核后在 Node `v22.23.2` 执行同一命令，`1` 个测试文件、`19` 项全部通过。新增受控屏障保证两个打开者都先观察到同一个过期锁，再验证只有独占回收者成功；同时验证残留 `LOCK-RECLAIM` 保留现场并 fail closed。
- 联合回归命令：`pnpm exec vitest run tests/node/file-game-persistence.test.ts tests/server/game-save-persistence.test.ts tests/world/chunk-snapshot-codec.test.ts --no-file-parallelism --maxWorkers=1`
- 结果：`3` 个测试文件、`29` 项测试全部通过，确认文件实现继续遵守现有一致冻结确认和 Chunk codec 契约。
- 静态局部检查：`pnpm exec eslint src/node/persistence tests/node/file-game-persistence.test.ts`、相关路径 Prettier check 与 `git diff --check` 均通过。
- 聚焦类型检查：以项目相同的 ES2022、ESNext、bundler、strict 和 Node types 参数检查六个持久化模块及其测试，结果通过。
- 全测试 TypeScript：`pnpm exec tsc -p tsconfig.test.json --noEmit` 当前被共享实施中的 network message narrowing、dedicated host 测试字段和尚未就位的 C0 codec 导入阻塞；本持久化路径没有报告类型错误，待主线对应实现稳定后复跑全量检查。

## 已实现存储闭环

- 保存调用进入异步队列前立即深拷贝 `FrozenGameSaveSnapshot`，后续调用方修改不影响磁盘检查点；首次失败后实例进入失败态，已排队及新增写入均拒绝继续。
- Chunk blob 调用既有 `createStoredChunkRecord` / `decodeStoredChunkRecord`，以 `normalizeSeed(seedText)` 和 `makeChunk(...)` 重建程序化基线；体素、fluid、checksum 和原 schema 均沿用现有契约。
- 每次保存先写并同步内容寻址的不可变 Chunk/Gameplay blob，再写并同步完整 manifest。新 manifest 从当前完整 Chunk 索引复制并只替换本次脏项。
- 发布前把旧 CURRENT 保存为 PREVIOUS，再以同目录临时文件原子替换 CURRENT；文件和目录分别执行同步，只有 CURRENT 同步完成后才解析为本实例的 durable 当前值。
- 启动对 CURRENT、manifest、Gameplay 及所有 Chunk 引用执行版本、世界身份、schema、路径、数量、长度和 SHA-256 校验。任何损坏都保留原文件并拒绝启动，不自动采用 PREVIOUS。
- 单写者锁包含本机名、PID 和随机 token。活动或无法解析/无法核验的锁拒绝抢占；只有本机 PID 已明确不存在时才回收。关闭前重新核对 token，避免删除其他实例的锁。
- 过期锁回收另以独占 `LOCK-RECLAIM` 串行化；取得回收权后必须重新读取 LOCK、比对完整身份并再次确认 PID 不存在。竞争者拒绝启动；回收进程崩溃留下的标记不递归自动抢占，错误明确要求人工核验。
- 默认限制 seed `1 KiB`、manifest `16 MiB`、单 Chunk blob `2 MiB`、Gameplay `64 MiB`、完整索引 `100000` 个 Chunk；所有磁盘读取以 `O_NOFOLLOW` 打开文件句柄，再以该句柄检查普通文件类型与上限、按已核验长度读取并探测尾部增长，避免符号链接和路径检查后替换竞态。引用路径只接受内部内容寻址格式。
- 已发布 `commitSequence` 的完整 manifest hash 定义该序号的内容身份。完全相同的重复保存作为幂等成功；相同序号下 world revision、Gameplay 或完整 Chunk 索引发生任一变化都会拒绝，不改写 CURRENT。

## 已知边界

- 本轮已在 Node `v26.0.0` 与 Node `v22.23.2`、macOS Darwin `25.6.0 arm64` 通过聚焦用例。Linux 本地文件系统由主线后续矩阵补证。
- 本子任务只验证进程内故障注入和 macOS 本地文件系统重启读取；Linux 设备断电、macOS 真实断电和任意网络文件系统均未验证，不能据此声称硬件掉电保证。
- 首版保留历史不可变 blob，不实现在线垃圾回收。
- `inspectPreviousCheckpoint(...)` 只验证和报告上一完整检查点；本轮没有提供自动或隐式切换 CURRENT 的恢复写操作。
