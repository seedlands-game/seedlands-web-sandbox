# Node 目标接入审计与最小方案

> 仅为长期架构背景与只读审计，不属于当前实施、验收或成本。用户最新澄清：当前不开发Node Dedicated Server、worker_threads pool或Rust Node-API。文中人日估算只适用于未来独立需求。

## 当前事实与结论

当前 Node 能力只有 `pnpm server:headless` 启动的本地 `HeadlessSession` 命令行入口。它通过 Vite middleware mode 直接加载 TypeScript，使用内存持久化和标准输入输出，复用 `AuthorityRuntime`、`GameServer`、多频率调度、事务去重、流体提交与 Logic 意图提交。这能证明无 DOM 的权威路径可运行，但还不是正式 Node Dedicated Server：仓库没有可部署的 Node 构建产物、实时进程生命周期、网络会话、多客户端认证、磁盘存储、`worker_threads` 池、N-API addon 或原生进程适配。

最小安全接缝应放在 `HeadlessSession` 与纯计算之间，不进入 `AuthorityRuntime`/`GameServer`。现有权威 runtime 已提供合适的请求和提交边界：安全出生点通过 `findInitialWorldBootstrap` 返回纯结果；流体通过 `onFluidWork` 发出不可变快照，只有 `commitFluidCandidate` 能写回；Logic 通过 `onLogicObservation` 发出观察，只有 `receiveLogicIntentBatch` 能写回；未知 Chunk 则由 `prepareMesh` 生成只读输入，再由 `acceptGeneratedChunk` 验证并提交。因而无需重写权威状态机，也不应让 Rust、Wasm、N-API 或线程池持有 `GameServer` 引用。

当前 `HeadlessSession` 在四处直接调用计算：新世界 `find-safe-spawn`、加载 Chunk 的 `generate-mesh`、`computeFluidCandidate` 和 `decideLogicIntents`。建议只增加一个会话级 `HeadlessKernelExecutor`：

```ts
type HeadlessKernelExecutor = {
  world(task: WorldComputePayload): Promise<WorldComputeResult>;
  fluid(snapshot: FluidAuthoritySnapshot): Promise<FluidCandidate>;
  logic(observation: LogicObservation, physicsHz: 30 | 60 | 120): Promise<LogicIntentBatch>;
  diagnostics(): HeadlessKernelDiagnostics;
  dispose(): Promise<void>;
};
```

默认 `NodeTsSingleExecutor` 仍在当前线程调用现有三个纯入口，先证明抽象本身 A/A 等价且成本在噪声内。异步 executor 的完成结果由 `HeadlessSession` 串行收回：先校验 epoch、work id、read set、结果类型与取消状态，再调用现有 Authority 提交方法。`advanceSession()` 在每个 Authority 分片后排空本分片派发的 Logic/Fluid 工作；继续请求下一批 Logic 观察只发生在上一批成功提交后。这样可保留现有每个模拟时间段完成后即可观察到结果的语义，并避免异步结果越过事务或会话边界。

## 三个 MVP 后端

1. **Node TS single**：上述 inline executor，是当前行为的接缝控制组。它保留 `runWorldComputeTask` 的 cancellation/checkpoint 与原始 TS Logic/Fluid 路径。
2. **Node TS pool**：Authority 仍固定在主线程；使用 `worker_threads` 建立一个 general 池、一个有序 fluid lane 和一个 TS logic lane。general 任务可并发，fluid 同一 Authority 保持单 lane；所有提交仍回到 Authority 主线程串行执行。浏览器 `ComputeWorkerPool` 的队列、epoch、依赖、取消、重启思想可复用，但 Node `Worker` 事件与错误生命周期需要薄适配，不能直接把依赖 DOM Worker 类型的 browser runtime 当作 Node 正式实现。
3. **Rust Wasm / N-API**：先建立无宿主依赖的 `seedlands-kernel-core` Rust crate，整数布局、排序、边界检查和结果编码只有一份实现。`wasm32-unknown-unknown` 与 N-API 分别是薄适配；两者都运行在 executor worker 中，不在 Authority 主线程同步执行大任务。Wasm 每个 worker 持有独立实例和线性内存；N-API 每个 worker 加载 addon 并同步调用纯函数。现有 `experiments/rust-reference.rs` 只覆盖 `fill_chunk`、`fluid_candidate`、`mesh_describe` 的单文件 Wasm 对照，尚不是共享 crate，也没有 N-API/native 产物或生产 loader，不能直接称作 Node Rust 后端。

独立原生进程适配放在长期目标：同一 Rust core 再加长度前缀二进制协议，通过子进程或本地 socket 提供 crash isolation。MVP 不同时引入这个传输层，因为它会把语言收益与 IPC、进程恢复、背压混在一起。N-API addon 若崩溃会带走所在 Node 进程；首版必须把调用限制在线程 worker 中、将 Rust panic 转成错误，并把任意 trap/panic/ABI/hash 不符标记为该 run 无效，不能在性能样本内静默回退 TS。

## 组合 A/B 设计

先冻结源码、Rust core、Wasm、addon 和 Node 构建产物 hash；每个 run 使用新进程并记录 Node/OS/CPU、worker 数、线程配置与 capability。比较拆成两个正交问题：

| 比较   | 配置                                      | 回答的问题                                      |
| ------ | ----------------------------------------- | ----------------------------------------------- |
| A / A′ | 当前 TS inline / 经 executor 的 TS inline | 接缝、观测与 Promise 编排本身的成本             |
| A′ / B | TS inline / TS pool                       | 只隔离线程搬移、排队和复制的收益                |
| B / C  | 同一 pool、TS kernel / Rust Wasm kernel   | 相同线程拓扑下 Rust/Wasm 的净贡献               |
| C / D  | 同一 pool、Rust Wasm / Rust N-API         | 相同 Rust core 下 Wasm ABI 与 native ABI 的差异 |
| A′ / D | TS inline / 最终 N-API pool               | 用户可得到的整体 Node 收益                      |

每项使用 10 个平衡 block，运行是配对统计单位。固定 seed、generatorVersion、命令序列、模拟时长、实体/Chunk/流体规模和并发会话数；禁止按结果选择性删 run。正确性先逐 run 比较 Authority snapshot、commit 顺序、Chunk/存档字节、Logic intents、Fluid candidate 和命令响应。性能同时包含一个完整 `HeadlessSession` 轨迹及独立 kernel corpus：前者回答整体收益，后者定位复制、排队、FFI 与内核成本，不能用微基准代替会话结论。

并发扩展在单会话通过后再固定为 `1/2/4/8` 个独立会话。每个会话继续拥有独立 Authority；共享的是有界 executor worker 池，不共享可变世界状态或 Wasm memory。另测 pool worker 数 `1/2/4`，并记录物理核/逻辑核；吞吐、单会话 p99 和公平性一起报告，不能只报总 tasks/s。冷启动用新进程测 10 对；稳态在一次初始化后跑固定模拟时长。`advanceSession(1000)` 表示推进 1 秒模拟时间，并不等于真实服务器已经以 1 秒 wall time 持续调度，报告必须使用“固定模拟工作量 wall time/CPU”这一口径。

## 可观察性

- **启动**：进程 spawn 至入口、模块加载、executor ready、Rust artifact 校验/实例化、`HeadlessSession.create`、Authority ready 分段；同时记录首次任务延迟。
- **延迟**：任务 enqueue、worker receive、kernel begin/end、parent receive、Authority commit 各用同一进程的 `performance.timeOrigin + performance.now()`；报告 queue、复制/编码、kernel、roundtrip、commit-delay 的 p50/p95/p99/max。不同进程时间不可未经校准直接相减。
- **CPU 与调度**：父进程记录 `process.cpuUsage()` 和 event-loop utilization；worker 记录自己的 wall 区间和 event-loop utilization。线程 CPU API仅在运行时存在时采集，否则写 `NOT_COLLECTED`，不得拿 kernel wall time冒充 CPU。
- **RSS 与内存**：父进程用 `process.memoryUsage.rss()` 采样进程峰值，并记录 heapUsed/external/arrayBuffers；每个 worker 回报 V8 heap、Wasm `memory.buffer.byteLength` 和 backend 自报 arena。RSS 是全进程数据，不能伪装成逐 worker RSS；N-API/native 分配若无 allocator 计数，只能从进程 RSS 增量和后端自报上界解释。
- **GC**：父线程及每个 TS worker 用 `PerformanceObserver` 记录 GC 次数、kind、总时长和 p95/p99；Wasm memory 与 Rust native heap另列。只在 run 之间可选调用 `global.gc()`，计时区间不强制 GC，并用 A/A′ 校验观测开销。
- **可靠性**：记录队列深度/字节、拒绝、取消、stale result、worker 重启、trap/panic、fallback、Authority 拒绝理由。正式 A/B 中 fallback 为无效 run，原始失败仍保留。

p99 只作为每个 run 内任务延迟分布及跨 run 汇总描述；置信区间仍以完整 run 为独立单位做配对 bootstrap。RSS 轮询、GC observer 和逐任务时间戳本身都要通过无观测/有观测 A/A 验证，不达噪声要求时降低采样频率而不是删掉内存结论。

## 人日估算与门槛

以下按一名熟悉现有代码的工程师、先支持当前 macOS arm64/Node 版本、已有三类 Rust 参考内核计算，不是跨平台发布日期：

| 工作                                                                    | 预计工程日 |
| ----------------------------------------------------------------------- | ---------: |
| executor 合同、TS inline 接入、异步排空与权威等价测试                   |        2–3 |
| 可部署 Node ESM 构建、`worker_threads` 入口、TS pool 生命周期/取消/背压 |        3–5 |
| Rust 单文件参考整理为共享 core，并接入 Node Wasm worker                 |        4–7 |
| macOS arm64 N-API 薄适配、构建/hash/失败测试                            |        4–6 |
| Node A/B runner、RSS/GC/p99/启动/并发观测与报告                         |        3–5 |
| **本机 MVP 合计**                                                       |  **16–26** |

Linux x64/arm64、macOS x64、Windows 的预编译 addon、签名/发布、CI 矩阵和原生崩溃恢复预计再需 8–15 工程日。把浏览器与 Node 的全部候选内核都迁到共享 Rust core，需在热点复测后按入选范围另估；不能用现有三个实验函数推算为已经完成。若 TS pool 已消除 Authority 主线程阻塞且 Rust 后端端到端 CI 未稳定高于复制/FFI 成本，应保留 TS pool 为正式后端，而不是为统一语言强行迁移。

## 长期目标与当前缺口

长期形态是同一纯 Rust core 产出浏览器 Wasm、Node Wasm、Node N-API 和可选 native service adapter；浏览器与 Node 各自保留宿主调度/生命周期，Authority 永远只接收带身份、版本和 read-set 的结果。Node Dedicated 再在 HeadlessSession 之外增加真实时钟驱动、持久化、网络协议、会话隔离、过载策略、优雅退出与恢复，不能把当前 CLI 改名后算作完成。

当前需要在更新后的 spec 审核通过后再补：Node ESM 构建产物与 worker 入口、executor 协议及 transfer/clone 规则、异步 drain 的确定性合同、Rust core crate、N-API/native 工具链与发布矩阵、Node 专用 corpus/轨迹、进程级原始证据格式，以及 A/A 噪声和观测开销基线。在这些缺口关闭前，可以称现有能力为“本地无头 Authority 会话和 Rust Wasm 实验参考”，不能称为“正式 Node Dedicated Rust 后端”。
