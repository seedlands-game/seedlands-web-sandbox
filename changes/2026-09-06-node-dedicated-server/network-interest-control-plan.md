# Interest 控制参考 DTO 实施计划

## 目标与范围

本切片仅新增独立的 v1 参考 DTO、严格校验和投影副本，用于描述未来远端会话中的 Chunk interest 控制。它不接入 Host、Authority、Node、浏览器、codec、baseline bytes 或真实 session 状态机，也不改变既有 `network-message-semantics.ts` 的草案消息。

所有对象均固定 `projectionVersion: 1` 和 `wireStatus: 'not-adopted'`。完成后只证明受限对象可被规范化为没有未知字段的副本，不证明客户端已经被授权、interest 已被接受、取消已生效或碰撞 baseline 已可读取。

## 新类型与边界

计划新增 `src/server/protocol/network-reference-interest-control.ts`，其中公开以下类型：

```ts
type InterestSessionRef = Readonly<{
  epoch: string;
  serverEpoch: string;
  sessionId: string;
  worldId: string;
}>;

type InterestControlTrustedContext = Readonly<{ ref: InterestSessionRef }>;

type InterestKeyDemandReference = Readonly<{
  key: string;
  minimumRevision: number;
}>;

type InterestRequestReference = Readonly<{
  kind: 'interest-request-reference';
  projectionVersion: 1;
  wireStatus: 'not-adopted';
  ref: InterestSessionRef;
  requestId: number;
  demand: readonly InterestKeyDemandReference[];
}>;

type InterestAcceptedReference = Readonly<{
  kind: 'interest-accepted-reference';
  projectionVersion: 1;
  wireStatus: 'not-adopted';
  ref: InterestSessionRef;
  requestId: number;
  interestId: number;
  granted: readonly InterestKeyDemandReference[];
  rejected: readonly Readonly<{
    key: string;
    reason: 'invalid-key' | 'over-limit' | 'not-available' | 'residency-pressure';
  }>[];
}>;

type InterestCancelReference = Readonly<{
  kind: 'interest-cancel-reference';
  projectionVersion: 1;
  wireStatus: 'not-adopted';
  ref: InterestSessionRef;
  requestId: number;
  targetRequestId: number;
  interestId: number | null;
  keys: readonly string[];
}>;

type InterestCancelledReference = Readonly<{
  kind: 'interest-cancelled-reference';
  projectionVersion: 1;
  wireStatus: 'not-adopted';
  ref: InterestSessionRef;
  requestId: number;
  targetRequestId: number;
  interestId: number | null;
  scope: 'whole-pending-request' | 'whole-interest' | 'granted-keys';
  keys: readonly string[];
  status: 'cancelled' | 'already-cancelled';
}>;

type CollisionBaselineRequestReference = Readonly<{
  kind: 'collision-baseline-request-reference';
  projectionVersion: 1;
  wireStatus: 'not-adopted';
  ref: InterestSessionRef;
  requestId: number;
  interestId: number | null;
  purpose: 'collision-resync';
  key: string;
  minimumRevision: number;
}>;

type InterestControlReference =
  | InterestRequestReference
  | InterestAcceptedReference
  | InterestCancelReference
  | InterestCancelledReference
  | CollisionBaselineRequestReference;
```

`ref` 只能与调用者提供的可信 `InterestControlTrustedContext.ref` 逐字段相等。它是接入层已经认证并选择出的 identity；玩家身份和协议版本已在认证握手上下文绑定，不在每条此类参考 DTO 重复。投影不从传入 DTO 推导 identity，也不接受客户端 capability、issuer、actor id、位置、半径或任何资源预算字段。

## 投影和校验 API

```ts
function projectInterestControlReference(
  value: unknown,
  context: InterestControlTrustedContext,
): InterestControlReference;

function validateInterestControlReference(value: unknown, context: InterestControlTrustedContext): boolean;
```

`projectInterestControlReference()` 是唯一的规范化入口：按 `kind` 校验完整 shape、精确 SessionRef、所有嵌套字段和资源上限后，重新构造数组/对象并返回独立副本；失败抛出 `TypeError` 或 `RangeError`。所有编号在校验后经 `canonicalReferenceInteger()` 规范为 `+0`。`validateInterestControlReference()` 仅判定该对象能否投影，失败转为 `false`；它不规范化原对象、不返回或缓存原对象，消费者必须使用 project 的返回副本。两者都拒绝未知字段，绝不透传扩展属性。

这两个函数不保存 request 表，也不根据一次 `interest-accepted` 投影建立授权。未来 session adapter 才能关联 requestId、interestId、取消 tombstone、受信任玩家位置、视距、驻留 lease 和队列预算。

## 固定门禁

- `requestId`、`targetRequestId`、`interestId`、`minimumRevision` 都必须是非负安全整数，并在投影中将 `-0` 规范为 `+0`；`requestId` 与 `targetRequestId` 同时出现时必须不同。
- 字符串 identity 非空且有 256 code-unit 上限；Chunk key 必须能由现有 `chunkKey(cx, cy, cz)` 回构为完全相同的 canonical 文本，坐标为安全整数。
- 一条 interest request 的 `demand` 必须为 1 到 256 项，key 唯一；每项有合法 `minimumRevision`。不静默去重或重排来掩盖错误。
- `interest-accepted` 的 granted/rejected 合计为 1 到 256 项，两个集合 key 不重叠；granted 带 `minimumRevision`，rejected 仅带允许的明确原因。此处不声称这些项确实来自某个既存 request。
- cancel 的 `requestId` 是此次取消操作自身编号；`targetRequestId` 仅标识欲取消的原 request。`interestId: null` 时 `keys` 必须为空，表示 whole pending request；数值 interestId 时 keys 至多 256 项、唯一且 canonical。
- cancelled 的 `scope` 与 nullable interestId/keys 一致：`whole-pending-request` 只允许 null 和空 keys；`whole-interest` 只允许数值 interestId 与空 keys；`granted-keys` 只允许数值 interestId 与 1 到 256 个 key。它只描述 Host 已给出的 terminal 结果，不实施幂等或阻止迟到 accepted。
- collision baseline request 固定 `purpose: 'collision-resync'`，key 和 minimum revision 合法，interestId 可为 null。null 仅保留“尚无表现 interest 的重同步请求”这一请求 claim；它绝不自动给予客户端任意 key 的 collision、生成、驻留或 baseline 读取权限。未来 Host 需以认证玩家 snapshot/commit 关联、world/session 身份和资源预算独立裁定。

## RED 与验收

建议新增 `tests/server/network-reference-interest-control.test.ts`，先以缺模块 RED 覆盖：

1. 五种合法对象的投影、深副本和稳定字段；修改输入后输出不变。
2. epoch、serverEpoch、sessionId、worldId 任一项与可信 context 不匹配即拒绝。
3. 负数、`-0` 之外的非安全整数、`NaN`、`Infinity`、257 keys、重复/非 canonical key、未知字段均拒绝。
4. cancel requestId 与 targetRequestId 相同、null interestId 携带 keys、cancelled scope 与 nullable id/keys 矛盾均拒绝。
5. accepted 的 grant/reject 重复或合计超限，以及 collision request 的错误 purpose 或 null interestId 被误当授权，均拒绝或保持为未经授权的纯 DTO。

GREEN 条件是上述纯单元通过、目标 Prettier/ESLint/typecheck 通过。该阶段不采集语料、不运行 codec、Host、Node、浏览器、benchmark、全仓静态或构建。

## 非目标与后续门禁

不实现 baseline bundle/page、bytes/LE/hash、27 Chunk 邻域、传输队列、interest ownership、取消 tombstone、session 状态机、权限裁定、admission reservation 或客户端 cache/GPU 释放。它们必须由下一阶段的真实 Authority/Host adapter 在已认证会话中完成，并以真实 Host corpus、资源预算和乱序/取消回归证明。
