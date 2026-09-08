# Seedlands 优化与技术选型实验回顾

## 审计范围

2026-09-08 对主线 75 个 `changes/*` 目录做了名称、spec 与性能/效率/选型关键词的全量索引；随后深入读取所有以性能、资源效率、测量合同或技术选型为主要采纳依据的 15 个 change，归并为 12 条证据链。以正确性、玩法或视觉功能为主、只附带回归预算的 change 不冒充优化实验，但其否决项仍纳入规则。基线 commit、纳入/排除清单和数量校验见[审计 manifest](optimization-audit-manifest.md)。

Node 独立服务端网络选型尚不在主线，本次另行 live fetch `origin/codex/node-dedicated-server@814413567b0754f20340aa216b219fff8cfeb294`，核对 `network-selection.md`、`network-codec-experiment.md`、`network-corpus.md`、`performance-guardrails.md` 与 `validation-summary.md`。该分支仍是 Active，N2–N4 和产品 A/B 未完成；以下只回收方法，不把参考接线写成已采用方案。

## 做得好的模式

| Change 家族                                                                                                                                                                                                                                                          | 可复用做法                                                                                                                                                                           | 为什么值得保留                                                           |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| [客户端性能可观测性](../2026-09-04-client-performance-observability/spec.md)、[Worker 分段](../2026-09-04-worker-mesh-timing/spec.md)、[Halo 热路径](../2026-09-04-halo-snapshot-hot-path/spec.md)、[Worker-first](../2026-09-04-cooperative-chunk-snapshot/spec.md) | 先把 request-to-visible 拆成 Halo、队列、Worker、transfer、commit、postrender；发现 Worker mesh 只有约 3.1ms 后不继续优化它，转向主线程 Halo；最终用同场景交错 A/B 验证 Worker-first | 先找短板再实现；分段诊断决定方向，端到端 A/B 决定采用                    |
| [世界修改事务](../2026-09-04-world-mutation-transaction/spec.md)                                                                                                                                                                                                     | 同环境 pre-change 基线保护单点路径，同进程交错 A/B 证明 batch；payload 构造、worldgen、meshing 排除边界明确，并同时验结构事件/remesh 次数                                            | 既证明新路径更快，也防止已有常用路径被拖慢；确定性计数和计时各司其职     |
| [体素渲染实验](../2026-09-05-voxel-rendering-pipeline-experiments/spec.md)                                                                                                                                                                                           | 每个候选先定主指标和否决项，先 A/A 再 A→B→A→B；P1/P2 只凭 draw call/bytes 的确定改善采纳，不夸大噪声内计时；P3 `NOT_RUN`，WebGPU 负向后 `ABANDONED` 并移除运行时分支                 | 最接近可复用模板：候选不是承诺，负结果和不运行也是合格结论               |
| [SIMD 实验](../2026-09-06-data-plane-simd-policy/spec.md)、[结果](../2026-09-06-data-plane-simd-policy/simd-results.md)                                                                                                                                              | scalar/SIMD 保持相同算法、布局、内存和任务边界；把热内核、完整 Worker 阶段和独立任务分开；即使内核快 15%–80%，因绝对收益、p95/p99 或产品门槛不足仍不启用                             | 防止“内核倍率”冒充产品收益，也证明拒绝采用是成功实验                     |
| [Wasm 工作量筛选](../2026-09-06-moonbit-wasm-workload-experiment/remaining-candidate-decision.md)                                                                                                                                                                    | 用真实 profile 排候选；把协议 gate、复制、缓存、数学对等和维护日数计入 ROI；W01/W11/W16 即使可采样或很热，也因无法形成有价值的独立替换单元而停止                                     | 未触碰可经济优化的边界时不因技术兴趣继续投入                             |
| [数据平面采纳](../2026-09-07-data-plane-adoption/spec.md)、[结果](../2026-09-07-data-plane-adoption/results.md)                                                                                                                                                      | A=原版、A′=TS 结构修复、B=A′+Rust，分开语言与数据结构贡献；分项通过后做真实输入组合 A/B；W02–W07 组合使编辑 p99 回归后撤出 W07 再测                                                  | 证明整体收益主要来自 TS 修复；组合门禁可以推翻漂亮的分项微基准           |
| `origin/codex/node-dedicated-server` 网络选型                                                                                                                                                                                                                        | 纠正早期把 WSS/JSON 参考组当默认方案；拆消息语义、codec、传输、频率/字段投影；同 corpus 比较 C0/C1/C2；发现与 Wasm 争用的计时整组作废并保留                                          | 技术选型必须逐轴归因；参考实现先跑通不等于采用，受污染样本不能修饰成证据 |
| [太阳采样复核](../2026-09-06-stable-sun-and-break-drop/sun-sampling-review.md)                                                                                                                                                                                       | 发现 readPixels 和不同帧间隔污染指标后保留旧 RED，修改为按太阳角位移归一化并加入已知坏候选负控制；最终候选重新采集，不用离线回算替代                                                 | A/B 之前先验证测量器；错误指标上的精确数字仍是错误证据                   |
| [CI 资源门禁](../2026-09-07-stabilize-ci-resource-gates/spec.md)                                                                                                                                                                                                     | 用多轮 runner 事实区分业务失败与资源争用；只降低 CI 并发、修正确定性等待和目标测试预算，不削弱断言、不加盲重试                                                                       | 工程效率优化也要保留验收语义，不能靠绕过门禁变绿                         |

## 需要吸取的教训

| 现象                                                                                     | 证据边界                                                                                                                                                              | 新规则                                                                                  |
| ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Halo 缓存以单次诊断最大值做 before/after，虽方向正确但不是独立交错 A/B                   | [Halo change](../2026-09-04-halo-snapshot-hot-path/spec.md)诚实标注本机单场景与剩余卡顿，最终采用强证据来自后续 Worker-first A/B                                      | 诊断前后对比用于定位；采纳仍要独立候选、身份一致和交错 A/B                              |
| 首屏 change 完成分包与 loading 行为，却没有取得 Navigation Timing/LCP/CLS 或完整 Harness | [首屏加载](../2026-09-07-loading-performance/spec.md)正确保留未完成项，没有伪造性能分数                                                                               | 功能与呈现可以交付；没有同负载 A/B 时只能称行为改进，不能称已验证的加载性能优化         |
| 数据平面第一批组合回归后撤出 W07，但两批不是随机交错的 W07 单因素实验                    | [数据平面限制](../2026-09-07-data-plane-adoption/spec.md)只称“组合警讯”，没有宣称唯一根因                                                                             | 组合回归必须消融；没有单因素对照不得指定根因                                            |
| 默认优化 profile 的稳态帧/任务基本持平，启动一度慢 3.65%，编辑仅约快 2.9%                | [实验客户端选项](../2026-09-07-experimental-client-options/spec.md)保留 requested/effective 双 profile 和真实中性结果                                                 | 分项采纳不自动证明默认组合对用户更优；默认值和广义收益声明需端到端 A/B 支撑             |
| 网络参考实现先跑通后容易被误当正式 wire，首轮 codec 计时又遇到并行 Wasm 竞争             | Node 分支明确将旧选择降为 reference，并把争用组标为 `CONTENDED_OR_UNVERIFIED`；N2–N4 仍未准出                                                                         | reference、功能接线、microbenchmark、真实传输和产品采用必须分层；污染样本不得补造或覆盖 |
| baseline 会因功能集合、源码和环境改变而失去可比性                                        | [MVP 包体基线](../2026-09-05-mvp-bundle-baseline/spec.md)保留旧值与功能增量；[数据平面主干同步](../2026-09-07-data-plane-adoption/spec.md)不把旧 A/B 重新归因给新提交 | baseline 更新必须保留旧身份和功能差；源码/负载改变后重测，不能用抬基线隐藏回归          |

## 收敛出的默认流程

1. 先从用户问题、SLO/预算、profile 或规模硬上限确认边界；没有边界就停止优化。
2. 以用户可感知主指标排序短板，建立分段观测；观测器本身先做 A/A 或负控制。
3. 为每个候选冻结假设、control、candidate、单一主指标、次指标、否决项、收益门槛、身份与恢复路径。
4. 独立执行分项 A/A 与平衡/交错 A/B；一次只改一个轴，保留全部原始样本和失败。
5. 分项通过后，把通过项组合到真实目标路径；执行产品或工程消费者的端到端 A/B，出现回归则有界消融。
6. 只采用超过噪声/门槛且不触发否决项的候选；否则保留简单 control，移除未采用生产代码，记录 `NOT_RUN`/`ABANDONED` 与重开条件。
7. 用 source/config/corpus/environment 身份限定结论；关键路径、功能集合或平台变化后重新验证。
