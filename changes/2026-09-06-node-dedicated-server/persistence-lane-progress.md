# Persistence lane 实施记录

## 接口

- `node-persistence-lane.ts` 导出 `createNodePersistenceLane(options)`。Worker 在 bootstrap 阶段只打开一次 `FileGamePersistence` 并持有目录锁；业务 `persistence-open` 只校验 Authority 身份并返回初始同步缓存，不再次打开目录。
- Authority 通过 `openNodePersistenceLaneProxy({ rpc, identity, limits })` 获得同时满足 `ChunkPersistence` 与 `GameplayPersistence` 的 proxy。`loadSnapshot`、`preparedSnapshotStatus`、`loadGameplaySnapshot` 和 `loadGameCheckpoint` 只访问本地缓存。
- 通用 RPC envelope 与 ledger 由 `src/node/runtime/node-rpc-*` 唯一实现；Persistence 层只定义业务 kind、DTO、逐类校验和缓存门禁。

## RED

- 2026-09-07：`pnpm exec vitest run tests/node/persistence-lane-proxy.test.ts`
- 结果：预期失败。Vitest 在收集阶段报告缺少 `src/node/persistence/persistence-lane-proxy.ts`，测试文件 1 个失败、0 个用例执行。该 RED 证明同步缓存与竞态合同先于生产实现落盘。
- 竞态复审 RED：proxy/handler 聚焦运行出现 2 个失败和 27 个未处理拒绝。失败分别证明保存超预算前已经发生两次 `structuredClone`、两个同 key prepare 中第二个误报 `missing`；未处理拒绝证明 neighborhood 为每个 key 派生拒绝 Promise。修正后共享单个在途 Promise、Worker 按 key 合并并为各调用者克隆结果，且先量算准入再复制。
- 关闭竞态 RED：受控首写屏障下，`close()` 后第二次 `saveFrozenSnapshot` 仍处于 pending，证明旧实现可能在等待期间替换 `saveTail`。修正为 close 启动时立即关闭写入准入、冻结已接纳 tail，并由幂等 `closePromise` 等待写入和锁释放。
- 元数据上限 RED：`maxCachedChunks=1` 时可同时创建 2 条 prepare 元数据。修正后驻留、missing 与在途 key 共用同一个条目上限。
- 物理关闭 RED：受控 Worker 将 `store-closed` 延迟 200ms，并把调用方 fake clock 推过 30 秒；旧 lane 在存储仍收尾时以“未确认存储锁释放”提前拒绝，遗留仍存活的 Worker/写者。修正后 lane 自身不设置提前完成期限，持续等待明确的 `store-closed`；调用方运行时的 deadline 只影响对外等待，后台关闭仍继续。
- 关闭失败 RED：真实篡改已持有 `LOCK` 的 token 使锁释放失败；旧 Worker 只发送 fatal，仍保留 RPC、端口和物理 thread。修正后先暴露 fatal，再关闭 RPC 并等待已开始 handler 真正结束，最后关闭控制端口退出；lane 的 `close()` 等物理退出后才以原失败结算，保留损坏锁文件作为人工核验依据。

## GREEN

- `pnpm exec vitest run tests/node/persistence-lane-proxy.test.ts tests/node/persistence-lane-handler.test.ts tests/node/persistence-lane-worker.test.ts tests/node/file-game-persistence.test.ts`
- 结果：4 个测试文件、38 个用例全部通过。覆盖同步热缓存、乱序/evict token、missing 与在途元数据上限、保存 ACK 版本门禁、真实 Worker thread、RPC 保存、目录锁竞争、重启恢复、无业务握手关闭、Worker 意外退出、延迟物理关闭、关闭失败物理退出、阶段测量状态跨 RPC 保留，以及文件存储发布与 close 竞态。
- 对本批源码和测试执行 ESLint，通过且无输出；Prettier 已写入且复查无差异。
- `pnpm exec vitest run tests/client/browser-chunk-persistence.test.ts tests/app/mesh-preparation-telemetry.test.ts`：2 个文件、18 个用例通过，证明可选 `measurementStatus` 没有破坏旧浏览器 Store 的解析与现有 UI 遥测。
- `pnpm exec tsc --noEmit`：通过且无输出。`pnpm exec tsc -p tsconfig.test.json --noEmit` 中本批 Persistence 测试无报错，但命令仍被并行开发中的 network projection 与 Authority 测试类型错误阻断，未记录为整体通过。

## 当前状态

- 已完成业务协议、proxy、Worker handler/入口、main factory、真实 `MessagePort` RPC 和同步缓存接线。Worker bootstrap 只打开一次目录；业务 open 只做身份握手。
- `NodePersistenceLane.close()` 以明确 `store-closed` 作为成功门禁，随后才终止 Worker；fatal、error 或未确认 store close 的提前退出均保持失败，不能把仍在收尾或仍持锁的 writer 伪报为已关闭。
- `NodePersistenceProxyBootstrap` 完整携带 `identity`、cache limits、resolved RPC limits 和 generation，Authority 不会从另一份根级配置重新推导限制。
- 业务 `payloadBytes` 使用共享的 `measureNodeRpcBytes` 按 UTF-8 字符串、DTO tag 与 TypedArray/ArrayBuffer 实际长度确定性计量。曾采用的 `node:v8 serialize` 长度会跨 isolate 漂移，已在真实产物暴露并移除；切换后 proxy/handler/真实 Worker 聚焦 15/15 通过。
- 当前聚焦验证运行于本机默认 Node 26。Node 22 正式产物、Authority/main 组合与 CLI 退出链由主线统一验证，本记录不提前宣称通过。
- Linux 设备断电、真实 fsync 介质行为和 A13 分阶段/资源收益尚未验证。

## 指标边界

2026-09-07 补充阶段诊断 RED：文件存储和真实 Worker RPC 返回的 `measurementStatus` 均为 `undefined`，证明旧实现会把未采集/不适用阶段的零值冒充实测。修正后：

- `transactionReadMs` 实测每个 Chunk 的受限文件打开、读取、长度与 hash 校验耗时之和；`decodeMs` 实测各 Chunk 解码耗时之和。两者是累计操作时间，可因并行读取大于 `totalWorkerMs`，不能解释成互斥的批次 wall-clock 分段。
- `totalWorkerMs` 是 Persistence Worker 处理一次 neighborhood 的实测 wall-clock；`roundTripMs` 是 Authority proxy 发出 RPC 到完成并等待重叠 prepare 的实测 wall-clock。
- Worker handler 入口观察不到通用 RPC server 内部排队起点，因此 `queueWaitMs` 保留兼容数值零并明确标为 `not-collected`。Node 文件存储不使用数据库，`databaseMs` 保留兼容数值零并标为 `unsupported`。直接调用 `FileGamePersistence` 没有业务队列，其 `queueWaitMs=0` 标为 `measured`。
- `measurementStatus` 是向后兼容的可选字段；旧浏览器 Store 不提供该字段时，只代表历史合同没有声明测量状态，不能推断所有阶段已经实测。
- 真实 Worker 用例已证明 status 经业务 codec 与 MessagePort 往返后完整保留。Node 新报告必须同时读取数值与 status；报告接线尚未完成前，不宣称 A13 分阶段采集已经闭环。
