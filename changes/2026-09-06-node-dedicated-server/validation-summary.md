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
