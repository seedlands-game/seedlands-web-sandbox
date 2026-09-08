# Authority 基线采集实现合同

## 目标与边界

本切片为 Node Authority lane 增加真实基线采集能力：一次请求只采集一个 mesh 主 Chunk 及完整 26 个邻接块，或一个 collision-resync Chunk。生成、驻留、版本判断和 owned copy 全部留在 Authority Worker 内；main/network adapter 不得通过逐 key `requestChunk()` 与 `readCollisionBaseline()` RPC 拼接 bundle。

本切片不实现公开 interest/session DTO、网络分页、codec、浏览器 adapter、GUI 或传输调度。返回值是 Node 内部 Authority RPC DTO，后续网络层仍须按 1 MiB transfer、16 MiB 在途和 4 MiB send queue 合同分页。

## 已核实的当前事实

- `prepareWorkerMeshInput()` 只复制 `materialized` 的 canonical/overlay，不能产生远端所需的完整 27 块。
- `GameServer.chunks` 与 `canonicalResidency` 是私有状态；`canonicalResidencyDiagnostics` 只公开计数和 2,048 hard limit。
- `readCollisionBaseline()` 对 available 结果立即 `slice()` canonical 64 KiB 和 fluid 32 KiB。它适合最终 owned copy，不得为 admission 或轮询存在性反复调用。
- `DedicatedServerHost.requestChunk()` 以 key 合并 pending 请求，默认最多 256 个 pending，但目前没有把“尚未驻留、已承诺生成”的 key 与 canonical hard limit 联合预留。
- Node Authority 控制 RPC 的 `maxResponseBytes` 为 4 MiB、`maxReservedResponseBytes` 为 16 MiB。27 份 canonical+fluid 原始块合计 `27 * 96 KiB = 2,654,208` 字节；完整 DTO 的 `measureNodeRpcBytes()` 结果尚未测得，不能把原始数组大小冒充 RPC 响应大小。
- 通用 RPC 对已经 in-flight 的 `AbortSignal` 取消会关闭整条控制端口。普通 interest cancel 不能借此取消单次 capture，必须使用独立业务 cancel RPC。

## 平台无关接口

新增建议路径：

- `src/server/authority/authority-baseline-capture-types.ts`：纯 request/result 类型和限额常量。
- `src/server/authority/authority-baseline-capture.ts`：key/邻域验证、确定顺序和同步 owned copy helper。
- `src/server/dedicated/dedicated-baseline-capture.ts`：Host 使用的 generation、owner、admission reservation 与取消协调器，避免继续扩大 `dedicated-server-host.ts`。

最小类型为：

```ts
type AuthorityBaselineCaptureRequest = Readonly<{
  captureId: number; // 同一 Authority epoch 内不复用的非负安全整数
  purpose: 'mesh' | 'collision-resync';
  key: string;
  minimumRevision: number;
}>;

type AuthorityBaselineCaptureEntry = Readonly<{
  role: 'main' | 'overlay' | 'collision-resync';
  key: string;
  chunkRevision: number;
  generatorVersion: number;
  canonical: ArrayBuffer;
  fluid: ArrayBuffer;
}>;

type AuthorityBaselineCaptureResult =
  | Readonly<{
      status: 'available';
      captureId: number;
      captureGeneration: number;
      purpose: 'mesh' | 'collision-resync';
      key: string;
      checkpoint: Readonly<Pick<AuthoritySnapshot, 'epoch' | 'physicsTick' | 'commitSequence' | 'worldRevision'>>;
      entries: readonly AuthorityBaselineCaptureEntry[];
    }>
  | Readonly<{
      status: 'unavailable';
      captureId: number;
      captureGeneration: number;
      purpose: 'mesh' | 'collision-resync';
      key: string;
      reason: 'cancelled' | 'not-available' | 'residency-pressure' | 'superseded' | 'stopping';
    }>;

type AuthorityBaselineCaptureCancellation = Readonly<{
  captureId: number;
  captureGeneration: number | null;
  status: 'cancelled' | 'already-settled' | 'unknown';
}>;
```

`purpose: 'mesh'` 的结果固定为 27 项：main 第一项，其余按当前 `meshNeighborhoodKeys()` 的 `y → z → x` 数值顺序输出，排除中心；主项 revision 必须不小于请求下界。`collision-resync` 固定为单项且 role 相同，revision 必须不小于下界。每项 generatorVersion 相同，canonical/fluid 分别严格为 65,536/32,768 字节。helper 不生成世界、不补 Air、不接受缺项。

`DedicatedServerHost` 新增：

```ts
captureBaseline(request: AuthorityBaselineCaptureRequest, signal?: AbortSignal): Promise<AuthorityBaselineCaptureResult>;
cancelBaselineCapture(captureId: number): Promise<AuthorityBaselineCaptureCancellation>;
```

Host 为每个新 capture 从 0 开始分配单调 `captureGeneration`，以 generation 拦截迟到准备结果。`captureId` 在同一 Authority epoch 内必须严格大于已接受 high-water；等于或低于 high-water 的新 capture 一律拒绝，不能在完成窗口过期后复用旧 id。取消回复只有在该 capture 的 lease、owner 和 reservation 已物理结算后才返回 `cancelled`；`cancelled`/`already-settled` 带非负 generation，`unknown` 的 generation 固定为 null。有界完成窗口只服务近期 cancel 查询：窗口内返回 `already-settled`，窗口外返回 `unknown`；正确性依赖单调 high-water，不依赖永久保存历史 map。

## 驻留预留与同步复制

`GameServer` 新增最小只读观察 `hasLoadedCanonicalChunk(key): boolean`。它校验 canonical key 后查询 `chunks.has(key)`，不复制数组、不更新 access epoch，也不改变浏览器现有 `canAdmit`/`getChunk` 语义。Host active-window 的 `isAvailable` 当前用 `readCollisionBaseline(key, 0).status` 每次复制 96 KiB；在测试确认其判断与 loaded 条件等价后改用这个观察口，避免保留周期性复制。mesh capture 复用现有 `retainMeshPreparationNeighborhood(cx, cy, cz)`；collision capture 新增对单 key 的 `retainCollisionBaseline(key)`，两者都只增加同一 `CanonicalChunkResidency` 的 preparation pin，并返回幂等 release closure。最终数据仍只由 `readCollisionBaseline()` 取得。

Host 内新增共享 canonical admission ledger，供所有 `requestChunk()` 和 capture 使用，而不是只给 capture 建一套旁路预算：

1. 新请求在任何 `await` 前用 `hasLoadedCanonicalChunk()` 区分 resident 与 unknown key；同 key 的 existing pending 只复用既有 reservation。
2. mesh 将一个主 key 展开为 27 项；collision 只有一项。单次 capture 不接受 key 数组，更不接受 256 个 mesh 主项。
3. 请求验证并展开完整 key 集后，capture 先取得 preparation retention lease，再调用会触发 residency maintenance 的共享 ledger。这样本次已经 resident 的目标不会在预算检查中被驱逐后又被计作 unknown 并重新生成；对尚未 resident 的 key 加 pin 不增加 residentCount，也不绕过 hard limit。
4. ledger 对新 unknown union 做一次原子预留，同时检查 `residentCount + reservedUnknownCount <= hardLimit` 以及现有 pending 加新增 key 不超过 Host `pendingChunks`。失败时不调用任何 `requestChunk()`，并在 `finally` 释放刚取得的 retention。
5. `requestChunk()` 自身也必须先经过同一 ledger；bulk reservation token 传给后续逐 key调用，避免二次计数。其它输入、活动窗口或 mutation preparation 同时请求 Chunk 时，只能复用同 key reservation 或在剩余预算中另行预留。
6. reservation 绑定底层 shared `requestChunk()` 的物理完成，而不是 capture caller 的等待期限。取消某个 capture 不提前释放仍执行的 shared admission；底层请求完成后再减计数。GameServer 的实际 `canAdmit()` 仍是最终权威门，若其它同步世界路径使预留无法兑现，capture 整体返回 `residency-pressure` 并清理，不得越过 hard limit。

retention 与预留成功后，capture 在同一事件轮次启动所有尚未完成的 `requestChunk()`。全部返回 true 后，Authority Worker 在一个不含 `await` 的同步 helper 调用中读取一次 Authority checkpoint `{ epoch, physicsTick, commitSequence, worldRevision }`，再按确定顺序逐项执行一次 `readCollisionBaseline()`，复制 `(key, revision, generatorVersion, canonical, fluid)`，最后复核 checkpoint 未变化。四个字段直接复用 `AuthoritySnapshot` 的真实字段与类型；不带与本次块采集无关的 worldTime。JS 事件循环在这段同步调用中不能应用 edit/fluid/mailbox，因此 checkpoint 与 27 项形成同一 Authority 观察边界。该 checkpoint 的 `commitSequence/worldRevision` 只表示 bundle 所见世界状态与 Authority C 的上界；每项仍以自己的 `chunkRevision` 为真值，不能把 checkpoint C 伪造成该 Chunk 的精确最后修改因果号。

若未来复制实现引入异步步骤，必须改为复制前后比较完整版本向量，任一变化使整个结果 `superseded`；不能以 retention lease 冒充 mutation lock。owned copy 完成后即可释放 preparation lease，hash、网络分页和传输只使用这些副本。调用方修改返回 buffer 不得改变 Server Chunk，复制完成后的世界编辑也不得改写已返回 buffer。

## Node Authority lane 接线

新增三个 operation kind：

- `authority-capture-mesh-baseline`
- `authority-capture-collision-baseline`
- `authority-cancel-baseline-capture`

`NodeAuthorityLane` 可公开统一 `captureBaseline(request)`，按 purpose 选择前两个 kind；取消使用第三个 kind，不能对 in-flight capture 调通用 RPC `AbortSignal`。worker handler 把 RPC server 提供的 signal 传入 Host，仅用于控制端口失败/关停时触发 owner 取消；它仍须等待 Host 的物理结算。

request validator 严格限制 captureId、合法 key、非负安全整数 minimumRevision 和固定 purpose，禁止额外字段。response validator 严格检查 union shape、captureId/generation、purpose/role、27 或 1 项、确定 key 集合与顺序、revision、generatorVersion、唯一 ArrayBuffer 以及长度；façade 再把回复的 captureId、purpose、key 和最低 revision 与原请求交叉核对，错配按现有 collision baseline 先例关闭 RPC 并使 lane failed。

available 回复使用 54 个 mesh ArrayBuffer 或 2 个 collision ArrayBuffer 作为 transfer list；worker 在 validator 和 `measureNodeRpcBytes()` 完成后一次转移，main 获得唯一所有权，不再无条件 `.slice()` 制造第二份 2.53 MiB 副本。unavailable/cancel 回复不携带 block。

初始实现保留控制 RPC 的 4 MiB 单回复硬上限。测试必须用完整 27 项真实 shape 记录 DTO 总字节，证明它高于 2,654,208 原始块且低于 4 MiB；未得到该证据前不写“约 2.53 MiB RPC”。`reserveResponseBytes` 对 mesh/collision/cancel kind 分别保留 `min(4 MiB, maxResponseBytes)`、`min(128 KiB, maxResponseBytes)`、`min(1 KiB, maxResponseBytes)`；response reservation 一直保留到 client 校验并 ACK。当前 Host/lane 的 epoch 只要求非空，capture validator 不单独增加 256 长度上限；极长但已被 Host 接受的 epoch 若使 collision/cancel DTO 超过固定 reservation，将明确拒绝而不是放宽预算。若完整 mesh DTO 达到 4 MiB，当前设计保持 RED，改用专用端口或内部分页，不能提高共享控制 RPC 限额掩盖问题。

两种 capture kind 通过可选 `dispatchOrderKey` 归入同一派发组：后来的小 collision 请求不能在早到的 mesh 因预算等待时越过它，以保持 Host captureId 的严格递增。该限制只约束开始执行顺序；已派发请求可以并发完成。cancel 不入组，其他 lane 不配置分组时沿用既有预算调度。`tests/node/authority-capture-dispatch-order.test.ts` 必须以真实 MessageChannel、未 ACK 的响应占用复现旧顺序 RED，再验证正确派发与 ACK 释放。

通用 RPC 没有控制消息优先队列：四个各预留 4 MiB 的 mesh 回复可以占满 16 MiB `maxReservedResponseBytes`，随后到达的 cancel RPC 仍可能排队。本切片只承诺取消请求被执行后等待全部已接纳生成物理结算再回复，不承诺即时取消或控制优先；真正的网络 bulk/control 调度在后续 adapter 切片解决。

## 取消、失败与关停

- 取消在准备前发生：不启动生成，释放 owner/lease/尚未交给 shared request 的 reservation 后返回 `cancelled`。
- 取消在部分生成后发生：标记 generation 失效，停止尚未启动的工作；已被 Host 接纳的 `requestChunk()` 和 compute/mailbox 继续物理结算。capture 等全部已接纳工作完成后释放 lease/owner，且不复制或发布 bundle。
- 多个 capture 或其它 Host 路径共享同 key 时，取消一个 owner 不取消 shared `requestChunk()`、不释放其它 owner 的 retention，也不删除已驻留 canonical。
- 任一 key false、minimumRevision 不满足、版本复核失败、validator/transfer 失败、RPC close 或 worker failure，都必须走同一 finally，释放本 capture 的 owner、lease 和未移交 reservation；已移交 shared request 的 reservation 由其 completion 释放。
- Host 进入 draining 后拒绝新 capture，给现有 capture 发取消信号，并在最终保存和 `stopped` 前等待它们及其已接纳 Chunk 工作结算。RPC failure 时现有 `host.stop() → rpc.whenIdle()` 清理顺序必须使 capture handler 最终退出；不能 abort 后立即报物理完成，也不能为了清理硬杀仍在完成持久化/生成的 Worker。
- diagnostics 至少暴露 `pendingBaselineCaptures`、`baselineCaptureOwners` 和 `reservedCanonicalAdmissions`，使取消、失败、停止后的零泄漏可断言；它们是 Node/Host 诊断，不进入公开网络 DTO。

## RED 与验证路径

先新增测试取得缺少类型、Host 方法和 RPC kind 的真实 RED，再写实现：

1. `tests/server/authority-baseline-capture.test.ts`：纯 helper 拒绝非法 key/revision/shape；mesh 精确 main+26、collision 精确一项；确定顺序、minimumRevision、每项长度、输入和输出 buffer 副本隔离；checkpoint 与数据来自同一同步观察，前后 checkpoint 改变时整体 `superseded`，且 checkpoint C 不被写进任一 entry 当作 Chunk 因果号。
2. `tests/server/dedicated-host-baseline-capture.test.ts`：真实 `requestChunk()` 补齐 27 个未编辑基础块；通过受控 executor barrier 证明 union 预留发生在生成前、重叠 key 只计一次、普通并发 `requestChunk()` 使用同一 ledger、超过 hard limit/pendingChunks 时零 dispatch；已 resident 目标在 maintenance 前先被 pin，不能无谓驱逐并重新生成；持久化准备或生成的单项失败使 bundle 整体 unavailable，并保留原有 `failedJobs/failure` 诊断；captureId 必须严格递增，已完成 id 即使离开有界查询窗口也不能复用。
3. 同一 Host 测试覆盖取消三个时点：生成前、部分 accepted 后、owned copy 后；断言迟到结果不发布、共享请求不被误杀、cancel Promise 只在物理结算后完成，最终三项 diagnostics 为零。`stop()` 并发 capture 时拒绝新请求并等待旧 capture 清理。
4. `tests/node/authority-baseline-protocol.test.ts`：严格 request/response schema，27/1 shape、checkpoint 四字段、错误长度、重复或缺 key、purpose/role、unavailable/cancel 无 buffer，以及极长 epoch 超固定 collision/cancel reservation 的明确拒绝。
5. `tests/node/authority-baseline-rpc-budget.test.ts`：完整 27 项响应的 raw block 为 2,654,208 字节、`measureNodeRpcBytes()` 的真实 DTO 总量低于 4 MiB、54 个 buffer 转移后 worker 侧已 detach、main 获得唯一所有权；response reservation 保持到 ACK，并记录四个 mesh 占满共享 16 MiB 后 cancel 会排队的阶段局限。不得用小 synthetic DTO 推断最大回复。
6. `tests/node/authority-lane-baseline-capture.test.ts`：真实 `worker_threads` 路径先因未知 kind RED；GREEN 后验证 epoch/generation/RPC request id、captureId/purpose/key/revision 交叉绑定，wrong response 关闭 lane，unavailable/cancel 终态，以及 control port 失败后的物理清理。
7. 故障用例关闭 control port 或在 capture 中注入生成失败，断言 `whenFailed()` 先可见，`whenExited()` 只在 Host capture、compute、最终保存与 worker 物理退出后结算；不运行 benchmark，也不把这些 Node 测试称为远端网络 E2E。

聚焦命令只运行上述两个 server 文件和三个 Node 文件及其 Prettier/ESLint。全仓 `verify:static`、build、coverage、Node 22/26 组合和产品入口由主线统一执行。

## 阶段边界

本计划完成后仍只有 Authority 内部的完整、可取消、可计量 owned capture。下一阶段才把纯 interest reference DTO 映射到一次 capture、将结果拆成公开 descriptor/page、实现 session owner/refcount 与浏览器安装门。认证、任意多客户端公平调度、WSS/WebTransport/WebRTC 选择、压缩和实际网络背压继续留在后续切片。
