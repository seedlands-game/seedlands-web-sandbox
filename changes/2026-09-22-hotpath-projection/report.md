# 热路径优化实验结果

## 决定

仅保留 C（可合成配方枚举）；U（UI 投影复用）因尾延迟否决已撤回生产源码。C+U 为 NOT_RUN：没有两个通过项共存，按预注册停止线不运行失败候选组合。未用后续实验放宽否决线，也未挑选重跑样本。

| 候选 | 主指标 A → B                   | 降幅 / 所需门槛 | chunk p95 A → B               | 决定                    |
| ---- | ------------------------------ | --------------- | ----------------------------- | ----------------------- |
| C    | Authority 136.79 → 120.33 ms/s | 12.03% / 11.42% | 499.65 → 567.20 ms（+13.52%） | PASS，低于 15% 否决线   |
| U    | 主线程 171.27 → 151.34 ms/s    | 11.64% / 6.46%  | 500.30 → 633.00 ms（+26.52%） | REJECT，触发 15% 否决线 |

C 的 Authority 统计分配率为 90.56 → 58.55 MiB/s（下降 35.35%）。这是包括已回收对象的采样分配量，不是 live heap/RSS 或精确复制 bytes。C 的主线程与 Authority 合计采样活动 CPU **298.37 → 306.09 ms/s（+2.59%）**，frame p95 **17.65 → 17.80 ms**。因此结论仅为 Authority 路径资源节省，不声称整帧、总 CPU 或操作延迟改善。C 收益刚越门槛，B 样本波动明显；本机少量受控样本不代表所有设备。

U 的主线程分配率为 124.14 → 90.27 MiB/s；即便 CPU 下降，仍按否决线撤回。区块延迟回归的机制尚未证明，不仅凭此关联断言 UI 是唯一根因。重开 U 需独立需求/实验，优先检查输入轨迹与 chunk 工作量差异，再决定是否缩小候选；不重跑筛选 GREEN。

## 实现与正确性

C 将列表查询与完整动作候选构造分离：每次枚举校验一次 Actor，普通缺料返回 false；保留配方 ID 校验、每次 provider 调用独立冻结槽快照、消费计划验证、实例匹配、顺序和生命周期语义。容量计算仍复用 Inventory 的 removeFromSlot/add，实际 craft 提交仍构造并校验完整事务候选。不缓存可变 Actor 状态，不修改 authority/Worker 所有权。

测试覆盖可合成、缺料、满容量、多输出、耐久实例、自定义 provider、非法计划、独立快照、Registry 合法但 craft 输入非法的 ID。全仓 typecheck、stdlib 96 文件/578 tests、原 crafting-provider 7 tests、定向资格 8 tests、路径检查及相关 ESLint 通过。U 撤回前的 14 项单元测试通过，仅作为实验正确性证据。

保留的静态失败：初次全仓 typecheck 发现新增测试 readonly 用法和 matcher mutable-array 类型错误，已修正；实验 helper 初次 lint 有空 catch，已修正；U 早期格式检查失败后已格式化复验。静态失败不冒充性能失败，也不抹去日志。

## 采样与身份

基线 commit：0759202cd0efbd6cc23dca4f96f657f70f8879d0。先 A/A/A，再 C 的 A/B/B/A、U 的 A/B/B/A，共 **11 次有效真实生产旅程**。所有回执 PASS / MEASURED / RECORDED，测量摘要与 window digest 对应；源码/产物 identity 在旅程前后校验。只有测试类型声明在最终交付中修正，C 生产三文件与被测 B 逐文件 hash 相同。各组身份见 identity-manifest.json；共用 observer/config、lock、seed、场景和 1 general worker。隐藏 sourcemap/CDP 仅用于实验，已从最终生产配置撤回。

A/A 噪声：主线程 3.23%、Authority 5.71%、合计 4.32%、frame p95 0.56%、chunk p95 6.30%。主指标门槛为 max(5%,2×噪声)，尾延迟否决为 max(15%,2×对应 A/A 噪声)。每格完整旅程；CPU 仅统计 C1 之后、C4 之前的完整采样段，按各目标有效秒数归一化，排除 idle/program、包含 GC。每组 A/B 取两次中位数。

| run  | 主线程 ms/s | Authority ms/s | frame p95 ms | chunk p95 ms | 证据 |
| ---- | ----------- | -------------- | ------------ | ------------ | ---- |
| aa1  | 174.18      | 137.09         | 17.60        | 517.80       | PASS |
| aa2  | 170.20      | 132.96         | 17.70        | 550.10       | PASS |
| aa3  | 175.83      | 140.79         | 17.70        | 517.50       | PASS |
| c-a1 | 148.64      | 148.44         | 17.60        | 515.90       | PASS |
| c-a2 | 174.52      | 125.14         | 17.70        | 483.40       | PASS |
| c-b1 | 189.59      | 107.06         | 17.80        | 533.10       | PASS |
| c-b2 | 181.93      | 133.60         | 17.80        | 601.30       | PASS |
| u-a1 | 168.32      | 139.92         | 17.60        | 483.30       | PASS |
| u-a2 | 174.22      | 132.84         | 17.60        | 517.30       | PASS |
| u-b1 | 130.18      | 146.04         | 17.60        | 666.50       | PASS |
| u-b2 | 172.50      | 131.06         | 17.60        | 599.50       | PASS |

每次 benchmark 和本任务重型构建/测试均使用同一 `/tmp/seedlands-benchmark-reservation`；各变体没有私有锁。owner.startedAt 是开始等待时间，实际持锁起点以 receipt 第一条机器 sample 及 waitedMs 核对，不能把排队时间误判为并发执行。未知 owner 不抢占。窗口不能消除 OS/非协作进程噪声，A/A 与 ABBA 仍是必要条件。

V8 profiler 本身、Playwright trace/DOM snapshot 带来观测成本，且该成本未做 off/on 对照。本次 A/B 使用相同观测器，仅把结果解释为该条件下的线程资源估计。浏览器退出时部分旧 Worker 尾段无法捕获，事件日志保留；这些尾段不属于主指标的 C1–C4 完整段。GPU、RSS、精确 ArrayBuffer 复制 bytes 与 input-to-visible 为 NOT_COLLECTED/UNAVAILABLE。函数 inclusive 分组互相重叠，不相加。

## 可复现与交付边界

复现入口见 experiments/README.md；被否决 U 的源码/测试补丁保存在 experiments/rejected-ui.patch，未留下生产开关或死分支。原始 cpuprofile/heapprofile、source maps、Classic/window 回执、构建和失败日志保存在本机 harness/results/hotpath-opt-20260922（最终路径和哈希清单随交付读回）。原始 GB 级数据不提交 Git。

当前未处理：碰撞查询对象分配、snapshot/metrics 编码、state port 深拷贝、prepared mutation 与 chunk 跨 Worker 复制。没有把这轮结果扩大为这些路径已优化。

Delivery Snapshot：最终默认生产构建与无 profiler 的 C0–C5 真实旅程均 PASS（hotpath-opt-delivery）；其结果只作功能回归，不作优化收益样本。最终 sourceDigest=b306e19c96f2cb1cdd0e0138c0ded59699d0a0cfd7529b5cab11b20c5970645b，artifactDigest=b1703fff7aa2c8c8956485ad513defbfcb37145cd9e73979f9fda4fc1bed5b10。远端 SHA/PR 与资源清理另在本机最终交付回执读回。长期 docs baseline 不更新：局部查询优化，沿用现有性能窗口与架构合同。传统正常/保守 3/6 PD；原预算墙钟 2–4 小时、保守×120%=4.8 小时；从用户授权 15:21 到最终功能回归完成约 51 分钟；其中包含串行工具运行和锁等待，不能当作模型生成活跃时长。费用仍无法归因，保留 unknown。两名实现 worker 请求 Terra/high，运行时模型未单独取得可信回显；tokens/credits/API 费用/额度分母 unknown，不用订阅额度推造费用。
