# Death mixed series 合同

阶段：`V2-DEATH-MIXED-SERIES-01 + PREDECESSOR-CAPTURE`  
基线：`9f5a6ff49cccb1e5ecb9fae9ae0ab9277f42769e`

## 公共输入

`prepareDeathInventorySettlementSeriesV1(entities, input)` 保持至少一个
`DeathInventorySettlementCandidateV1`，并新增可选
`additionalActorReplacements: readonly DeathInventoryAdditionalActorReplacementV1[]`。每项精确包含：

```ts
type DeathInventoryAdditionalActorReplacementV1 = Readonly<{
  source: DeathInventorySettlementSourceV1;
  replacement: PreparedActorReplacement;
}>;
```

`source` 是调度前的权威 frontier，包含 lifetime reference、health 和完整 actor components；
`replacement` 是同一 actor 的拟存活状态，可携带既有 actor replacement 的可选 position/physics velocity。构造过程
复制并冻结 source 与 replacement，调用者后续修改不影响 prepared mutation。additional replacement 必须保持
`health > 0` 且 `lifecycle === 'alive'`；死亡、despawn、
inventory drop 和 intrinsic drop 只能经 policy-governed death candidate 与已有 `intrinsicDrops` 输入表达。

## 原子与失败边界

- additional replacements、death replacements/despawns、所有容器 drops 和 intrinsic drops 按确定顺序合并，
  每段仍最多 `128` entries，且只调用一次 `prepareEntityMutationSeries`。既有 `192` segments 总预算不变。
- additional source 使用与 death candidate 相同的完整 freshness：reference/epoch/lifetime、health、needs、armor、
  inventory/cursor revision 和完整 components 必须仍与权威 ECS 一致。prepare 后继续由底层 series 校验 owner、
  epoch、sequence、lifetime/order high-water 与所有 touched snapshots。
- source 与 replacement reference 必须完全一致；additional 与 death candidates 跨集合不得重复 actor；
  replacement/despawn 互斥由 death candidate 保持。additional 只接受完整 `PreparedActorReplacement` 的字段，
  可选 position/physics velocity 复制冻结；它不接受 spawn、despawn 或其他绕过字段。
- 任一 source stale、非法附加字段、伪死亡 replacement、跨集合冲突、最终 spawn capacity 或 series 总预算失败，
  都在 apply 前失败且 survivor、dead actor、drops、inventory revision 与 allocator 均零写。
- 该接口只服务“至少有一个死亡”的混合批次。没有死亡的调用方继续使用普通
  `prepareEntityMutationSeries`，不把通用 actor update 反向塞入 death owner。

## Producer 边界

本片不接 Needs、Vitals、registered Combat、Autonomy 或 GameplayRuntime。后续 Needs producer 可把同一 schedule
中的存活 player/NPC needs update 放入 `additionalActorReplacements`，但仍须维持非 player health/lifecycle readonly；
player death 才进入 policy candidate。Autonomy effects 必须与返回的唯一 entity series 先全部 validate、再 apply，
不得两个 participant 先后 apply 冒充原子。

## Pre-death V4 身份

在修改 Classic Pack 前，从保留 clean BUILD02 tree 的已验证 Pack bytes 实际 load+assemble 捕获完整
`CompositionCheckpointIdentity`：

- source SHA：`1bbe3a60d55ffa5d05e405377624fbbd942e6327`；tree：
  `4d70cef0e00c8617290159e1aa83a685126b1fc4`。
- artifact receipt SHA-256：`aa4f6d8056335413523964fd1d2d4630c5261fb7ee4477c879a54ad0c145281a`；
  packs.lock SHA-256：`fd4054012073c1252f7f8a63d9d9d09ac968620c6859cff9ca78aaebda3d2332`。
- Pack manifest：`14e53b01e8c31a80d10bcb4109d3e3c13abe69b046b60f2ebc80bbd9f585bcb3`；
  entry：`4b12ea606bd12dc62e74ea40e5e90678231cf866fecd2ce2a97eea3a21c38142`。
- canonical identity：`39998` bytes，SHA-256
  `e799b930b686da9a8bd34d9052e4179e8624013bcbc774da81ff672ed6cd724a`，包含 `22` modules、
  `28` capabilities。完整 literal 在 `evidence/v2-death-mixed-series-01/pre-death-v4-identity.json`。

捕获使用 clean tree 自带 `scripts/pack-integrity.mjs` 校验并加载 `packs.lock.json` 和 entry bytes，再把同一
clean tree 的 assembly/canonicalizer 通过 esbuild `write:false` 仅在内存转译后执行。捕获前后 tree 均 clean，未重建
或修改 artifact。未来 Classic 安装必须把该完整 literal 作为 `gameplayVersions: [4]` 的 exact predecessor；不得只拼
digest，也不得从新 target 动态删除 death capability。现有 pre-Media target 剥离逻辑需在后续 Classic 串行阶段验证，
本片不改 migration。

## Done When 与预算

- 可执行 RED 证明旧 API 会忽略 survivor replacement；GREEN 覆盖 mixed success、detach、stale、冲突、非法绕过、
  capacity 零写、跨 128 entries，并保留既有 death policy/series/equipment 合同。
- stdlib、root test、Classic test types，精确 ESLint/Prettier/scoped diff 通过；原始失败和 window receipts 全部保留。
- 传统人工估算：`1.5-2.0 PD`；AI 活跃预算：`3-5h`，保守 `x120%` 上限 `6h`。实际工时在 evidence 回填。
  credits、API 等价费率、当前额度及分母均为 `unknown`，不伪造换算或占比。
- 不改长期 docs：本片只是当前 change 内已冻结 stdlib transaction 细化，不改变 Kernel/stdlib/Playbook/Web owner。

## 明确未完成

Classic policy 安装和 predecessor 声明、pre-Media 迁移适配、GameplayRuntime resolver/wiring、Needs/Vitals/Combat/
Autonomy producer、Browser/Cua、build、CI、Git/提交/推送均不属于本片。
