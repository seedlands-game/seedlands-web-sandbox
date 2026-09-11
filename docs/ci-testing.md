# CI 测试边界与核心保障

CI 绿色表示当前 SHA 在声明的执行环境中通过指定断言，不能证明没有缺陷。运行入口以 `package.json` 为准；GitHub 要求的 check 名保持 `Static verification`、`Production build`、`Chromium regression`。仓库 ruleset 在 2026-09-09 的读回确认这三项 required 且要求同步最新 base；本 change 不修改保护规则。

## 每个 PR 的保护范围

| 层级                              | 当前保护                                                                                                                                                                 | 不能由此推导                                                                                          |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| 格式、Lint、类型和路径            | 源码约束、声明 API、依赖方向、生成起始页一致性                                                                                                                           | 业务正确、运行时接线正确                                                                              |
| Vitest 全量 + world 行覆盖率 ≥80% | seed/生成器、体素/网格、存档、Authority/物理/玩法/协议/Worker 适配的已声明不变量；真实 Wasm 与 TS 对等及输入不变                                                         | 80% 并非全仓覆盖率；server/client/UI/Agent Server 不受该数值门槛保护，Wasm 内部 Rust 行覆盖率也未测量 |
| Production build                  | 声明的生产产物可以构建                                                                                                                                                   | 产物可启动、路由/Worker/资源在部署路径正常                                                            |
| Chromium regression               | 真实加载、Pointer Lock 移动/跳跃/碰撞、生产编辑与存档重进、streaming、地图、背包/合成/战斗、跨 Headless/Browser checkpoint、诊断、动态实体移除后的局部阴影失效等显式测试 | 所有浏览器/GPU/输入设备、视觉流畅、声音体验、公网和真实模型服务                                       |

文档白名单 PR 只跑格式和路径检查；可执行 change/skill、配置、测试和未知路径仍跑完整 CI。classifier 从受保护的 base tree 读取；异常 fail closed。不要把 docs-only 的跳过重型检查写成核心功能重新验证通过。

现有 `changes/*/e2e` 是显式接入的需求证据，仍有历史维护债务。归档或更改其产品 API 前，必须决定移除已退出产品的用例，或经独立 Sol/xhigh 评审提炼为 `tests/e2e` 长期基线；不能因为路径在 changes 下就认为 CI 不再执行。测试选择清单必须与 package scripts 一起维护。

## GitHub hosted CI 能跑什么

| 场景                                                             | 执行方式 / 验收边界                                                                                                                                               |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 纯逻辑、世界确定性、协议、非法输入、旧 epoch/sequence、取消/释放 | Vitest，固定 seed/时钟，完整字段断言；相同输入与当前生产实现比较                                                                                                  |
| Node ↔ 浏览器 WebSocket                                          | 同一 runner 启动仅监听 loopback 的 Node 服务，真实 Chromium WebSocket；模型响应使用确定性 fixture，端口动态分配、ready 等待、finally 关闭；不需要互联网或模型密钥 |
| 已打包 Node 入口                                                 | build 后 spawn 独立进程，外部客户端 handshake/ready，SIGTERM 退出并确认端口释放；进程内 import 测试不覆盖此边界                                                   |
| 浏览器 Worker、IndexedDB、Pointer Lock、WebGL2 功能              | Playwright 单 worker，按可观察状态等待；确需软件 GPU 的场景显式配置 SwiftShader，结果只声明此环境的功能正确性                                                     |
| 真实外部模型/凭据/服务                                           | 单独、显式 opt-in 验收，报告模型/超时/费用/失败；普通 PR 不依赖秘密或远端服务可用性                                                                               |
| FPS、首屏绝对时延、CPU/GPU/RSS 性能收益                          | 固定设备、性能窗口、A/A 与交错 A/B；共享 hosted runner 的耗时可诊断，但不能与开发机绝对阈值混比                                                                   |
| 实体 GPU 驱动、音频主观体验、移动端手势、WAN/部署                | 专用环境或人工/设备验证。软件 Chromium green 不等价于这些环境通过                                                                                                 |

超时是资源上限，不是性能验收阈值。容量、队列长度、复制字节、状态机不变量属于确定性断言，即便测试名含 performance 也不能整体排除。当前两份显式 opt-in 性能文件中的 skipped 项不能计为通过。

## TDD 的可靠性要求

新增功能先让预期行为在正确边界得到可执行 RED，再通过真实 owner 路径完成 GREEN。修复竞态时，RED 必须能通过控制消息顺序、旧 epoch、取消、延迟和队列上限触发，不能只在快机器上运行 happy path。使用 fake clock 验证逻辑定时，用真实浏览器验证输入与线程接线，两者相互补充。

核心功能至少拥有：规则级成功/失败断言、模块边界真实交互断言，以及一条用户可观察的浏览器旅程。重点是启动→进入世界、输入→Authority→可见反馈、编辑→保存→重进，以及角色生命周期/动作/战斗。不要用大量 UI 旅程重复证明已经由逻辑测试覆盖的排列组合，也不要只测 mock 的调用次数。

异步回归还须核对因果边界：就绪条件只绑定被测对象；夹具显式定义会影响结论的环境；计数基线与正式 owner 的完成边界对应。输入 ack 前进可能确认的是旧输入，计数增长也可能来自前置动画，须结合目标操作对应的状态、轨迹或结果判断。具体帧数/tick 数由用例设计决定，不作为通用规范。

覆盖率之外必须问：如果去掉校验、重放旧消息、丢弃保存、跳过输入释放或调用错误的 Worker/打包入口，这些测试会失败吗？优先为这些具体故障增加反例；不能承诺 TDD 或一个覆盖率数字保证整个程序健壮。关键回归按风险做定向故障反例，反例仍通过时先修正测试；不为每个 PR 引入全仓 mutation testing。

## 执行成本与失败定位

- 静态 job 的生成、格式、Lint、路径、类型和全量覆盖率分别显示耗时；类型错误提前反馈。所有既有门禁保留，不默认关闭 Vitest 隔离或放大并发。
- 大型 TypedArray 对等使用原生 strict deep equality 时仍覆盖全部 corpus/所有元素/类型/有效视图；保留小结构和语义断言。不要用抽样、只比长度或 hash 降低成本。
- 浏览器重试一次用于取得 trace，CI `failOnFlakyTests` 使重试通过仍然失败；不得把 flaky 当作健康通过。失败应修复时序或产品原因，而非增加 retries。
- 浏览器测试默认自行启动严格端口的服务，端口被占则失败，不复用同端口的其他项目。可用 `SEEDLANDS_E2E_PORT` 选择空闲测试端口；只有已核对目标是当前源码的本地开发者才显式设 `SEEDLANDS_E2E_REUSE_SERVER=1`。CI 与生产 preview 始终禁用复用。
- 每轮 Playwright 结束后立即上传独立名称的报告，防止下一条命令覆盖前一轮错误上下文。trace 和截图用于定位，不当作性能采样。
- 优化先读取 step/test 耗时和失败记录；本机受控对照与新 SHA 的远端 CI 状态分别记录，不能把不同机器的 before/after 当严格 A/B。

## 当前已知缺口与下一步

2026-09-09 的核查只讨论当时主线产品；NPC 可组合基线新增的保障与实际准出见[本期 change](../changes/2026-09-10-npc-composable-baseline/spec.md)。

- 常规浏览器回归仍通过 Vite dev server 运行。NPC 基线为浏览器 job 增加独立 `build:web` + `test:npc-production`：在 preview 端口启动实际 `dist`，检查打包 Authority Worker、NPC 状态与 checkpoint 恢复和真实玩家移动。它不复用开发服务器；断言范围仍不是所有生产路由/部署方式。两次构建和对应浏览器证据分开保存，不将 dev regression 冒充生产 smoke。
- Agent 确定性/协议/PG 测试进入 Vitest，`bundled-entrypoint.test.ts` 另经根 `build:agent` 构建后启动真实 Node 子进程，完成 PostgreSQL + WebSocket ready、SIGTERM 与端口释放。Docker 不可用时相关 PG 用例显示 skipped，不能计为通过；真实模型仍只在显式 opt-in 运行，普通 CI 不传上游密钥。
- `test:npc-behavior` 保留断网生活、威胁边界、三角色有限食物、三个认知通道、世界/PG checkpoint 配对和独立扩展 Pack 的需求测试。1800 秒是模拟时间；可选真实墙钟长跑和外部模型用例的 skipped 不等于准出。
- 光影修复是测试口径遗漏的具体例子：旧 gate 没有验证“动态实体移除、体素 revision 不变时清掉阴影”。本次把该用例接入每 PR regression，并以禁用移除失效的突变确认它会失败；它验证 shadow update 请求而非逐像素视觉效果，仍不能推导所有材质、动画、灯位和 GPU 下的像素都正确。
- 覆盖率门槛仅约束 world 行覆盖率；核心规则、存档、输入、Worker/Authority 新鲜度和资源释放仍需要可触发的故障反例。每次线上/人工发现的核心缺陷，应补到能捕获根因的最低层，并保留少量跨层主旅程。
- 光影源 change 记录了两条不在默认 CI 清单中的历史采集/碰撞用例在未改动 main 上也失败；它们仍是需独立定位的基线债务，不将未执行用例计为通过。

### 提速候选（尚未实施，须先对照）

依据 [28f3058 的 CI run](https://github.com/seedlands-game/seedlands-web-sandbox/actions/runs/34335632381)，Vitest 367.97s 中测试体合计312.85s；`world-harness-session` 62.467s、`headless-session` 49.982s、`data-plane-rust` 26.755s、`server-headless-cli` 24.401s，四文件合计约占总墙钟44.5%。这些是既有 SHA 的热点定位，不能当成后续组合提交的性能结果。

1. **测单 worker 与两个 worker。** 保持测试全集、进程隔离、coverage 和断言不变；在同类 runner 上 A/A 后交错 A/B，同时记录墙钟、CPU/RSS、失败与 flaky。当前命令强制 `--maxWorkers=1`，文件间并行可能缩短关键路径，但 Headless、Wasm 和 CLI 子进程争用也可能抵消收益。禁止直接承诺两倍速度或关闭隔离。
2. **减少与断言无关的完整世界启动。** 两个 Headless 测试文件约24次创建，每次支付 safe-spawn、starter chunks、实体 chunk/mesh 初始化成本。优先将非法输入矩阵下沉到已有 validator，保留真实 Harness 路由与错误映射的集成断言；需要独立世界状态的测试继续隔离。共享可变 session 会引入顺序依赖，不采用。若使用只读初始 checkpoint，须验证恢复后的 clock、队列、实体与缓存隔离再测收益。
3. **减少重复 CLI bootstrap。** `server-headless-cli` 至少七次进程启动。可在同一 JSONL 生命周期中串联兼容的协议断言，把纯语义矩阵放低层；保留真实子进程的 stdin/stdout、退出码、EOF 与失败清理覆盖。不能为了省启动而删掉这些进程边界。

`data-plane-rust` 的固定 workload corpus 同时检查 Rust/TS 等价和输入不变，不能把减少 corpus 或只比 hash 称作无损优化。四个慢文件的时间也不是全部可消除的时间。下一轮先以有限并发作单轴实验，再针对剩余热点优化初始化；通过项共存后仍需组合验证。组合CI还观察到一条edge-support flaky使serial组整组重跑，拆解不必要的串行依赖是失败成本候选；必须先确认各用例和结果汇总独立，不能把失败隐藏为部分PASS。
