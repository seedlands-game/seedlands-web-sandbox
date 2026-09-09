# S3 持久执行来源设计

## 边界与身份

宿主 `WorldPrincipal.id` 仍是本次运行的别名。新增可选 `subject` 作为宿主显式配置的跨宿主稳定主体。authorizer 构造时要求已配置 subject 非空、无首尾空白、长度不超过 256，并在同一个 policy 中唯一；未配置 subject 的旧即时授权仍可工作，但不能捕获或恢复持久来源。

`principalForSubject(subject)` 只做完全相等查找，不读取 principal ID、labels 或 bound actor，也不合成管理员主体。

## V1 schema

```ts
type DurableExecutionOriginV1 = Readonly<{
  version: 1;
  principalSubject: string;
  provenance: Readonly<{ packId: string; moduleId: string }>;
  originalActor: Readonly<{ entityId: string; lifetime: number }>;
}>;
```

schema 不保存 principal alias、labels、permission、target 或 runtime epoch。所有字符串使用精确、非空、有界值；对象只允许列出的 enumerable 自有 data descriptors。`validateDurableExecutionOrigin` 在读取字段前拒绝 getter/setter，再从不可信 JSON 构造并冻结一个规范副本；额外字段、epoch、坏版本和坏 lifetime 同样拒绝。

## capture

```ts
captureDurableExecutionOrigin({
  composition,
  authorizer,
  identity,
  binding,
  request,
}): DurableExecutionOriginV1;
```

capture 只接受当前真实 binding：

1. composition 中存在完全匹配的 pack/module provenance 与 module binding；
2. 当前 principal ID 存在且显式配置 subject；
3. host-bound principal 与 original actor 一致；
4. identity port 能为 actor 返回并解析当前 `EntityLifetimeReference`；
5. 当前 authorizer 允许完整 resource/operation/target；
6. 当前 module permission 允许同一 resource/operation。

通过后只持久化 actor lifetime，不保存当前 epoch。

## rebind

```ts
rebindDurableExecutionOrigin({
  origin,
  composition,
  authorizer,
  identity,
  request,
}): ReboundExecutionOrigin;
```

rebind 首先重新做 V1 schema 校验，再按当前 composition、authorizer 和 identity 解析：

- provenance 的 pack/module 必须仍精确匹配；
- subject 必须在当前 authorizer 中有唯一显式映射；
- 当前 principal 的 bound actor 必须与保存 actor 一致；
- actor 必须仍存在且 lifetime 相等；返回当前 `referenceFor` 的新 epoch binding，并用 `resolve` 证明当前引用有效；
- 当前 authorizer 必须允许本次 request 的 resource/operation/target；当前 module permission 也必须允许。

成功结果包含当前 principal alias、可直接接现有 registered-operation 的 binding、当前 actor lifetime reference 以及冻结的 `ModuleExecutionContext`。任何失败抛出 `TypeError`，调用方在执行 protected effect 前取消或拒绝恢复。

## RED 设计

1. Browser alias 捕获后 JSON roundtrip，在 Headless alias 的同 subject、同 actor lifetime、新 epoch 中成功 rebind。
2. 不同 subject、缺失 subject、重复 subject、labels/alias 猜测均失败。
3. 当前 target grant 被撤销、self target 改变或 module permission 被撤销均失败。
4. 未知 pack/module、host-bound actor 不一致、actor 缺失或 lifetime 变化均失败。
5. schema 拒绝 epoch、额外字段、空/过长 identity、坏版本和坏 lifetime；输出及嵌套对象被冻结。
