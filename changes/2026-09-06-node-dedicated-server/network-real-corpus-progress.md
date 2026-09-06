# 真实 Host 参考投影进度

## 目标与边界

本子任务只增加 codec 无关的公共参考投影和真实 Host fixture，为 N2 后续真实 corpus 做准备。`NetworkReferenceProjection` 明确不是最终 wire v1：不引入 transport、codec、鉴权、GUI 或 Node 监听，也不修改既有网络消息/codec 文件。

## 准出合同

1. `AuthoritySnapshot` 投影为独立 clone 的 player correction，保留 string epoch、signed `acknowledgedInputSequence`（含 `-1`）、physics/commit/world revision、浏览器环境消费的 `worldTime`、权威 body/grounded 与按 key 稳定排序的 collision revisions；不带当前浏览器未消费的 `worldMutationCount`、contacts 或 diagnostics。
2. `AuthorityGameplayView` 投影只保留 UI player/inventory/recipes 与实际可表现的 world-item/creature/npc（含 presenter 使用的 health/maxHealth）；每个 view 以 epoch、所属 snapshot physics/commit/world revision 锚定，供跨 stream 清理旧 epoch；不带 metrics、完整 actor state、player entity 或未白名单字段；浮点必须保持 f64 值。
3. `WorldCommitResult` 投影只保留所属 publication snapshot 的 `publicationCommitSequenceUpperBound`、`causalCommitSequence: null`、结构 Chunk revision 与允许的 collision delta；上界明确不是单个 commit 的精确因果索引，不得把 `worldRevision` 冒充 commit sequence，也不得泄漏 semantic event `data`、metrics 或 unknown 扩展数据。
4. 每项在真实 `DedicatedServerHost` + `MemoryGamePersistence` fixture 中取得 Authority runtime 的 snapshot/view/commit，并经过 `World.edit()` 生产路径触发 commit；结果不共享可变引用。
5. 投影器拒绝不支持 entity type/archetype、非有限坐标/速度、无效 cell、非法 revision 与未知/越界 inventory 映射；错误不返回部分 DTO。

## RED 设计

- `tests/server/network-reference-projection.test.ts` 先从尚不存在的 `src/server/protocol/network-reference-projection.ts` 导入投影器，证明测试在实现前不可解析。
- fixture 使用固定测试 seed、`DedicatedServerHost.create()` 与 `MemoryGamePersistence`，推进 runtime、通过 Host 的 `World.edit()` 产生真实 commit；不构造假 archetype/Chunk。
- 覆盖 `ack=-1` 初始 correction、已确认 input 后 correction、真实 gameplay entity 白名单、真实 commit/delta、独立 clone、diagnostics/metrics/actors/semantic data 排除与拒绝边界。

## 当前状态

- 已完成：字段合同已发 root；只读确认 AuthoritySnapshot、AuthorityGameplayView、WorldCommitResult 和浏览器消费者。
- 进行中：等待字段合同确认后写 RED 与生产投影。
- 已完成：change-local recorder 从同一真实 Host publication 构造 welcome/correction/gameplay/commit 的 metadata UTF-8 投影样本，并从 `readCollisionBaseline()` 保留完整 canonical/fluid 二进制块、typed length/revision 与注入的 SHA-256。welcome/baseline 均是 `wireStatus: not-adopted` reference；未提供实际 action receipt 时才记录 `NOT_COLLECTED`。它不是 wire encoder。
- 未开始：正式 recorder 落点、codec、wire v1、网络、GUI 和计时。

## RED 与实现记录

- RED：`pnpm exec vitest run tests/server/network-reference-projection.test.ts --no-file-parallelism --maxWorkers=1` 在投影模块不存在时失败，错误为找不到 `src/server/protocol/network-reference-projection`。
- GREEN：新增 `network-reference-projection-types.ts` 和 `network-reference-projection.ts`。`PlayerCorrectionReference` 带浏览器环境使用的 `worldTime`；`GameplayViewReference` 带 epoch 及同 publication snapshot 的 physics/commit/world revision 锚点；`WorldCommitReference` 只接受同一 publication 的 `{ epoch, publicationCommitSequenceUpperBound }` context，并以 `causalCommitSequence: null` 明示不能从中推导单个 commit 的精确序号。`GameplayViewReference` 保留 presenter 使用的 entity health/maxHealth、stack 与 archetype；省略 `spawnPosition`、world mutation count、metrics、actors、diagnostics、contacts、semantic events 和 unknown payload。新增 `network-reference-bootstrap*`：welcome 对 Host 未提供的 world/session/config 使用显式 context，校验字段与 limits 关系，只声明空 capability、`wireStatus: not-adopted`；baseline 只接受真实 available 结果、固定 cell 大小、复制 raw buffer 并经注入 digest 端口校验 SHA-256 格式。
- 真实 fixture：固定测试 seed 的 `DedicatedServerHost` 与 `MemoryGamePersistence` 生成 snapshot/view；commit 通过 `host.runtime.server.edit()` 的 `GameServer.edit()`→`World.edit()` 生产路径获得，再以 `commitHostActivation()` 取得同 publication 的 snapshot 上界。没有手写实体 archetype 或 Chunk。
- 当前验证：`pnpm exec vitest run tests/server/network-reference-projection.test.ts --no-file-parallelism --maxWorkers=1` 通过 7/7，覆盖真实 Host snapshot/view/World.edit、welcome context 与由 `runDedicatedComputeTask()` 得到后经 `acceptGeneratedChunk()`/`readCollisionBaseline()` 查询的 baseline；额外拒绝 player id 与 snapshot 不一致、非枚举频率及超越 snapshot 的虚假 durable checkpoint。change-local corpus runner 使用 `pnpm exec vitest run --config changes/2026-09-06-node-dedicated-server/e2e/vitest.real-corpus.config.ts --no-file-parallelism --maxWorkers=1`，通过 1/1：welcome、correction、gameplay、commit、baseline metadata/binary hash，以及由真实 `host.performAction(select-hotbar)` 与 `projectActionReceiptReference()` 得到的 receipt 均被捕获。长期 `tests/server` 不再导入 change recorder，避免 Delivered/Archived change 反向成为基线依赖。`uint16-source-buffer` 仍未成为网络字节序合同，N2 前须归一为 LE 或显式核验实际字节序。`pnpm exec tsc --noEmit` 通过；tests 类型检查当前仅被并行改动的 `tests/node/authority-lane-protocol.test.ts:99` readonly `entities` 赋值阻断。Prettier、ESLint 与 `git diff --check` 通过。未运行 coverage、benchmark、codec 或 transport。
