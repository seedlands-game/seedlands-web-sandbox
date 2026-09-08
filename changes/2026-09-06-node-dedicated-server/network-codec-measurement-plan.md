# N2 编解码测量执行口径

## 当前状态与范围

本页细化已审核的 [网络选型](network-selection.md) 与 [实验合同](experiments.md)，不修改原合同，不增加协议采用权限。当前完整 descriptor/page 的候选实现仍在做正确性和字节验证，尚无本页定义的耗时样本。历史包含 MessagePack 冒充 C1、共享校验或 oracle 混入计时、样本不足或资源竞争的结果不进入本轮排名。

先做可丢弃原型的编解码成本筛选，再做完整 N2 同 T0 网络实验。筛选回答特定冻结消息的执行耗时与应用字节成本，不能证明可玩客户端收益，也不直接选出正式默认协议。真正的客户端镜像安装、mesh worker 消费、网络同步频率和 T0 会话仍需按各自接线合同完成。

## 准备门禁

1. 输入使用已冻结的真实 Authority 语料及其公共投影。完整基线使用 [基线编解码计划](network-baseline-codec-plan.md) 的 r2 pins；欢迎、提交、动作、输入、实体和 Gameplay 分别登记自己的 manifest、frames、生成入口与源文件 hash，禁止把不同来源的新旧记录无标识混合。
2. 每类先通过每个候选的强等价、真实 decoder 畸形输入、独立持有验证。基线再由正式 change-local 测试调用生产 reassembler；消费者不能由原型内自建 reducer 代替。任一合法输入失败须保留并标记候选覆盖缺口，不能静默删除、放宽资源上限或缩小数据范围。
3. 基线原型新增入口必须绑定源码 hash。C1 使用真实固定 schema writer/reader，C2 使用 typed message 与 raw preflight；旧 `codec-core.mjs` 和 `benchmark-runner.mjs` 不是当前真实 C1 测量入口。记录依赖 lock 和浏览器 bundle hash，所有候选禁止量化或改变字段、消息顺序、发送频率、压缩配置。
4. 计时前冻结配置、主指标、样本数、失败与停止条件。候选实现改变后原样本只保留为历史；重新验证和绑定后才能形成新组，不拼接旧结果。

## 计时边界与公平比较

| 名称               | 包含                                                                      | 不包含或限制                                                            |
| ------------------ | ------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `encodeTotal`      | 公共 pipeline 的合法性检查、候选 encoder、封套和其实际发生的分配/复制     | 输入语料读取、用于预生成输入的 base64/JSON、结果 oracle                 |
| `decodeOwnedTotal` | 实际 decoder 的边界检查/preflight、解析、公共语义校验和独立持有步骤       | 摘要校验、生产消费者和审计格式转换，三者另计                            |
| `integrityTotal`   | 业务合同要求的实际摘要验证                                                | 不逐页额外发明合同没有的全块 hash；禁止每页重复 hash 整块来冒充正常成本 |
| `reassemblyTotal`  | 生产 reassembler 的准入、页复制、整块摘要、最终组装；等待真实异步摘要完成 | 是单独端到端测量，不能再与含相同 hash/复制的分项相加                    |
| `consumerTotal`    | 真实客户端入镜像、LE 转换、版本核对、缓存/worker 副本及任务接纳           | 接线未实现时标 `NOT_COLLECTED`，重组成功不替代客户端应用                |
| 应用字节           | 每个实际 encode 返回的完整消息长度；descriptor/page/整组分别汇总          | 不含 TLS、QUIC、IP 或重传；JSON 字符数不作为字节数                      |

当前 pipeline 可能同时具有公共检查和 codec 内部必需检查；主结果保留实际 API 执行的工作，不为某候选手工去掉检查。实现内部的重复工作可另作优化切片，重新冻结后比较。内部 `parse` 等诊断分项只能解释热点，不能代替 `decodeOwnedTotal` 排名。正确性 oracle、逐字段深等价、审计 JSON/base64、日志、文件写入和浏览器到 runner 的结果传送均在计时外。

绑定当前 `codec-application-pipeline.mjs` 的调用边界：`encodeTotal` 仅执行 `pipeline.encode(input)`；`decodeOwnedTotal` 执行 `parsed = pipeline.parse(bytes); pipeline.validate(parsed); owned = pipeline.own(parsed)`；独立业务摘要项仅执行 `await pipeline.hash(owned)`；消费者项仅执行实际生产 consumer。`pipeline.receive()` 包含 parse、validate、own、hash 和 consumer，只能另标为整个 receive 链路耗时，不归为单独解码或消费者项，也不能与这些分项相加。完整 baseline 的摘要在 production reassembler 内完成；没有独立逐页业务 hash 时 `integrityTotal` 标 `N/A`，不能对 no-op 计时，也不能先做一次同样摘要再放入重组。其余类型同样按实际业务摘要合同决定是否适用。

Node 和浏览器均用各自的单调 `performance.now()` 测量本进程区间，输出字段后缀为 `ElapsedMs`；不得用两端时钟相减。它包含调度、正常 GC 及异步摘要线程池等待，是经过时间而不是 CPU 时间。Node 进程 CPU 计数如另采须明确统计范围；浏览器 CPU、逐消息分配或 GC 采不到则各自标 `NOT_COLLECTED`，不从 elapsed 或 RSS 反推。

基线整组和小消息分开展示。333 条 baseline 记录反映这次采集的两组 mesh 和一组 collision-resync，并非真实每秒消息分布；不能与小输入任意等权合成“总体快多少”。完整 N2 的权重来自实际会话的已登记频率/大小直方图。

## 第一阶段：成本筛选

先 Node 22，再在同一冻结浏览器版本单独测浏览器。每个宿主/候选/消息类先至少 5 个预热 batch，随后至少 30 个测量 batch，累计计时不少于 100 ms。使用相同输入和固定的每批迭代数，批量大小由独立校准阶段确定并写入配置；禁止测量中按哪个候选更快就给它换负载。每次保存批级原始样本和迭代数，结果单位为每批耗时及由其计算的每条平均成本。

30 个 batch 是筛选数据，不把其第 99 百分位当成每条消息的可信 p99，不把一批中的每条重复输入算作独立样本。报告 batch p50/p95、范围和失败；高尾部正式结论由后续独立 run 给出。至少 5 对 A/A 先判断调度噪声与埋点影响；不能区分拟议收益则标不确定，不继续重跑直到显著。

校准与预热记录单列，不进入测量样本。测量 batch 任一正确性或 timeout 失败都保留原记录，并使该组不能用于候选排名；修复后以新绑定重跑整组。该要求同样适用于筛选，不能只对正式 N2 执行。

候选按预登记轮转顺序交错运行，记录顺序，避免总让同一候选承担冷启动。每组正确性检查在计时前后执行，计时中仍保留被测生产/原型 API 自身的必要校验。运行输出保留一个有界、可核对的结果消费值，防止空跑；不把逐条 oracle 放进热循环。正常执行路径的 GC 影响计入时间；不强制逐样本 GC，不把进程 RSS 差直接声称逐消息分配。无法可靠采集的分配/GC 指标标 `NOT_COLLECTED`。

该阶段的主指标预登记为 `encodeTotal`、`decodeOwnedTotal` 的批级 p95 与完整应用字节，分别展示不合并成单一分数。目的为筛选与定位，没有“快 10% 即采用”的权限；完整 baseline 消费和网络排队可能改变排序。

## 第二阶段：完整 N2 与采用门禁

固定同 T0、相同消息投影/频率/压缩与负载，在 Node encode → 浏览器 decode 和反向方向分别测试；真实应用成本和并发 streaming/实时输入场景必须纳入。按冻结实验合同：至少 5 对 A/A，每场景/候选至少 10 个独立配对 run，预热 30 秒、稳态 120 秒，交替或随机 AB/BA，预登记主要指标，配对 bootstrap 95% CI，并以独立 holdout 复验入选配置。每条消息和每个 tick 都不是独立 run。

资源竞争、断连、OOM、timeout、fallback 或正确性失败保留在原始记录，不静默剔除成功率分母；非注入故障不能靠剩余成功样本获得采用。筛选结果不替代该样本量，也不替代固定 codec 的 N3 或真实可玩/WAN 的 N4。

第一阶段首先固定无压缩。完整 N2 前按原合同为大 baseline 另登记无压缩与一种可离线部署的 gzip 对照；固定 codec、页面/batch、窗口、级别、实现版本和线程位置，每次只改变压缩轴。分别测 `compressionElapsedMs`、`decompressionElapsedMs`、压缩前完整 codec 字节、压缩后含必要封套字节，以及解压后的强等价和大小/资源门禁。已有 Chunk 压缩不能无标识重复压缩；若每页或整块压缩改变交付形态，单列为消息/分块策略实验。gzip 收益不算 codec 收益，不在浏览器主线程同步压缩整帧；实现与可达平台未验证前保持未采集。

复杂网络候选的采用仍需满足原合同的预登记主要指标改善与置信区间门槛，明确内存、原生依赖、浏览器覆盖和运维成本。用户 A13 优先：任何已确认的计算上移核心退化必须解决，不能套用旧附件的 5% 容差。无显著收益或证据不足时保留更简单参考并注明未决定，不为达成采用而改主指标。

## 排他运行与留痕

另一侧任务已由用户暂停，但本任务的子 agent、测试、构建和浏览器同样会竞争资源。正式采样前暂停本任务的重计算工作，通过 `scripts/run-exclusive-benchmark.mjs` 获取 `/tmp/seedlands-benchmark-reservation`；已有 reservation 时停止，不删除或抢占。runner 记录 owner、token、PID、起止 UTC，清理前保留 owner 记录。窗口结束后恢复独立工作。

排他窗口包括第一阶段的校准、预热、A/A 和筛选，不只第二阶段正式 N2。每个窗口重新确认其它 agent、构建、测试与无关浏览器闲置，登记供电/热状态；不能读取时标未知。检测到竞争后整组标 `contended` 并禁止排名，保留证据，环境恢复后另建新组。

每组保存 source SHA/dirty 状态及相关源码 hash、lock、artifact、corpus、config、run/pair id、Node/V8/浏览器/OS/CPU、进程角色、执行顺序、采样边界、原始结果 hash、失败和未采集项。不得声称整个目录同一个 Git SHA 能绑定未跟踪原型。大型语料和依赖留在隔离目录，提交精简报告与 hash；报告引用可重查的文件。

本页没有执行采样，实际 credits/API 费用、活跃工时和任务专属额度占比仍为 unknown。筛选和正式窗口属于既有 N2 预算；出现新增平台或代价显著变化时先按工作量规范重估，不能把测量时钟耗时直接当 agent 工时或用 token 替代 credits。

独立审阅：Sol/high 核查冻结合同和实际 pipeline 后指出调用边界、elapsed 与 CPU 混用、大块 gzip 轴三个阻断，以及筛选排他/失败留痕两项补充；本页已逐项修订。尚未执行 runner，不能将文档修订当作测量实现通过。
