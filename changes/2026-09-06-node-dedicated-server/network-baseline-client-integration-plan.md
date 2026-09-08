# 基线完整输入的真实客户端接线测试计划

## 目标

本切片只新增一个 change-local Node 集成测试，串联冻结的 r2 基线投影、实际 C0 解码 artifact、生产 `createBaselineReferenceReassembler()`、`createNetworkBaselineConsumer()`、`MeshTaskScheduler` 的 `authority-complete` source 与真实 `runWorldComputeTask()`。它验证参考数据在接收后的缓存、完整输入副本、worker 派生结果核对和调度完成之间没有偷偷退回本地生成路径。

这不是网络监听、正式 wire 采用、浏览器 GUI、GPU 上传、兴趣授权或远端可玩性的验收。测试使用可信 fixture adapter 从同一 descriptor 建立 owner，仅模拟已经完成认证和兴趣授权后的组合层；不从 page 反推 owner，也不实现测试 reducer。

## 冻结输入与 pin

测试只读以下已有目录，不导入其中脚本：

- `/tmp/seedlands-network-baseline-reference-projected-v1-r2/manifest.json`、`frames.jsonl` 与 descriptor 指向的 page 文件；
- `/tmp/seedlands-network-probe-codec-baseline-reference-v1/baseline-codec-decoded-artifact.json`；
- 本 change 已记录的 `network-baseline-codec-evidence.json`。

初次闭环只选择 artifact 的 `C0` 记录与 `reference-000-unmodified-mesh`。测试固定检查 r2 manifest/frames 和 raw corpus 的 SHA-256 pin；codec artifact 的目录与 artifact SHA-256 从当前 `network-baseline-codec-evidence.json` 读取后再逐字节核验，避免把历史 v1 原型目录误当当前准入。descriptor、page locator、arrival 顺序和原始 block hash 必须与 r2 frame 一一对应。C1/C2 在相同 test helper 可复用后另行扩大，不以 C0 成功宣称三种候选都已接入客户端。

## 生产链与最小 adapter

1. 使用生产 reassembler 对 C0 descriptor/page 的真实抵达顺序完成哈希、长度与 little-endian 校验。
2. 从该 descriptor 的可信字段构造唯一 mesh owner：`ref`、`requestId`、`interestId`、`purpose`、main `key`、`generatorVersion` 与 main-first 27 项 `{key, minimumRevision}`。创建专属空 `Map` 与 `AuthorityCollisionRevisionGuard` 后调用生产 consumer 的 `registerOwner()`、`accept()`、`snapshotForWorker()`。
3. `MeshTaskSource` 仅取 `kind: 'authority-complete'`：`prepareCompleteWorkerInput()` 返回该 snapshot lease；`acceptDerivedMesh()` 调用同一 owner 的 `consumer.acceptWorkerResult()`。该 source 不含 `acceptWorkerCanonical()`。
4. typed test worker port 用 `structuredClone(message, { transfer })` 接收真实调度消息，保存已 detach 的 main-side block；其 `finish()` 调用真实 `runWorldComputeTask()`，再把结果经 port 回调交回 scheduler。它不代替 mesh 或 consumer 的算法。
5. consumer 成功接纳 worker result 后，测试读取真实 collision map 和 diagnostics；调用 consumer 的 `consumeCollisionCommits()` 处理一个由同一 r2 overlay key/revision 推导的 overlay-only structural commit。该 bridge 必须先更新 consumer 的 owner/preparation 水位，再复用现有 collision mirror 发布与 apply 路径，并在删除 shared cache 时同步回收 collision 账本。测试不得直接调用 `publishAuthorityCollisionCommits()` 绕开 consumer。此处只验证既有 commit API 与 consumer 水位协作，不把该构造 commit 误称为 r2 的真实 WorldCommit 语料。

## 预期 RED 与验收

先运行新测试并记录实际 RED；若 production consumer/scheduler 尚未冻结导致类型、公开方法或断言失败，保留严格断言并把具体问题反馈 root/Sol，不在测试中补 mock、cast 绕过或放宽下列条件。

- r2/C0 pin、descriptor/page 身份与原始 canonical/fluid SHA-256 全部匹配；reassembled bytes 的 `DataView.getUint16(..., true)` 数值与 consumer 后的 canonical 相符。
- worker snapshot 有 54 个互异 buffer；`structuredClone(..., { transfer })` 后 main side buffer 已 detach，而 consumer cache 和 worker-side任务输入仍保持可读、原始 hash 不变。
- 真实 worker result 具有同一 `haloRevision`、`authorityComplete=true`、`proceduralVoxelSamples=0`、`macroContextCount=0`；scheduler 只走 `acceptDerivedMesh()`，consumer 返回 true，且 `onAcceptedResult` 恰一次。
- overlay-only revision 上升经 `consumeCollisionCommits()` 先使该 owner stale、释放 preparation 并更新 shared collision 账本，再走真实 unknown-baseline 门；旧 worker result 因 owner stale 被拒绝，未知 revision 不被 collision guard 的 `satisfy()` 静默放行。
- 每个 finally 都结束 reassembler、scheduler、consumer snapshot lease；最终 reassembler reservation、consumer `workerTransferBytes` 和 active snapshot 数均为零。

执行 Node 22 定向 Vitest、目标 Prettier/ESLint 与 test typecheck；不执行全仓 coverage、build、浏览器或 benchmark。

## 文件边界与状态

仅新增：

- `changes/2026-09-06-node-dedicated-server/e2e/network-baseline-client-integration.test.ts`；
- `changes/2026-09-06-node-dedicated-server/e2e/vitest.baseline-client-integration.config.ts`；
- 必要时同目录的只读 fixture reader helper。

不改 consumer、scheduler、worker、投影、原型或 r2 语料。

## 当前证据

- 预期 RED：新 test 首次在空路径上无法提供该 integration target；实现后第一次实际运行还暴露了测试自身把 `Uint16Array.byteLength` 错当元素数量，已改为 `.length`，不涉及生产行为。
- 语义校正：`AuthorityCollisionRevisionGuard.isReadable(key, minimumRevision)` 表示版本水位满足，不表示 cache 已存在；用例改为验证旧 revision 不可读，并同时验证 unknown callback、cache 删除和 consumer 账本回收。
- GREEN：Node 22.23.2 定向 Vitest 1/1；该三份新增文件的 Prettier、ESLint 与 diff check；`pnpm typecheck`（含 test tsconfig）均通过。
