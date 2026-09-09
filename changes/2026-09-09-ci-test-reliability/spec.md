# CI 测试效率与可靠性

## Intent / Scope

用户目标：缩短每个 PR 的反馈时间，明确 GitHub hosted CI 的可验证边界，并让绿色状态基础保障核心功能。技术假设：瓶颈可能是测试框架的大缓冲比较、串行编排和真实时间驱动的长浏览器旅程；WS 本身并不必然需要外部环境。

Agile：仅修改测试、CI 编排和文档；不改变产品协议、权威、世界生成、渲染或权限。当前基线 `01bab28ace506685f39c1d4a86fec541cbbf2f1b`。未合并 PR #26 的 agent-server 只做只读覆盖评估，不将另一功能分支隐式并入本 change。工作量预计 2–3 PD / Agent 3–6 小时，非大规模 change，精确 credits 和费用 unknown，不创建 Goal。

## Evidence / RED

[主干 run 34332487076](https://github.com/seedlands-game/seedlands-web-sandbox/actions/runs/34332487076)：Static verification 659 秒，其中 Vitest 557.47 秒（236 文件通过、2 文件跳过，1167 测试通过、4 性能测试跳过）。Chromium job 496 秒，20 条 regression 中一条 flaky，重试两次仍将整轮记为 success；后续三个命令覆盖 5 条集成测试。性能 skip 不等于已通过。

最慢测试：wasm-mesh-equivalence 65.993 秒、world-harness-session 63.202 秒、wasm-fluid-logic-equivalence 63.184 秒、data-plane-rust 62.131 秒、headless-session 51.405 秒。浏览器失败定位到木剑旅程固定按 W 500 ms 后未拾取石块，另一次超时在成功截图。

## Behaviour / Test Design

- Given 全量逻辑测试，When 优化比较器，Then 保留全部 corpus、所有字段、每个有效元素及输入未变断言；类型/长度/任意位置差异必须失败，不能用抽样/hash 替代精确比较。
- Given PR 含可执行文件，Then 保留格式、路径、Lint、类型、全量逻辑/覆盖率、生产构建和既有浏览器核心旅程；文档白名单仍使用 base classifier，失效时 fail closed。
- Given 多轮浏览器命令，Then 每轮失败证据在下一轮覆盖前上传；不能用最后一次 report 代表全部。
- Given hosted CI，Then 真实 Chromium/Worker/本机 Node/loopback WS 属于可跑范围；真实模型服务、实体 GPU 性能、跨公网部署、视觉/音频体验属于补充验收，不能由 CI green 推导。
- TDD 以可执行 RED→GREEN 和生产路径断言为依据；覆盖率只衡量已声明目录，不证明整个系统健壮。

## Optimization Experiment

候选 A：Vitest 对大型数值缓冲逐元素 matcher；B：Node 原生 strict deep equality，仍比较完整值与结构。唯一轴为断言实现，禁止缩小样本、增加 worker、关闭隔离或覆盖率。主指标为五个 Wasm/数据面文件在 `--coverage --maxWorkers=1` 下完整执行墙钟；最低收益 15%，且超过 A/A 相对差异两倍。顺序 A/A/B/A/B；同一源码、依赖、Node、corpus、coverage 配置，通过机器性能窗口串行采样；保留失败，任一正确性不一致否决，最多一轮矩阵。B 未通过则还原候选。完整 `verify:static` 和 build 为组合正确性门禁；GitHub 总时长只能经新 SHA live run 读回，历史与本机不同环境不作为严格 CI A/B。

CI 仅拆日志步骤，不增加 runner 或省略任务；类型检查提前，完整覆盖率仍单 worker。浏览器重试一次用于取证，`failOnFlakyTests` 拒绝重试掩盖失败。

木剑旅程的两个固定时长移动改为真实键盘按住、读取 Authority 库存和掉落物位置、朝向目标、库存相对采集/战斗前增加后释放按键（100ms 轮询，先确认 Pointer Lock）；finally 保证失败时也释放。目标相对当前玩家位于攻击距离内，消除固定走路时长对战斗 fixture 的隐含依赖。保留采集、合成、真实攻击、拾取和存档重进断言。该旅程成功截图只保留给非 CI 的视觉验收，普通 CI 不在输入/动作窗口插入同步截图；失败 trace 仍由 Playwright 收集。

局部计时矩阵保持原 coverage 配置，因此每轮都预期在 11/11 用例通过后因只选五文件而未达到全局80%门槛，不能将 exit 1 记作验收通过。计时比较要求每轮相同的行覆盖率和测试结果，最终全量 coverage 必须独立通过。

## Acceptance / Tasks

- [x] 读取 CI、日志、测试和当前契约。
- [x] 大缓冲断言语义反例与 A/A、A/B 证据，见 performance.md。
- [x] 分步骤报告静态门禁、报告保全与浏览器稳定性改进。
- [x] CI 边界/核心保护矩阵/agent-server 缺口记录。
- [x] 静态、构建、受影响浏览器与独立评审（详见 delivery.md）。
- [ ] 最新 PR CI（发布后绑定 SHA 读取；结果写入 PR 交接描述）。

## Delivery Snapshot

本地准出完成，远端 CI 待发布后读回。长期 docs baseline 已更新 CI 测试边界与维护规则并链接开发治理；生产架构不变。详见 delivery.md；远端准出以 PR 绑定 SHA 的检查结果为准。
