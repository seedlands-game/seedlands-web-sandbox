# 网络基线消费计划

## 目标与阶段边界

本计划定义一个平台无关的客户端基线 consumer。它接收已经由
`BaselineReferenceReassembler` 完成长度、little-endian 与 SHA-256 校验的
`ReassembledBaselineReference`，再把可信 session adapter 登记的 owner 与 bundle 身份、27 项 mesh
版本向量或 1 项 collision-resync 版本绑定起来。成功接纳后，它为现有碰撞镜像安装可变副本，并把未来
`authority-complete` mesh worker 所需的不可变 block 放入按内容身份共享的 preparation cache。owner 只保存
27 项引用，不为每个重叠兴趣重复复制约 2.65 MiB 数据。

本切片只覆盖纯消费、缓存、预算、owner 生命周期和 worker snapshot 的正确性。它不实现网络 listener、认证、
interest 授权、实际 wire、World/scheduler 接线、GPU 生命周期、GUI 或默认远端开关。输入 DTO 仍是
`wireStatus: 'not-adopted'` 的参考对象，预算值必须由调用方显式注入，不能据此选择正式 page 大小或 transport。

以下七个已冻结的 producer/protocol 模块不在本切片修改：

- `network-reference-baseline.ts`
- `network-reference-baseline-types.ts`
- `network-reference-baseline-validation.ts`
- `network-reference-baseline-budget.ts`
- `network-reference-baseline-owned.ts`
- `network-reference-baseline-publication.ts`
- `network-reference-baseline-reassembly.ts`

`ReassembledBaselineReference` 证明 block 的引用身份、长度、little-endian 字节与 hash 已通过参考层校验，但不证明
owner 有权使用该 bundle。consumer 必须用可信 adapter 的 active owner 再做一次业务关联；不能因 reassembler
返回成功而跳过 session、request、purpose、key、generation 或版本门禁。

## 已核实的现有消费事实

1. `acceptAuthorityMeshPreparation()` 只以 main key/revision 调用
   `AuthorityCollisionRevisionGuard.accepts()`；旧 `AuthorityMeshPayload.overlays` 没有 revision。因此新 bundle
   不能先降级成旧 payload，再声称 27 项均已验证。
2. `cacheAuthorityCollisionBaseline()` 会调用 `guard.satisfy()`，而 `satisfy()` 会清空该 key 的
   `minimumRevision`。它适合维护实际碰撞可读性，但不能兼任 mesh preparation 的完整版本水位。
3. `createProceduralMeshInput()` 会在缺 canonical/overlay/fluid 时生成或推导 fallback。远端完整输入必须在进入该
   函数前拒绝缺项；真实验收要求 `proceduralVoxelSamples = 0`、`macroContextCount = 0`。
4. 当前 worker-first `haloRevision` 只是 `worker-input-${sequence}`。后续已规划的完整 worker 接缝使用
   `inputStrategy: 'authority-complete'`，要求 main canonical/fluid 和 26 个 overlay canonical/fluid 均完整，
   每项携带已验证的 key/revision/generatorVersion，并原样回显由 consumer 形成的非空 `haloRevision`。
5. `publishAuthorityCollisionCommits()` 按 `structuralChange.chunkRevisions` 更新碰撞要求，但 mesh 调度目前主要看
   `meshChunks`。consumer 必须按全部 chunk revision 建反向依赖，不能只使直接列入 `meshChunks` 的主项失效。
6. `AuthorityCollisionRevisionGuard` 的 commit 窗口和 baseline lease 处理碰撞重同步；它不是完整的严格网络重排器，
   也不保存每个 mesh owner 的 27 项版本身份。

## 可信 owner 与最小公开 API

计划新增的中立类型放在 `src/client/authority/network-baseline-consumer-types.ts`。该文件只可依赖
`src/server/protocol` 的参考 DTO 与中立 world 类型，不得导入 `src/app/**`、DOM、Worker global 或网络实现。

```ts
type NetworkBaselineOwnerRef = Readonly<{
  ref: InterestSessionRef;
  ownerId: number;
  ownerGeneration: number;
  requestId: number;
  interestId: number | null;
  purpose: 'mesh' | 'collision-resync';
  key: string;
  generatorVersion: number;
  expectedEntries: readonly Readonly<{
    key: string;
    minimumRevision: number;
  }>[];
}>;

type NetworkBaselineConsumerLimits = Readonly<{
  ownersMax: number;
  sharedCollisionBytesMax: number;
  sharedPreparationBytesMax: number;
  workerTransferBytesMax: number;
}>;

type NetworkBaselineOwnerHandle = Readonly<{
  ownerId: number;
  ownerGeneration: number;
}>;

type NetworkBaselineWorkerSnapshotLease = Readonly<{
  input: AuthorityCompleteMeshInputReference;
  settle(): void;
}>;
```

`expectedEntries` 由已完成认证和 interest/collision 授权的 adapter 产生。mesh 必须恰有 27 项，第一项为 main，
其后是明确的 26 项邻域顺序；collision-resync 必须恰有目标 key 一项。consumer 不根据客户端请求重新生成授权
邻域，也不从 bundle 反向建立 owner。`minimumRevision` 逐项绑定 owner 创建时的版本下界，而不是只检查 main。

建议最小 factory 与操作如下：

```ts
createNetworkBaselineConsumer({
  limits,
  collisionChunks, // 必须为空，并由该 consumer 专有
  collisionGuard, // 必须为该 consumer 专有
}): NetworkBaselineConsumer;

type NetworkBaselineConsumer = Readonly<{
  registerOwner(owner: NetworkBaselineOwnerRef): NetworkBaselineOwnerHandle;
  accept(
    owner: NetworkBaselineOwnerHandle,
    bundle: ReassembledBaselineReference,
  ): NetworkBaselineAcceptResult;
  snapshotForWorker(owner: NetworkBaselineOwnerHandle): NetworkBaselineWorkerSnapshotLease | null;
  acceptWorkerResult(
    owner: NetworkBaselineOwnerHandle,
    result: Readonly<{
      key: string;
      chunkRevision: number;
      generatorVersion: number;
      haloRevision: string;
      canonical: ArrayBuffer;
    }>,
  ): boolean;
  observeChunkRevisions(revisions: readonly Readonly<{ key: string; revision: number }>[]): readonly number[];
  releaseOwner(owner: NetworkBaselineOwnerHandle): void;
  close(): Promise<void>;
  whenIdle(): Promise<void>;
  diagnostics(): NetworkBaselineConsumerDiagnostics;
}>;
```

`ownerId` 与 `ownerGeneration` 是可信 adapter 的本地生命周期标识，不是公开 bundle 字段。一次 consumer 实例内，
owner generation 注册必须严格递增；active handle 以 consumer 内部不可伪造 token 与 id/generation 共同匹配。
owner 释放后，迟到 bundle、迟到 worker snapshot 请求和旧 handle 都拒绝。只保存 active owner 与一个标量 generation
高水位，不为所有历史 owner 保留永久 tombstone。

`ref`、`requestId`、`interestId`、`purpose`、main `key` 与 `generatorVersion` 必须同时匹配 descriptor 和 owner。
mesh 的 `interestId` 必须非空；collision-resync 是否允许空 interest 已在上游可信授权完成，本层只要求与 owner
一致。consumer 不接受调用方临时传入另一套 expected identity，避免验证目标与实际 owner 分离。

## bundle 验证与显式 LE 读取

`accept()` 必须是同步、无 `await` 的事务边界。它按以下顺序执行：

1. 复制并验证 owner handle；核对仍 active、generation 未过期、consumer 未 closing。
2. 严格核对 descriptor 的 ref/request/interest/purpose/key；验证 27/1 数量、entryId 连续、role、key 顺序和唯一性。
3. 逐项核对 `entry.key === expectedEntries[i].key`、`entry.generatorVersion === owner.generatorVersion`，且
   `entry.chunkRevision >= expectedEntries[i].minimumRevision`。不得用 main revision 代表 overlay。
4. 确认 reassembled entry 与 descriptor 的 entryId 一一对应，数组稠密，无缺项、重复项或额外项；两个 block
   均为独立 `Uint8Array`，长度分别为 65,536 B 与 32,768 B。
5. 先直接用 source `DataView.getUint16(offset, true)` 与已有共享值逐值比较，并按
   `(key, chunkRevision, generatorVersion)` 计算本次新增的共享不可变 block、新共享碰撞副本与目标转换字节。所有
   source view 的 byteOffset/byteLength 都必须生效，不能读取其 backing buffer 的额外区域。相同身份但字节不同
   必须返回 `conflicting-content`，不能任选一份覆盖。
6. 在任何 LE 目标、fluid 副本、cache 或 owner 表分配前，同步取得全部预算。预算不足返回明确结果，零大数组
   分配、零部分安装、零 owner 反向依赖变化。预算成功后，canonical 才用
   `DataView.getUint16(offset, true)` 逐值写入新的 `Uint16Array`；不能对 LE bytes 的 `buffer` 直接构造本机端序视图。
   fluid 同样在准入后复制为新的 `Uint8Array`。
7. 再次核对 handle 仍是入口捕获的 active token。JavaScript 同步段内调用现有
   `cacheAuthorityCollisionBaseline()` 安装独立可变 collision 副本；全部调用成功后才公开共享 immutable
   block 引用与 owner 反向索引。调用前已预检 guard 和当前 cache，故不得依赖中途失败回滚。

mesh 的任一现有 collision cache revision 高于 bundle 对应 revision 时，整个 mesh preparation 返回
`superseded`，不能把较新 collision 与较旧 overlay 凑成一个版本向量。collision-resync 的已有 cache 更高时可返回
`satisfied-by-newer`，不覆盖新值，也不额外保留传入 block。低于最低 revision 或 guard 不接纳时均 fail closed。

`accept()` 不把 reassembler 的字节 view 保存在 cache 或 preparation 中。碰撞镜像和共享 immutable block
分别拥有副本；调用者在返回后修改、清零或释放 reassembled bundle 不影响 consumer。owner preparation 只保存
不可变 block identity/ref 与完整版本向量，不能暴露可写 typed array。

## 三类内存账本与原子安装

限制值全部由测试或未来 adapter 显式传入，没有隐藏默认值：

| 账本                     | 计量内容                                                                                               | 释放时点                                                            |
| ------------------------ | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| `sharedCollisionBytes`   | 每个被一个或多个 owner 共享的 key 的 mutable canonical/fluid 副本                                      | 最后一个 owner 释放，或失效后实际删除                               |
| `sharedPreparationBytes` | 每个唯一 `(key, revision, generatorVersion)` 的 immutable canonical/fluid block；重叠 owner 只增加引用 | 最后一个引用释放、版本失效完成或 close                              |
| `workerTransferBytes`    | 每次 worker snapshot 新复制的 54 个 buffer                                                             | post 失败、任务成功/失败/取消后的物理 settle、worker exit 后 settle |

转换输入时的短暂 LE source、`Uint16Array` 和目标 cache/preparation 可能同时存在；diagnostics 必须把无法由上述
持久账本约束的峰值标为 `NOT_COLLECTED`，不得把三个上限相加后称为浏览器进程总内存上限。未来 transport、
reassembler、GPU、worker isolate 和 mesh result 另有账本。

共享碰撞 cache 按 key 建 `owners: Set<internalOwnerToken>`。共享 preparation cache 另按
`(key, chunkRevision, generatorVersion)` 建 immutable block 与引用计数。多个重叠 mesh 或 collision owner 引用同一
key 时只保留一个当前 mutable collision cache；多个 mesh owner 引用同一版本时也只保留一份 immutable block。
释放其中一个 owner 不调用 `collisionGuard.release()`，不删除该 key，也不释放其它 owner 的 immutable 引用。只有
最后一个相关 owner 离开后才释放对应 guard/key 或 block。factory 只接受空的专有 collision Map 和新的专有
guard；非空 Map 必须拒绝。当前不提供混合系统 external ownership callback，避免一个未经验证、无人消费的所有权
模式误删浏览器旧路径缓存。

替换同一 owner 的 preparation 时，先验证所有已有共享 identity 的内容一致性，只为新的唯一 identity 预留和复制，
再同步切换 active 引用与反向依赖，最后递减旧引用。预算不得先释放旧值再尝试新值，否则失败时会丢掉仍有效的旧
preparation；也不能先公开新对象后才发现共享 collision 预算不足。测试与 diagnostics 必须按实际新增的每种字节
收费，不能按“每 owner 固定 2.65 MiB”估算，也不能凭空扩大 cache 上限掩盖重复复制。

## 独立版本水位与反向失效

consumer 保存两个与 `AuthorityCollisionRevisionGuard.satisfy()` 分开的结构：

- `acceptedRevisionByKey`：活跃 owner 仍引用该 key 时已接纳的最高 revision；较低 bundle 不回退。
- `ownersByDependencyKey`：每个 key 反向指向所有依赖它的 mesh/collision owner 和该 owner 接纳时的 revision。

`observeChunkRevisions()` 接受未来 adapter 从已验证 `WorldCommitPresentationReferenceV2.structuralChange` 取得的
完整 `chunkRevisions`。它先验证数组稠密、key 唯一、revision 为非负安全整数，但只为仍有 owner 的 key 更新水位，
不因任意未拥有的 commit key 创建永久表项。某 revision 高于 owner preparation 中记录的 revision 时，先同步标记该
owner stale、禁止新 worker snapshot，并递减该 owner 的 immutable block 引用；函数返回受影响 ownerId，供后续
scheduler 重新请求。已经复制给活跃 worker 的 buffer 仍由 worker transfer lease 持有，直至物理 settle 才减账。
最后一个 owner 释放后可回收该 key 的水位；新 owner 的最低 revision 必须由可信 adapter 从当前 snapshot/commit
重新建立。本层只保证活跃 owner 生命周期内不回退，不承诺保存全历史 revision map。它不自行修改 World、GPU 或发包。

失效必须遍历全部 `chunkRevisions`，不只遍历 `meshChunks`。碰撞 delta 的实际修改仍由现有
`publishAuthorityCollisionCommits()` / `applyAuthorityCollisionCommit()` 路径完成；consumer 不重写第二套碰撞
reducer。`collisionGuard.satisfy()` 清空自身 minimum 后，不清除仍有活跃 owner 的 `acceptedRevisionByKey` 或 mesh
依赖水位。

同一次 commit 接线的顺序由未来 adapter 固定为：先调用 consumer 的 `observeChunkRevisions()` 阻止旧
preparation 发起新任务，再交给现有碰撞 commit 应用，最后通知 scheduler。这个顺序尚未接入生产 World。

## authority-complete worker snapshot 接缝

本计划与 `network-complete-baseline-worker-plan.md` 当前冻结设计对齐；其设计 SHA-256 为
`26cb6631a2a7e01c6b8f4d0477b8d795f78f7cc0fc3b448c73ac2db724301cd0`，已经主线审批。consumer 先输出不导入
`src/app/**` 的中立 `AuthorityCompleteMeshInputReference`，后续 app adapter 再映射到
`WorkerInput` / `GenerateMeshTaskPayload`：

```ts
type AuthorityCompleteMeshInputReference = Readonly<{
  inputStrategy: 'authority-complete';
  key: string;
  chunkRevision: number;
  generatorVersion: number;
  haloRevision: string;
  canonical: Uint16Array;
  fluid: Uint8Array;
  overlays: readonly Readonly<{
    key: string;
    chunkRevision: number;
    generatorVersion: number;
    canonical: Uint16Array;
    fluid: Uint8Array;
  }>[];
}>;
```

`haloRevision` 由 consumer 对可信 ref、owner generation、main key 和规范顺序的 27 项
`(key, chunkRevision, generatorVersion)` 生成确定性、长度前缀明确的版本身份。它不使用异步 hash，也不只使用
main revision。worker 只验证并透传该字符串；scheduler/result 接纳必须同时核对任务 epoch、main revision 与完整
`haloRevision`。同一版本向量跨 owner generation 也得到不同身份，避免旧 session/owner 的迟到结果被新 owner
接纳。

`snapshotForWorker()` 先预留完整 `workerTransferBytes`，再从共享 immutable preparation 为 54 个 buffer 分别复制。
所有 buffer 必须精确长度、互不别名，也不与 cache/preparation 共享 backing buffer。成功返回的 lease 在 worker
任务成功、失败、取消、postMessage 同步失败、端口关闭或 worker exit 后由 adapter 调用幂等 `settle()`。调用方取消
owner 或 consumer close 只能阻止新 snapshot；已经发出的 snapshot 继续占账，直至物理 settle。consumer 的
`close()` 标记关闭、释放未外借状态，并等待全部 snapshot lease 结算；不能用提前减账或 detach 主线程 view 冒充
worker isolate 已释放。

`acceptWorkerResult()` 同步核对 live owner/current preparation 与结果的
`{ key, chunkRevision, generatorVersion, haloRevision }`，并用显式数值读取逐值比较 `canonical`；它不保存或取得
result buffer 所有权。numeric scheduler `epoch/taskId` 由真实 scheduler 接缝校验，不能把字符串
`InterestSessionRef.epoch` 混作 numeric mesh epoch。

后续 app `MeshTaskSource` 以判别联合保留 legacy source，并为完整路径增加
`prepareCompleteWorkerInput() -> { input, settle }` 与 `acceptDerivedMesh()`。完整 source 先用 scheduler 的 numeric
epoch/taskId 校验，再委托 `acceptWorkerResult()` 核对 consumer 身份与 canonical；完整路径的类型不能出现
`acceptWorkerCanonical`，也不得发送 `accept-generated-chunk`。postMessage 同步失败在任务尚未接纳前 settle；任务
取消只标记取消，收到取消完成或 worker 实际 terminate 后才 settle；source dispose 先 terminate 再 settle。

后续真实 worker 验收必须调用生产 `createWorkerFirstDispatch()` 与 `runWorldComputeTask()`，断言完整 54 buffer 被
transfer、结果回显同一 `haloRevision`、`authorityComplete = true`，且 `proceduralVoxelSamples = 0`、
`macroContextCount = 0`。本 consumer 单元不新造 mesh reducer，也不在 worker 计划批准前伪造这些字段。

## RED 设计与推荐实施顺序

### 1. 类型、owner 和关联 RED

先新增 `tests/client/network-baseline-consumer.test.ts` 并取得缺少 consumer 模块的真实 RED。表驱动覆盖：

- 错 ref/request/interest/purpose/main key/generatorVersion/owner generation；
- mesh 不是恰好 27 项、collision 不是恰好 1 项；entry 稀疏、重复、顺序错、role 错；
- 任一 overlay key/revision/generator 不符，即使 main 正确也拒绝；
- old handle、release 后迟到 bundle、close 后 accept 均拒绝；
- 调用后修改 descriptor、entry、LE bytes 不改变已经安装的对象。

### 2. LE、预算和原子安装 RED

在 `tests/client/network-baseline-consumer-budget.test.ts` 覆盖：

- 用不对称 `uint16` 值证明显式 little-endian 数值读取，不依赖本机端序；
- shared collision、shared preparation 任一预算不足时，cache、guard、owner preparation 和反向索引均零变化；
- 两个 owner 接纳重叠的同版本邻域时，shared preparation 只按唯一 identity 收费；相同 identity 但任一 block
  字节不同则 `conflicting-content`，现有 cache/refcount 不变；
- 同 owner 原子替换失败保留旧 preparation；成功后才释放旧预算；
- 现有 cache revision 更高时 mesh 全体 `superseded`，collision-resync 返回 `satisfied-by-newer`；
- 两个 owner 重叠 key 只计一份 collision cache，逐一 release，最后一个才删除/释放 guard。

测试使用真实 `AuthorityCollisionRevisionGuard`、`cacheAuthorityCollisionBaseline()` 与 collision Map，不实现测试专用
cache reducer。

### 3. 版本失效与 worker 生命周期 RED

在 `tests/client/network-baseline-owner-lifecycle.test.ts` 和
`tests/client/network-baseline-worker-snapshot.test.ts` 覆盖：

- overlay-only revision 上升使依赖它的 mesh owner stale；`meshChunks` 未含该 key 也不能保留旧 preparation；
- `collisionGuard.satisfy()` 后 consumer 的水位仍在，旧 bundle 不能回退；
- snapshot 的 54 个 buffer 精确、互不别名；调用方修改 snapshot 不影响 cache/preparation；重叠 owner 的 snapshot
  各自复制并分别计 worker transfer；
- worker transfer 预算不足时零复制、零 lease；post 失败、任务失败、取消、worker exit 分别 settle 后归零；
- owner release、版本失效或 consumer close 在 snapshot barrier 未 settle 时不提前减 worker 账，`whenIdle()` 保持 pending；settle 后 close
  完成且幂等；
- owner 释放并以更高 generation 重建后，旧 worker result 的 `haloRevision` 不匹配。
- `acceptWorkerResult()` 拒绝错误 key/main revision/generator/halo identity、过期 owner 与 canonical 差异；成功与
  失败均不持有或修改 result buffer，numeric scheduler epoch/taskId 留给真实 scheduler 用例证明。

### 4. 后续真实接线验收

consumer 本身 GREEN 后，按以下依赖顺序推进，不能用纯单元替代：

1. 等 `network-complete-baseline-worker-plan.md` 审批并实现完整 worker 变体；由 app adapter 映射中立 snapshot。
2. 使用冻结的 source-bound baseline reference corpus 重放 27/1 bundle，验证投影、重组、consumer 的逐项 bytes/revision
   等价；该证据仍不是网络联通。
3. root 在真实 Browser/World scheduler 用例接入 owner、commit 失效、worker post/settle 和 collision mirror，确认
   `proceduralVoxelSamples = 0`、`macroContextCount = 0`，且无 `accept-generated-chunk` 上行。
4. 网络 session adapter 后续独立验证认证/interest/cancel/传输 ACK、late page、断线和重连；本计划不宣称完成。

## 准出边界

本设计可以准许后续 consumer 实施的条件是：接口不导入 app；27/1 和全部 identity/version 均在分配、安装前验证；
三类预算与 physical settle 分开；owner/refcount 和反向失效有界；worker snapshot 只提供完整权威输入；所有测试使用
现有碰撞入口且不增加伪客户端 reducer。

即使这些用例全部通过，也只能证明 reference bundle 在单进程内被安全消费并形成完整 worker 输入。它不能证明
session 授权、真实网络采用、浏览器 scheduler/GPU 接线、远端取消、传输背压、Linux 设备行为或 N2 性能达标。
