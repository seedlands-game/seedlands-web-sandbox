# V2 Restore Reference Observability 合同

阶段：`V2-RESTORE-REFERENCE-OBSERVABILITY-01`
基线：`01c650793c79ac34e6184da48b5a4c94a5f161c2` / tree
`e20a8b1d85520c960096b5c898c3ffdd7e241b2a`
状态：`IMPLEMENT + FOCUSED DETERMINISTIC/STATIC`；不运行 Browser、build、artifact 或 Git。

## 目标与非目标

目标是让同一通用 World Harness 在 Headless 与 Browser Worker transport 上，以当前 Authority owner 的真实
`resolveEntityReference` 判断一个调用方持有的 `EntityLifetimeReference` 为 `current` 或 `stale`，并让既有 Classic
equipment restore journey 记录和消费该结果。

本片不改变 `EntityStore.restore`、保存 schema、gameplay action、inventory pointer、death/combat、world-item 投影、
Classic scenario、路线/瞄准/鼠标、900s/60s 预算、协议版本、Kernel、Pack composition、公共 exports、CI 或 runner。
不新增第二 Harness/helper/fallback，不把 epoch 比较或当前投影查询冒充 reference resolve。

## 接口与 owner

`WorldHarnessPort.inspect` 增加：

```ts
type EntityReferenceInspectRequest = Readonly<{
  kind: 'entity-reference';
  reference: EntityLifetimeReference;
}>;

type EntityReferenceInspectResult = Readonly<{
  kind: 'entity-reference';
  reference: EntityLifetimeReference;
  status: 'current' | 'stale';
}>;
```

- `packages/stdlib/src/server/harness/world-harness-contract.ts` 拥有公开形状。
- `world-harness-validation.ts` 拥有 untrusted request 的 exact-key 验证与 detached readonly copy。外层只能有
  `kind/reference`，reference 只能有 `entityId/epoch/lifetime`；id 必须 trimmed、非空、最长 256；epoch/lifetime 必须为
  `1..Number.MAX_SAFE_INTEGER`。accessor、数组、null、缺字段、额外字段、0/负数/小数/越界都拒绝。
- `world-harness-operations.ts` 把规范化 request 映射为
  `{resource:'world.entity', operation:'read', target:{kind:'entity', entityId}}`。
- `authority-world-harness.ts` 在排队授权描述阶段取得规范化 detached request；既有 `run()` 完成 authorization 后，
  execute 阶段才调用当前 `AuthorityServerPort.resolveEntityReference`。存在同 id 但 epoch/lifetime 不同，或实体不存在，
  都返回 `stale`。结果再经平台 clone，不泄露 owner 或输入别名。
- Browser Authority world port 和 Worker RPC 已按 `keyof WorldHarnessPort` 泛型透传，本片不得为此增加协议版本或专属
  transport。非 Classic Headless 实例消费同一实现；不把 Classic 行为放进 stdlib。

## 授权与失败

1. malformed 请求在授权映射前结构化返回 `WORLD_REQUEST_INVALID/validation`，不 resolve、不改变任何状态。
2. 合法请求先检查 `world.entity/read`；self scope 使用 `reference.entityId`。未授权返回
   `WORLD_PERMISSION_DENIED/permission`，不得通过 current/stale 泄漏目标是否存在。
3. 授权后的合法旧 epoch、错误 lifetime 或不存在 id 返回 `ok:true`、`status:'stale'`，不是 unavailable。当前完整
   reference 返回 `ok:true`、`status:'current'`。
4. 输入 reference、返回 reference 与 owner 状态互不共享可变别名；排队期间调用方修改原请求不能改变授权目标或解析目标。
5. 所有路径保持 world revision、gameplay revision、inventory revision、actor state 与 entity set 不变。失败 restore 不换
   owner，因此其前置 ref 仍 current；成功 restore 换 owner，因此 old stale，restore 后新 ref current。

## TDD 与证据

### RED

- 真实非 Classic `HeadlessSession`：current；成功 checkpoint restore 后 old stale/new current；失败 restore 后 old
  current，且 world/gameplay/inventory revision 不变。
- 权限与输入：self ref 可读、foreign/unknown ref 在 self policy 下均 permission denied；malformed/missing/extra keys 与非法
  id/epoch/lifetime 均 validation failure；请求排队后突变不改变已规范化 identity。
- Browser Worker adapter：真实 `BrowserAuthorityClient.world.inspect` 发出一个携带当前 runtimeEpoch/requestId 的
  `world-harness-rpc`，并原样接收 current/stale 或结构化 failure。返回对象与提交对象无别名。
- focused consumer：不用假 Page；抽取一个纯 orchestration helper，按顺序用同一个 inspect port 检查传入 old ref stale、
  restored snapshot 的 new ref current，任何 stale/current 反转、validation、permission 或 transport failure 都在调用 UI
  continuation 前抛错；成功返回可直接写入 restore evidence 的 old/new request+status。

RED 必须由当前缺少 `entity-reference` variant 或 consumer 调用而失败，不能是 import/collection/config 错误。失败 raw 与窗口
原样保留。

### GREEN 与 affected scope

先运行上述 3 个 focused files，`--maxWorkers=1`；再运行 stdlib/Web/Classic/root 必要 types、目标 ESLint、正常
Prettier 和 allowlist diff。所有命令串行持有默认 machine lock，不嵌套。复用既有已通过的 145/16，不机械重跑全量。

Classic restore evidence 的最小记录形状：

```ts
{
  referenceStatus: {
    old: { reference: before.actor, status: 'stale' },
    current: { reference: restored.actor, status: 'current' }
  },
  v2Equipment: { phase: 'restored' | 'detached' | 'continued', ... }
}
```

只有 old/new 两项均由同一 `window.__seedlandsHarness.world.inspect` 返回且校验通过后，才执行已有正式 UI helmet
detach/reequip。此处只证明 Authority lifetime reference；JS object identity 和 retained access 抛错继续由既有 Headless
restore suite 证明。

## 完成条件与停止线

- shared Harness、真实 Headless restore、Browser Worker RPC、focused consumer 的正反例 GREEN；协议仍为 version 1。
- current/stale 不泄漏未授权实体，不接受 malformed 引用，不改变状态，不受请求别名突变影响。
- existing equipment restore callback/receipt 记录 old/new reference status；既有 UI continuation 顺序不变。
- source/type/lint/format/scope 门禁通过；证据严格绑定 HEAD、diff、RED/GREEN 原始输出。
- 真实 Browser 明确 `NOT_RUN`；其准出需要本片提交后的新 production artifact 和 root 唯一 Browser 租约。

如编译必须越出已授权 allowlist，或需要 protocol version、写接口、Kernel/Pack/fixture/scenario/runner 变更，立即停止并
报告最小扩展建议。3 小时内不能闭合则保留 RED 与 dirty checkpoint 退出。

## 工作量与预算

传统工程量 `0.25-0.5 PD`，120% 建议 `0.6 PD`；AI 基准 `2h`，120% 建议 `2.4h`，硬上限 `3h`。单
agent、测试串行。credits、费率、API 等价费用、当前额度与预测占比均为 `unknown`。
