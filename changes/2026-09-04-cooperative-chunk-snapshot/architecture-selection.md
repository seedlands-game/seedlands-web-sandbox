# 浏览器阶段 Chunk 流水线优化选型

**状态：** 待 Breaking-flow 审核；本文件只定义选型和实验合同，未实施生产改动。

## 结论

选择 **P0：Worker 生成的 provisional Chunk + Worker Halo + Worker meshing** 作为下一项实现；主线程只保留确定性请求编排、权威接受、按帧 commit 和渲染。它直接移除当前已证实的同步 `makeChunk()` 与 `HaloSnapshot`，同时符合“Worker 是纯计算资源、GameServer 是权威边界、异步结果按预算提交”的浏览器运行时架构。

不选择把 `makeChunk()` 简单切进 `setTimeout` 或 microtask：它们仍在主线程，不能保证释放 rendering opportunity。当前已有的 commit budget 继续保留；Worker Pool、渲染分类和 WebGPU 都不是当前瓶颈的首选解。

## 已有证据与边界

排空初始队列后的固定跨 Chunk 观测为：frame p50 `55.4ms`、p95 `121.5ms`、p99 `299.9ms`、最大 `299.9ms`，request-to-visible `323.6ms`。`HaloSnapshot` 共 4 次、总 `160ms`、单次最高约 `50ms`（另一轮为 `49.9–111.2ms`）；`DetermineNeededChunks` 单次最高 `47.8–56.9ms`。同一轮 `WorkerMesh` 共 3 次、总 `7.2ms`、最高 `3.1ms`，`MeshCommit` 最高 `0.1ms`，`SceneAttach` 为 `0ms`。

因此只可得出“同步 canonical/halo 是当前优先对象”，不能把已有 Halo cache 的前后样本称为严格 A/B。GPU、draw call、Worker queue saturation 和 WebGPU backend 均没有足以支持先行优化的 profile 证据。

## P0：Worker 生成与网格化（选中）

| 项目      | A：当前                                         | B：候选                                                                                             |
| --------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| canonical | Main `GameServer.getChunk()` 同步 `makeChunk()` | Worker 生成 provisional `Uint16Array`；Main 只在 task identity 有效时原子接受                       |
| halo      | Main `createDerivedMeshSnapshot()` 完整采样     | Worker 以 seed + 坐标生成；仅对已编辑/持久化邻块传入权威 overlay                                    |
| meshing   | Worker                                          | 保持 Worker，与生成同一任务串联                                                                     |
| Main 权威 | 已持有 canonical                                | 接受前不暴露、不持久化、不参与碰撞；接受时校验 `taskId + epoch + key + revision + generatorVersion` |

预期收益是减少 Main 长帧；不预设 request-to-visible 必然更短。风险是 overlay 漏传、过期结果覆盖编辑、以及 Worker 排队提高可见延迟。字节一致性、取消和持久化优先级不通过即回退 A。

## 后续候选（均不与 P0 并行实现）

| 优化点                              | 当前判断                                       | 进入条件                                                       | A/B 的唯一结论指标                                                                 |
| ----------------------------------- | ---------------------------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| P1：priority scheduler 与 queue cap | 延迟候选，非当前掉帧主因                       | P0 后 `worker-queue-wait` 占 request-to-visible p95 的主要部分 | 最近可见 Chunk 的 request-to-visible p95/p99；取消率与远端浪费任务数               |
| P2：1 对 2/4 Worker Pool            | 延迟候选；当前 mesh 仅 3.1ms，扩容可能争用 CPU | P0 后 worker 生成/排队吞吐不能满足移动路径                     | request-to-visible 分位数、worker queue wait、Main frame p95/p99；选择最小获益配置 |
| P3：自适应 commit budget            | 保留现有固定 budget，不重做                    | `MeshCommit`、GPU upload 或 SceneAttach 成为长帧 top span      | frame p99 与 request-to-visible；不得突破每帧数量、部件、时间三重上限              |
| P4：Chunk × RenderCategory          | 延迟候选                                       | draw submission、Material switch 或 GPU 证据成为主因           | 同画质下 draw call、CPU submission、GPU/帧时间和网格内存                           |
| P5：WebGL2 / WebGPU                 | 仅 benchmark target                            | P4 后确认 submission/backend 是瓶颈且 PlayCanvas 路径可用      | 固定画质与场景下 CPU frame、GPU frame（可测时）和稳定性；不以 API 新旧决策         |

## 强制 A/B 实验合同

每个候选先加仅 Harness 可用的显式 variant（`A`、`B` 或枚举值），不得靠不同 commit、手工改文件或不同 query 默认值比较。一次对照固定：source SHA、seed、quality、分辨率、Chromium、performance profile、热身时长、相机/移动脚本、初始存档和场景 epoch。

顺序使用交错 `A → B → A → B`；每个单元至少 5 个独立重复，轮换起始 variant，丢弃仅已记录且可解释的浏览器启动失败，绝不按结果删样本。每个样本导出 Chrome Trace 与结构化 JSON；汇总同时保留所有原始样本、每 variant 的 p50/p95/p99/max、B 相对 A 的中位差/百分比、样本数、环境、source SHA 和失败原因。绝对毫秒只在同机同轮比较，不能成为跨机器门槛。

场景固定为：冷启动首个可玩中心、初始队列排空后的单向跨 Chunk、往返 crossing、编辑后边界 remesh。每个候选必须记录：frame 分位数与长帧数、request-to-visible 分位数及阶段耗时（canonical、halo、worker queue、worker generation、worker mesh、transfer、commit、postrender）、队列深度/取消/过期结果、canonical/halo hash、可见 Chunk、三角形、draw call、网格内存。GPU 指标不可测时明确 `NOT_COLLECTED`。

## 保留或回退规则

保留 B 的前提是所有确定性、权威、取消和浏览器基线测试通过，且交错样本显示目标指标改善、没有未解释的 frame p99/long-frame 回退，也没有 request-to-visible p95 的实质回退。若指标相互冲突，保留原始样本并按用户体验优先级裁决，不能用平均 FPS 掩盖尾延迟。P0 的优先准出是消除由 main `makeChunk` / `HaloSnapshot` 造成的长帧归因；若仅把耗时移为更长的队列等待，则不算完成。
