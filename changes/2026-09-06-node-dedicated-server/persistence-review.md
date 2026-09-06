# Node 文件持久化独立评审

## 范围与结论

本评审以已批准的 `spec.md` 第 3.6 节和 `remote-environment.md` 第五节为合同，只检查 `src/node/persistence/**` 与 `tests/node/file-game-persistence.test.ts`；没有修改被评审的实现或测试。评审快照为 2026-09-07 的工作树，相关实现仍是未跟踪文件。

初始结论：检查点发布的主路径已经具备「不可变 blob → 完整 manifest → PREVIOUS → 同目录原子替换 CURRENT」的结构，初始 15 项测试覆盖了六个发布故障注入点、CURRENT 损坏 fail closed、显式只读检查 PREVIOUS、活动锁和可确认的本机过期 PID 锁。初始审查发现运行中懒读取会接受目录外的符号链接且无界读取；同一 `commitSequence` 能发布不同检查点。缓存上界、实际 Linux/进程中止证据和锁身份说明仍未满足合同的完整准出。

### 2026-09-07 修复复核

实现者已修正两项初始 P1，独立复核命令使用 Node `v22.23.2`：`pnpm exec vitest run tests/node/file-game-persistence.test.ts --no-file-parallelism --maxWorkers=1`，17/17 通过。`readBoundedFile()` 现以 `O_NOFOLLOW` 打开、对已打开 fd 取 `stat`、有界分段读并在末尾探测长度变化；懒加载、CURRENT/PREVIOUS、LOCK 都使用该路径。新增的“启动后外部同内容 symlink 替换”测试拒绝 `ELOOP`。同序号路径改为仅接受 manifest hash 完全相同的幂等重试，world revision、Gameplay 或完整 Chunk 索引导致 hash 改变时拒绝且重启后保持原 CURRENT；新增回归已覆盖。此两项不再是当前阻塞项。

## 已核对的正确路径

| 合同点                                   | 代码与测试证据                                                                                                                                                                                                                                       | 评审判断                                                                                   |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 不可变数据、完整索引和 Gameplay 同检查点 | `file-game-persistence.ts:263-313` 以旧 `chunks` 完整复制后只替换 frozen 脏 Chunk；Gameplay 引用与 checkpoint 在同一 manifest。`file-game-persistence.test.ts:65-84` 验证第二次增量保存仍可读取旧 Chunk。                                            | 符合。                                                                                     |
| 文件/目录同步和 CURRENT 原子发布         | `durable-files.ts:14-22` 对临时文件 `sync()`；`35-39`、`46-56` 在同目录 `rename()` 后同步所在目录。`file-game-persistence.ts:316-324` 先同步 PREVIOUS，再替换并同步 CURRENT。临时文件与目标分别处在相同父目录，正常本地文件系统不会跨设备 `rename`。 | 代码路径符合；尚不能据此声称断电保证。                                                     |
| CURRENT 损坏时不自动退回 PREVIOUS        | `open()` 只读取 CURRENT（`76-96`），`inspectPreviousCheckpoint()` 是独立只读入口（`99-119`）。测试 `193-217` 损坏当前 manifest 后确认启动拒绝、原文件保留、仍可显式检查 C1。                                                                         | 符合。                                                                                     |
| PREVIOUS 的完整性                        | `loadManifestFromPointer()` 对指针、manifest、Gameplay 和每一 Chunk 执行版本、长度、hash 和 schema 校验（`file-store-manifest.ts:137-162`）；PREVIOUS 使用同一读取路径。                                                                             | 结构符合；测试只覆盖 CURRENT 损坏后检查上一代，未覆盖 PREVIOUS 自身损坏应拒绝检查。        |
| 单写者与崩溃后的保守恢复                 | `LOCK` 用 `open(..., 'wx')`、文件和目录同步（`file-store-lock.ts:51-70`）；同目录第二实例被测；损坏锁、异机锁或权限不明均拒绝，只有同主机 `ESRCH` 才删除。                                                                                           | 安全侧符合 fail closed。PID 重用会被当作活动写者而阻塞恢复，这是可用性边界，不会形成双写。 |
| 启动损坏、身份与路径格式                 | manifest 引用只允许固定内部内容寻址正则，启动用 `readBoundedFile()` 拒绝符号链接、非普通文件和超限文件；测试覆盖 seed 不同、hash 损坏、manifest 越界。                                                                                               | 启动路径基本符合，运行中路径见下列缺陷。                                                   |

## 初始 P1 发现及修复复核

### 已修复 P1：启动后 Chunk 懒读取可穿越符号链接并先无界分配

`src/node/persistence/file-game-persistence.ts:141-145` 对已通过启动校验的 Chunk 直接执行 `readFile(join(directory, reference.path))`。这里没有调用已有的 `readBoundedFile()`，没有先拒绝符号链接，也没有在分配前按 `reference.bytes` 或 `maxBlobBytes` 限制读取量。长度与 hash 的检查发生在完整 `readFile` 之后。

已在 Node 22.23.2 做独立临时复现：保存一个合法 Chunk 并关闭；重开存储使启动全量校验通过；将该 blob 改名，再把原路径换成指向存储目录外、内容相同 blob 的符号链接；调用 `ensureSnapshot(0, 0, 0)` 成功，状态为 `found`。这证明实现会在运行中接受目录外内容，而非仅在损坏时失败。若目标是大文件，问题会先表现为无界内存读取，再进入长度/hash 错误。

修复已使运行中读取复用有界、拒绝符号链接的读取器，并以已打开 fd 的 `stat` 大小分段读取；新增回归覆盖「启动后替换为目录外 symlink」。这消除了初始 `lstat()` 后再 `readFile()` 的路径替换窗口。超过限制文件的运行中替换仍应作为单独回归补充，以固定资源上限行为。

同一类未经受限的存在性探测曾出现在 `file-store-manifest.ts` 的 `pointerExists` 和 `file-store-lock.ts`。复核时前者已改为 `lstat` 存在性检查，后者已统一使用受限读取；初始问题已关闭。

### 已修复 P1：相同 commitSequence 的 durable 身份没有明确约束

`src/node/persistence/file-game-persistence.ts:245-246` 仅拒绝小于当前的 `commitSequence`，因此 `publish()` 会接受相同序号但新 revision/内容的 frozen snapshot，并在 `323-328` 重新发布 CURRENT。独立 Node 22.23.2 复现：第一次 edit 后保存 `freezeSaveSnapshot(7)`，得到 `{ commitSequence: 7, worldRevision: 1 }`；第二次 edit 后再次保存 `freezeSaveSnapshot(7)`，也成功，CURRENT 变为 `{ commitSequence: 7, worldRevision: 2 }`。

合同将冻结 C、返回 durable C、动作 `executedCommitSequence`/`durableCommitSequence` 和重连因果关系绑定在一起。同一个 C 能改指向不同世界时，若只向调用方报告 C，durable 确认不再唯一，也会使 PREVIOUS 的解释不稳定。

这里**不能**简单把检查改成 `<=`：Dedicated 自动保存可在没有新权威动作时连续落盘，`GameSaveRuntime.save()` 的默认序号就是 0，合法自动保存会以相同 action sequence 携带更高 `worldRevision`。实现已选择保守的存储语义：仅允许 manifest hash 相同的幂等重试，内容改变时由调用方提供新的 commit sequence；回归覆盖同 C 幂等成功与同 C 内容改变失败/重启保持原检查点。该策略已经消除“一份 durable C 可指向不同内容”的歧义，但 Dedicated/Authority 宿主仍须在跨模块验证中证明会为实际自动保存生成可前进的 checkpoint 身份，不能让存储拒绝成为常态。

## 尚未形成准出证据的边界

### 缓存与异步读取

`snapshots` 和 `missing` 是没有容量、字节数、淘汰策略或并发去重的 `Map`/`Set`（`file-game-persistence.ts:60-61`）。`ensureNeighborhood()` 忽略传入的 `_residentKeys`（`160-170`），每次固定并发读取 27 个 key；持续访问不同已保存或不存在坐标会累积内存。`maxChunks` 只限制 manifest，不能限制运行期缓存。应把缓存容量与既有 canonical resident 上限绑定，给 missing 负缓存设定上限/TTL，并限制并发解码；补一个超过容量后的淘汰与重新读取测试。

### 锁、崩溃与本地文件系统

锁体记录 hostname、PID 和随机 token，但过期判定只有 `process.kill(pid, 0)`，没有可验证的进程启动身份。PID 已复用时实现保守地拒绝启动，符合「无法证实即 fail closed」，但恢复文档和测试应明确这是预期的人工清理/等待边界，而不是声称能识别同 PID 的旧进程。现有测试覆盖应用内抛错后的重开；没有实际子进程 `SIGKILL` 后重启的证据，也没有 Linux 本地文件系统运行记录。`fsync`、目录同步和同目录 rename 是正确的调用顺序，却不能替代 APFS 与目标 Linux 文件系统上的实际中止恢复验证，更不能外推到 NFS、SMB、overlay 或跨文件系统目录。

远端附件还要求部署 DRAINING 阶段「最终 durable checkpoint 成功才切换」和 ACTIVATING 阶段同一数据目录独占锁（`remote-environment.md:99-103`）。这份实现只提供存储原语；部署状态机、最终 checkpoint 失败时停止切换、release/config/存档备份与离线产物尚应由根任务在跨模块验证中补齐，不能由本评审代替。

## 执行记录

- Node：`/tmp/seedlands-node-22/node-v22.23.2-darwin-arm64/bin/node`，`v22.23.2`。
- 已通过：`PATH="/tmp/seedlands-node-22/node-v22.23.2-darwin-arm64/bin:$PATH" pnpm exec vitest run tests/node/file-game-persistence.test.ts --no-file-parallelism --maxWorkers=1`，15/15 通过，耗时约 4.14 秒。
- 独立负面复现：同一 Node 版本，以仅位于 `/tmp/seedlands-network-probe-persistence/` 的 Vitest 配置和两份临时测试运行，2/2 通过；覆盖上述 post-open symlink 接受和 same-sequence 内容改变。临时目录将在交付前清理，未写入仓库。
- 本评审没有执行 build、没有改 `package.json`、没有产生或检查部署 artifact；后续离线 artifact 测试应在根任务给出构建合同后，使用干净目录、固定 Linux x64 Node runtime、无开发依赖/无网络启动，并验证解包路径、链接、大小、manifest digest、临时测试世界的存储恢复和显式关闭。
