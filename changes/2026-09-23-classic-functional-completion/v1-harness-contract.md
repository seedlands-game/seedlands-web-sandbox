# V1 BrowserProductHarness 只读 Oracle 合同

状态：冻结；geometry/media 私有 seam 已由 root 准出，公共只读组合已实现，等待 root 审阅与唯一 scenario 冻结。

阶段：`V1-HARNESS-INTEGRATION-01`，最长 2h。本阶段只恢复唯一 Classic scenario 在早期浏览器验收所需的观察能力，不运行浏览器、不新增第二条 Playwright 线路，也不改变玩法、Authority、renderer 或 audio 的生产语义。

## 目标与边界

`window.__seedlandsHarness` 仍只在现有 `?harness` BrowserProductHarness 会话安装。新增 API 只观察正式生产链已经接受的数据：

- geometry 来自当前 `BrowserAuthorityClient` 已校验的 Authority ready/restore registry；
- mesh 来自 Worker mesh part 经 `playcanvas-chunk-adapter.commitPart()` 实际写入 `pc.Mesh` 且完成 postrender 后的当前 resource；
- media projection/fact receipt 来自当前 `GameMediaController`，playing 状态来自 `GlobalAudio.snapshot().worldMedia`。

新增方法没有写口、不会准备世界、不会触发 remesh/播放/恢复，也不成为新的权威 owner。返回值必须深度 detach/freeze；调用方修改输入或返回对象不能改变正式 registry、renderer、controller 或 audio 状态。`null`/空投影表示当前正式 owner 没有可验证数据，不能回退到 Classic ID、源码声明、Worker 原始 payload、缓存 fact 或测试 fixture。

## 冻结 API

### Voxel geometry

```ts
getVoxelGeometry(voxel: number): VoxelGeometryDefinitionV1 | null
```

- 只读当前 Authority ready/restore 所属 `VoxelGeometryRegistryV1`。
- 命中时返回 descriptor 的深度 clone/freeze；未注册、Authority 未 ready 或 malformed restore 被拒绝时返回 `null`。
- restore 只有在完整 ready 成功安装后才切换 registry；失败 restore 继续观察旧世界。不得从 Classic descriptor 表或 mesh 反推 geometry。

### Rendered material mesh

```ts
type RenderedMaterialMeshSummary = Readonly<{
  worldEpoch: string;
  chunkKey: string;
  chunkRevision: number;
  material: FaceMaterialId;
  vertexCount: number;
  indexCount: number;
  min: readonly [number, number, number];
  max: readonly [number, number, number];
}>;

getRenderedMaterialMesh(
  cx: number,
  cy: number,
  cz: number,
  material: FaceMaterialId,
): RenderedMaterialMeshSummary | null
```

- Web world owner提供冻结签名。数据源严格为 `playcanvas-chunk-adapter.commitPart(resource, task, part)` 收到并送入 `pc.Mesh` 的实际 `part.positions/colors/indices`。
- 普通 part 按 `part.material` 汇总；compact batched `part.material === null` 时，对每个实际 index 读取 `colors[index * 4 + 3] + 1` 解析 material，只计目标 material 的 index 数、被引用的唯一 vertex 数及其 bounds。
- adapter 在当前 `PlayCanvasChunkResource` 的小型 Map 保存摘要；replace/unload/dispose 清旧摘要。`World` 只从 `repository.chunks` 中已 postrender 的当前 record 读取，并把 local bounds 加 `task.cx/cy/cz * CHUNK_SIZE` 得到 world bounds。
- 未安装、尚未 postrender、Chunk/record/revision 已替换、目标 material 不存在或参数非法时返回 `null`。Harness 仅深度 clone/freeze 转发，不以 descriptor 存在、Worker 结果或 chunk revision 单独冒充可见 mesh。
- `worldEpoch` 由 Browser Harness 组合层添加，私有 World/resource 摘要不持有 epoch。新 World 创建时绑定其 Authority runtime epoch；成功 restore 的既有回调先由 `world.beginScenario()` 清空旧 repository，再绑定新 epoch。失败 restore 不进入该回调，旧 world/旧 epoch 仍可查询。查询摘要前后都核对当前 Authority 实例与 epoch，不能给旧摘要简单贴新 epoch。

### Media

```ts
type GameMediaControllerSnapshot = Readonly<{
  worldEpoch: string | null;
  projections: readonly MediaPlaybackProjectionV1[];
  lastForwardedBatch: MediaPlaybackCommittedBatchV1 | null;
}>;

type HarnessMediaSnapshot = Readonly<{
  worldEpoch: string | null;
  projection: readonly MediaPlaybackProjectionV1[];
  lastForwardedBatch: MediaPlaybackCommittedBatchV1 | null;
  audio: GlobalAudioSnapshot['worldMedia'];
}>;

mediaSnapshot(): HarnessMediaSnapshot
```

- `projection` 来自 `GameMediaController.snapshot().projections`；`lastForwardedBatch` 只在完整 batch 已通过当前 epoch 与 resource 校验并实际调用 `audio.consumeMediaFacts()` 后写入，包括 `beginWorld()` 对 pending facts 的 flush。
- `lastForwardedBatch` 只是“已转交 audio”的诊断回执，不证明正在发声；playing 必须由同次 `GlobalAudio.snapshot().worldMedia` 独立观察。
- `beginRestore()`、`endWorld()`、`dispose()` 清空旧 batch；world 切换后旧 epoch batch 不得保留或被新 world 读取。projection 与 batch 均用正式 clone validator 生成冻结副本。
- Harness 组装时 controller `worldEpoch` 与 audio world snapshot 必须来自同一当前 world。尚未进入世界时 worldEpoch 为 `null`、projection 为空、batch 为 `null`；不得用历史 fact 补齐。

## 组合与失败原子性

- `game.ts` 只把当前 `authority`、`world`、`GameMediaController` 和 `GlobalAudio` 的窄只读 getter 传入 `createRuntimeHarnessApi()`；不把具体 Classic ID 或 scenario 写入 app。
- `createRuntimeHarnessApi()` 每次调用时读取当前 owner，不在安装 Harness 时永久捕获旧 world/registry。restart、成功 restore 和 world switch 后观察新 owner；失败 restore 保持旧 owner。
- 三项 oracle 分别 clone 完整结果后再返回。任一子项不可读时返回其合同定义的 `null`/空值，不部分安装到其他 owner，也不抛出会改变游戏状态的异常。
- 这些方法只用于 browser 验收断言，不进入 deterministic save，不序列化 Web Audio 对象、`pc.Mesh`、URL、Blob、AudioBuffer 或 Worker buffer。

## 唯一 Scenario 约束

只扩展现有 `apps/web/tests/e2e/classic-runtime.spec.ts` 与其 `classic-support` canonical scenario，不新增 spec 或第二浏览器。主 lane 整体 y 坐标减 29：floor 从 59 移到 30，air 为 31..37，player feet 为 32.6；所有原 resource/build/station/hostile 坐标保持 x/z 不变并同步减 29。

baseline 前允许复用既有 developer preparation。baseline 后 water bucket、两格 door（y=31/32）、record/jukebox 与 save/reopen 全部通过真实 DOM、Pointer Lock、键盘和鼠标完成；Harness 只能观察正式结果。geometry descriptor 不能证明 mesh 已渲染，forwarded media fact 不能证明 playing，保存成功或输入 ack 不能替代恢复后正式状态。

## RED / GREEN 与验收

本阶段先写共享 Harness 定向测试，RED 至少覆盖：

1. API 不存在或返回 owner 原对象；
2. geometry 未注册、restore 切换与失败 restore 保留；
3. mesh 尚未 postrender、material 缺失、replace/unload 清理，以及 compact batched material 计数/bounds；
4. media projection 已安装但尚未 forward、forward 但未 playing、world switch/restore 清旧 batch；
5. caller 尝试修改返回 tuple/array/object不能污染下一次读取。

GREEN 要求共享 Harness 组合测试、geometry/media 私有 owner 测试、Web types、targeted ESLint/Prettier/diff 均通过。重命令走默认 `benchmark-window`，Vitest `--maxWorkers=1`。真实 production build、Chromium/Cua、WebGL/音频设备在 root 后续单例租约执行；本阶段不能宣称浏览器旅程已通过。

## Owner 与交接

- 794 独占 `apps/web/src/app/world/{playcanvas-chunk-adapter.ts,world-runtime.ts}`、必要私有 mesh helper/tests；保留同文件 Lighting dirty，公共 owner 不改这些路径。
- a288 独占 `apps/web/src/app/audio/game-media-controller.ts` 及其测试；公共 owner 不改该路径。
- 761 独占 canonical scenario、`classic-support`、`classic-runtime.spec.ts` 和 scenario invariant 测试；公共 owner 不改这些路径。
- 954 独占本合同、`spec.md`、`tasks.md`、`execution-state.md`、`game-harness.ts`、`gameplay/game-harness-contract.ts`、`game.ts`、`app-contracts.ts`、必要窄共享 Harness 组合测试，以及本阶段实际入口边界的 `docs/ci-testing.md`、`docs/harness-contracts.md`。

所有 worker 都不是唯一编辑者，不回退他人 dirty。私有 seam 未真实落盘前共享 owner 不 stub/no-op 假 GREEN；签名变化先由 root 重新冻结。
