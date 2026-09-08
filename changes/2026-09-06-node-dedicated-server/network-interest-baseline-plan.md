# Interest、碰撞基线与网格输入参考计划

## 目标与边界

本计划为未来远端会话 adapter 定义最小的公开 interest、取消、基线可用性与可靠分片参考 DTO。它解决浏览器已存在的 Chunk streaming、碰撞镜像和 mesh 输入所需的因果关系；**不是** wire v1、传输映射、认证协议或生产实现。

客户端只提出有限的表现兴趣。可信 Host 决定实际订阅、canonical 生成、流体活动、持久化加载、halo 与版本；客户端永不上传 canonical、fluid 或 Logic/Fluid 候选来建立权威状态。客户端继续保留 mesh、GPU、表现和派生碰撞镜像，符合冻结 spec 对职责上移的规定。

本计划不把 `AuthorityRequest` 或 `AuthorityMeshPayload` 联合类型直接公开。它们含本地 Worker 生命周期、诊断、`accept-generated-chunk`、`set-fluid-active-chunks` 等内部调用，不能成为网络合同。

## 当前消费者和必须保留的语义

| 当前读取处                                                                                       | 实际需要                                                                                                                      | 参考合同的对应项                                                                                                       |
| ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `src/app/world/world-runtime.ts:352-383`                                                         | 以相机位置求主 Chunk，发起加载；离开缓存半径则取消 scheduler、卸载 GPU 资源并释放准备                                         | `interest-request`、`interest-cancel` 与按 `requestId` 关联的 bundle；浏览器本地仍决定画质/radius，但 Host 可收紧/拒绝 |
| `src/client/authority/browser-authority-client.ts:194-265`                                       | 每个 mesh 主 Chunk 等待准备完成，取得主 canonical/fluid、邻接 overlay，再复制给 browser mesh worker                           | `mesh-baseline-bundle`：一个主条目和完整 halo 条目，各有 revision、canonical/fluid 描述与分片引用                      |
| `src/client/authority/authority-collision-baseline-client.ts:54-86`                              | 对 snapshot/commit 要求的 key 和最低 revision 取完整 canonical/fluid；只接受 `available`、同 key、revision 足够且长度正确的值 | `collision-baseline-request` 与 `baseline-available` / `baseline-unavailable`；安装前完整收齐、长度/hash/LE 校验       |
| `src/client/authority/authority-collision-mirror.ts:61-99,201-239`                               | 以每 Chunk `previousRevision → revision` 应用 delta；缺旧基线、链断或 cell 非法时失效并重取                                   | baseline 带 key/revision；commit 继续以 worldRevision 顺序和 per-Chunk revision 作屏障，不能由跨 stream 可靠性假定排序 |
| `src/server/authority/authority-mesh-payload.ts:4-46`、`src/server/game-server.ts:46-50,211-231` | Host 目前为一个 mesh 主 Chunk 保留并准备 3×3×3 邻域（27 项），再取得 canonical/fluid/overlays                                 | adapter 从此生产路径读公开数据，但投影给每一项显式 key/revision/block 描述；不沿用 Worker 的无 revision overlay 形状   |

`WorldCommitPresentationReferenceV2` 已负责公开 `meshChunks`、chunk revision、collision delta 和 presentation class；它不携带完整块。本计划补齐使这些提交实际可被碰撞和网格消费的可靠基线数据。`WelcomePresentationReferenceV2` 提供 session/world/limits/checkpoint 锚点；本计划不重定义启动 body 或一次性营地表现。

**来源修正：**当前 `prepareMesh()` 本身不保证生成或返回 27 个完整块。`server-mesh-snapshots.ts` 的本地 Worker 优化只复制 `materialized` 的主块和 overlay；已驻留但未编辑的基础块可以不在 payload 内，留给浏览器程序化生成。远端方案不能沿用这一省略语义。未来 Host adapter 必须先取得邻域 retention lease，经 `DedicatedServerHost.requestChunk()` 完成所需 canonical，再以 `readCollisionBaseline()` 复制主块及 26 个邻接块，包括未编辑的基础块和各自 revision。本地 `prepareMesh()` 只作为消费形状参考，不能把其省略字段解释为 Air 或已完成权威生成上移。真实语料必须对这种未编辑块场景作断言。

## 已确认预算和不可擅改项

冻结 spec 与当前 reference fixture 的值是：metadata 不超过 64 KiB、单条可靠消息/单次 baseline transfer 不超过 1 MiB、总在途 baseline 不超过 16 MiB、发送队列高水位 4 MiB、一次 interest 最多 256 key、服务端 canonical 驻留 hard limit 为 2,048（`spec.md:131-135`；`network-real-corpus-recorder.test.ts:228-237`；`src/server/chunk-residency.ts:1-3`）。

因此本计划**不**把 512 interest 或 4,096 canonical residency 写成事实：当前 512 是其它 actor/commit 参考预算的语境，不是冻结 interest 上限；4,096 也不是当前 canonical hard limit。服务端可按运行时压力、权限、活动窗口和驻留预算向下收紧，不能因客户端列出 key 而扩大 fluid/physics 活动范围。

单个主 mesh 目前需要最多 27 个 Chunk 的 halo；这只是源路径的邻域形状，不意味着一个请求可无界地展开为 27×256 个驻留项。Host 在启动生成前必须把所有 granted 主 key 展开为 27 项邻域，以 key 求 union，并把已驻留项与尚未完成的 admission reservation 一并计入 2,048 hard limit。重叠 halo 只占一份 canonical 与一份 reservation；无法完整预留的主项必须在发起 `requestChunk()` 前拒绝，不能先启动数千项生成再依赖逐项 admission 失败收口。256 是客户端单次 interest 的输入上限，不是 2,048 驻留预算的替代值。

## 最小参考 DTO 草案

所有 DTO 均包含 `{ projectionVersion, wireStatus: 'not-adopted', epoch, serverEpoch, sessionId, worldId }`；其中 world/session 身份必须匹配已接受的 Welcome。`requestId`、`interestId`、`bundleId` 与 `transferId` 是同一 session 内不复用的安全整数或不透明文本标识，具体 wire 表示留给 N2/N4。它们不是 Authority 的 transaction issuer，也不向客户端开放内部 actor id。

### 1. 客户端兴趣和取消

```ts
type InterestKeyDemandReference = Readonly<{
  key: string;
  minimumRevision: number;
}>;

type InterestRequestReference = SessionRef &
  Readonly<{
    kind: 'interest-request-reference';
    requestId: number;
    demand: readonly InterestKeyDemandReference[]; // 1..limits.interestKeysMax，唯一、稳定优先序
  }>;

type InterestCancelReference = SessionRef &
  Readonly<{
    kind: 'interest-cancel-reference';
    /** 本次取消操作自己的、不复用的 request id。 */
    requestId: number;
    /** 被取消的原始 interest-request request id。 */
    targetRequestId: number;
    interestId: number | null;
    /** 空表示撤销整个 accepted interest；否则为已授予 key 的子集。 */
    keys: readonly string[];
  }>;

type InterestCancelledReference = SessionRef &
  Readonly<{
    kind: 'interest-cancelled-reference';
    /** 回显取消操作自身的 request id。 */
    requestId: number;
    targetRequestId: number;
    interestId: number | null;
    scope: 'whole-pending-request' | 'whole-interest' | 'granted-keys';
    keys: readonly string[];
    status: 'cancelled' | 'already-cancelled';
  }>;

type InterestAcceptedReference = SessionRef &
  Readonly<{
    kind: 'interest-accepted-reference';
    requestId: number;
    interestId: number;
    granted: readonly Readonly<{ key: string; minimumRevision: number }>[];
    rejected: readonly Readonly<{
      key: string;
      reason: 'invalid-key' | 'over-limit' | 'not-available' | 'residency-pressure';
    }>[];
  }>;
```

`demand` 是客户端对表现/碰撞的建议，不携带 halo、fluid active keys、canonical bytes、优先级类别或服务端活动窗口。Host 必须验证 key、去重、会话、总数和资源预算，再根据认证玩家位置、视距上限、模拟窗口和当前 canonical 驻留决定 `granted`。客户端只有收到 `interest-accepted` 后才能接受该 interest 的 bundle；未知、过期或已取消的 `interestId` 的数据一律丢弃。

这里的重复 key 必须拒绝，不能以静默去重修复请求。`interest-cancel.requestId` 是取消操作自己的新 id，`targetRequestId` 才指向被取消的原始 request；两者不得相同或复用。为覆盖 accepted 尚未返回的离屏取消，`interestId: null` 只允许 `keys=[]`，表示撤销整个待处理 request。Host 必须记录这一有界 tombstone，并在返回 `interest-cancelled` 前保证稍后收到或完成的原请求不会再发布 accepted/bundle/page；`already-cancelled` 具有相同终态保证。tombstone 在原请求拒绝、取消 ACK 已被双方确认或 session 结束后释放，不能随历史 request 永久增长。此生命周期由真实 adapter 实现，纯 DTO 投影不声称已实现取消。

取消是幂等的。Host 收到后停止尚未发出的页、解除该 owner 的传输保留；浏览器同时废弃该 owner 的未完成页和本地 mesh preparation。adapter 必须以 `(interestId, key, purpose)` 保存有界 owner/generation；重叠 mesh halo、另一个 interest 或受信任玩家 collision-resync 仍持有同一 key 时，取消其中一个 owner 不得调用现有 `AuthorityCollisionRevisionGuard.release(key)`、删除共享 collision cache 或释放其他 owner 的 GPU preparation。只有最后一个相关 owner 结束后才释放共享状态。取消不要求 Host 停止世界的 fluid/physics 活动，也不等同 `release-mesh` 的本地 Worker 调用。

### 2. 基线 bundle、可用性和分片

独立碰撞重同步请求应定义为 `collision-baseline-request-reference`，携带 `SessionRef`、新的 `requestId`、可空 `interestId`、`key`、`minimumRevision` 和固定 `purpose: 'collision-resync'`。已有表现 interest 时必须绑定其 id；没有表现 interest 时只允许 `interestId: null`，并由可信 Host 根据当前认证玩家 snapshot/commit 的碰撞需求裁定该 key，不能信任客户端自报范围。两种路径都不能成为任意坐标生成或绕过驻留上限的接口。

```ts
type CollisionBaselineRequestReference = SessionRef &
  Readonly<{
    kind: 'collision-baseline-request-reference';
    requestId: number;
    interestId: number | null;
    purpose: 'collision-resync';
    key: string;
    minimumRevision: number;
  }>;

type BaselineBlockReference = Readonly<{
  name: 'canonical' | 'fluid';
  transferId: number;
  elementType: 'uint16-le' | 'uint8';
  elementCount: number;
  byteLength: number;
  pageCount: number;
  sha256: string;
}>;

type BaselineEntryReference = Readonly<{
  entryId: number;
  role: 'main' | 'overlay' | 'collision-resync';
  key: string;
  chunkRevision: number;
  generatorVersion: number;
  blocks: readonly [BaselineBlockReference, BaselineBlockReference];
}>;

type BaselineBundleReference = SessionRef &
  Readonly<{
    kind: 'baseline-bundle-reference';
    requestId: number;
    interestId: number | null;
    bundleId: number;
    purpose: 'mesh' | 'collision-resync';
    /** 仅为弱 publication 边界；不得冒充每个 Chunk 的精确 commit id。 */
    publicationCommitSequenceUpperBound: number;
    entries: readonly BaselineEntryReference[];
  }>;

type BaselineAvailableReference = SessionRef &
  Readonly<{
    kind: 'baseline-available-reference';
    requestId: number;
    interestId: number | null;
    bundleId: number;
    purpose: 'mesh' | 'collision-resync';
    entryId: number;
    transferId: number;
    pageIndex: number;
    pageCount: number;
    block: 'canonical' | 'fluid';
    byteOffset: number;
    bytes: Uint8Array;
  }>;

type BaselineUnavailableReference = SessionRef &
  Readonly<{
    kind: 'baseline-unavailable-reference';
    requestId: number;
    interestId: number | null;
    purpose: 'mesh' | 'collision-resync';
    key: string;
    minimumRevision: number;
    reason: 'not-available' | 'residency-pressure' | 'superseded' | 'transfer-limit';
  }>;
```

`purpose: 'mesh'` 的 bundle 必须绑定非空 `interestId`，恰有一个 `main` 和完整 26 个相邻 `overlay`；所有 entry 的 key 唯一，主 entry 是请求 key。`purpose: 'collision-resync'` 的 bundle 恰有一个 `collision-resync` entry；其 `interestId` 可以为空，但只能来自上文的可信玩家碰撞授权。role、key、revision 和 block descriptors 在页到达前已固定。当前生产 mesh 邻域为主点周围 3×3×3，因此 Host 产生的正常 mesh bundle 应显式列出主与每个实际 overlay，而不是让客户端猜坐标、补 fluid 或以 seed 生成 canonical。

每个 block descriptor 必须预先绑定唯一 `transferId` 和 `pageCount`；该 id 对应固定的 bundle、entry、block、总长度和页数。页的 `requestId`、`interestId`、`purpose`、`bundleId`、`entryId`、`transferId` 与 block 名必须全部匹配 descriptor，不能以新的 transferId、另一个 purpose 或另一个请求的页混入同一 block。

`baseline-available` 的 `bytes` 是可靠页的 payload。每页只能覆盖一个 block 的连续区间，`pageIndex/pageCount/byteOffset` 不得重叠或留洞；所有页拼接后的长度、element count、little-endian canonical 和 SHA-256 必须匹配对应 descriptor。完整 canonical 为 32³ 个 `uint16-le`，fluid 为同数目的 `uint8`；客户端在完整两个 block 均验证成功前，不能安装碰撞镜像或交给 mesh worker。该对象可承载多项 entry、每 block 多页，但每个 transfer 和总在途字节仍受 Welcome limits 约束。

`baseline-unavailable` 是可恢复的、有界失败：客户端保持该 key 不可读，不以 Air/旧数据假装满足最低 revision；若对应 mesh interest 或受信任玩家 collision owner 仍有效，可等待 Host 后续可用通知或以新 requestId 重试。`superseded` 表示该 bundle 已被较新 revision/interest 取代，旧页不能再安装。队列/字节超限应优先发送这一明确失败或 future `baseline-resync-required`，而非默默截断。

## Authority 内采集与资源生命周期

当前逐 key Authority façade 不足以安全实现远端 bundle：它只公开异步 `requestChunk()` 与 `readCollisionBaseline()`，也不能把 `retainMeshPreparationNeighborhood()` 返回的 closure lease 传过 RPC。下一实现切片必须在 Authority worker 内增加一个 bundle capture 操作；main/网络层只能收到已经复制并完成身份、版本和预算校验的结果，不能在 27 次 RPC 间自行拼接 canonical 状态。

mesh capture 按以下顺序执行：先对 granted 主 key 展开 27 项并求 union；在同一 Authority 所有权域内原子登记 owner、preparation lease 和 pending admission reservation；再调用 `requestChunk()` 完成 union 中尚未驻留的 key。全部 key 可用后，在 Authority worker 的一个不含 `await` 的同步步骤里读取并复制完整版本向量与每项 canonical/fluid。`readCollisionBaseline()` 的单 key `slice()` 只保证单项副本隔离，不能替代这一 bundle 边界。若实现不能保证同步复制，则必须在复制前后读取并比较完整 `(key, revision, generatorVersion)` 向量，任何变化都将整个 bundle 标为 `superseded`，不能发出混合版本。

完成 owned clone 后可释放 preparation lease；后续 hash、分页和传输只读取该不可变副本。bundle 在传输中发生新提交时，可以让旧副本完成并由 commit delta 补齐，或取消为 `superseded`。无论正常完成、部分 `requestChunk()` 失败、版本复核失败、取消、编码失败、队列拒绝还是连接关闭，均须在实际在途工作结算后释放该 owner 的 lease、pending admission 和 transfer/send-queue reservation；取消不能以提前释放仍被执行任务使用的资源冒充完成。已成功生成的 canonical 可按 Host 正常 residency 策略继续驻留，但失败请求不能继续持有 pin 或预算。

## 版本、因果与失败规则

1. Welcome 已接受前，拒绝一切 interest/bundle/page。每个回包同时匹配 epoch、serverEpoch、sessionId、worldId、requestId、interestId 和 purpose；旧 epoch、已取消 owner、未知 bundle/entry/transfer、重复页、页数/offset 溢出、超预算、hash/长度/类型错误均在大分配和应用前拒绝。
2. `minimumRevision` 是非负安全整数，来自客户端已有 collision state 和 commit 链下界。Host 返回的 entry revision 必须不小于它；客户端沿用现有规则，只在缓存 revision 精确等于 delta `previousRevision` 时应用 delta，否则使该 Chunk 失效并请求新 collision-resync baseline。
3. `publicationCommitSequenceUpperBound` 只能将 bundle 绑定到一个不晚于的公开 publication。单个 `WorldCommitResult` 没有精确 Authority commit sequence，故不得把它替代 per-Chunk revision 或伪造 causal id。
4. 主/overlay 必须来自同一 Host/world/generatorVersion；每项各自 revision 是最终真值。一个 bundle 在传输中若发生相关 world 更新，可以完成旧 revision 的 bundle 并让随后 commit delta 补齐，或标为 superseded 后重发；两种路径都不得将新 pose 视为已有所需碰撞 baseline。
5. 因 commit 重排窗口、baseline 页缺失或队列 resync 导致 gap 时，客户端废弃相关 transfer，并按 owner/generation 重新 attach/resync 后请求。取消只释放被取消 owner；同 key 仍被其它 mesh/collision owner 引用时保留共享 guard/cache/GPU preparation。客户端不得只重放 datagram pose，或将未验证的半包喂给 mesh/collision。
6. 可靠页的 stream 选择、HTTP/3/WSS fallback、是否将 pose 放 datagram、压缩、页大小、调度公平性和发送频率都尚未冻结；本计划只要求大块不与输入/动作共享一个不可区分的无界队列。

## 真实语料、预期 RED 与后续验证

下一实现切片先写 reference DTO/validator 和以下 RED；没有生产 session adapter 前，不把单元或 Host corpus 称为远端联通证据。

1. **真实 Host bundle corpus：**以未来 Authority 内 bundle capture 完成受限邻域准备，持有真实 retention lease，再从 `readCollisionBaseline()` 采集一个主 Chunk 及完整 27 项邻域；写出每项的 revision、canonical/fluid LE blocks、SHA-256、bundle/page manifest 与 source/config hash。对照 `prepareMesh()` 证明未编辑块在本地 payload 中可被省略，但远端 bundle 仍完整携带。用真实 `World.edit()` 或 fluid commit 使至少一个 key 的最低 revision 上升，证明 revision 变化；旧 bundle+delta 应用或 superseded 取消只有实际 adapter 实现后才能宣称通过。不得手填 canonical、fluid、overlay 或 revision。
2. **DTO 与关联 RED：**无 Welcome、错误 session/epoch、重复 key、257 个 demand、负数或非安全整数 revision、主项缺失/重复、overlay 无 revision、main key 不等于 request、purpose/role 不匹配、descriptor 缺 transferId/pageCount、页跨 request/interest/purpose/bundle/entry/block、错误 block 类型、非 LE canonical、长度/hash/page gap/overlap、`available` revision 小于 minimum 均拒绝。
3. **取消 RED：**取消使用独立 requestId 并绑定 targetRequestId；`interestId: null` 携带非空 keys 拒绝；accepted 前取消先得到 terminal ACK，迟到 accepted/page 不得复活；重复取消幂等；取消一个重叠 interest 不得使另一个 interest 或玩家 collision owner 的共享 key 不可读；所有 tombstone 在确定终态后回收。
4. **碰撞授权 RED：**非空 interestId 只能请求其 granted key；`interestId: null` 仅允许 Host 从当前认证玩家 snapshot/commit 推导的碰撞 key，客户端自报任意坐标拒绝；collision bundle 必须是单 `collision-resync` entry，不能混入 mesh role。
5. **原子采集 RED：**27 项未全部由 `requestChunk()` 准备时不发布 bundle；在准备后、复制期间注入 edit 或 fluid commit，只允许得到同一同步复制边界的完整旧/新版本向量或整体 `superseded`，不得混合；复制完成后的编辑不改变 owned bytes。任何单项失败、取消和 superseded 都释放本请求全部 lease/reservation。
6. **消费者 RED：**以现有 `AuthorityCollisionRevisionGuard` 和 mesh scheduler 的等价 adapter 做强断言：完整 verified bundle 才可调用 `prepareWorkerInput`；commit delta 链断时只能请求 collision-resync；取消最后一个 owner 才释放缓存/guard；`meshChunks` 的呈现重网格不改变 collision revision 规则。
7. **资源 RED：**单 transfer 超 1 MiB、总在途超过 16 MiB、metadata 超 64 KiB、单 interest 超 256、4 MiB send queue resync 都必须显式拒绝/重同步。多个 granted 主 key 先展开 27 项并按 union 去重；当前 resident 加 pending reservation 将超过 2,048 时，在启动生成前拒绝。重叠 halo 只计一次，部分失败、取消、连接关闭后 reservation 回到原值，不能隐式丢可靠 commit/baseline。
8. **真实 adapter 待办：**认证与 world-open、session 状态机、首次 attach/reconnect、interest 合并/服务端裁定、Authority lane bundle capture、Host retention lease、transport reliable stream 调度/背压、WSS fallback、浏览器 `WorldAuthorityPort` 替换、分片重组内存上限，以及跨 stream 乱序 Playwright/真实网络验证。N2 codec 只能验证 DTO/frame 保真；N4 才能以真实客户端数据流验证这些接线语义。

## 不在本计划内

- 不修改现有 browser Worker、`WorldAuthorityPort`、Host、protocol、codec 或 GUI。
- 不公开 `accept-generated-chunk`、Fluid/Logic candidates、`set-fluid-active-chunks`、persistence diagnostics、任意 actor id 或 Worker preparation diagnostics。
- 不承诺所有 27 overlay 在任意 world/兴趣下都已可传；Host 可按资源和权限拒绝，真实 corpus 必须据实记录。
- 不把参考 DTO、真实 Host corpus、loopback transport 能力或编解码强等价当作已完成的远端游玩、性能收益或正式 wire 采用。
