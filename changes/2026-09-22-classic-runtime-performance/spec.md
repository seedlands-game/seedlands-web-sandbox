# Classic 真实路径性能优化

状态：Delivered / 单列缓存候选通过并采用。基线源码 ece53fcd34149d4bb71879996ccdfd459649c93e。

## 用户结果与硬约束

用户希望改善当前 Classic 可玩体验的真实性能；任何候选都必须先测当前基线，并在每次单因素优化后以同一场景复测，不凭静态热点或示意性 microbenchmark 宣称收益。

硬约束：复用唯一生产 Classic C0–C5 旅程、固定 seed/generator/Playbook/WebGL2/Chromium/960×540/Low/Wasm/SIMD、持有机器级性能窗口、保留全部失败与原始样本；普通测试、Playwright 总墙钟、历史数据和未预约诊断不能充当性能证据。一次实验只改变一个候选，未通过则删除候选生产分支。不得改变世界确定性、权威 owner、存档/协议语义、Worker buffer 所有权或现有 C0–C5 行为。

## 现状与待证伪假设

- 当前生产旅程已暴露 frame、chunkVisible、队列/资源边界和 Chrome trace，且 evidence 仅在窗口身份、receipt 与 measurement declaration 完整时标记 MEASURED。
- 当前 checkout 只有立即失败的独占锁 scripts/run-exclusive-benchmark.mjs，尚没有会等待并注入上述测量身份的窗口 wrapper；直接伪造环境变量不满足证据合同。
- 静态扫描候选包括：snapshotBytes 在每次 gameplay view 中创建并序列化全量快照、UI 每帧用 JSON.stringify 深比较、Authority wake 容量预检分配/全量扫描、gameplay view 全量投影。它们只是 profile 候选，不预先认定为主要瓶颈。
- 待证伪主假设：profile 中贡献最大的单一非必要热点移出真实路径后，完整 C0–C5 的 Chunk 可见 p95 会产生超过机器 A/A 噪声且至少 5% 的改善，同时 frame p95、资源和正确性不退化。

## 范围

1. 恢复最小性能窗口 wrapper：阻塞等待现有锁、只释放自己的 lease、向 child 注入 window identity/receipt/declaration 路径，结束后验证声明并保留 receipt。
2. 对冻结 control 运行三次 A/A，取得当前机器与观测器噪声；启动/能力失败也保留。
3. 从同一批 trace/profile 选择贡献最大的单一候选，先写语义 RED/等价测试，再实施最小 B。
4. 以 A B B A 顺序各四个完整旅程样本复测。若候选通过才保留；否则恢复 A 并记录负结果。
5. 若首个候选通过且仍存在清晰主要瓶颈，后续候选须新增独立分项合同并重新 A/B；多个通过项共存前做组合端到端 A/B。

非目标：发布或自动合并；更新 accepted baseline；用 microbenchmark 外推产品收益；一次性清扫全部 stringify/clone；更换渲染后端、玩法集合或场景；以调大超时/重试掩盖失败。

## 实验合同

### 基础设施 RED/GREEN

Given Classic benchmark 由现有独占锁直接启动，When evidence 写出，Then measurement 必须是 DIAGNOSTIC 而不是 MEASURED。

Given 新窗口 wrapper 成功持锁，When child 写出与 run/window/owner/scenario/source/artifact 对齐的 declaration，Then receipt 包围实际采样时间且 Classic evidence 为 MEASURED；竞争者等待，超时返回 75，取消/失败不删除他人锁并清理自有进程组。

### A/A 噪声

- 样本单位：一次完整生产 C0–C5 旅程；每次冷启动浏览器，构建 artifact 在同一源码身份下复用。
- 样本数/顺序：A1 A2 A3，全部 control，串行且持有同一机器锁。
- 唯一主指标：各 run C4 evidence 的 chunkVisible.p95Ms；次指标：frame.p95Ms/p99Ms、longFrameCount / frame.count、trace 分类累计/尾延迟、队列和资源边界。
- A/A 噪声：三次 control 主指标的 (max-min)/median；次指标同法记录。样本不足、身份不一致或任一 run 非 MEASURED/PASS 时停止并标记 NOT_COMPARABLE。

### 首个候选 A/B

- A：冻结 control artifact/source；B：只包含 profile 选中的一个候选及其语义测试。
- 样本数/顺序：A B B A，每臂四个 run（两轮 ABBA）；固定 corpus、seed、输入、质量、runtime、浏览器、viewport、artifact 构建方式和观测边界。
- 估计量：每臂四个 run 主指标的 median；尾延迟和资源逐 run 保留，不丢异常值。
- 通过：(median(A)-median(B))/median(A) >= max(5%, Chunk A/A noise)；且 B 的 frame.p95Ms median 不比 A 退化超过 max(5%, frame A/A noise)。
- 否决项：任一 B 非 MEASURED/PASS；C0–C5、page error、failed response、确定性/权威状态、source/artifact identity、Worker/Wasm/WebGL2 身份失败；长帧率或资源边界退化超过对应 A/A 噪声/5%；Worker 失败/陈旧结果增加；出现 GC/RSS/GPU 数据缺失时记 NOT_COLLECTED，不填零、不单独否决。
- 停止线：基础设施无法生成真实 MEASURED 样本；A/A 噪声超过 20%；profile 不支持候选影响主指标；首个候选失败后恢复 A，再根据同批 profile 重新排序，不反复运行挑 GREEN。

## 实施前测试设计

- 窗口测试覆盖：竞争等待、超时、取消、child 失败、进程组清理、owner 原子提交、receipt/declaration 身份与采样包围关系。
- 候选测试覆盖：先破坏目标优化的等价/调用次数合同得到 RED，再实现 GREEN；运行相关 stdlib/Web 定向测试、类型与 lint。
- 浏览器证据：只运行 apps/web/tests/e2e/classic-runtime.spec.ts 的生产 artifact，不新增旁路线。

## 工作量与预算

不属于大规模 change：预计传统工程量 1.5–3 PD；单候选 Agent 连续墙钟约 4–10 小时，其中完整浏览器采样占主要时间。credits、API 等价费用与账户额度分母当前不可得，记 unknown；不创建 goal。若扩展为三个以上独立候选或跨越渲染/协议边界，先按大规模 change 规范重估并增加 estimates.md。

## 任务状态

- [x] 恢复前序 agent 对话并冻结当前源码身份。
- [x] 核对现有 Classic telemetry、evidence 与独占锁边界。
- [x] 建立并验证性能窗口 wrapper。
- [x] 构建冻结 control artifact，完成 A/A。
- [x] 基于真实 trace 选择首个候选并取得语义 RED。
- [x] 实施 B 并完成 ABBA。
- [x] 完成回归、结论与 Delivery Snapshot。
- [x] 本地语义 commit。

## Delivery Snapshot

采用 Classic worldgen provider 的实例内、4096 列上限 MacroContext 缓存；普通产品仍默认 1 个 general Worker。恢复 pnpm bench:runtime、阻塞性能窗口和 measurement proof，长期 docs baseline 因可执行入口恢复而更新；局部候选细节只留在本 spec。

最终源码身份：source SHA ece53fcd34149d4bb71879996ccdfd459649c93e，working source digest cd14c47f130c153fcf93997a0107dd664af23668286ac4eff3224e3f9918cc12，artifact digest 66184bc148e9649a3c3667df56e042435e5539d181194a10583c3fa9fa1635b4。最终确认 perf-final-confirm 为 PASS / MEASURED / RECORDED，C0–C5 全绿；C4 Chunk p50/p95/p99 为 101.2/451.0/616.6ms，frame p50/p95/p99 为 16.7/17.4/18.5ms，长帧 0，Worker failed/stale 0，kernel memory 18MiB。

正式 A/B 结果：无缓存 A（4 个单 Worker 样本）对列缓存 B（4 个单 Worker 样本），Chunk p95 中位数 2283.85→468.45ms（-79.49%），Chunk p50 472.30→100.70ms（-78.68%），WorkerHaloSample p95 294.50→42.30ms（-85.64%），累计 15.95→2.52s（-84.17%），WorkerQueueWait 累计 96.53→55.75s（-42.25%）。frame p95 17.60→17.25ms，frame p99 18.90→18.25ms，长帧率均 0，kernel memory 均 18MiB。全部 B 样本通过正确性、身份和资源否决项。

未采用候选：默认 2 个 general Worker 的 8 样本 ABBA 将 Chunk p95 从 2283.85 降至 1225.90ms（-46.32%），但 kernel memory 18→36MiB（+100%），违反预注册资源线，已恢复默认 1。

验证：pnpm verify:static PASS（Kernel 28、stdlib 570）；Classic provider 2/2、halo/ore 7/7、session/worker pool 20/20、性能窗口 4/4；最终完整浏览器旅程 1/1 PASS。GC/RSS/GPU 为 NOT_COLLECTED，不外推到实体设备。传统工程量实际约 1 PD；Agent 墙钟约 2 小时；credits/API 等价费用/账户占比 unknown。

### 运行记录

- perf-aa-control-1：FAIL / NOT_RECORDED，2026-09-22。C0/C1 通过，C2 固定资源采矿被确定性自然生成实体 natural-6-27_60_1 抢成近战目标，8 秒内目标体素未破坏；窗口 receipt、Classic failure evidence 与 Playwright trace 均保留。该样本证明原 fixture 在恢复时钟后没有隔离 C1 期间的新自然实体，不能进入 A/A 统计。
- 修订 control fixture：C1 后暂停时钟，只清退刷怪策略产生的 natural-* 实体并验证无残留，再恢复时钟；不关闭产品自然生成，不改变固定 hostile/NPC/食物。修订后重建 source/artifact identity，并从零取得三份有效 A/A。
- perf-control-validation：FAIL / NOT_RECORDED，2026-09-22。C0–C3 通过，C4 到达 x=189.4、streamCenter.x=5 且 Worker/队列均健康，但从工位区域的 center 2 只移动了 3 个 Chunk 中心，不满足既有 >=4 合同。canonical farTurnaround=192.5 与 walk tolerance 会在进入 Chunk 6 前停止；保留失败 receipt/evidence/trace。
- 保持既有“四个 Chunk 中心”验收，不降低断言；把 canonical farTurnaround 修正到 Chunk 6 内部的 x=208.5，并以新 scenario/source identity 重新做一次 control validation。
- perf-control-validation-2：FAIL / NOT_RECORDED，2026-09-22。成功到达修正远端，但返回时在 x=141.3、y=20.8 停止；输入 ack 和 Worker 均继续，证据显示受控 floor/air 只到 x=198，路线 x=208.5 越界坠落。把同一 fixture 走廊延伸到 x=224，不改变真实输入或四-Chunk 验收，再执行 control validation-3。
- perf-control-validation-3：PASS / MEASURED / RECORDED，C0–C5 全通过，measurement digest 与窗口 proof 一致。
- A/A：perf-aa-1/2/3 均 PASS / MEASURED / RECORDED，同一 source digest adfb52b6、artifact digest 4ab461cc。C4 frame p95=18.4/17.6/17.5ms，relative range=5.11%；Chunk 可见 p95=2248.1/2266.6/2232.8ms，relative range=1.50%。
- 三次 trace 一致：WorkerQueueWait 89–91 次、累计 93.5–94.3s、p95 3.33–3.36s；WorkerHaloSample 108 次、累计 15.3–15.5s、p95 284–289ms。frame 无长帧，故首个候选改为已有的双 general-worker 能力：A 显式 generalWorkers=1，B 默认/显式 generalWorkers=2；主指标改为 Chunk 可见 p95，frame 与额外 Worker 内存作为否决项。
- 双 Worker ABBA（perf-ab-r1-a/b1/b2/a2 + perf-ab-r2-a1/b1/b2/a2）：8/8 均 PASS / MEASURED / RECORDED，同一 source digest d3c30ddc、artifact digest e94549db。A/B 的 Chunk 可见 p95 中位数为 2283.85/1225.90ms（B 改善 46.32%），frame p95 为 17.60/17.45ms，WorkerQueueWait 累计中位数为 96.53/68.21s；但 kernel memory 为 18/36MiB（+100%），触发预注册资源否决项。候选不采用，产品默认恢复 1；显式双 Worker 能力保持原状。
- 第二候选：保持 1 个 general Worker，在每个 Classic provider 实例内按 seed/generatorVersion/x/z 有界缓存纯确定 MacroContext。A 为无缓存，B 为最多 4096 列的缓存；主指标仍为 C4 Chunk 可见 p95，frame、Worker 错误/陈旧结果和资源为否决项。组件 RED 要求同列多 y 逐值等价且 macroAt 调用次数显著少于无缓存路径。
- 第二候选组件证据：调用计数测试先 RED；实现后 Classic provider 测试 2/2、TS/staged/Wasm halo 逐字节等价 7/7、Playbook 类型检查通过。A 使用双 Worker 实验中四个显式 generalWorkers=1 且尚无列缓存的样本；B 同样显式 generalWorkers=1，只改变 provider 内有界列缓存。
- 单 Worker 列缓存 A/B：A 四个样本 Chunk 可见 p95 中位数 2283.85ms、p50 472.30ms、WorkerHaloSample p95 294.50ms、累计 15.95s；B 四个样本分别为 468.45ms、100.70ms、42.30ms、2.52s，对应改善 79.49%、78.68%、85.64%、84.17%。WorkerQueueWait 累计下降 42.25%，frame p95 17.60→17.25ms，frame p99 18.90→18.25ms，长帧率保持 0；Worker kernel memory 均为 18MiB，failed/stale 均为 0。四个 B 均 PASS / MEASURED / RECORDED，满足采用条件。
- perf-final-confirm：最终 tree PASS / MEASURED / RECORDED；C4 Chunk p95 451.0ms，frame p95 17.4ms，单 general Worker、18MiB kernel memory、failed/stale 0。
