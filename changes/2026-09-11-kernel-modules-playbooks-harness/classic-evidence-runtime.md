# Classic 生产线路诊断与测量格式

## 2026-09-11 生产 dist 诊断

本轮使用正式 `apps/web/dist` + Vite preview、系统 Chrome、1280×720 viewport 运行 canonical
Playwright。静态检查包括目标文件 ESLint、独立 strict TypeScript 编译和 `playwright test --list`；当前只发现一条 canonical test。

已保留并定位的失败：

1. 新增第四个原木最初离上一拾取落点过近，掉落生成后被自动拾取，因而“掉落先可见”失败。固定场景改为间距足够的前向资源点，没有放宽可见掉落断言。
2. NPC 最初距敌对生物 5 格，在 C3 战斗期间被攻击并死亡。真实事件为
   `attacked → activity-interrupted → threat-action → goal-interrupted(killed)`；固定场景把 NPC 和敌对生物隔离，并在初态准备中放置可消费浆果栈。NPC 仍通过正式无模型行为、世界物品拾取与消费推进。
3. Pointer Lock 状态下直接点击暂停按钮被 canvas 拦截。线路改用真实 Escape，读回暂停 dialog 后再执行保存，而非 force click。
4. 最新诊断 `classic-correctness-20260911-full3` 已通过 C0–C4；C5 建立了不同 epoch，但保存前通过真实右键放置且已呈现的结构体素，在“保存并返回主菜单 → 继续世界”后从 `4` 读回为 `0`。该值来自 Web 派生镜像，单独不足以区分存档丢失和恢复后 Chunk 尚未流送。下一生产构建会在不改变期望值的前提下，同时记录保存前 Authority inspect、portable checkpoint Chunk/index/voxel，以及恢复后 Authority inspect、派生初值和同步后值。
5. 静态追踪确认继续世界会创建 yaw 初值为 `0` 的新 `PlayerController`，而营地方向初始化只在 `ready.isNew` 时调用；旧控制器的 yaw 不属于当前持久化合同。C5 因此不再假定恢复前朝向，也不调用 Harness `setView`：它从可见目标卡读取实际指向，使用 Pointer Lock 真实鼠标做有界水平/垂直修正，并把支撑体素和工作台的最终目标卡读回及鼠标累计位移写入恢复证据。
6. 统一生产构建后的唯一 correctness 运行 `2026-09-11t14-35-12-328z-6136e623` 在 C0 初态准备期间终止，未进入 C1–C5。Harness 先通过 artifact 校验，读到 `sourceDigest = b5c2ceb9c25a25c265d37ea64411e236dc875f62a259fa174cea58782fc3caff`、`artifactDigest = c82b42469380acd5ebbcb2fb855b32dd4672e6073f42657532b6e7d6aad96a67`；随后 Authority 客户端拒绝 Worker 消息并报告 `Authority Kernel physics debt does not match the session frontier.`。失败 aggregate 保持 `status = FAIL`、`attempt = 0`、`stages = {}`，路径为 `harness/results/2026-09-11t14-35-12-328z-6136e623/classic.json`。页面失败快照观察到 physics tick `42`、commit sequence `276`、Worker `5`、Compute completed/failed `5/0`。本次运行没有到达保存恢复边界，因此不能生成 C5 Authority/portable/derived 新证据，也不能作为 Classic 或性能 PASS。
7. 修复 Authority debt 后的唯一 correctness 运行 `2026-09-11t14-44-57-341z-6b7463ae` 通过 C0–C4，并在 C5 证明新 epoch 与体素恢复：保存前 Authority、portable checkpoint、Web 派生镜像均为 build `4` / station `0`；恢复后 Authority 仍为 `4` / `0`，派生镜像从初值 `0` 同步为 `4`，库存签名也一致。随后角色观察得到同一 NPC `lifecycle = deceased`，因此运行保持 FAIL，未继续执行恢复后的工位操作。该失败附件没有保存 NPC 的保存前 checkpoint 字段，不能从现有 receipt 区分“保存前已死亡”和“恢复时死亡”。线路已增加保存前/恢复后 NPC entity、actor、character 的 lifecycle、health、needs、事件证据，并在保存边界新增 active/alive 强断言；初态浆果移到 NPC 家园附近、但在玩家直线路径 1.5 格自动拾取半径之外，避免玩家取走 NPC 的真实食物资源。此测试/场景变更需纳入新的 artifact identity 后再执行，不能沿用本次 artifact 宣称通过。
8. 包含上述 NPC checkpoint 与食物隔离的统一构建后，唯一 correctness 运行 `2026-09-11t15-01-42-528z-5a574ade` 通过 C0–C3，在 C4 的保存前观察处失败，未进入 C5。新证据已排除恢复导致死亡：NPC 初始为 `active`、health `20`；玩家到达 C4 前已变为 `deceased`、health `0`，事件 cursor 4/9/10/11 连续记录 `attacked`，cursor 13 为 `goal-interrupted(killed)`。源码复核纠正了最初的敌对生物归因：canonical 使用的 `spawn-creature` 只生成没有 archetype 和自主 actor 注册的固定战斗目标，不能执行追击或攻击；`attacked` 事件中的 opaque target 引用的是攻击者。木剑作用距离为 3，而 NPC 初态 x=72.5 与工作台 x=75 仅相距 2.5；工作台拆除的持续真实左键在体素消失后继续选中了近旁 NPC。`Behavior actor domain binding is unavailable.` 出现在最后一次受击与死亡清理的同一时刻，只能作为清理诊断，不能证明逃跑启动失败或构成死因。失败 receipt 位于 `harness/results/2026-09-11t15-01-42-528z-5a574ade/classic.json`，保持顶层与 attempt `FAIL`；本轮没有重跑或继续调整食物。

当前固定场景把 NPC 家园与食物移到 x=96.5：它距固定战斗目标 x=56 为 40.5，超过 Classic 真正 `night-stalker` actor 的 12 格感知范围；距工作台 x=75 为 21.5，也超过木剑 3 格作用距离。玩家在工作台附近 x=72.5 时仍距 NPC 24 格，处于 48 格 actor active radius 内，NPC 可继续用正式无模型行为拾取/消费家园旁的真实食物。线路只改变 setup fixture 的空间隔离，没有中途写状态，也没有删除战斗、NPC 活动或保存后存活断言。

C3 在实际浏览器中已观察到木剑连续输入缓存、第二段 HUD 和 7 点伤害；C4 已观察到 NPC 完整
episode、身体位移、四个 stream center 往返以及同一返程 Chunk key 的新 trace ID 和完整
Worker/mesh/postrender 链。C0–C4 PASS 不能覆盖 C5，也不能作为最终交付 PASS。

## Runtime measurement JSON 合同

`SEEDLANDS_CLASSIC_RESULT` 写出的顶层结构为：

```json
{
  "schemaVersion": 1,
  "status": "PASS",
  "attempts": [{ "status": "PASS", "benchmark": { "measurement": {} } }]
}
```

任一早期失败 attempt 会让顶层保持 `FAIL`，重试成功不覆盖原失败。只有设置
`SEEDLANDS_CLASSIC_BENCHMARK=1`、`SEEDLANDS_PERFORMANCE_WINDOW_RESERVED=1`，并同时提供非空
`SEEDLANDS_PERFORMANCE_WINDOW_ID`、`SEEDLANDS_PERFORMANCE_WINDOW_EVIDENCE` 和
`SEEDLANDS_PERFORMANCE_MEASUREMENT_DECLARATION` 的运行可写
`measurement.status = "MEASURED"`；上下文不完整的 benchmark 是 `DIAGNOSTIC`，普通正确性运行是
`NOT_MEASURED`。measurement declaration 由 Harness runner 在 Classic aggregate 写完后统一生成，浏览器测试不重复写文件。

measurement 固定包含：

- `runId`（来自 `SEEDLANDS_HARNESS_RUN_ID`）、`owner = "web-runtime"`、scenario；
- `windowId` 与 `evidencePath`，来自性能窗口提供的只读执行上下文；
- `sampleStartedAt` 与 `sampleCompletedAt`：前者在 `beginPerformanceScenario` 后、C0 首个样本前记录，后者在 C5 最后真实交互、stage snapshot 与新 epoch trace 采集后立即记录；二者都是 UTC ISO 时间，不使用附件写完时间冒充采样边界；
- `sourceSha`、`sourceDigest`、`lockDigest`、`artifactDigest`，均来自浏览器实际读取的
  `harness-artifact.json`；
- environment：浏览器 UA、平台、viewport、DPR 和实际 WebGL2 renderer/vendor/version；
- boundary：初态准备、采样边界和明确排除项；
- `samples`：按 C0、C1、C2、C3、C4、C5 各一个样本；
- `rawTrace`：本次浏览器会话导出的原始 trace events。

每个 stage sample 的字段为：

```json
{
  "stage": "C0",
  "frame": { "count": 1, "p50Ms": 0, "p95Ms": 0, "p99Ms": 0, "longFrameCount": 0 },
  "streaming": { "chunkVisible": {}, "completedChunkTraces": 0, "traceEventCount": 0 },
  "workers": {
    "counts": {},
    "submittedTasks": 0,
    "completedTasks": 0,
    "failedTasks": 0,
    "staleResults": 0,
    "submittedBytes": 0,
    "kernel": { "calls": 0, "failures": 0, "memoryBytes": 0 }
  },
  "resources": {
    "loadedChunks": 0,
    "renderedChunks": 0,
    "uploadQueueDepth": 0,
    "estimatedMeshBytes": 0,
    "residency": null,
    "npcCount": 0,
    "worldItemCount": 0,
    "presentedEntityCount": 0
  },
  "storage": { "bytes": 0 }
}
```

数值示例只表达 schema，不是性能结论。最终 measured 样本必须在生产源码修复、统一 artifact 重建以及性能执行窗口预约后重新取得；当前未生成可接受 baseline candidate。

`samples[].frame`、streaming、Worker 与资源字段是阶段结束时读取的有界滚动 telemetry；它们不是每阶段单独清零的分位数，也不是资源峰值，除非字段名称明确为 maximum。benchmark 在 `beginPerformanceScenario` 重置后，C0 必须等待同一 scenario 的 `frame.count >= 1` 和实际可见 Chunk，不能用空窗口生成 baseline candidate。

当前生产 telemetry 没有完整暴露以下端到端延迟，measurement 必须显式写为 `UNAVAILABLE`：

- `inputToAuthorityMs`；
- `inputToVisibleMs`；
- `saveMs`；
- `loadMs`。

不得用 Playwright 墙钟、按钮等待时间或相邻 counter 差值填充这些字段。最终 raw trace 由恢复前 C0–C4 和恢复后 C5 两段组成；每个事件增加 `runtimeEpoch` 与 `stageRange`，避免把恢复后新 runtime 的 trace 漏掉或与旧 epoch 混写。

## 最终运行入口与严格收据对齐

root 在统一生产构建完成后可直接执行：

```bash
pnpm harness:classic
pnpm bench:runtime
```

第一条运行同一 canonical 路线并要求 `measurement.status = "NOT_MEASURED"`；第二条通过性能窗口包装器运行 `run.mjs --stage runtime`。性能窗口包装器自动提供 reservation、window id、window evidence 和 measurement declaration 环境，Harness runner 自动提供本次 `runId`、`SEEDLANDS_CLASSIC_RESULT` 与 benchmark mode；浏览器测试不应手工伪造这些变量。测量成功后，从命令输出的 `harness/results/<runId>/result.json` 取得 `<runId>`，再执行：

```bash
pnpm harness:baseline:candidate -- --run <runId>
```

当前产出与 `classic-receipt.mjs` 的严格字段逐项一致：顶层 `schemaVersion = 1`、单次且未重试的 PASS attempt；attempt 的 `runId`、artifact 四项 digest/files、场景 id/schema version/seed/generator/playbook identity 与 runner 预期相同；C0–C5 六个 PASS stage 和六个有序 sample 均存在；正确性/测量模式分别为 `NOT_MEASURED`/`MEASURED`；测量运行的 `windowId`、`evidencePath` 与 runner 读取的 reservation context 相同。`attempt.trace.traceEvents` 与 `measurement.rawTrace` 来自同一合并 trace，覆盖 C0–C4 旧 epoch 和 C5 新 epoch；Worker 消费链仍由 attempt trace 的同一 trace id 关联。baseline validator 另要求六个 frame 样本非空、浏览器/WebGL2 环境完整、四项源码/产物 digest 完整，以及 `sampleStartedAt ≤ sampleCompletedAt` 且都落在性能窗口收据内。
