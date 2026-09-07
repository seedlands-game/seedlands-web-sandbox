# P2 固定 workload corpus 说明

## 目的与计时边界

`e2e/workload-corpus.ts` 的默认 30 个输入是 P2 分项 A/B 的固定工作量，schema 为 `2`。十个确定性 seed 在 30 个输入中重复，坐标覆盖负数与不同 Y 层；每个模式接收完全相同的输入顺序。

构造 Chunk、halo、网格 parts、存档记录和流体快照都发生在 `prepareWorkload()` 阶段，不进入任务计时。正式 `task()` 仍计入输入 `structuredClone`、向既有单 Worker 发送、计算、输出 transfer 和消费前往返，因此不会把无关 fixture 准备混入内核或端到端样本。

## 各责任的分布

- W02：10/30 为 generator v2，20/30 为 v3；覆盖负 Chunk 坐标，并以 `12/6/6/6` 个样本覆盖 0、1、8、64 项编辑。编辑采用全局坐标，仍由生产 `makeChunk` 的既有过滤和覆盖路径处理。
- W03：两版 generator；每十个 seed 都覆盖 0、1、4 个已物化邻 Chunk。邻块包含跨边界 Water/Lantern 和 fluid，部分中心 canonical 含权威编辑；这同时覆盖纯程序 halo、混合已知 halo 和多邻块输入。
- W04：保持自然地形为多数；30 个样本中另有 2 个全空气、2 个全实心、2 个 checkerboard 和 6 个编辑后自然 Chunk。fixture 先构造 authoritative data/halo，计时只包含窗口准备与 mesh 计算。
- W05：水面高度 1–8、双层源水、台阶边缘和 Lantern 组合随 seed/高度变化；两版 generator 都保留。
- W06：从真实 `meshChunk` 输出预先构造 parts；主体是自然/编辑/边界网格，6/30 使用水面和特殊模型。parts 构造不进入 pack 计时。
- W07：每个快照使用 4 或 5 个完整 Chunk，包含 X/Z Chunk 边界两侧的 frontier、源水传播和低水位 cleanup 写入。`frontier=128`、`cleanupFrontier=64`，总位置达到 adapter 上限 192；22 个 5-Chunk 与 8 个 4-Chunk 样本的 TypedArray 平均输入为 `465,306 bytes/task`。P0 的 `464–468 KB/task` 是 fluid 与 general remesh 混合消息代理，所以这里只对齐协议负载量级，不宣称是同一种消息的精确复刻。
- W10：分别保留 1、1024、32768 cell 三个独立 workload；体素值覆盖 Air、Water、普通实心和特殊模型 ID。
- W14：两版 generator；0、1、1%、10%、100% 变更各 6 个样本，覆盖 procedural diff、低 palette 和高 palette/raw 候选；20/30 含 fluid sidecar，其中一部分有实际水位。
- W15：独立 CRC 输入按 0、约 3 KB、32 KB、64 KB 固定分布，既包含 P0 保存快照量级，也保留完整 Chunk/sidecar 上界。

## 解释限制

这是分项吞吐和端到端任务成本 corpus，不替代 P3 用户旅程。W03 的 4 邻块不是生产最多 26 邻块的压力上限；W07 的字节量与 P0 接近，但 P0 计数器混合了流体与重网格消息。每个 workload 的 30 个事件属于一次 run 内样本，统计独立单位仍是外层成对 run，不能把这些事件当作 30 个独立实验重复。
