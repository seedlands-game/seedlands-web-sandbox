# H1/H2 实施与验收记录

状态：集成验收中，不是完成声明。基点 `3c93101861925b0faa89b143993059f36b5fafe3`，工作分支 `codex/developer-world-harness`。前置 PR #24 仍需独立合并，最终 PR 不自动合并。

## 已确认的证据

- 框架隔离实验：固定版本 `LangGraph 1.4.14`、`ChatDeepSeek 1.1.11`、`OpenAI Agents 0.17.2`；mock transport 实测两个默认 adapter 丢失 DeepSeek reasoning replay，显式图暂停/恢复不重复 submit。版本锁、脚本、机器输出和 dsh 固定提交来源在 `experiments/framework/`。零真实模型调用；模型质量/延迟/费用未验收。
- UI：真实 Chrome / Playwright 已通过 F3 切换、Pointer Lock 释放且世界不暂停、六类指标、Wasm 数据、紧凑布局与 800×600 滚动。原始截图检查发现全局按钮样式覆盖，修复作用域后复验通过；不是性能 A/B。最终 source 验证尚待集成完成后统一运行。
- 诊断定点测试：真实 KernelMemory 调用/异常/增长、未知值不伪装零、陈旧/坏 Worker 遥测拒绝、重建归零及有界 JSONL/base64 编解码，共 4 文件 7 测试通过。
- JSONL 真实子进程与 transport：9/9 通过，非法参数后继续、typed-array checkpoint 导出/恢复/损坏后继续均通过；两个旧 `/tick` 在初始暂停下回零步的问题已修复，原测试未放宽。
- 真实 TTY REPL：多行对象、top-level await、同一 world 改块并查询为 voxel 4、run 推进到 physicsTick 400、pause、导出 799383 bytes checkpoint、`.exit` 退出码 0。该数据来自同一个持续进程，不是每次命令重建世界。

## 独立验收及修复追踪

独立 Terra/high 定点验收，修复由实现 owner 完成后再复验；工作中间态不重复算新缺陷。

| 问题                                               | 已采取措施 / 当前状态                                                              |
| -------------------------------------------------- | ---------------------------------------------------------------------------------- |
| JSONL malformed args 在捕获外抛出并退出            | dispatch/CLI 捕获为结构化失败，真实连续请求已通过                                  |
| typed arrays 被 JSON.stringify 变数字键对象        | Node transport 使用显式 little-endian/base64，真实 roundtrip 已通过                |
| readline 无界累积、pending 计数不可达              | 增量 framing、96 MiB 总行边界、一般 RPC 1 MiB、单请求与 stdout 背压，定点测试通过  |
| 多目标动作只授权 self                              | 修复中，需对实际目标逐项授权并覆盖旧入口                                           |
| 指定 self entityId + foreign actionId 读取他人动作 | 修复中，必须从实际 owner 派生目标                                                  |
| Browser restore 仍用旧 Logic epoch                 | 修复中，新 epoch 必须进入 runtime、Logic 和镜像                                    |
| 暂停显式推进把 wall clock 推到未来                 | 真实 Browser E2E 触发 monotonic fatal，修复独立 active-time 推进，不能放宽时钟校验 |
| barrier 持有串行队列、用 sleep 等待或全局排空      | 修复中，要求有限工作 frontier、无持锁等待与超时/epoch 失效                         |
| export 被误认 checkpoint persistence ACK           | 修复中，要求真实 adapter ACK并区分内存/IndexedDB                                   |
| restore 遗留目标世界多余持久 Chunk                 | 修复中，完整集合原子替换，而非覆盖源中已有 key                                     |
| restore 后客户端生成 seed、派生网格或玩家绑定陈旧  | 修复中，追加不同 seed 恢复、首次新 Chunk、派生镜像与真实输入验证                   |
| runtime epoch 与 transport epoch 混用              | 修复中，恢复后新输入应可用，旧输入/普通请求不能被重标成新世代                      |
| 存储计数初始0误报测量                              | 新 nullable measurement 等待 Browser 接入                                          |

“Persistence Worker 不存在”的初始评审意见已撤回：BrowserChunkPersistence 内确实创建嵌套 Worker。DeepSeek SDK 限制已补固定提交文档/字节 hash 与实际 npm 标签，属于源码证据，未声称 SDK 运行验证。

fluid barrier 的“两个 lease 乱序完成”假设经源码核对撤回：`requestFluidWork()` 在已有 lease 时拒绝再发，因此当前 issued/settled 计数具有连续水位语义；不能为了不可达反例增加第二套状态机。该前提随未来并发 lease 合同改变时必须重新设计。

## 准出待办

- 同 fixture 的 Headless ↔ Browser 实际世界/Action/Chunk 与 checkpoint 往返。
- 无服务时 Headless run/pause 与 EOF 清理、连续 REPL 多轮脚本。
- 修复后根 `pnpm verify:static`、独立 `pnpm build`、原浏览器/近战和新增 Harness 验收。
- 独立最终复验、清晰语义提交、PR/CI 交接。

## 长期基线与范围

更新产品/长期路线、代码地图、README 与世界 Harness 使用文档。旧 Agent 设计添加后续修订入口，撤回 OpenAI SDK 优先推荐、core agentState 专属块和按控制者类型授权；以通用 principal/resource/scope 与 LangGraph + DeepSeek wire 接缝继续。世界 LOD、离线追赶、World AI 和真实模型 NPC 仍未实现。

预算见 estimates.md；期间账户共享周使用量71%→74%，额外余额未变511.183598，不能把账户差值当任务账单。任务级实际 tokens/credits/API费用无可归因账单，记录unknown；未购买或兑换额度。父合同复制遗漏不改变本轮实际 H1/H2 授权范围。
