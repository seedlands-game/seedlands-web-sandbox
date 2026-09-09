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

## 用户追加：合并光影修复与主链路保障复核

用户明确要求将隔壁 `25b6119`（PR #28）合入本 PR，并排除 Agent Server 讨论。以 `cherry-pick -x` 保留来源；原光影 spec 和 RED/分层证据一起带入，不改写旧证据。新增阴影 Playwright 文件显式进入现有 regression 命令和测试 TypeScript include，复用同一浏览器 job，不再启动一整轮独立 Playwright；允许高画质场景90秒总上限，不作为性能阈值。

组合验收：更新前的测试发现清单未包含 dynamic-local-shadow 用例为 RED；更新后 `--list` 必须发现它，定向逻辑、真实浏览器和构建复验，并在最终 SHA 运行全部必需 CI。成功后更新 PR #27 的标题/说明，并关闭已被替代的 #28（不合并任一 PR）。

这次只实施修复集成与遗漏测试接线；下一轮提速候选根据当前精确 SHA 的实测耗时排序，不无对照地提高并发、删用例或降低覆盖率。主链路保证边界与尚未覆盖的生产构建启动验证单列记录。

独立复核确认光影 E2E 在截图前记录计数会被删除前的旋转帧污染。修正设计：在同一次 page.evaluate 中 await 删除命令（正式 owner 已消费实体视图）后读取计数，后续实体消失且计数必须高于此新基线；再加入签名从非空到空的直接反例。用临时禁用“caster 签名变为空时失效”的生产突变获得 RED，恢复生产实现取得 GREEN，避免以测试成功次数代替根因检出能力。

### Hosted runner 首轮组合失败与修正设计

`5ca96b6` / run34337900087 的 static 和 build通过，Chromium 报一条新 shadow失败与一条既有 edge-support flaky。新 shadow 的15秒前置要求全世界 generation/meshing queue清空；实际局部灯与阴影已稳定43帧，但High视距后台仍有90个待生成chunk。该用例测局部失效，不测全世界生成完成；改为等待实际有阴影的局部灯启用、已有可见chunk和局部shadow稳定，保留High画质与后续所有caster/worldRevision断言。无关后台queue不作为就绪前置。edge-support的第二次位移采样可能已落到底层地形，需要按真实落地/空中状态设计断言，不能靠重试接受flaky。

edge-support修正：保留y56支撑，在下方显式构造y48底板和y49..55空气柱；以权威高度/physicsTick/输入ack确认真实Space窗口，检查既有authority trajectory在此窗口无上升，最后允许落地并验证已知高度50.6与不穿模。保留真实键盘路径，不增加重试。禁用stepBody的grounded跳跃条件应使该浏览器用例RED；原实现及软件GPU重复GREEN后再交接。

首版ack/tick+2仍未检出跳跃突变，保留此失败；最终Space先保持跨2个rAF发布帧，再要求15个权威tick与ack进展，才比较空中轨迹。该版本的相同突变已RED，原生产源已恢复。

### 后续规范提交暴露的落地边界

`1fa0ac5` / run34342032083 的浏览器回归在edge用例失败：轨迹从50.600001上升至50.703334，说明Space保持到首次落地后触发合法再次起跳。原断言把落地后的运动也算成空中阶段，不能通过增加重试解决。修正：显式底板下移到y16，增加操作空间；Space窗口允许已经合法落地，单调下降断言只覆盖首次接触已知底板之前的轨迹；最终仍要求18.6落地稳定且全程不穿底板。用故意延迟观察3秒验证合法落地/再次起跳不会误报，同时保留允许空中跳跃的突变RED。该改动仅修正既有CI测试合同，不改生产物理。

首次仅截断首次落地、仍在15tick后松开Space的方案未捕获空中跳跃突变，已否决并保留失败结果。最终保持Space直到权威轨迹首次触及已知底板，检查完整首次下降；先断言轨迹仍包含falling起始tick，防止环形缓存裁掉受测窗口后假通过。Space窗口的ack/tick只是前置条件，不能独立当作输入已生效证据。故障实现可因无法继续下落/触底或首次下降出现上升而RED；正常实现允许首次落地后的合法再次起跳，最终松键后仍须在18.6稳定。生产物理在每次突变验证后恢复。

正常版本进一步暴露快照采样边界：authority trajectory不是每个physics tick的完整事件流，可跳过18.6精确接触而先记录18.703→18.801的合法起跳。精确首次触地截断因此也被否决。最终测试将空中窗口终点显式设为已知底板上方两格（20.6）；保持Space直到权威轨迹首次越过该边界，检查从falling起点到此处的长距离空中下降，随后独立检查松键、18.6最终落地、无碰撞与稳定。这个位置是该夹具的预落地边界，不是通用容差，也不声称快照覆盖每一物理tick或最后两格内的所有输入行为。

释放Space同样经异步输入链路，首个落地快照后的15tick可能包含释放生效前的合法再次起跳。最终稳定验收改为等待权威轨迹连续至少15tick处于已知18.6底板且当前grounded/无碰撞；不把一次落地或固定等待当作松键已处理的证据。

最终本地证据：正常软件GPU用例3/3通过；相同grounded条件移除的生产突变退出1，Space后无法继续满足权威下落条件，已恢复生产源；故意延迟读取3秒退出0，临时固定延迟已移除。测试类型、Lint与格式检查通过，最终完整CI绑定后续提交SHA读取。独立只读复核支持以明确预落地边界和轨迹留存做断言，不把ack独立当因果证据。
