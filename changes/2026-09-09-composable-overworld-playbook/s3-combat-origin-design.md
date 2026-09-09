# S3 Combat durable origin 设计

## 稳定入口

在现有构造参数后增加可选配置，不改变前三个参数：

```ts
type CombatOriginValidationPort = Readonly<{
  validate(
    origin: DurableExecutionOriginV1,
    checkpoint: CombatOriginCheckpoint,
  ): Readonly<{ ok: true }> | Readonly<{ ok: false; reason: string }>;
}>;

type CombatOriginRuntimeOptions = Readonly<{
  requireOrigin?: boolean;
  validationPort?: CombatOriginValidationPort;
}>;

new CombatRuntime(callbacks, meleeRegistry?, identityPort?, originOptions?);

combat.request(actorId, targetId, definitionId, createActionId?, origin?);
```

`checkpoint` 包含 `stage: 'request' | 'restore' | 'hit'`、actorId、targetId、definitionId 和 comboStep。根任务的 port 使用这些当前请求字段构造准确授权请求，再调用 `rebindDurableExecutionOrigin`。`requireOrigin: true` 要求同时配置 port；缺少 origin 的新请求在任何 live 写入或 action ID 分配前返回 `origin-required`。

## 接收和延迟执行

CombatRuntime 自己先用 `validateDurableExecutionOrigin` 校验并冻结输入，因而 accessor、额外字段或坏嵌套 schema 在读取字段值前拒绝。随后核对：

- `origin.originalActor.entityId` 等于请求 actor；
- 保存 lifetime 等于当前 actor identity lifetime，epoch 不写入 origin；
- validation port 按当前 composition、subject、provenance、权限和本次 target/operation 重新绑定。

当前 step 和 buffered step 分别持有各次 request 提供的 origin。buffer request 缺失 origin 时拒绝，不复制当前 origin。combo 进入下一个 windup 时只移动该 buffered origin。

每次 windup 即将进入 hit、调用 `applyDamage` 之前，再执行 actor lifetime 与 validation port 检查。失败用 port 的有界确定性 reason 取消，不产生 damage。hit/recovery 已经有 dedupe result，不再次验证已消失的致死 target，也不重放 damage。

## V3 codec 与恢复

Combat checkpoint V3 在 V2 的 actor/target lifetime binding 上增加：

```ts
active.origin: DurableExecutionOriginV1;
active.bufferedOrigin: DurableExecutionOriginV1 | null;
```

buffered origin 的有无必须与 buffered target 一致。V3 restore 先校验所有 combat projection、identity binding、origin schema、actor/lifetime 和需要未来 hit 的当前/buffered授权，构造完整 candidate 后才替换 live map/allocator/events。跨宿主 alias 不进入快照；port 按相同 stable subject 映射当前 principal。

`requireOrigin` 模式恢复 V1/V2 时不推测来源：保留快照 allocator/terminal combatants，再以 `restore-origin-missing` 取消 active。legacy 模式维持原行为：V1 `restore-cancelled`，V2 继续保留合法 in-flight。V3 malformed schema/accessor 直接拒绝，当前 live state 不变。

## RED

1. requireOrigin 的当前 windup 在授权撤销后命中前取消，damage 为零。
2. 两个不同 origin 分别进入当前与 buffer；撤销 buffer 来源只阻止第二次 damage，不能复制第一次来源。
3. V3 在新 epoch/不同 principal alias 下按同 subject restore，保留 timing 和两个来源；hit dedupe 与 lethal recovery 不重放。
4. requireOrigin 恢复 V1/V2 active 时确定性取消并保留 allocator/terminal history；legacy 既有语义不变。
5. request 与 V3 restore 的 origin accessor/坏 schema 在 live map、allocator、damage 改变前抛错；restore 原子保留旧状态。
