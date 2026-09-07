# Node Dedicated Server 当前状态与阶段证据

## 恢复入口：2026-09-07 完整基线采集检查点

整个 change 仍 **Active**。本页随当前功能分支源码提交；上一已推送检查点为 `c4e2f16`。本批完整静态 **189 文件/1030 项通过**（另 2 文件/4 项跳过），world 行覆盖 96.37%；浏览器与 Node 五入口构建通过。以下较早计数及“尚未 push”等表述仅属于各自历史阶段。

| 门禁                 | 当前事实与仍需完成                                                                                                                                                                                                                      | 详细证据                                                                                                                |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| N0 公共语义          | 已有输入/动作/correction/Gameplay/Welcome/WorldCommit 参考；新增兴趣控制纯 DTO，以及真实 Node Authority 内完整 27 块/单块采集、共享生成预算、取消/stop 和 owned transfer。公开 interest 会话、分页/安装门与大提交分帧/resync 仍未完成。 | [本批采集](network-baseline-capture-progress.md)、[兴趣计划](network-interest-baseline-plan.md)                         |
| N1 能力              | 普通 WS loopback 的单连接及双连接回显在 Chrome/Firefox/Playwright WebKit 通过；现代 Go WebTransport 在 Chrome/Firefox 的可靠流/datagram 通过，WebKit 数据路径失败。WSS 可信证书、真实 x64/移动端/IPv6/WAN 未采集。                      | [WS 探针](network-websocket-loopback-progress.md)、[WebTransport 矩阵](network-webtransport-browser-matrix-progress.md) |
| N2 编解码            | 此前已采集的参考包通过三候选强等价与 Node/Chrome 双向；本批内部 capture 不冒充公开 codec/page 证据。正式阶段成本、分配/GC、代表性负载未采样；C0 大 metadata 和超过 512 项 commit 的表示限制保留。                                       | [密度](network-density-codec-progress.md)、[呈现编解码](network-presentation-codec-evidence.json)                       |
| N3/N4 网络选择与采用 | 正式对照未完成，wire 和最终传输未采用；功能探针不能默认选择 JSON/WSS 或 QUIC。                                                                                                                                                          | [冻结选型合同](network-selection.md)                                                                                    |
| 产品与性能           | 常驻 Node 权威、持久化 lane 和线程/进程执行器已运行；远端可玩客户端/双模式 GUI、目标远端/CI、迁移加 feature 收益与计算上移不退化 A/B 仍待完成。                                                                                         | [剩余合同](#合同剩余状态)、[滚动估算](stage-estimate.md)                                                                |

## 本批统一验证

- `pnpm verify:static` 一次完整通过：Prettier、ESLint、路径规范、V8 coverage、Svelte 和生产/测试 TypeScript。新增共享生成/取消/预算、异步请求副本、真实 Worker 错误回复和 RPC 派发顺序回归均在本批内。
- `pnpm build` 通过，保留已有 500 kB bundle 提示；随后官方 Node 22 执行 `scripts/build-node-server.mjs` 生成 5 个 ESM 入口。产物记录 `sourceSha=c4e2f16`、`sourceDirty=true`，source inputs SHA-256 为 `1c02da36f90682d94be3e63c5aaae71ce07d5e14503ce4f4c73c893a97e811ab`；不冒称构建了未来的提交 SHA。
- 共享 Host 核心和 Node 接线均经独立 Terra 审阅；没有发现新增 P1/P2 阻断。真实控制端口在 capture 执行中断开的组合故障注入仍未单独采集，普通 stop 和机制测试不能替代。
- 本批没有执行正式 benchmark，没有远端写入、部署或网络采用。常规浏览器回归使用独立端口 4197、CI 模式禁止复用其他工作树的开发服务，Chromium 8/8 通过；它不代表远端 GUI 或 WAN 已验收。

## 上一批验证：呈现字段与来源锚点

- `pnpm verify:static` 最终通过：Prettier、ESLint、路径规范、V8 coverage、Svelte 和两份 TypeScript 检查。先前一次运行的 983 项单元通过，但类型检查失败；修复可空闭包、字面量推断和测试故意构造非法值的类型后，再完整执行至上述 984 项通过。
- `pnpm build` 通过；现有 500 kB bundle 提示保留。完整类型检查后使用官方 Node 22 执行 `scripts/build-node-server.mjs`，生成 5 个 ESM 入口；产物记录基线 `6de696b` 与未提交源码状态，不伪称已在未来提交 SHA 构建。
- 最终 WorldCommit corpus 为 `/tmp/seedlands-network-world-commit-presentation-corpus-v2-r5`，官方 Node 22.23.2 直接执行独立 config，1/1 通过；实际 Authority C 为 2→3→4→5。早期直接 server 调用导致 C 不推进的记录、Node 26 的 r3、类型修正前的 r4 均保留历史，未进入最终 codec 输入。
- Welcome 最终 corpus 为 `/tmp/seedlands-network-bootstrap-welcome-corpus-v2-source-bound`，Node 22 1/1 通过；新建、同 epoch 当前状态和持久化恢复的 body/worldTime/checkpoint 绑定同一 snapshot。首次 attach/reconnect 和相机表现继续为未采集。
- 两组 presentation corpus 的当前显式 source hash、manifest、逐条内容、输入/输出绑定和三候选严格深相等均通过；真实 Chrome 152 与 Node 22 的两个方向分别通过。C2 的矛盾 presence 帧修复前取得真实 RED，修复后 5 类帧均在 consumer 前拒绝；旧 59 条参考回归仍通过。
- 本批没有新增 UI 或网络入口，未把上述结果当作 Playwright 产品旅程、Midscene 视觉语义、WAN 或性能 A/B；没有运行正式 benchmark。

以下保留各阶段原始证据。恢复先读上表及当前切片，只有追溯失败或环境时才展开历史。

---

# 无网络宿主阶段验证快照

2026-09-07，本阶段已形成可运行的 TS Node 世界宿主；整个 Node Dedicated Server change 仍 **Active**，不标为 Delivered。批准的 spec 与附件 hash 保持冻结，实施状态以本页、[实施记录](execution.md)和源码为准。

## 本次统一验证

验证环境为 macOS arm64 Node 22.23.2；所有 subagent 实现冻结后，由 root 执行完整组合检查。未运行正式 benchmark。Wasm 任务已明确交还资源；其代码未自动合入。

| 证据                       | 实际结果                                                                                                                 | 边界                                                                          |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| `pnpm verify:static`       | 通过；174测试文件通过/2跳过，910项通过/4跳过；world 行覆盖96.37%；Prettier、ESLint、路径、Svelte与两份TypeScript检查通过 | coverage只覆盖规定的world范围，不代表所有Node代码覆盖率                       |
| `pnpm build`               | 通过                                                                                                                     | Vite提示现有大bundle警告；不证明FPS或远端可玩                                 |
| `pnpm build:server`        | 通过；5个独立Node22 ESM入口                                                                                              | 产物无需源码/Vite/运行依赖安装                                                |
| `pnpm test:e2e:regression` | headless Chromium 8/8通过                                                                                                | 当前本地浏览器长期基线；不是远端GUI旅程                                       |
| 显式 change corpus runner  | 1/1通过                                                                                                                  | 真实Host生成/编辑/动作与公开参考投影；不是codec计时或N2准出                   |
| Node实际进程               | artifact、启动中SIGTERM、SIGKILL恢复均在完整Vitest中通过                                                                 | 单独区分顺序关停、最后durable恢复和线程/子进程清理；不宣称设备断电            |
| Linux离线产物              | Node22.23.2/linux arm64、无网络、非root、只读根FS；thread/process各两轮启动/关停/恢复及5文件hash核验通过                 | [完整记录](linux-offline-final-evidence.json)；目标CT105 x64与LAN/WAN尚未验证 |

change corpus 显式命令为 `pnpm exec vitest run --config changes/2026-09-06-node-dedicated-server/e2e/vitest.real-corpus.config.ts`。原本错误的畸形publication mock与未处理Promise导致的一次完整检查失败已保留在实施记录，不混入本次通过计数；修正后重新从格式检查开始完整执行。

当前离线产物的 source inputs SHA-256 为 `caba7a665a46b5fdc85a781543cbbf5ffec96aa6d7923a3123a0fd2d18cb3f70`。清单标记当时 `sourceSha=485de57`、`sourceDirty=true`，并提供每个产物hash，因此不会把工作树产物伪称已提交构建。随后的本地语义提交用于保存本阶段源码/证据，不改变这份历史构建元数据。

## 合同剩余状态

| Acceptance                 | 状态                                                                                    |
| -------------------------- | --------------------------------------------------------------------------------------- |
| A1 Node常驻                | 本地无网络核心已实现并验证；受控浏览器连接旅程未完成，整项部分完成                      |
| A2 网络权限/顺序/背压/镜像 | 仅参考消息与内部RPC，公开网络尚未实施                                                   |
| A3 冻结持久化与硬kill      | FileStore/真实进程恢复已有证据；Playwright-change未完成，设备断电按原合同不承诺         |
| A4 双模式GUI               | 未实施                                                                                  |
| A5 Node分项feature实验     | 线程/子进程执行器有功能证据，收益实验未完成                                             |
| A6 完整归因                | 未完成，历史争用或方法不合格计时已排除                                                  |
| A7 本地旅程与架构          | 本阶段静态/构建/8项基线通过；后续产品改造继续保护                                       |
| A8 macOS/Linux与LAN可玩    | 两平台离线宿主通过；LAN客户端可玩未完成                                                 |
| A9 可恢复交付              | README、代码地图、目录边界和阶段证据已同步；整个change未交付                            |
| A10 CI推送CT105            | 未实施、未远端写入                                                                      |
| A11 WAN预测/重连/MC共存    | 未实施                                                                                  |
| A12 消息与选型             | N0参考投影推进，N1部分探索；N2–N4未准出，wire尚未冻结                                   |
| A13 计算上移不退化         | 服务端职责与有界执行链已接线；完整观测、受控A/B及WAN SLO未完成                          |
| A14 双口径预算             | 工作区规则、初版与[滚动估算](stage-estimate.md)已落地；实际task工时/credits未知，未伪造 |

后续依赖仍为：真实代表性corpus与N2/N3选型 → 有证据的N4采用 → 受限网络和完整客户端镜像/预测 → 双模式GUI → 真实远端/CI → 宿主与feature分项及组合A/B。T0/C0受控最小可玩探针可提前用于选型，不等正式GUI，也不代表正式wire已采纳。任务恢复从本页进入，避免把冻结spec的“设计时尚未实现”或早期失败记录当成最新状态。

本阶段没有push、PR发布、远端部署、Wasm合并、goal创建或reset兑换。长期docs baseline只更新已实际验证的Node所有权与入口；未把网络/GUI/性能建议写成现有能力。

# 网络准备批次的补充检查点

本节补充于 2026-09-07，整个 change 仍 Active。已通过的无网络宿主基线为 `ed9aec5`，用户恢复额度后授权推送，现已保存到 `origin/codex/node-dedicated-server`；本节随新的网络准备检查点交付，相关提交 SHA 以该功能分支的 Git 历史为准。

## 变更与独立复审

Authority lane 增加 readonly collision baseline RPC，使用现有权威读取，不自动请求未知 Chunk；固定数据长度与控制通道预算继续生效。回复除既有消息 identity 外还绑定请求 key/最低 revision，错误回复进入失败及有序清理。客户端预测/排序门禁的参数改为实际使用的字段集，完整 Worker 快照仍兼容。

change 专用接收路径复用现有 collision mirror、统一物理与预测，实现完整 LE baseline 的双块 hash/副本/版本门，并覆盖丢失提交、迟到旧基线、旧 epoch 和重同步。实际 C0/C1/C2 解码的九条真实语料与原始语料得到同样的镜像/预测状态；gameplay/action 仅验证 DTO 等价，没有宣称 UI 或完整重连回执状态机通过。Sol/high 与 Terra/high 的独立评审/修复记录见各附属文档。

## 当前可复核证据

环境为 macOS arm64、官方校验的 Node 22.23.2；以下均为功能/静态证据，运行耗时不用于性能收益。

- `pnpm verify:static`：重跑通过，175 文件通过/2 跳过、916 项通过/4 跳过；world 行覆盖 96.37%。首次完整运行暴露只读测试将后台 active-window 生成误归因于 RPC；已改为指定 key 的读取/显式生成对照，没有放宽阈值或全套改为串行，默认配置复验通过。
- `pnpm build`、`pnpm build:server`：通过，浏览器保留既有大 bundle 提示。当前生产源码在这两次构建后未改动；后续只调整测试与文档。
- Node 实际五入口 artifact 与 baseline RPC/protocol 聚焦：3 文件 12 项通过。产物测试实际运行 thread/process 两模式并关停、重启恢复，不以 mock 代替。
- 客户端预测/门禁/镜像：3 文件 19 项通过；reference receiver：5/5；真实 corpus recorder：1/1；三 codec 应用 oracle：1/1。独立配置和显式 fixture 环境变量见 [应用证据](network-codec-application-evidence.md)。
- 当前批次没有新跑 Linux、Playwright、Midscene、WAN、压力或正式性能组。上一检查点的证据保留为其历史结果，不声称验证了新增 RPC 的目标 Linux x64 部署。

## 尚未放行的网络选型

九条通过只覆盖当前受控 subset，不能宣布完整 N2。C1/C2 仍有非空 gameplay/其他动作域缺口；独立复审要求统一 parser/语义校验/资源预检/输出所有权/hash 阶段，避免比较时额外复制或少校验带来偏差。T0/T1 已通过小型 loopback 功能探针，T2/T3 仍有能力与依赖门。所有候选继续 `not-adopted`，没有公开 listener/GUI 或远端部署。

---
