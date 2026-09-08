# 启动呈现与世界提交 v2 参考投影计划

## 背景与目标

冻结的 [网络选型](network-selection.md) 要求 N0 先从真实消费路径反推公共 DTO，再用同一语料比较编码与传输。现有 `WelcomeReference` 与 `WorldCommitReference` 已建立第一代参考证据，但不足以驱动当前浏览器呈现：

- `WelcomeReference` 没有玩家当前 body、开场营地方向信息，也没有表达 `AuthorityReady.isNew` 的真实生命周期。
- `WorldCommitReference` 丢失 `meshChunks`。边界体素编辑会使相邻 Chunk 失效，因此不能用实际写入的 `chunks` 推导完整重网格集合。
- `World.consumeServerCommit()` 以 `structuralChange.actorId === 'fluid-v2'` 选择流体呈现路径。该判断会触发 `interactive-fluid` 优先级、可见 revision 保护、0 ms 重网格调度和流体首个 commit 反馈绑定，属于客户端行为输入，不是可删的诊断字段。

本切片只规划两组最小 v2 参考投影和对应真实语料。它不会修改 v1 DTO、旧 corpus、正式 wire、连接适配器或浏览器消费代码。v2 仍须标记 `wireStatus: 'not-adopted'`；完成参考投影不代表网络协议已经采用。

## 已核实的来源语义

### Authority 启动事实与连接事实不同

`AuthorityRuntime.ready()` 当前有两个容易误用的字段：

- `playerBodyPosition` 来自构造时保存的 `initialBodyPosition`，不会随移动、恢复后的标准化或同进程后续状态更新。
- `isNew` 来自本次 Authority 创建时是否新建玩家，整个进程生命周期内不变。它不是“这条网络连接是否首次 attach”的事实。

`ready.snapshot` 可以包含调用时的 Authority 状态，但未来远端重连应直接取得同 epoch 的当前 `AuthoritySnapshot`，不能重新使用 `ready.playerBodyPosition` 把玩家放回出生点。连接是否第一次 attach、是否已经消费过一次性开场朝向，只能由未来已认证的 session adapter 管理；当前不存在这样的生产适配器，纯投影不得伪造该状态。

`worldTime` 是 0 到 24 小时内的循环值，也可由权威命令显式设置，因此不能用数值大小判断新旧。新旧门禁使用同 epoch 下的 `physicsTick`、`activeTimeMs`、`commitSequence` 和 `worldRevision`；输出的 `worldTime` 必须与输出 body 和 checkpoint 来自同一个当前 snapshot。

### 世界写入集合与呈现失效集合不同

`VoxelRegionChanged` 中：

- `chunks` 和 `chunkRevisions` 表示发生 canonical 写入并推进 revision 的 Chunk。
- `meshChunks` 表示必须重建 mesh 的完整集合，边界编辑时可含未发生 canonical 写入的相邻 Chunk；它不是 `chunks` 的子集。
- `mutationCount` 是本 commit 的 canonical 写入数量，可作为 A13 有效工作计数保留，而不需要透传完整 `metrics`。
- `bounds` 被 `FluidFeedbackTracker.markFirstCommit()` 用来判断流体 commit 是否覆盖当前交互目标。省略它会把无关流体提交错误绑定到当前反馈样本。
- `actorId` 的任意值不需要公开；当前消费者只需要区分严格等于 `fluid-v2` 和其他来源。

## 最小 v2 DTO

### Welcome 呈现参考

新增独立种类 `welcome-presentation-reference`，`projectionVersion: 2`。它保留 v1 已验证的身份、seed、版本、频率、limits 与 capability 字段，但重新定义连接初始化时的状态锚点：

```ts
type WelcomePresentationReferenceV2 = Readonly<{
  kind: 'welcome-presentation-reference';
  projectionVersion: 2;
  wireStatus: 'not-adopted';
  // v1 的 epoch/serverEpoch/sessionId/worldId/playerId、seed、版本、频率、limits 等字段
  worldTime: number;
  initialCheckpoint: Readonly<{
    physicsTick: number;
    commitSequence: number;
    worldRevision: number;
    durableCommitSequence: number;
  }>;
  playerBody: Readonly<{
    position: Readonly<{ x: number; y: number; z: number }>;
    velocity: Readonly<{ x: number; y: number; z: number }>;
    grounded: boolean;
  }>;
  authorityStartPresentation: Readonly<{
    authorityStartPlayerWasCreated: boolean;
    campPosition: readonly [number, number, number] | null;
  }>;
}>;
```

建议函数签名为：

```ts
projectWelcomePresentationReference(
  ready: AuthorityReady,
  currentSnapshot: AuthoritySnapshot,
  context: ReferenceBootstrapContext,
): WelcomePresentationReferenceV2
```

约束如下：

1. `currentSnapshot.epoch` 必须同时匹配 `ready.snapshot.epoch`，`currentSnapshot.player.id` 必须匹配 `ready.playerId`。
2. 同 epoch 下，当前 snapshot 的 `physicsTick`、`activeTimeMs`、`commitSequence`、`worldRevision` 不得低于 `ready.snapshot` 的启动锚点。`worldTime` 只校验有限且位于生产允许范围，并直接取当前 snapshot；由于它会循环或被设置，不作数值单调比较。
3. `worldTime`、`initialCheckpoint` 和 `playerBody` 全部从同一个 `currentSnapshot` 复制。不得从 `ready.playerBodyPosition` 填 body，也不得让 top-level `worldTime` 留在旧 `ready.worldTime`。
4. `context.durableCommitSequence` 允许为 `-1`，但不得高于当前 `commitSequence`。
5. `authorityStartPlayerWasCreated` 是 `ready.isNew` 的精确定义改名，只表示本次 Authority 启动时创建了玩家。`campPosition` 来自 `ready.campPosition` 并固定为显式 `null` 或三元组，所有坐标必须 finite；两者均作独立副本。
6. 该 DTO 不含 `firstAttach`、`reconnect`、`initialPresentationHandled` 或推导后的 yaw/pitch。未来 session adapter 必须以自己的连接生命周期门禁决定是否应用一次性朝向：只有“该会话首次 attach”且 `authorityStartPlayerWasCreated` 为真且 camp 存在时，才能从当前 body 朝向 camp。重连只使用当前 body 建立初始呈现，随后由 correction 持续校正，不再次应用营地朝向。

这里沿用 `initialCheckpoint` 名称时，它表示本次连接初始化所见的当前权威锚点，不表示 Authority 进程刚启动时的永恒锚点。v1 的原字段语义和旧语料保持不变。

### WorldCommit 呈现参考

新增独立种类 `world-commit-presentation-reference`，`projectionVersion: 2`。保留 v1 的 epoch、publication upper bound、显式 `causalCommitSequence: null`、commit/world revision 和 collision delta；结构部分扩展为：

```ts
type WorldCommitPresentationReferenceV2 = Readonly<{
  kind: 'world-commit-presentation-reference';
  projectionVersion: 2;
  epoch: string;
  publicationCommitSequenceUpperBound: number;
  causalCommitSequence: null;
  committed: boolean;
  worldRevision: number;
  structuralChange: Readonly<{
    presentationClass: 'fluid' | 'default';
    mutationCount: number;
    chunks: readonly string[];
    meshChunks: readonly string[];
    chunkRevisions: readonly Readonly<{ key: string; revision: number }>[];
    bounds: Readonly<{
      min: readonly [number, number, number];
      max: readonly [number, number, number];
    }> | null;
  }> | null;
  collisionDeltas: readonly WorldCommitDeltaReference[];
}>;
```

`presentationClass` 仅按生产规则 `actorId === 'fluid-v2'` 投影为 `fluid`，其他值一律为 `default`。它隔离内部 magic string，也不公开玩家 id、命令来源或其他任意 actor identity。客户端语义必须保持：

| 类别      | mesh 请求优先级     | 已有 revision 的可见保护 | dirty 重网格调度 | 流体反馈首个 commit |
| --------- | ------------------- | ------------------------ | ---------------- | ------------------- |
| `fluid`   | `interactive-fluid` | 调用                     | 0 ms             | 用 revisions+bounds |
| `default` | `interactive`       | 不调用                   | 48 ms            | 不推进              |

结构校验不得用一个集合替代另一个集合：

- `chunks`、`meshChunks`、`chunkRevisions.key` 分别要求合法、唯一、按生产 `compareChunkKeys` 的数值坐标顺序排序及各自的 512 项参考预算；保持同优先级 mesh 排队顺序。
- `chunkRevisions` 的 key 集合必须与 `chunks` 一致；`meshChunks` 可包含相邻 key，不要求是 `chunks` 的子集。
- `mutationCount` 必须是非负安全整数；有结构变化时与当前生产结果一致地大于零。
- `bounds` 坐标必须是有符号安全整数，逐轴满足 `min <= max`。`fluid` 结构变化必须有 bounds，避免把无边界提交宽松绑定到任意待处理的流体交互；若未来生产允许无 bounds 的 fluid commit，应先修改合同与反馈消费者，不在投影中静默放宽。
- `structuralChange.worldRevision` 必须等于顶层 `worldRevision`；投影可以不重复输出该字段。
- 所有数组和元组深复制。重复 key、非法 revision、非有限数、超过预算或不一致集合均 fail closed，不排序去重后掩盖上游错误。
- 存在 collision delta 时，必须有 committed structural change；每个 delta 的 key 属于 `chunks`，revision 匹配对应 `chunkRevisions`，并满足 `previousRevision + 1 = revision`、cells 非空。cells index 不重复且在 Chunk 范围内，voxel/fluid 分别不超过 Uint16/Uint8 的域；结构变化不强制携带 delta，以保留独立基线重取的后续适配路径。

2026-09-07 独立审阅确认：512 是当前参考表示预算，不是生产 WorldCommit 的最大范围。Authority 的 mutation preparation 可涉及 2,048 个 Chunk，mesh 失效集合还可能扩展至邻接块；大提交可超出此参考格式。当前投影必须显式拒绝，不能裁剪、改世界规则或静默丢弃。正式接线前必须完成 commit 分帧/原子应用或明确 baseline resync 合同，并将大提交加入真实语料；目前这项保持未完成。因此本切片的正确性仅覆盖明确预算内的参考消息，不能作为全部生产提交都可表示的证明。

完整 `metrics`、semantic event 的 unknown data、碰撞 baseline bytes、mesh payload、trace id 与客户端 scheduler 诊断不进入该 DTO。`mutationCount` 是本次明确保留的有效工作量，不代表其他 metrics 已成为公共协议。

## 消费顺序和版本隔离

1. 未来连接收到 v2 Welcome 后，先验证身份、epoch、版本、limits 和当前 checkpoint，再安装当前 body；只有 session adapter 的一次性门禁允许时才计算开场朝向。Welcome 不能代替紧随其后的完整 correction，也不能替 correction 确认 input ack 或 collision revision。
2. reconnect 必须从当前同 epoch snapshot 重新投影 v2 Welcome 或走未来定义的 resync 消息。不得重放进程启动时保存的 body，也不得仅因 `authorityStartPlayerWasCreated` 仍为真而再次朝向 camp。
3. v2 WorldCommit 先经过现有 collision revision 因果门，再把结构字段交给与 `World.consumeServerCommit()` 等价的呈现入口。`meshChunks` 驱动重网格，`chunks/chunkRevisions/collisionDeltas` 驱动权威 revision 与碰撞镜像，不能跨 stream 先应用新 pose 而缺少所需 baseline/commit。
4. v1 与 v2 使用不同 kind 和 projection version；旧 9 条、59 条及其 source/corpus hash 不改写。新 receiver 明确拒绝把 v1 当作 v2 补默认值，因为无法从 v1 恢复 `meshChunks`、source class、bounds 或当前 body。

## 真实语料方案

新增独立目录 `/tmp/seedlands-network-bootstrap-presentation-corpus-v2`，沿用现有 manifest、逐条 content hash、source path/hash、config hash、provenance、JSONL metadata 与 binary sidecar 规则。旧 `/tmp/seedlands-network-real-corpus-v1` 及其派生 codec 证据只读保留，不覆盖、不重新标记为 v2。

语料必须由真实 `DedicatedServerHost`、`AuthorityRuntime` 和生产 world/fluid commit 路径生成：

| 记录                         | 真实来源                                        | 必须证明                                                                                               | 明确边界                                                                                                 |
| ---------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| 新世界启动 Welcome v2        | 通用安全出生点和 starter ecology 的 Host 初始化 | 当前 snapshot body、`authorityStartPlayerWasCreated=true`、真实 camp、同 snapshot checkpoint/worldTime | 没有未来 session adapter，provenance 标记 `attach-disposition: NOT_COLLECTED`，不能声称已执行首次 attach |
| 同 epoch 当前状态 Welcome v2 | 玩家移动或恢复标准化后的当前 snapshot           | `ready.playerBodyPosition` 与当前 body 不同时，输出只跟当前 snapshot；checkpoint 不倒退                | 只证明投影来源，不把再次调用 `ready()` 当网络重连实现                                                    |
| 已恢复世界 Welcome v2        | 同 seed/version 的真实持久化恢复                | `authorityStartPlayerWasCreated=false`、当前 body、camp 可空                                           | 不把 process restore 等同客户端 reconnect                                                                |
| 普通边界编辑 commit v2       | 真实 `editWorld`/action commit                  | `meshChunks` 含实际邻接失效，`presentationClass=default`，48 ms 分支所需输入完整                       | 不用手写结构对象替代 Host commit                                                                         |
| 流体 commit v2               | 真实 candidate 计算与 `commitFluidCandidate`    | `presentationClass=fluid`、mutationCount、meshChunks、chunkRevisions、bounds 及 collision delta 一致   | 若 fixture 未产生真实 accepted fluid commit，记录 `NOT_COLLECTED`，不得伪造 actorId                      |

每条 v2 记录都保存输入 Authority 对象的规范化 hash与投影结果 hash，并在写盘前后做深相等校验；这只证明记录器未因 JSON 序列化改值。首次 attach、重连、公开认证、跨连接一次性门禁、真实网络乱序和浏览器相机可见效果继续标为未采集。

## 预期 RED 与验收设计

下一实现切片先增加用例，取得缺少 v2 模块或字段的 RED，再写投影：

### 纯投影用例

建议文件：

- `tests/server/network-reference-bootstrap-presentation.test.ts`
- `tests/server/network-reference-world-commit-presentation.test.ts`

Welcome v2 至少覆盖：

1. `ready.playerBodyPosition` 故意与同 epoch 当前 snapshot body 不同，输出 body/worldTime/checkpoint 全取当前 snapshot，输入修改不影响输出。
2. epoch 或 player 不匹配，以及 physics tick、active time、commit sequence、world revision 低于 ready 启动锚点时拒绝。
3. `authorityStartPlayerWasCreated` 原样保留为 Host 启动事实；camp 的 null、有效三元组、非 finite 和副本隔离。
4. durable `-1`、等于当前 C 和高于当前 C 的边界。
5. 循环 worldTime 可小于旧 ready 值但仍与当前 snapshot 一致；该场景防止误加错误的数值单调规则。
6. 输出没有 `firstAttach`、`reconnect` 或“已朝向”字段；这是静态 shape 约束，不用伪 session reducer。

WorldCommit v2 至少覆盖：

1. 边界编辑的 `meshChunks` 严格保留邻接 key，不被 `chunks` 裁剪；三个 key/revision 集合及数组均副本隔离。
2. `fluid-v2` 只投影为 `fluid`，任意其他 actor 投影为 `default`，原 actor id 不出现在 DTO。
3. fluid 的 bounds/revisions 能驱动现有首个 commit 目标筛选；普通提交不推进流体反馈。
4. 通过现有呈现入口 spy 验证 fluid/default 分别选择 `interactive-fluid`/`interactive`、revision 保护和 0/48 ms 调度。这里只验证字段足够驱动现有行为，不新增第二套 reducer。
5. 重复/非法 key、结构 revision 不一致、`meshChunks` 超过 512、unsafe mutation count、倒置 bounds、fluid 缺 bounds 全部拒绝。
6. v1 样本不能被 v2 validator 接受，也不能以默认 `meshChunks=chunks` 修补。

### 真实语料与应用用例

建议 change-local 文件：

- `changes/2026-09-06-node-dedicated-server/e2e/network-bootstrap-presentation-corpus.test.ts`
- `changes/2026-09-06-node-dedicated-server/e2e/vitest.bootstrap-presentation-corpus.config.ts`

采集用例只生成上述真实 Host 记录、manifest 与 source binding。后续 codec 接入仍须以同一 v2 corpus 做 C0/C1/C2 强等价、wire 畸形和应用 oracle；本切片不新增 codec、不计时，也不把单元测试当作浏览器相机或网络 E2E。

## 推荐实现顺序

1. 冻结两个 v2 TypeScript 类型、投影签名和本计划的预期 RED；保持 v1 导出不变。
2. 先实现 Welcome v2 的同 snapshot 绑定、启动锚点门禁和副本隔离，再补真实新建/当前状态/恢复语料。
3. 实现 WorldCommit v2 的 presentation class、mutationCount、meshChunks、bounds 和集合一致性，再用普通边界编辑与真实 fluid candidate 采集。
4. 用现有浏览器 `World.consumeServerCommit()` 行为测试确认 v2 字段足够恢复 fluid/default 分支；不在参考层复制 scheduler 算法。
5. 另开后续切片扩展共同 schema/codec 和浏览器解码应用。完成强等价、畸形拒绝与 source binding 后，才能把新 v2 corpus 纳入 N2 计时输入。
6. 再由未来 session adapter 定义认证、first attach 一次性门禁、reconnect/resync 和连接代次。该步骤完成前，Welcome v2 只证明可投影信息，不证明远端 join 已闭环。

## 不在本切片内

- 不修改 `AuthorityRuntime.ready()`、`AuthorityReady` 或当前本地浏览器启动行为。
- 不实现 first-attach 状态机、认证、重连、相机 yaw/pitch、HUD 或可见验收。
- 不定义 interest 订阅、多个 mesh baseline 的传输、request/cancel、分页、压缩或 baseline resync；这些按后续独立适配合同处理。
- 不冻结公开 wire、codec、发送频率、可靠流/可丢流映射或 transport。
- 不把 fluid feedback 统计或 A13 计数称为已完成性能证据；这里只保留产生这些行为所需的业务字段。

## 当前状态

方案已依据当前生产来源和浏览器消费者完成；尚未新增生产类型、投影、测试或 corpus。下一切片的首个可执行证据必须是上述 v2 import/字段用例 RED，随后才进入实现与真实 Host 采集。
