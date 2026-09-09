# H1/H2 实施与验收记录

状态：本地实施与验收完成，交付功能分支 PR 供人类审核；不自动合并。基点 `3c93101861925b0faa89b143993059f36b5fafe3`，分支 `codex/developer-world-harness`，生产源码冻结于 `23a0445a40d95c7b1083470ce60a487931454372`。前置 PR #24 尚未合并，因此本 PR 以 `codex/living-world-browser-baseline` 为 base；后续文档和截图提交不改变上述源码。

## 交付结果

Headless 与 Browser 共用 `WorldHarnessPort`：世界身份、inspect、prepare、命令/回执、pause/run/advance、Logic、Action、barrier、trace、checkpoint。持续 Node REPL 支持多行 JS 与 top-level await；JSONL 是版本化白名单 RPC，单请求背压、增量限长和 U16LE/U8 base64 checkpoint 编码。Browser 通过已有 Authority Worker 执行，保留唯一世界写者。

所有入口按宿主绑定的 principal、资源、操作、目标/作用域判定，默认拒绝；角色标签不产生权限。多目标动作逐项授权，Action 读取使用实际 owner。当前可任意指定范围的 observation/POI/path 仍是 world scope 开发查询；A1 才交付受 Actor 感知约束的局部投影，不能把开发 inspect 暴露给模型。

F3 提供六类可折叠诊断：概览、世界/模拟、任务/Worker、渲染/资源、Wasm/特性、内存；展示真实调度/核执行样本，标明配置、估算、测量和 unavailable。打开释放 Pointer Lock 与已按住输入而不暂停世界；800×600 可滚动且保留碰撞控制。[原始截图](evidence/README.md)已人工查看。没有 CPU、OS 线程、GPU 或全部 Worker JS 内存测量时不编造数值；不宣称性能提升。

## 世界合同的具体边界

- `inspect` 不生成地形，显式 `prepare` 才准备；Browser 在 core 验证和生成后，等待真正的 collision canonical baseline，不依赖 mesh 恰好携带 canonical。
- `advance` 只在 paused 接受，单次最多 60 秒；Physics → Gameplay → Fluid → Logic 的现有 lane 顺序一致。`ready()` 不再改变时间，Logic 过期判定读取 session 当前 tick。
- barrier 捕获有限 frontier，经完成事件唤醒，不占用命令队列。Fluid 水位依赖当前最多一个在途 lease；以后允许并发 lease 时须重设连续完成水位。
- checkpoint export 是冻结完整 snapshot、保存到宿主 adapter、等待 ACK；Headless adapter 为内存，Browser 为 IndexedDB，不能把两者都称磁盘持久化。
- restore 先在内存构建/验证候选，原子替换完整持久集合，然后同步切换 delegate、owner、epoch 和呈现消费者。旧请求/输入/Logic/Compute 不重标为新世界。成功路径已真实验证；第二阶段 IndexedDB I/O 失败的原子性经过源码审查，尚未单独故障注入。
- snapshot 未保存旧 runtime physicsTick，恢复创建新 epoch，activation 会增加提交；跨宿主精确 tick/frontier 对比必须让双方先恢复同一 snapshot 再推进，不比较不同生命周期。

## 最终证据

所有命令均未启用测试重试。日志位于本机 `/tmp/seedlands-h1h2-ui/`，CI 对当前 PR 另行运行门禁并保留 Browser artifact；以下结果不冒充尚未完成的远端 CI。

| 源码               | 验证与实际结果                                                                                                                                                                 | 日志                    |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------- |
| `23a0445`          | `CI=true pnpm verify:static` 退出 0；236 测试文件、1167 测试通过，2 文件/4 测试跳过；SSG、格式、ESLint、路径、coverage、全部 typecheck 通过；Svelte 0 error/0 warning          | `static-delivery.log`   |
| `23a0445`          | 独立 `CI=true pnpm build` 退出 0；3.64 秒；保留既有大 bundle warning                                                                                                           | `build-delivery.log`    |
| `96322c8`          | `CI=true pnpm test:developer-harness --retries=0` 2/2 通过，11.9 秒；跨 seed、未知 Chunk、双向 checkpoint、世界/Actor/Action/lane/frontier、恢复后真实 Pointer Lock/KeyW 与 F3 | `harness-delivery.log`  |
| `23a0445`          | 只补 checkbox selector 后，同命令加 `--grep 'F3 分类'` 1/1 通过，5.0 秒，最终三张原始截图                                                                                      | `ui-delivery-final.log` |
| `96322c8`          | `CI=true pnpm test:pr15:integration --retries=0` 资产集成 2/2 通过，6.4 秒                                                                                                     | `assets-final.log`      |
| `f127d6e` 生产源码 | 既有独立近战门禁，FULL_CHROMIUM=1 / SWIFTSHADER=1 / quality=low，`test:pr17:integration --retries=0` 1/1 通过，12.1 秒                                                         | `melee-final.log`       |

近战之后的 `96322c8` 仅修改诊断布局与旧测试身份 fixture，`23a0445` 仅调整该 CSS selector；不能据此声称这些 SHA 又运行了完整近战门禁。

CLI 的真实子进程 9/9 通过，覆盖非法参数后继续、checkpoint 往返/损坏后继续、EOF 清理。真实 TTY 在同一进程执行多行对象、top-level await、改块/查询 voxel 4、run 到 physicsTick 400、pause、导出 799383 bytes checkpoint、`.exit` 返回 0；该观察不是每条命令重建 world 的 fixture。最终根 suite 也覆盖 CLI/JSONL 回归。

## 失败、修复与保留的不确定性

| 失败证据                                                                | 确认原因与修复                                                                                                                                                                            |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `12f379d` Browser 2 失败；`browser-final.log`                           | 跨 seed 派生 canonical 未就绪；旧 world edit 的审计标签被当 actor identity。所有 edit/batch/legacy 入口现绑定实际 Authority player，保持严格鉴权。                                        |
| `e37b32b` Browser 仍 6→0；`browser-repaired.log`                        | mesh payload 可合法不附 canonical；定点 mock 强行附带 canonical 不足以证明真实产品协议。`ed9e3ae` 改为等待正式 collision baseline。                                                       |
| `ed9e3ae` monotonic 失败；`browser-baseline-fixed.log`、`ready-red.log` | 恢复后队列已推进，ready 又以旧 start time wake。`6a7e270` 改为只读当前 snapshot。                                                                                                         |
| paused Logic 过期判定 RED；`paused-logic-red.log`                       | 重复 latestPhysicsTick 未随显式 advance 更新；改读 session 当前 tick。修复后相关 19 测试通过。                                                                                            |
| prepare 返回 WORLD_EXECUTION_FAILED；`prepare-queue-red.log`            | prepare 持有串行队列等待未知 chunk，其 canonical completion 又在队列后等待，形成死锁。`2cec030` 仅让 canonical 完成消息经过同一 Worker/epoch guard 直接提交并唤醒等待，普通命令继续串行。 |
| `2cec030` parity 的 tick/commit 不等；`browser-queue-fixed.log`         | 原 fixture 比较未恢复 Browser 和已恢复 Headless；`f127d6e` 改为两端同 snapshot restore 生命周期，保留精确断言和真实输入。之后完整 Browser 2/2 通过。                                      |
| 首次 static 1157 pass / 4 fail；`static-final.log`                      | 旧查询 fixture 未配置资源策略、Fluid 完整对象断言未包含新增水位、两个 coverage 恢复测试 5 秒超时。修复 fixture/字段并将恢复测试超时设为 30 秒；不更改产品或性能阈值。                     |
| 第二次 static 1166 pass / 1 fail；`static-repaired.log`                 | 旧 World 测试 mock 缺少新绑定的 gameplay.player。`96322c8` 补真实身份 fixture，并断言 edit/batch/legacy 都使用绑定身份。最终根 suite 1167 pass。                                          |

原完整浏览器回归曾 **19/20 通过、1 失败**（`regression-final.log`）：旧近战 combo 的第二段已出现，但 5 秒内未看到 7 点伤害文案。保留该失败，不把后续孤立通过算作全套 20/20。

对该失败进行了有界定位：旧 combo 在既有软件渲染配置下通过（10.4 秒，`combo-software-control.log`）；隔离 base `3c93101` 使用原 Chrome 配置通过（6.7 秒，`combo-base-control.log`），当前生产源码同配置也通过（5.3 秒，`combo-head-control.log`）。未改变 combat 生产逻辑、旧测试断言或时限，独立源码审查未发现本次变更的因果证据。此处不是性能 A/B，也不声称已解决旧 combo 的偶发时序问题；若 CI 再现，应采集双方位置/LOS、Authority combat lastResult、tick/commit 与 UI 后判因。

验证期间受限子进程 pnpm 误判依赖并中断重建，Root 以 `pnpm install --frozen-lockfile` 恢复（4.9 秒，退出 0，锁文件不变）。后续包管理器由 Root 统一执行；临时 base 对照 worktree 已清理。

## 独立审阅与下一阶段

[独立审阅](independent-review.md)冻结 base/head，并记录逐路径覆盖；120 路径为部分审阅，高风险 owner/恢复/权限/协议与最终增量深读，无剩余可证实 P0/P1/P2。审阅者不批准或合并，也不把 Root 测试当作自己执行。审阅写成时最终 static/build 尚未返回，本记录补充其退出 0 的事实。

[Agent 详细设计](agent-harness-design.md)固定 observe→decide→authorize→execute→receipt→context 回路、事件驱动频率/预算、工具与 schema、32K/48K 上下文轮换线和 A1–A3 路线。[框架决策](framework-decision.md)重新比较 DeepSeek Harness、LangChain/LangGraph 与 OpenAI Agents SDK，推荐 LangGraph JS 显式图加薄 DeepSeek V4 wire adapter，撤回未经验证的 OpenAI 默认优先推荐。

固定版本 mock 实验确认 ChatDeepSeek 1.1.11 和 OpenAI Agents 0.17.2 的默认链路丢失第二轮工具调用所需 reasoning replay；LangGraph 1.4.14 暂停/恢复没有重复提交。DeepSeek Harness 固定源码提交与 SDK 生命周期限制为静态证据。全部实验零真实模型调用，不代表模型质量、延迟或费用验收；生产未加入模型 SDK。

更新了长期路线、产品定位、代码地图、README 和 [Harness 使用文档](../../docs/developer-world-harness.md)，旧设计增加 supersession 入口。下一阶段 A1 通用 Actor/Action/反射/受限感知/持久化，A2 模型适配与 Bridge，A3 性格目标与可玩后果。**本 PR 没有模型驱动 NPC、LOD、离线追赶或 World AI。** 实际预算与额度边界见 [estimates.md](estimates.md)。

## 前序合并后的低负载 parity 复验

`b7d7169` 的 CI run `34322183659` 中，parity 三次超时；源码树与此前通过的 `5d49ce8` 相同。独立分诊从 artifact 观察到 3–4 FPS、271–291ms p95 和 WebGL stall，未找到可归因该提交的生产改动。此观察只支持资源压力假设，不证明特定 Worker 队列的因果。

将这一功能合同用例在首次导航前设为既有 Low 质量，并断言实际 snapshot quality；不改 world/clock、旧断言、timeout 或 Worker 拓扑。2026-09-09 在隔离 checkout 执行 `SEEDLANDS_E2E_PORT=4175 pnpm exec playwright test changes/2026-09-09-developer-world-harness/e2e/browser-world-parity.spec.ts --retries=0 --trace=on`，1/1 通过（15.5秒）。日志保留 `/tmp/seedlands-living-npc/harness-low-fixture.log`，该次不是性能实验，也不代表软件渲染 CI 的终态；以新提交远端 CI 为准。长期 docs baseline 未变，本次只固定不验证画质的测试夹具。

低画质后的 CI `34324832874` 仍失败；逐操作 trace 将原因收敛为**整个测试30秒预算耗尽**：Browser parity evaluate 在7.872–14.741秒成功，随后Headless往返和断言耗去至少16.252秒，`beforeMovement` 到30.993秒才开始。失败上下文显示世界已运行、tick推进，不能把末尾报告位置当作clock死锁。

因此仅该重集成case获得90秒总预算，并新增测试侧clock:run 5秒deadline；通过可选参数将该case的boundingBox/click限制为5秒，原15秒KeyW位移断言不变，其他调用lockPointer的用例默认行为不变。相同本地命令无重试通过1/1（14.1秒），日志 `/tmp/seedlands-living-npc/harness-deadline-fixture.log`。新增局部界限防止总预算调整掩盖挂起；远端结果继续按新SHA验收。
