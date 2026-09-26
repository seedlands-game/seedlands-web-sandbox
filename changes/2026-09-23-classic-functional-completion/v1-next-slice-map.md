# V1 下一纵切实施图：A2/A3 → B 木门闭环

状态：Architecture consumer map / 当前树 2026-09-24；不是接口已实现声明。
目标：只闭环 Classic 两格木门，不提前泛化床、活板门、梯子或 transport。

## 1. 当前已存在

- `AuthorityAction.interact` 已携带 `target.voxel.{hit,adjacent}` 与四项 `expectedSelection`；network copy、语义校验和 Chunk preparation 已覆盖 hit/adjacent。
- `dispatchItemInteraction` 当前顺序仍是先取 selected item；空手直接返回 `no-selected-item`，尚非 target-first。
- Browser secondary input 当前顺序是 `useTarget(hit) → useHeldItem() → place(adjacent)`；`useTarget` 只打开 station，legacy `place` 丢失 hit/face。
- V1.3 已有 `StructureDefinitionV1`、per-world registry、`resolveTarget(position, read)`、legacy 唯一 pair fail-closed、placement/transition multi-edit candidate。
- A1 已有 `GameServer.prepareVoxelEdits(actorId, expected edits)`，可跨 Chunk 校验 expected voxel/fluid 并一次提交 canonical、metadata 和 fluid effects。
- Classic 已声明 voxel `89..104`、四朝向×closed/open×lower/upper；legacy `52` 不进入 `resolveVariant`，只由 bounded target resolver识别。
- `placementItemId` 是 Pack ID `seedlands:wooden-door`；inventory/runtime storage ID 是 `wooden-door`。
- 结构状态已编码在 Chunk voxel variants；不得新增 Gameplay snapshot child 或第二份门状态。
- `RegisteredMediaPlaybackRuntime.prepareDeviceRemoval(position)` 已是可扩展 dependent-removal participant。
- 几何仍是静态 `voxel-model.ts`：89..104 目前 `meshKind:'cube'`，Authority collision、player occupancy、recovery、Web/Worker mesh 尚不消费 Pack geometry。

## 2. 推荐决策

1. 木门普通放置改走现有 voxel `interact`，保留 Authority 可复核的 `hit→adjacent`；不扩 `place` wire schema。
2. 朝向只取 Authority 可验证数据：水平点击使用已校验的 `hit→adjacent` 水平法向；地表顶面/底面使用 Authority actor body position 到 placement cell 中心的水平主轴 bearing，固定 X/Z tie-break。仅 actor 与 cell 水平中心完全重合时返回 `ambiguous-placement-orientation`。当前树没有 Authority-owned yaw，不能假装读取 Web camera。客户端不能提交 definition/state/variant/orientation ID。
3. target-first 仅处理已注册 Structure target；结果为 `handled | not-structure | unavailable | malformed`。`unavailable/malformed` 终止，绝不回退 item/generic break。
4. target 非 Structure 时再按 selected item binding → generic place → held/self；兼容 water bucket。
5. Pack item ID→storage ID 必须由 composition definition map/content resolver预冻结；禁止字符串去 namespace 猜测。
6. Geometry 是独立 per-composition registry；Classic 只声明 boxes/material/collision，公共消费者统一读取。
7. Break 任一 half 解析同 root；world edits、single drop、inventory/tool、media dependent removal、receipt、cancellation 共享一个 prepared transaction。

## 3. A2：Target-first 与 face-preserving routing

### 公共文件 owner

- `packages/stdlib/src/server/gameplay/modules/structure-target-dispatch.ts`（新）
  - `resolveStructureTargetIntentV1(registry, hit, loadedReader)` → 四态结果。
  - `resolveStructurePlacementIntentV1(registry, selectedStorageId, hit, adjacent, itemIdResolver)`。
  - 只返回可信 definition/root/state/face；不执行写入。
- `packages/stdlib/src/server/authority/authority-player-action.ts`
  - voxel interact：先 Structure target；handled 时 invoke Structure operation。
  - not-structure 才调用现有 `dispatchItemInteraction`。
  - 成功 value 统一经 Structure/Block receipt acknowledge 发布 commit。
- `packages/stdlib/src/server/authority/authority-mutation-preparation.ts`
  - hit/adjacent 已准备后，按 selected variant/legacy candidate 的有界 footprint+support 补齐 Chunk。
  - await 后 operation host 必须重新 resolve；unknown 返回 `chunk-unavailable`。
- `packages/stdlib/src/server/protocol/network-action-reference.ts`
  - 增稳定失败原因：`structure-malformed`、`unsupported-placement-face`；不改 action shape。
- `packages/stdlib/src/server/composition/content-item-identity.ts`（新或现有 composition helper）
  - `itemStorageIdForDefinitionId(composition,id)` 与反向唯一 lookup。
- `apps/web/src/app/gameplay/browser-gameplay.ts`
  - `useTarget` 向 Authority 发送 voxel interact，而不是只查 station。
  - station 本地打开只能在已提交/可确认 station 路径，Structure 不被本地吞掉。
- `apps/web/src/app/player/secondary-interaction.ts`、`player-controller-types.ts`、`game-player-controller.ts`
  - `useTarget` 消费完整 `{position,adjacent}`；保留 face 到 Authority。

### A2 RED

- 空手点击正式门上下半均到 Structure operation，不返回 `no-selected-item`。
- 持 bucket 点击门仍先 toggle，不触发 bucket binding。
- 非 Structure target 保持 bucket 与普通 place 行为。
- legacy 孤立、错配、三连、跨 definition 歧义返回 malformed，world/inventory/revisions/receipt 不变。
- footprint/support 第二 Chunk unavailable 请求正确 Chunk并返回 `chunk-unavailable`；prepare 后 stale 重新解析并零提交。
- 地表顶面可放置；侧面/底面是否可放由 support/replaceable/occupancy 决定。伪造非相邻 hit/adjacent、朝向完全歧义、stale selection、越距、LOS blocked 全拒绝。

## 4. A3：Composition Geometry Registry

### 最小公共合同

```ts
type VoxelGeometryDescriptorV1 = {
  voxel: number;
  boxes: readonly { min: Vec3; max: Vec3; material: FaceMaterialId }[];
  collision: readonly { min: Vec3; max: Vec3 }[];
  occludesFullFace: boolean;
};
type VoxelGeometryRegistryV1 = { get(voxel: number): VoxelGeometryDescriptorV1 | undefined };
```

### 公共文件 owner / 全消费者

- `packages/stdlib/src/world/voxel-geometry.ts`（新）：严格 bounded/deep-frozen registry；storage ID 唯一、box finite 且在 0..1、material 已注册。
- `packages/stdlib/src/server/composition/contracts.ts`、`content-registration.ts`、`content-capabilities.ts`、`mod-api.ts`：Pack 注册与 capability；definitions-ready 可查询 closure。
- `packages/stdlib/src/world/voxel-model.ts`、`voxel-model-mesh.ts`、`mesh-semantics.ts`：legacy 0..88 adapter + composition resolver，不再让 89..104 回退 cube。
- `packages/stdlib/src/server/authority/voxel-collision-world.ts`：collision resolver。
- `packages/stdlib/src/server/gameplay/player-occupancy.ts`：placement collision resolver。
- `packages/stdlib/src/server/authority/authority-geometry-recovery.ts`：commit delta recovery resolver。
- `packages/stdlib/src/server/authority/authority-ready.ts`、`authority-mesh-payload.ts`、protocol copy：投影已验证 descriptor。
- `apps/web/src/client/compute/browser-compute-runtime.ts`、`apps/web/src/compute/mesh-kernel-control.ts`、`mesh-kernel.ts`：Worker mesh消费 registry boxes；Wasm 未支持时显式 TS fallback，不画 cube。
- `apps/web/src/client/presentation/item-mesh-definition.ts`、`collision-debug-projection.ts`：同一 descriptor；不得另写门 geometry。

### Classic 私有声明

- `playbooks/classic/src/structure-descriptors.ts`（新）：机械生成 89..104。
- closed 为 N/E/S/W 定向薄门 mesh + thin collision；open mesh 绕 hinge 旋转 90°。
- V1.3 当前 open collision contract 是 passable，故 open collision 为空；不得私自改为阻挡。
- lower/upper geometry方向一致，material 固定 WoodenDoor。

### A3 RED

- 非 Classic fixture 注册不同 panel geometry并独立装配。
- 缺 descriptor、重复 storage ID、越界/NaN box、未知 material、collision/state contract mismatch 在 assembly 失败。
- 89..104 不再以 cube mesh/collision出现。
- Authority collision、placement occupancy、recovery、Web mesh、item mesh 对同一 variant 返回一致 boxes。
- WebGL descriptor输出验证四 closed 与四 open 方向顶点/法线；不能只做源码断言。

## 5. B：木门私有机制 GREEN

### 文件与函数

- `packages/stdlib/src/server/gameplay/modules/structure-operation-model.ts`（新）
  - `buildStructurePlaceCandidateV1`、`buildStructureToggleCandidateV1`、`buildStructureBreakCandidateV1`。
  - place state由可信 face policy给出；toggle只走 transition graph；break edits覆盖完整 footprint。
- `packages/stdlib/src/server/gameplay/modules/structure-actions-module.ts`（新）
  - 注册 place/toggle/break actor operations、Structure resource/state projection。
- `packages/stdlib/src/server/gameplay/modules/structure-state-port.ts`（新）
  - 读取 actor、root/parts/support及观察 revision；unknown/malformed fail closed。
- `packages/stdlib/src/server/gameplay/modules/structure-host-commit.ts`（新）
  - 复算 candidate；校验 auth/range/LOS/support/player collision/mode/selection。
  - 组合 `prepareVoxelEdits`、ECS inventory/single drop、slot cancellation、dependent removal、receipt。
- `packages/stdlib/src/server/gameplay/modules/registered-structure-runtime.ts`（新）
  - operation facade + bounded receipt queue；不持有 durable door state。
- `packages/stdlib/src/server/gameplay/gameplay-registered-adapters.ts`、`gameplay-module-runtime.ts`、`gameplay-runtime.ts`
  - 接 Structure state owner/receipt；不扩旧 `StructureInteractionRuntime` 门分支。
- `playbooks/classic/src/structures.ts`
  - `classicDoorClosedStateForPlacement({face,actorPosition,root})`：水平 face 优先，否则由 Authority actor-to-cell bearing 返回四 closed state；无客户端 ID参数。
- `playbooks/classic/src/pack.ts`
  - 最终安装 geometry descriptors → Structure definitions/actions；移除 staged descriptor失败。

### B 事务规则

- place：support solid、两格 replaceable、closed geometry不与玩家 AABB相交；survival扣1，creative扣0。
- toggle：上下半空手双向；legacy合法 52/52 直接写对应 open variants完成迁移；open→closed碰撞检查。
- break：上下半均两格→Air；survival仅 `dropOwnerRole` 生成一个 door，creative无drop。
- dependent removal：每个 part 收集 media removal participant；若未来 Structure part是media device，world、eject/drop、state removal同事务。
- 任一 participant validate失败或容量不足：world/inventory/drop/media/receipt/gameplay/world/Chunk revisions全不变。
- save/reopen：只验证 Chunk variants；不增加 Gameplay snapshot child。

## 6. 并行与互斥

- A2 与 A3 可并行：A2只拥有 authority/protocol/browser routing/item identity；A3只拥有 geometry registry/world+Web consumers。
- B1 model/tests可在 A2/A3接口冻结后并行准备，但不改两域公共文件。
- B2 host/runtime需同时依赖 A2 target context、A1 batch、A3 collision resolver；不得提前接线。
- `playbooks/classic/src/structures.ts`、`structure-descriptors.ts` 可由同一 B owner；`pack.ts` 只由总负责人最终安装。
- `gameplay-runtime.ts`、`gameplay-module-runtime.ts`、`gameplay-registered-adapters.ts` 为一次串行集成，不能多人并改。
- Web geometry consumer与 Browser input owner文件互斥，无重叠可并行。

## 7. 自动化准出

- A2：protocol/copy/security、target-first顺序、Chunk unknown/stale、non-Classic panel RED→GREEN。
- A3：registry closure、Authority collision/occupancy/recovery、TS mesh、WebGL mesh readback、non-Classic geometry GREEN。
- B unit/integration：四朝向×closed/open×lower/upper；跨 Chunk单commit mutationCount=2；survival/creative；上下半toggle/break；single drop；legacy负例；dependent removal回滚；save/reopen。
- 所有 Vitest `--maxWorkers=1`，经 `node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- <command>`。
- Unit/integration GREEN不计“可玩”；还需下一节真实浏览器旅程。

## 8. 最小真实浏览器验收

同一临时 production artifact、唯一 Chromium/Cua：

1. 创造目录取得 wooden-door，分别从四个水平面真实右键放置；每次可见两格薄门且方向正确。
2. 空手点击 lower、upper 各一次，门 mesh旋转、collision同步开/关；关闭时玩家占位有可见失败且不吞门。
3. 生存取得一扇门，跨 Chunk边界放置只扣1；破坏 upper 后两格消失且只掉1。
4. 构造合法 legacy 52/52，点击任一半迁移；孤立/三连均无部分写。
5. 保存并重开：朝向/open state/两格/collision一致；console无错误，commit mesh revision追上 Authority revision。
6. 同 artifact 回归 water-bucket；证明 target-first未破坏 selected-item interaction。

## 9. 停止线

- A2 若既未保留 hit/adjacent face、也未提供 Authority actor position，停止 B placement，不从 Web camera或客户端 state ID补洞。
- A3 任一消费者仍调用静态 0..88 geometry处理 89..104，禁止宣称门可玩。
- browser旅程任一失败只修 V1门切片，不扩 bed/trapdoor/transport。
