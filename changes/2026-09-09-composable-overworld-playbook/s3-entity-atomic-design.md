# S3 EntityStore 预备事务参与者设计

## 边界与入口

本切片只提供宿主内部的单 `EntityStore` 参与者，不从 `mod-api` 导出。根任务负责把它与 World edit、Combat、规则、facts 等其他 owner 放入同一个协调器。

```ts
type PreparedActorReplacement = Readonly<{
  reference: EntityLifetimeReference;
  health: number;
  components: ActorComponentSnapshot;
}>;

type PreparedWorldItemSpawn = Readonly<{
  id?: string;
  position: readonly [number, number, number];
  physicsVelocity?: readonly [number, number, number];
  stack: ItemStack;
}>;

type PreparedEntityMutationInput = Readonly<{
  actors?: readonly PreparedActorReplacement[];
  spawns?: readonly PreparedWorldItemSpawn[];
  despawns?: readonly EntityLifetimeReference[];
}>;

type PreparedEntityMutation = Readonly<{
  spawnIds: readonly string[];
  validate(): void;
  apply(): PreparedEntityMutationResult;
}>;

prepareEntityMutation(store, input): PreparedEntityMutation;
```

输入总项数必须为 `1..128`。actor replacement 与 despawn 都必须携带当前完整 `EntityLifetimeReference`；同一 entity ID 不能在 actor/despawn/spawn 间重复或冲突。spawn 只接受 world-item 字段，显式 ID 服从现有 canonical/issued 规则，缺省 ID 在 prepare 阶段按当前 `sequence` 确定。

## prepare

prepare 在不修改 live owner 的情况下完成：

1. 捕获 owner 对象、epoch、entity sequence、lifetime/order high-water；
2. 解析全部 touched reference，并保存现有 entity 投影；actor 额外保存完整 component snapshot；
3. 将 actor snapshot 的校验拆成 `prepareActorComponentSnapshot` 与 `installPreparedActorComponentSnapshot`。前者先验证 needs、Inventory/item instance、equipment、lifecycle/control、mode、player spawn/break action，并持有脱离调用者的候选；后者只写已验证字段；
4. 验证 candidate health 与现有 maxHealth，以及 health/lifecycle 一致性；
5. 规范化并复制每个 world-item position、velocity 与 stack instance；
6. 预分配确定性 ID，并检查 issued IDs、sequence、lifetime 与 order 容量。

普通 `restoreActorComponentSnapshot` 同样改为 prepare 后 install，避免 player 末尾坏字段在同一 owner 内造成部分写入。

## validate

`validate()` 不写状态。它验证：

- 仍是捕获的 owner 与 epoch；
- allocator sequence、lifetime/order high-water 未漂移且仍有完整 spawn 容量；
- 所有 touched reference 仍可解析为同 lifetime；
- touched entity 投影以及 actor component snapshot 与 prepare 时一致；
- 所有 planned spawn ID 仍未存在、未 issued。

因此通过 retained actor/inventory handle 改动候选 actor 后，或 restore 替换 owner/epoch 后，参与者会变 stale。

## apply

协调器必须先调用 `validate()`。`apply()` 在开始安装前再做一次 live-only freshness 检查并立即关闭参与者，防止 validate/apply 间的同步误用；随后只执行：

1. 安装已预备 actor components 与 health；
2. 按 reference despawn；
3. 通过 owner 的 prepared-create 路径安装已验证 world items，更新 buckets 和预定 sequence。

apply 不读取调用者对象、不调用外部 callback、不创建另一整个 ECS world、不改变 epoch。已预检的 domain 规则不会在安装阶段再次运行。一次 apply 后 validate/apply 均拒绝复用。

## RED 设计

1. 最后一个 actor candidate 的坏 Inventory/item instance 使 prepare 失败，前面的 actor 与 spawn 均不变。
2. lifetime/sequence/order 容量耗尽使 prepare 失败，actor components、实体、allocator frontier 与 reference 均不变。
3. 成功批次一次提交 player health/Inventory、despawn 与多个 drops；调用者随后改输入不泄漏，untouched reference 和 world epoch 保持有效。
4. prepare 后通过 retained handle 改 actor，或 restore 更换 epoch，validate/apply 均拒绝且不安装候选/spawn。
5. duplicate/conflicting ID、retired explicit ID、sequence exhausted、重复 apply 与未 validate apply 均拒绝。
