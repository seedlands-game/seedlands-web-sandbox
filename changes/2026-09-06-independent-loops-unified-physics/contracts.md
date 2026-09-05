# 模块契约与最小接线顺序

本文件冻结 `spec.md` 已批准范围内的模块接口。它补充实现边界，不改变 `spec.md` 的范围、行为或准出标准。协议字段在本 change 内保持向后兼容；实质变更必须先由集成负责人记录原因并通知并行模块负责人。

## 依赖方向

```text
world ────────┐
physics ──────┼─> runtime ─> server ─> worker adapters
              └────────────> client ─> app
```

- `src/physics/`、`src/runtime/` 是无 DOM、PlayCanvas、Worker global 和浏览器存储依赖的纯逻辑。
- `src/physics/` 不导入 `runtime`；协议层单向复用物理数据结构。
- `src/server/` 持有权威规则，但浏览器中的唯一 `GameServer` 实例只在 Authority Worker 内创建。
- `src/client/` 只保存本地预测历史、快照插值和连接适配；`src/app/` 只把输入、渲染与 UI 接到 client port。
- `src/worker/` 只创建执行环境、计时器和消息端口，不包含可复用规则。

## 物理核心

`src/physics/index.ts` 导出以下稳定接口：

- `Vec3 = { x: number; y: number; z: number }`
- `LocalAabb = { min: Vec3; max: Vec3 }`，相对实体脚底中心原点。
- `WorldAabb = { min: Vec3; max: Vec3 }`
- `BodyConfig = { localAabb; collisionLayer; collisionMask; medium?; gravity?; buoyancy?; drag?; maxSpeed? }`
- `BodyState = { position: Vec3; velocity: Vec3 }`
- `PhysicsInput = { wish: { x: number; z: number }; jumpPressed: boolean; verticalIntent: -1 | 0 | 1 }`
- `Collider = { id?; aabb: WorldAabb; layer?; mask? }`
- `FluidVolume = { aabb: WorldAabb; velocity: Vec3 }`
- `PhysicsWorld = { querySolids(bounds): readonly Collider[]; sampleFluid?(bounds): readonly FluidVolume[]; unknownIsSolid?: boolean }`
- `stepBody({ state, config, input, world, dt })` 返回 `{ state, contacts, grounded, medium, recovery? }`。

普通固定步不得自动爬阶、按中心格判定支撑或反复传送脱困。有限重叠恢复只能由初始化、旧档迁移或外部几何变化显式请求。

## 会话与命令协议

`src/runtime/session-protocol.ts` 是 DOM-free 的唯一协议源头。

```ts
type SessionEpoch = string;

type FrequencyConfig = {
  physicsHz: 30 | 60 | 120;
  gameplayHz: 10 | 20;
  fluidHz: 20 | 30;
  intentHz: 10;
  decisionHz: 1 | 2;
};

type InputCommand = {
  kind: 'input';
  protocolVersion: 1;
  epoch: SessionEpoch;
  sequence: number;
  targetPhysicsTick: number;
  issuedAtMs: number;
  state: { moveX: number; moveZ: number; verticalIntent: -1 | 0 | 1; jumpHeld: boolean };
  edges: { jumpPressed: boolean };
};

type TransactionCommand = {
  kind: 'transaction';
  protocolVersion: 1;
  epoch: SessionEpoch;
  sequence: number;
  expectedCommitSequence?: number;
  issuedAtMs: number;
  transaction: AuthorityTransaction;
};
```

- `sequence` 在同一 epoch 内严格递增；Authority 对已提交 sequence 返回相同回执，不重复执行。
- `moveX/moveZ` 是客户端根据即时镜头朝向算出的世界坐标移动意图；Authority 不读取客户端 yaw 猜方向。持续输入状态和 `jumpHeld` 可被较新状态覆盖，但按下/松开边沿必须按 sequence 消费一次。持续按住 Space 时，每次重新获得合法向上支撑后可再次起跳，不能只依赖首次 `jumpPressed`。
- 事务包括编辑、库存、伤害、拾取、保存和调试快照订阅；它们不得静默丢弃。
- 所有响应都带 `protocolVersion + epoch`。旧 epoch、重复及乱序响应由接收方明确忽略并计数。

## Authority 快照与时间

```ts
type AuthoritySnapshot = {
  kind: 'snapshot';
  protocolVersion: 1;
  epoch: SessionEpoch;
  physicsTick: number;
  commitSequence: number;
  acknowledgedInputSequence: number;
  activeTimeMs: number;
  integratedPhysicsTimeMs: number;
  physicsDebtMs: number;
  player: { id: string; body: BodyState; grounded: boolean; colliding: boolean };
  entities: readonly AuthorityEntitySnapshot[];
  chunkRevisions: Readonly<Record<string, number>>;
  worldRevision: number;
  worldTime: number;
  paused: boolean;
  diagnostics: AuthorityDiagnostics;
};
```

- Authority Worker 握手接收主线程 `sessionTimeOriginMs` 与本地 `workerNowMs`，只比较换算后的会话经过时间，不比较不同执行环境的 `performance.now()` 原点。
- `ActiveMonotonicClock` 在显式暂停时冻结；恢复时重置唤醒基准，不补算隐藏或睡眠区间。
- `MultiRateScheduler` 为每条 lane 保存独立 `nextDue`。物理固定步只在真实积分后推进 tick；单次唤醒最多追赶 4 步，剩余为可观测 debt。
- gameplay、fluid 和低频 decision 的到期事件可合并到最新一次；输入和事务不经过这些可丢弃 lane。

## 游戏逻辑 Worker

- 输入：`LogicObservation`，带 `epoch + observationSequence + physicsTick + entityRevisions + chunkRevisions + activeTimeMs`。
- 输出：`LogicIntentBatch`，带 `epoch + observationSequence + expiresAtPhysicsTick`，内容只有移动、跳跃、攻击目标或高层行动意图。
- Authority 仅在 epoch、实体 revision 与有效期均匹配时采纳；逻辑 Worker 不返回坐标、速度、库存或体素写入。
- 测试注入的 `blockForMs` 只阻塞逻辑 Worker，用于证明 Authority 物理继续产出。

## 计算池

`ComputePool` 的浏览器实例上限为 3：`fluid` 保留槽 1 个，`general` 槽 1 或 2 个。总后台 Worker 上限计算为 Authority 1 + Logic 1 + Compute 2/3 + Persistence 1，即 5/6。

```ts
type ComputeTask = {
  protocolVersion: 1;
  epoch: SessionEpoch;
  taskId: number;
  lane: 'fluid' | 'general';
  category: 'fluid' | 'chunk-generation' | 'mesh' | 'navigation';
  priority: 'interaction' | 'near' | 'streaming' | 'background';
  key: string;
  revision: string;
  dependencies: readonly number[];
  estimatedBytes: number;
  payload: unknown;
};
```

- 每个 Worker 同时执行一个 CPU 任务；`fluid` 任务只进保留槽，长 Mesh 不借用该槽。
- 同 `epoch + category + key` 的未开始任务合并为最高优先级的最新 revision。
- 依赖未完成不占槽；旧 epoch、取消或过期结果不提交。运行中取消走合作式检查，并分别统计取消请求与过期结果。
- 队列同时受任务数和字节数限制；普通任务超限返回显式背压，交互任务先淘汰可合并的后台旧任务，否则明确拒绝。
- 世界切换先增加 epoch，停止接收旧结果，再取消队列、通知运行任务并终止 Worker。

流体候选的结构由流体模块补充，但必须包含 `protocolVersion + epoch + workId + readSet(chunk contentRevision) + expected old cells + writes + consumedFrontier + addedFrontier`。Authority 在物理步边界原子验证并提交；失效或故障时归还租赁 frontier。

## 客户端预测、插值和碰撞调试

- `PredictionBuffer` 只预测本地玩家，保存 `{input, predictedBody, collisionRevisionVector}`。快照确认后回退到权威身体并重放未确认输入；缺少旧碰撞版本时清空历史并报告 `collision-history-missing`。
- 小误差只平滑表现偏移；权威碰撞或大误差立即校正，表现插值不得穿过固体。
- `SnapshotInterpolator` 用 `(physicsTick, integratedPhysicsTimeMs)` 插值其他实体；`activeTimeMs` 只用于估算当前 Worker 会话时钟映射和展示 debt，不能在发生 debt 时当作实体已积分时间。最多有限外推，超时保持最后状态。
- `visibilitychange`、`blur`、死亡和世界退出都必须经直接 Authority 输入通道发送全零持续状态，并清空未消费按键边沿。
- `CollisionDebugProjection` 只从物理 `BodyConfig`、Authority `BodyState`、本地预测 `BodyState` 和方块形状注册表生成批量线段。F3+B 完整消费，面板开关发送订阅事务；关闭时不请求调试快照且释放批量资源。

## 保存与 headless

- 保存事务在 Authority 冻结一个 `commitSequence` 后创建 Chunk、流体、实体/库存、时钟和物理状态的一致快照；持久化确认后才返回成功。
- 新快照版本保留 `seed + generatorVersion + voxel id`，旧 `GameplaySnapshotV1` 和 `GameplaySnapshotV2` 均保持可读；旧玩家坐标经显式版本适配为脚底中心。迁移失败返回原因且不覆盖原记录。
- `HeadlessSession` 复用 `AuthoritySession`、协议和调度器，通过内存端口运行；支持 `advancePhysics(steps)`、`advanceLogic(steps)`、`advanceFluid(steps)` 与 `advanceSession(ms)`。旧 `/tick <seconds>` 保留参数的秒语义并映射为 `advanceSession(seconds * 1000)`，在输出中标明实际推进的各 lane 数。

## 最小接线顺序

1. 先以 RED 用例固定 runtime、client、Worker pool、静态边界和协议行为。
2. 实现纯 `runtime` 时钟、调度和协议，再实现 `client` 预测、插值与 pool 控制器。
3. 接入纯物理核心；在内存端口让 `AuthoritySession` 单独拥有 `GameServer` 并通过协议驱动。
4. 加 Authority/Logic/Compute Worker 适配，替换浏览器内主线程 `GameServer` 和旧单 world Worker。
5. 接入流体候选事务；Authority 只在物理边界接纳，Mesh 通过通用池消费已提交版本。
6. 接通 app 输入、渲染、F3+B、存档和 headless，删除旧玩家、AI、掉落和流体调度路径。
7. 运行 Vitest、静态检查、构建、change Playwright、基线、Midscene 与同机 2/3 槽对照，将实际结果写入 `integration-progress.md`。
