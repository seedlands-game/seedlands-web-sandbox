# H1/H2 世界开发 Harness 与运行诊断

- 状态：本地实施与验收完成，[PR #25](https://github.com/seedlands-game/seedlands-web-sandbox/pull/25) 已提交，2026-09-09；远端 CI/审核状态以 PR 当前 head 为准。
- 基点：`3c93101861925b0faa89b143993059f36b5fafe3`，PR #24 尚未合并。本分支 `codex/developer-world-harness` 以该交付为前置。
- 授权：用户明确要求自主交付 H1/H2、可见调试面板和下一阶段方案。本轮覆盖下述开发合同、统一权限接缝和内部协议修改；不以旧设计待审核状态阻止已授权的 H1/H2。不实施模型 NPC 产品、远端身份服务或权限管理后台。

## 需求、约束与假设

| 类别         | 内容                                                                                                                                           |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 成功体验     | 同一持久世界可在 Headless REPL 和浏览器调试；显式推进、脚本 Logic、观察、Action、trace、屏障、完整 checkpoint 可实际调用；调试信息分类清晰展示 |
| 长期方向     | 所有调用者经同一权威与鉴权；agent/玩家/API/脚本是配置角色，底层无此特判；模型认知与世界执行分离                                                |
| 硬约束       | 一个 Authority 写者，core 纯逻辑，玩家行为保留，WebGL2；不复活 Dedicated，不做 LOD/离线推进/World AI                                           |
| 技术假设     | 复用 AuthorityRuntime、HeadlessSession、端口和存档完成 H1/H2；诊断优先复用实测，缺失值明确 unavailable                                         |
| 必须消除未知 | 宿主推进/恢复一致性、资源权限表达、Worker/Wasm/内存数据来源、DeepSeek V4 与框架接入边界                                                        |

## 世界协议与权限

新增平台无关世界开发端口和资源授权合同，不引入 AgentSource/AgentSession/agent RPC。身份由可信宿主绑定，请求不能自授角色。角色是配置；统一按 principal、resource、operation、target/scope 判定，默认拒绝，通配权限只由开发宿主显式授予。

现有命令进入可枚举资源目录；目标至少覆盖自身 Actor、其他实体、世界查询/编辑、时间、Logic、trace、checkpoint。玩家、脚本/API 走同一策略判定，标签不决定权限；旧 command category 只作为兼容适配，不能绕过资源策略。新的底层协议不能固化 agent/LLM/provider 枚举。

全局 inspect 与局部 observation 权限分离，角色可见性由玩法感知决定。不将同源开发工具伪称为 UGC 沙箱，不声称本期完成后续 NPC 平权重构。现有可指定搜索范围的 query-observation/query-pois/query-path 是开发查询，要求全局资源权限，不能由 self Actor grant 获得；真正的局部投影在 A1 实现。

## H1：共享世界能力与持续 REPL

共享能力包含 identity、inspect voxel/chunk/entity/actor、显式 prepare/场景构造、command 提交/回执、clock pause/run/advance、Logic observe/submit、Action 查询、barrier、trace 读取/导出、checkpoint 导出/恢复。返回结构化错误、epoch/revision/frontier，inspect 不隐式生成未知地形。

Headless world 一次创建。TTY 使用 Node REPL 支持多行 JS/top-level await 和公开 world 对象，明确可信开发执行；JSONL 不 eval 字符串，只接受版本化白名单 RPC，stdout 纯 JSONL。保留 slash CLI 兼容入口。JSONL 单请求背压、普通行 1 MiB / checkpoint restore 96 MiB 的增量 framing，typed arrays 有正式 base64 编码；单次推进最多 60 秒，导出/恢复有尺寸验证；EOF 释放资源，不默默保存。

checkpoint 复用完整 FrozenGameSaveSnapshot，不引入尚未实现的 agentState；跨宿主恢复，候选验证后替换 owner，失败保持旧世界，成功切换 epoch，使旧请求/Logic 候选失效。明确当前保存覆盖与未来认知字段的区别。

## H2：Browser 同合同与确定推进

Browser 世界端口通过 Authority Worker 执行，不在主线程建立第二 Authority。保留 window.__seedlandsHarness 历史产品方法，新增明确 world 端口；视角/输入/渲染/音频/诊断只属 BrowserProductHarness。

pause 等 Authority 握手并清旧输入；advance 只在 paused 接受，关闭 wall-clock 驱动且串行；两端使用相同固定步长与 lane 顺序，不用改天时冒充模拟推进。run 恢复正常时钟。

barrier 绑定有限 frontier/epoch，有超时/失效反馈，区分 committed、settled、checkpoint ACK，不用 sleep 实现完成。scripted Logic 停止算法同时抢写决策，反射与执行保留正常运行时；切回/恢复使旧候选失效。

## 可见调试面板

F3 保持入口，打开时释放 Pointer Lock 和已按住输入，正常世界不因此暂停，单击世界恢复操控；按概览、世界/模拟、任务/Worker、渲染/资源、Wasm/特性、内存分组，参考 BetterF3 的可读信息块。支持折叠/筛选或紧凑展示，常用视口可读可滚动，保留碰撞显示与原有有用指标。

展示真实来源的 Worker 角色/数量/队列/忙闲/延迟、模拟频率/债务/提交进度、Wasm 后端/执行统计、特性开关和可得内存。Worker 数不是 OS 线程数；未知 CPU 使用率、线程数、GPU/全进程内存明确 unavailable，不能按 hardwareConcurrency 或零默认值伪造测量。样本带时间/来源，更新有界，不宣称性能提升。

## RED / GREEN 与准出

- H01 持续会话：多轮 JS/JSONL 改块、查询、推进，同一 worldId；非法方法、序列、超限、EOF 可观察。当前缺共享端口/REPL，先写行为 RED。
- H02 同 fixture/ticks，在 Headless 与真实 Browser Authority Worker 比较规范化世界、Actor、Action、提交、checkpoint；覆盖跨 Chunk、编辑后路径、未知块、重复/旧 epoch，只验证现有游戏能力。
- H03 pause 不偷偷推进，run 中 advance 拒绝，恢复不粘输入；scripted 切换、陈旧候选拒绝、屏障超时/恢复失效。
- H04 checkpoint 跨宿主恢复；损坏/未知版本保留旧世界，成功新 epoch 且继续编辑/推进。
- H05 不同标签同策略、同标签不同策略；无权限/越界不泄漏或写入；命令目录穷尽；请求自报角色不授予权限。
- H06 真实浏览器 F3、分类/折叠/滚动、小视口、负载后指标变化；截图核查层级、可读性和未知字段。
- H07 根 verify:static、独立 build、原 Headless、必要浏览器/近战回归，不下调旧门槛。
- D01 下一阶段明确核心回路、频率/预算、工具/schema、上下文分区/轮换/压缩/恢复；框架比较引用当前一手资料，有否决项与接入门槛，本期不调用模型密钥。

## 分工、预算与任务

见 [estimates.md](estimates.md)。主任务持有标准、研究、UI、集成交付；Sol/high 持有世界 Harness/REPL/Worker 与确定性自测；Terra/high 独立验收。现有隔离 worktree 按路径分工，不另建用户任务。

- [x] H1 合同、权限与 REPL。
- [x] H2 浏览器同合同、一致性与恢复。
- [x] 可见诊断面板。
- [x] 下一阶段方案和路线。
- [x] 独立验收、静态/构建、浏览器证据。
- [x] 长期 docs、语义提交、PR 交接，不合并。

最终静态、构建、新增真实 Browser 与必要集成门禁已通过；旧完整回归一次 19/20 的失败及后续有界对照如实保留，详见 [实施记录](implementation-report.md)。PR/CI 状态以远端当前 head 为准。

## 2026-09-09 前序合并后的 CI 复验

远端 `b7d7169` 与此前绿色 `5d49ce8` 的源码树完全相同；run `34322183659` 的 parity 场景三次超时，artifact 显示约 3–4 FPS 与 WebGL stall。此为保留的运行 RED，尚不能证明特定队列死锁。parity 不验证画质，将其首次导航前固定为产品 Low 配置并断言 snapshot quality；仍验证同一 Authority、Worker、checkpoint、显式推进和真实输入。仅做一次无重试受影响复验；若仍超时，进一步采集请求时序，不提高 timeout 或改变生产调度。
