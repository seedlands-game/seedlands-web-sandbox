# Node 文件持久化评审修复记录

## 行为与边界

- `FileGamePersistence.open()` 仍同步读取并验证 `CURRENT` 指针、manifest、Gameplay blob，以及所有 Chunk 引用的路径、长度上限、hash 格式、坐标、revision 和 codec 元数据；它不再读取 Chunk blob 内容。Chunk 的 bytes/hash、世界身份、生成器版本、坐标、revision、codec 与 fluidVersion 在首次 `ensureSnapshot()` 时一起验证，失败后实例维持 fail closed。
- `inspectPreviousCheckpoint()` 保留原合同：显式检查 `PREVIOUS` 时读取并验证其所有 Chunk blob。启动时若 `PREVIOUS` 无法完成 manifest/Gameplay/引用元数据验证，则保留既有 `CURRENT` 启动路径，但跳过本次 GC，不在可达集不完整时删除文件。
- 检查点切换顺序未改变：写入不可变 Chunk/Gameplay、写入不可变 manifest、durable 更新 `PREVIOUS`、durable 更新 `CURRENT`。GC 只在持有目录写者锁且 `CURRENT` 已 durable 后运行，并从磁盘重新读取 `CURRENT` 与 `PREVIOUS` 来构造可达集。
- GC 只识别 `blobs/(chunk|gameplay)-<sha256>.json` 和 `manifests/manifest-<sequence>-<sha256>.json` 普通文件；其他名称、目录和符号链接不进入删除候选。删除后同步对应目录。这样既回收每次保存产生的第三代及更旧文件，也在下次启动时回收未被指针采用的崩溃孤儿。
- 活跃 Chunk 按需读取在开始 I/O 前登记，GC 等待这些读取结束；`close()` 禁止新读取并等待已登记读取后才释放锁，避免下一实例回收上一实例仍在读取的文件。同一 Chunk 与保存交错时，旧引用的读取结果不会覆盖保存刚发布的新缓存。保存仍由原 `saveTail` 串行化。
- 磁盘格式、锁文件、`CURRENT/PREVIOUS` 恢复入口、Gameplay eager 校验和损坏拒绝语义均未改变。

## RED 与验证证据

- RED：`pnpm vitest run tests/node/file-game-persistence.test.ts`，23 项中 3 项失败、其余 20 项通过。失败分别证明第三次保存仍留下第一代 manifest；损坏 Chunk 导致 `open()` 提前失败；manifest/blob revision 不一致也在 `open()` 提前失败。
- GREEN：`tests/node/file-game-persistence.test.ts` 与按 GC/close 职责拆出的 `tests/node/file-game-persistence-lifecycle.test.ts` 共 26/26 通过；覆盖 Chunk 引用长度上限、`PREVIOUS` 显式检查、manifest/blob 原元数据、目录符号链接拒绝和关闭时读锁生命周期。长度负例会篡改 manifest 并重算 pointer hash，证明拒绝发生在 Chunk 文件 I/O 前。
- 相关 Node 持久化与崩溃恢复：`pnpm vitest run tests/node/file-game-persistence.test.ts tests/node/file-game-persistence-lifecycle.test.ts tests/node/persistence-lane-handler.test.ts tests/node/persistence-lane-proxy.test.ts tests/node/persistence-lane-worker.test.ts tests/node/node-server-crash-recovery.test.ts`，6 个文件、44/44 通过。
- 类型：`pnpm --filter @seedlands/node-server typecheck` 与 `pnpm exec tsc -p tsconfig.active-node-tests.json --noEmit` 均通过。
- 质量：受改两个源码文件与测试文件的 ESLint 通过；受改源码、测试和本记录的 Prettier check 通过。

## 剩余风险

- 启动仍需对 manifest 中每个 Chunk 引用做 O(n) 的内存元数据校验，这是防止恶意或越界索引进入按需路径的保留门禁；本次证据证明不再做 O(n) Chunk 文件 I/O，不是启动性能基准。
- GC 位于 `CURRENT` 提交后；若目录删除或 fsync 失败，保存调用会失败并使实例进入既有失败状态，而 durable 的新检查点可能已存在。该窗口与既有 `after-current-pointer` 故障合同一致，重启仍从完整 `CURRENT` 恢复并重新尝试孤儿回收。
- 本次没有改变多进程只读者模型；文件协议继续以单目录写者锁和当前进程内的按需读取登记为边界。
- GC 枚举前会用 `lstat` 拒绝被静态替换为符号链接的存储子目录；目录在 `lstat` 后被外部进程并发换链的 TOCTOU 防护需要 dirfd/openat 级平台实现，不在本次单写者合同范围内，也未宣称已验证。
