# 公开基线描述、分片与有界重组参考计划

## 目标与边界

本切片把真实 `AuthorityBaselineCaptureResult` 投影为 codec、transport 无关的公开参考对象：一个 bundle descriptor、每个 canonical/fluid block 的 transfer descriptor，以及带完整身份的可靠 page。它同时提供只做字节收集、长度/hash 校验和预算释放的有界 reassembler，证明 27 块 mesh 或 1 块 collision-resync 可以在乱序 page 下正确重组。

本切片不实现 session 认证、interest 授权、owner/refcount、网络 listener、wire 采用、浏览器缓存安装、GPU 生命周期或 GUI。所有对象继续声明 `wireStatus: 'not-adopted'`。默认 page 大小只能作为 N2 候选配置显式传入，不能从本计划推导正式 wire 帧大小。reassembler 的产物是已验证的 LE/raw block，不是伪造的客户端 reducer；实际 collision mirror 和 mesh worker 接入留给后续 Remote adapter。

## 已核实的输入与消费边界

- `AuthorityBaselineCaptureResult` 的 available 分支已在 Authority 所有权域内取得同步 checkpoint，并完整复制 27 个 mesh entry 或 1 个 collision-resync entry。每项 canonical 为 32³ 个 `uint16`，占 65,536 B；fluid 为 32³ 个 `uint8`，占 32,768 B。
- capture 的 `checkpoint.commitSequence/worldRevision` 是整个同步观察的 Authority 上界，不是每个 Chunk 的精确最后修改序号。公开 descriptor 必须保留这一含义，每项版本仍以 `chunkRevision` 为准。
- 当前 Node lane 返回的 canonical 是 `Uint16Array` 源 buffer。公开参考投影必须按数值读取源 `Uint16Array`，再用 `DataView.setUint16(offset, value, true)` 写出明确 little-endian 字节；不能把当前机器的原始内存字节直接改名为 LE。fluid 按原 `uint8` 值复制。
- 当前 mesh 消费路径只对 main 做 revision guard，旧 `AuthorityMeshPayload` 的 overlay 没有 revision。新 bundle 不能直接降级为旧 payload 后宣称 27 项均已验证。未来 Remote adapter 必须先按 owner/generation、entry key、每项 revision 和完整 block 校验全部 27 项，再构造实际 mesh 输入。
- `createProceduralMeshInput()` 在 main canonical、26 个 overlay canonical 和 fluid 全部来自已验证 bundle 时，应得到 `proceduralVoxelSamples = 0`、`macroContextCount = 0`。缺 overlay 会回退 `baseVoxel`，缺 fluid 会走 legacy fluid 推导；远端 adapter 必须在进入该函数前拒绝缺项。这个真实消费者 oracle 属于后续接线验收，不在本切片另造 reducer。

## 身份与最小类型

复用现有 `InterestSessionRef` 的 `{ epoch, serverEpoch, sessionId, worldId }`。公开对象继续使用嵌套 `ref`，避免同时存在一套平铺身份。可信 session adapter 提供下面的投影上下文：

```ts
type BaselineReferenceProjectionContext = Readonly<{
  ref: InterestSessionRef;
  requestId: number;
  interestId: number | null;
  expectedCapture: Readonly<{
    captureId: number;
    captureGeneration: number;
    purpose: 'mesh' | 'collision-resync';
    key: string;
    generatorVersion: number;
  }>;
  minimumRevision: number;
  referencePagePayloadBytes: number;
  pagesPerBundleMax: number;
  limits: Pick<
    ReferenceSessionLimits,
    | 'metadataBytesMax'
    | 'reliableMessageBytesMax'
    | 'baselineTransferBytesMax'
    | 'baselineInFlightBytesMax'
    | 'sendQueueBytesMax'
  >;
  digest: ReferenceSha256DigestPort;
  sizer: BaselineReferenceSizer;
  inFlight: BaselineReferenceInFlightLedger;
}>;
```

`expectedCapture` 的五个字段必须分别与真实 capture 及其全部 entry 交叉匹配，epoch 则由 `capture.checkpoint.epoch === ref.epoch` 绑定；这些内部 capture 身份不进入公开 descriptor。`pagesPerBundleMax` 是可信候选配置，必须为 `1..NETWORK_REFERENCE_BASELINE_PAGES_MAX`，其中 reference 固定硬上限建议为 512。投影器在处理 block 内容前计算两个 pageCount 之和；`referencePagePayloadBytes = 1` 这类会产生数万个或数百万对象的配置直接拒绝。512 只限制本参考对象数量，不是正式 wire 常量。

公开 `bundleId` 和每个 `transferId` 直到 hash 完成、draft 准备进入单一 descriptor 发布队列时才分配。它们由最小 publication queue 在当前 session 内严格单调分配且不得复用；不能在异步 hash 前预分配较小 id，再让较晚完成的较大 id 先发布。未来 session 状态机仍须拒绝旧 epoch、取消 owner 和已完成 id，纯投影不声称建立了该状态机。

最小公开类型建议放在 `src/server/protocol/network-reference-baseline-types.ts`：

```ts
type BaselineBlockDescriptorReference = Readonly<{
  name: 'canonical' | 'fluid';
  transferId: number;
  elementType: 'uint16-le' | 'uint8';
  elementCount: 32_768;
  byteLength: number;
  referencePagePayloadBytes: number;
  pageCount: number;
  sha256: string;
}>;

type BaselineEntryDescriptorReference = Readonly<{
  entryId: number;
  role: 'main' | 'overlay' | 'collision-resync';
  key: string;
  chunkRevision: number;
  generatorVersion: number;
  blocks: readonly [BaselineBlockDescriptorReference, BaselineBlockDescriptorReference];
}>;

type BaselineBundleDescriptorReference = Readonly<{
  kind: 'baseline-bundle-descriptor-reference';
  projectionVersion: 1;
  wireStatus: 'not-adopted';
  ref: InterestSessionRef;
  requestId: number;
  interestId: number | null;
  bundleId: number;
  purpose: 'mesh' | 'collision-resync';
  key: string;
  minimumRevision: number;
  authorityCheckpoint: Readonly<{
    physicsTick: number;
    commitSequence: number;
    worldRevision: number;
  }>;
  entries: readonly BaselineEntryDescriptorReference[];
}>;

type BaselinePageReference = Readonly<{
  kind: 'baseline-page-reference';
  projectionVersion: 1;
  wireStatus: 'not-adopted';
  ref: InterestSessionRef;
  requestId: number;
  interestId: number | null;
  bundleId: number;
  purpose: 'mesh' | 'collision-resync';
  entryId: number;
  transferId: number;
  block: 'canonical' | 'fluid';
  pageIndex: number;
  pageCount: number;
  byteOffset: number;
  bytes: Uint8Array;
}>;

type BaselineUnavailableReference = Readonly<{
  kind: 'baseline-unavailable-reference';
  projectionVersion: 1;
  wireStatus: 'not-adopted';
  ref: InterestSessionRef;
  requestId: number;
  interestId: number | null;
  purpose: 'mesh' | 'collision-resync';
  key: string;
  minimumRevision: number;
  reason: 'cancelled' | 'not-available' | 'residency-pressure' | 'superseded' | 'stopping' | 'transfer-limit';
}>;
```

descriptor 不重复 `checkpoint.epoch`，而是要求 capture checkpoint epoch 与可信 `ref.epoch` 完全相等。`authorityCheckpoint` 的三个数值只作为 bundle 观察上界；不写入 entry，也不替代 `chunkRevision`。mesh 必须有非空 `interestId`；collision-resync 可为空，但空值只表示“授权尚由可信 adapter 裁定”，不授予任意坐标读取权限。

unavailable capture 只投影原始五种原因。投影阶段因 metadata、transfer 或 in-flight 限制拒绝时才产生 `transfer-limit`；session adapter 决定该对象是否仍可发送。因取消或 stopping 而不再有活跃 owner 时，adapter 可以抑制回包，但不能把它改标为 available。

## 投影 API 与原子步骤

建议新增：

- `src/server/protocol/network-reference-baseline.ts`：严格投影、canonical LE 转换、hash 和 page 产生。
- `src/server/protocol/network-reference-baseline-budget.ts`：无网络副作用的 in-flight/send-queue 账本。
- `src/server/protocol/network-reference-baseline-reassembly.ts`：有界 page 重组和最终 block 校验。

最小 API：

```ts
prepareAuthorityBaselineReference(
  capture: AuthorityBaselineCaptureResult,
  context: BaselineReferenceProjectionContext,
  options?: Readonly<{ signal?: AbortSignal }>,
): Promise<BaselineUnavailableReference | PreparedBaselineBundleReference>;

type PreparedBaselineBundleReference = Readonly<{
  publish(queue: BaselineReferencePublicationQueue): PublishedBaselineBundleReference;
  cancel(): Promise<void>;
}>;

type PublishedBaselineBundleReference = Readonly<{
  descriptor: BaselineBundleDescriptorReference;
  pageCount: number;
  materializePage(locator: BaselinePageLocator, queue: BaselineReferenceSendQueue): BaselinePageLease | null;
  close(): void;
}>;

createBaselineReferenceReassembler(options): BaselineReferenceReassembler;
createBaselineReferenceInFlightLedger(limitBytes: number): BaselineReferenceInFlightLedger;
createBaselineReferenceSendQueue(limitBytes: number): BaselineReferenceSendQueue;
createBaselineReferencePublicationQueue(options): BaselineReferencePublicationQueue;

type BaselineReferenceReassembler = Readonly<{
  acceptDescriptor(descriptor: BaselineBundleDescriptorReference): void;
  acceptPage(page: BaselinePageReference): Promise<ReassembledBaselineReference | null>;
  clearBundle(bundleId: number, reason: 'cancelled' | 'timeout' | 'schema-error' | 'hash-error'): Promise<void>;
  cancel(bundleId: number): Promise<'cancelled' | 'already-settled' | 'unknown'>;
  close(): Promise<void>;
  whenIdle(): Promise<void>;
  diagnostics(): Readonly<{ activeBundles: number; digestingTransfers: number; reservedBlockBytes: number }>;
}>;
```

`PreparedBaselineBundleReference` 和 `PublishedBaselineBundleReference` 是本地资源 handle，不进入 DTO、codec 或 corpus metadata。publication queue 的 `publish()` 在同一同步临界区分配 bundle/transfer id、建立 descriptor 并追加到 FIFO；sender 只能按 `takeDescriptor(sendQueue)` 顺序取得带独立 settle token 的 descriptor，且 descriptor 的完整候选消息也计入 4 MiB send queue。这样异步 hash 完成顺序本身就是公开 id 与发送顺序，不会让合法旧 id 在新 id 后到达。若未来要求按请求接受顺序发布，须另建有界 reorder gate 并处理失败 gap，本切片不实现该 session 策略。

`materializePage()` 先让可信 sizer 只读 private block 的目标 `subarray`，结合 metadata 计算完整候选消息大小，再取得 4 MiB send-queue token；成功后才复制这一页。sizer 不得保存或修改 view。返回的 page lease 独立拥有 page buffer，并在 transport 物理 settle 后释放队列字节。

published handle 的 `close()` 同步禁止后续物化并清空 private owned blocks，释放对应 16 MiB in-flight reservation；它不释放已经独立 materialize 的 page，也不替这些 page 完成 send token。prepared handle 的 cancel 同理释放尚未发布的 owned block。若 signal 在发送端 digest 运行时触发，投影先标记取消并拒绝发布，但仍等待已启动 digest `allSettled` 后才释放 owned block/reservation 和完成 Promise，不能让后台 digest 继续读取已减账内存。

投影顺序固定为：

1. 严格验证 capture/context 的精确字段、身份、`expectedCapture` 的 purpose/key/generation/generatorVersion、checkpoint、entry 数量、role、顺序、唯一 key、revision、ArrayBuffer 唯一性与长度。mesh 重用 Authority 的确定邻域函数核对 main+26；collision 精确一项。主 entry revision 必须不小于 `minimumRevision`，checkpoint epoch 必须等于可信 `ref.epoch`。
2. 用固定 27/1 形状计算输出 block 总字节、每个 transfer pageCount 和整个 bundle page 总数，在复制、LE 转换、hash 或任何 page 对象分配前完成门禁。单 transfer 超 1 MiB、总 reservation 超 16 MiB、page 总数超过可信上限或 512 reference 硬上限、非法候选 page 配置时，零大分配并返回 `transfer-limit`。
3. 在第一个 `await` 前同步取得输入的独立所有权：canonical 按数值重写为 LE `Uint8Array`，fluid 复制为 `Uint8Array`。调用方随后修改或 detach capture buffer，不得改变待 hash 字节。
4. 对每个 owned block 调注入的 SHA-256 port；hash 必须为 64 位小写十六进制。digest 失败或 signal 取消走同一异步 cleanup：先等待全部已启动 digest 物理结算，再释放 reservation，不返回半个 descriptor。
5. hash 完成后形成不带公开 id 的 immutable draft。publication queue 的同步 `publish()` 按 ready 顺序分配 bundleId 和唯一 transferId，按 capture entry 顺序分配 `entryId = 0..26`，每项固定 canonical 在前、fluid 在后，并把 descriptor 放入单一 FIFO。
6. 用 `sizer.measureMetadataBytes()` 检查 descriptor 和每页去掉 `bytes` 后的 metadata 均不超过 64 KiB；用 `sizer.measureReliableMessageBytes()` 检查每个完整 page 参考对象不超过 1 MiB。sizer 是候选 codec 注入的计量口，不是本计划选择的 wire；返回值须为非负安全整数。正式 wire 采用时必须用真实编码结果重新门禁，不能沿用另一候选的数字。
7. draft 不预建 `pages[]`。`materializePage()` 仅在 send queue 接受该页的完整候选消息字节后复制对应区间，且每个 materialized page 有独立 buffer。成功对象只写显式字段，不得展开 capture/context 透传未知字段。

page 切分必须在 hash 所覆盖的完整 LE/raw block 上进行。SHA-256 绑定完整 block，不绑定源机器 buffer；重组后先验证总长度和 hash，再允许后续 adapter 解释 `uint16-le`。reference page config 没有隐式默认值；即使 N2 试验暂用 64 KiB 或其它值，也必须由 fixture/config 明示并记录，不能据此冻结 wire。

内存口径必须拆开记录：Authority capture 输入 buffer 仍由调用方持有；投影 in-flight ledger 只覆盖新建的 owned LE/raw block；一次 materialized page 由 send queue 单独计量；digest 实现可能产生的 scratch/copy 由 digest provider 的实际诊断或明确 `NOT_COLLECTED` 记录。投影期间 capture input 与 owned block 会短暂并存，不能把 16 MiB in-flight 上限宣称为进程总内存上限。lazy page 避免再同时保留完整的第二份 `pages[]`，但不消除 hash scratch 或 transport 自身复制。

## 三项预算的责任划分

| 限制                        | 参考层责任                                                                                                                       | 后续 session/transport 责任                                |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| metadata ≤ 64 KiB           | 投影器对 descriptor 与每页 metadata 使用当前候选 sizer，重组器在预留大块前重复校验                                               | 采用 wire 后按真实编码字节重新检查；认证封套也计入最终消息 |
| 单 transfer/page ≤ 1 MiB    | 每个 block descriptor 的 `byteLength` 不超过 transfer 上限；每个 page 的完整候选消息不超过 reliable 上限                         | 选择 page 大小、frame overhead、压缩和实际发送方式         |
| baseline in-flight ≤ 16 MiB | sender owned-block ledger 与 receiver reassembler 分别按 descriptor 的完整 block 字节预留；所有已启动 hash/page 工作结算后才释放 | 按 session/连接隔离或共享公平策略，关联 ACK 和连接关闭     |
| send queue ≤ 4 MiB          | descriptor 出 FIFO 和 page 副本物化前均按候选完整消息预留；各自 transport settle 后释放                                          | 实际 socket `bufferedAmount`、控制/bulk lane、公平和优先级 |

当前一个完整 mesh 的原始 block 总量为 2,654,208 B，低于 4 MiB 但高于 1 MiB，所以 bundle 不能作为单 transfer；54 个 block 各自都低于 1 MiB。这个算术不包含 descriptor/page envelope，不能冒充 wire 大小。4 MiB send queue 也不能因为“一个 fixture 大约 2.53 MiB”而允许同时无界构造多个 bundle；每个 page 只有在 queue ledger 成功预留后才进入待发送集合。

send queue 不发送网络数据，只返回幂等 settle token。若队列不足，owned draft 可以保持在 16 MiB in-flight reservation 内等待，也可以由 adapter 取消并发出 `transfer-limit`；本切片不决定调度。取消只能停止尚未交给 transport 的 page；已经交给 transport 的页仍须等待实际 settle 才减 send queue。该账本不能冒充 socket backpressure、ACK 或多客户端公平性。

## 有界 reassembler

reassembler 接受已由未来 codec 解码、但尚未进入实际客户端的 descriptor/page。它只返回：

```ts
type ReassembledBaselineReference = Readonly<{
  descriptor: BaselineBundleDescriptorReference;
  entries: readonly Readonly<{
    entryId: number;
    canonicalLittleEndian: Uint8Array;
    fluid: Uint8Array;
  }>[];
}>;
```

它不创建 `AuthorityMeshPayload`、不修改 collision mirror，也不生成 baseVoxel/fluid fallback。后续 adapter 必须把 verified LE canonical 转为目标平台 `Uint16Array`，再使用实际 production 消费入口。

行为要求：

1. descriptor 必须先到并通过严格 schema、可信 `ref`、bundle high-water、27/1 entry、transfer 唯一性和 metadata 检查。当前纯参考层只验证可信 session ref 与 bundle 单调性，不拥有 owner allowlist，也不声称已完成 owner 权限认证；该门禁仍由后续 Remote adapter 实施。随后按全部 block `byteLength` 一次预留接收端 16 MiB；失败时不创建每页数组或 block buffer。跨 stream 先到的 page 直接拒绝，不为未知 descriptor 建 orphan 缓存；未来 sender 必须在 descriptor 被接纳后才调度 bulk page。
2. descriptor 接纳后，page 可跨 transfer 任意乱序到达。每页完整匹配 ref/request/interest/bundle/purpose/entry/transfer/block/pageCount；`byteOffset` 必须等于由 descriptor page size 推导的偏移，长度必须等于该页应有长度。重复 page、重叠、洞、稀疏数组、未知字段和 extra Symbol 一律拒绝。
3. page bytes 在任何异步 hash 前先复制；调用方修改原 view 不影响 reassembler。只按 descriptor 的精确 byteLength 分配，不按 page 声称扩容。一个 transfer 收齐后对完整 block hash；hash 错误使整个 bundle fail closed 并释放全部 reservation，不能保留其它“已通过”的半 bundle。
4. `clearBundle(bundleId, reason)` 是唯一物理清理入口：先把状态标为 closing 并拒绝新 page，然后等待该 bundle 已启动的 digest Promise 全部 `allSettled`。只有 digest 物理结算、page 输入副本不再被 handler 使用后，才清零 block、释放 in-flight reservation 并完成 Promise。重复 clear/cancel 复用同一 completion；digest 卡住时清理保持 pending，不能先返回成功后反复建立新 bundle 绕过 16 MiB。
5. `cancel(bundleId)`、超时、schema/hash catch 与 `close()` 全部委托 `clearBundle()`；`close()` 对当时所有 active bundle 调用 clear 并等待，`whenIdle()` 同样等待真实清理完成。diagnostics 包含 `activeBundles/digestingTransfers/reservedBlockBytes`，不得在 catch 中同步减账、把仍运行的 digest 留在后台。
6. 全部 transfer 验证后按 entryId 返回 owned LE/raw bytes，并从 active map 移除。最近完成/cancel 状态只保留有界窗口；bundleId 的严格 high-water 防止窗口淘汰后复用旧 id，不能永久保存历史 map。high-water 只在 descriptor 完成预算预留、buffer 建立并成功加入 active map 后推进；因容量不足或同步分配失败而未准入的 id 不得烧掉水位，预算释放后仍可重试该 id 或接纳下一个合法 id。
7. 接收端 in-flight 只计算尚未终态 bundle 的完整 descriptor block 总量；page 输入 view 会在同步校验后直接复制进固定 transfer buffer，调用栈内仍短暂持有输入 view 与其 metadata，但不会再为每页创建跨 digest `await` 存活的中间副本。hash 实现工作区和最终交给实际消费者后的 cache 仍须另由客户端内存预算记录，不能用 16 MiB 数字掩盖它们。

## RED 与验证路径

先创建测试并取得缺少模块或 API 的真实 RED，再实现：

1. `tests/server/network-reference-baseline.test.ts`：真实 27/1 capture shape；严格交叉绑定 captureId/generation/purpose/key/generatorVersion/ref epoch/minimumRevision；canonical 已知 `0x0102` 写为 `[0x02, 0x01]`；fluid 保值；每项 hash、descriptor、page offset/count 和输入/输出副本隔离。覆盖 unavailable 五种原因、digest 失败、重复 buffer/key/transferId、稀疏或扩展字段、错误 checkpoint、长度、role、顺序与 generatorVersion。受控 sender digest barrier 证明 signal 取消后仍等待已启动 digest，再释放 owned-block reservation。
2. 同一测试以小但合法的 page 候选形成多页，验证没有隐式默认；`referencePagePayloadBytes=1`、page 总数超过可信上限或 512 reference 硬上限必须在 LE/hash/page 分配前 RED。metadata/完整 page 的候选计量分别超过 64 KiB/1 MiB 时也拒绝。单 transfer或总 in-flight 超限用访问/分配 spy 证明没有继续处理内容。
3. `tests/server/network-reference-baseline-publication.test.ts`：用两个受控 digest 让后发 capture 先 ready，证明 bundleId/transferId 只按 ready draft 进入 FIFO 的顺序分配，`takeDescriptor()` 不会返回较大 id 后再返回较小 id；页在 send queue 预留前没有独立 buffer，物化一页只增加该页计量，settle 后释放。
4. `tests/server/network-reference-baseline-reassembly.test.ts`：descriptor 先行、跨 transfer 乱序 page、最终 27/1 强等价；page 先到、duplicate/gap/overlap、错误身份/offset/count/hash、调用后修改 source view 均 fail closed。用多个真实大小 descriptor 验证 16 MiB 原子 reservation，不创建 16 MiB 测试数组。
5. 同一重组测试直接覆盖 `clearBundle()`，以受控 digest barrier 证明 cancel/close/错误 clear 在 digest 运行时保持 pending 和 `reservedBlockBytes` 不变；重复 clear/cancel 不能释放预算或准入新 bundle，digest settle 后才完成并归零。覆盖超时触发相同 clear、`whenIdle()` 与 diagnostics。
6. `tests/server/network-reference-baseline-budget.test.ts`：descriptor 和 page 都用候选 sizer 的完整消息计量；填满 4 MiB 队列后，下一 descriptor 保持 FIFO、下一页零物化/零入队；settle 一个 token 后恢复准入；取消不提前释放已交 transport 的 token。该测试只证明参考账本，不声称真实 socket `bufferedAmount`。
7. 后续真实消费者 oracle 使用 production `createProceduralMeshInput()`：完整 27 entry 时断言 `proceduralVoxelSamples = 0`、`macroContextCount = 0`；删一 overlay 或 fluid 必须在 Remote adapter 门禁拒绝，不能让 production fallback 掩盖缺包。collision 使用现有 revision guard/mirror 接口，不另造测试 reducer。此项在 Remote adapter 切片保持 RED，不计入本切片纯重组 GREEN。

本切片不运行 benchmark、全仓 coverage 或浏览器视觉测试。聚焦 Vitest、Prettier、ESLint 与两套 TypeScript 是纯参考实现的证据；生产 build、真实 codec 大小、socket 背压和浏览器消费由主线后续阶段分别收集。

## Source-bound 真实语料复用

真实 Authority capture 已由独立任务按 [原始语料计划](network-baseline-corpus-plan.md) 采集；最终采用的原始输入是 `/tmp/seedlands-network-baseline-corpus-v1-r2`，manifest SHA-256 为 `0d2959e728f73a30efec8c9bac0f58269b9d0b51f3c73c23b0640fbbb1b7b0ad`，frames SHA-256 为 `2d3a0a9fd1670c087367fbb1c9330eda9e2484d9e7facd665892c6128e5f3b91`。`network-baseline-corpus*` 文件、recorder 和原始目录均由该任务拥有；早期 `r1` 未采用。本切片不重跑 Host、不重写原始 sidecar、不新建同源 recorder，也不把已有原始目录覆盖成 projected corpus。

后续只新增独立的 projected/reassembled 派生语料，例如 `/tmp/seedlands-network-baseline-reference-projected-v1-r1`。它必须把原始 corpus 的 manifest hash、record/index/content hash 和每个 sidecar hash作为输入身份，先验证完整 source-bound 原始数据，再调用本切片 projector。输出保存 descriptor、显式 page 候选配置、lazy materialize 次序、每个实际页 sidecar/hash、reassembled block hash和对应原始 capture record id；未被物化的页不能伪造为已发送。

派生 manifest 另保存当前 Git SHA、tracked diff SHA-256、新 reference types/projector/reassembler/budget/publication queue 的显式 source path/hash、Node 版本、reference limits、page/page-count 候选配置和 digest/sizer 身份。目标目录同样存在即失败、publish claim 防并发覆盖；任何原始 path/hash 或派生 source hash 变化都在 projector/reassembler 调用前拒绝。原始 capture provenance 保持 `real-host-capture`，派生记录另标 `reference-projected-from-source-bound-capture`，不能改写成真实网络包。

这组复用只证明“已冻结真实 Authority capture → reference descriptor/lazy pages → 有界重组”的功能等价。它不证明认证 interest、网络时序、codec 采用、Chrome 安装、mesh/collision 实际消费、4 MiB socket backpressure 或 N2 性能。若使用临时 codec decoded fixture，必须再建新的派生 generation，并继续绑定原始 corpus，不得反向修改原始语料。

## 阶段完成条件

本计划经审阅后，下一实现切片只交付纯 reference projection、预算账本、reassembler 和 source-bound corpus。完成态仍是 `not-adopted` 的可验证中间表示。随后 Remote adapter 才负责认证 owner、descriptor 接纳 barrier、可靠页调度、ACK/取消、LE 解码和调用现有 collision/mesh 入口；transport/codec 选择继续由 N2/N3 证据门决定。
