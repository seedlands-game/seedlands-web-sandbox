# 流体体验修复：河岸、涉水游泳与连续反馈

**状态：Delivered；实现、合并与全部自动准出完成，真实耳机听觉为明确保留的人工补充项。**

## Context & Goal

用户实机截图显示自然河流的透明水侧墙高出草岸近一格，河面呈整齐铺设的方块带；玩家进入水体后仍使用陆地速度、重力和跳跃，没有涉水、游泳、下潜、镜头入水视觉与听觉变化；打开水池缺口时，水流网格会闪现且响应迟缓。

代码复核确认：generator v2 将河床压到 `waterLevel - 2`、近岸压到 `waterLevel - 1`，而满级水顶面为单元底部加 `7/8`，所以岸顶可低于水面；河流水位只取路径起终点地形，不能约束中途低洼。流体求解为 10Hz、有界队列，但同 Chunk 连续提交会反复取消无法真正中止的 worker 任务，并把近场更新放回 FIFO 尾部，存在可见性饥饿。

完成态是：新建世界的自然河流具备一致的河床、水位、岸高和过渡规则；旧 generator v2 世界仍按原版本继续且不静默重生；玩家按实际水面获得涉水、游泳、上浮/下潜、镜头入水视觉与听觉状态；服务端确认的流体前沿优先可见，同 Chunk 更新合并并最终与权威水位一致。

父任务已明确授权本轮无需逐项等待人工 SDD 审核；本 change 仍按 Breaking flow 保存合同 SHA、RED/GREEN 与分层证据，不据此授权 push、部署、删除存档或使用额度重置。

## Scope & Non-goals

### 本次范围

- 新增 generator v3 河流规则：沿完整路径与近岸采样安全水位，河床、满级水面、岸顶和四格过渡共同约束；覆盖多 seed、交汇、端点与跨 Chunk 横断面。
- v2/v3 存档选择：开始界面提供“继续推荐版本”“继续旧版 v2”“新建当前 v3”三个明确入口；同 seed 同时存在 v2/v3 时默认继续 v3，用户仍可显式进入 v2。不得复制、删除、覆盖或自动修复 v2 数据。
- 建立无 DOM 的实际水面采样，输出身体浸没比例、涉水/游泳和带迟滞的镜头水下状态。
- 玩家在浅水减速；深水降低重力、加入浮力和阻力；Space 上浮、下潜键使用左 Shift；离水恢复陆地规则。
- 镜头入水使用平滑的雾距、吸收色和后处理过渡；暂停、存退、重载不积压或跨世界残留状态。
- 环境水声按实际水面/距离而非仅 macro hydrology；入水、出水、涉水、划水使用有界事件；水下只对音乐、世界音效和环境声应用平滑低通，UI 确认音保持干声。
- 流体网格调度新增交互近场优先级与每 key 合并：在途旧任务完成后只派发最新修订，不允许连续更新无限取消；可见前沿只来自服务端 commit。
- 水纹动画加入局部流向参数与更连续的表面偏移；最终网格与服务端 fluid sidecar 一致。

### 明确不做

- 不做压力、体积守恒、无限水、海洋、波浪物理或客户端权威流体。
- 不做氧气条、溺水伤害、潜水装备或水生生态。
- 不接 AgentServer/LLM，不改联机协议。
- 不把本次 change E2E 提炼进长期基线；历史 Delivered/Archived 用例保持冻结。
- 不把波形、频谱或事件计数冒充真实听觉审美通过。

## Decisions

1. `GENERATOR_VERSION` 升为 3；生成函数显式接收版本。v2 分支保持逐值兼容，v3 才采用新河流规则。开始界面显式传递打开模式；默认继续当前版本，只有当前版本不存在时才回退旧版。GameServer、worker、persistence 与 procedural mesh 均使用实际选中版本。
2. v3 河流水位取整条折线路径、段中点及两侧近岸样本的最低地形减一，并保留有界范围；河床最多到 `waterLevel - 2`，紧邻岸顶不得低于满级水面上方的整数岸层，向外四格只削高形成自然过渡，不用 shader 整体下移掩盖生成错误。
3. `src/world/` 新增共享水介质采样，只依赖坐标、voxel 读取和 fluid level 读取。水面统一使用 `waterSurfaceHeight()`；镜头入水使用进入/离开不同阈值，避免贴水面抖动。
4. 移动物理由纯策略函数计算参数，PlayerController 仍执行碰撞与输入。浅水只减速，深水才允许持续游泳；Space/Shift 只在游泳时改变垂直意图。
5. 水下视觉为独立模块，不改 `advanced-visual-effects.ts`，以避免与灯笼/阴影任务重叠；它附着相机后处理并在销毁时恢复资源。共享 `WorldEnvironment` 接收水下混合量覆盖当帧雾参数。
6. 音频混音器把音乐、世界音效和环境声汇入可平滑调节的低通后再接 master；UI 音效直接接 master。世界音频只驱动参数和有界事件，暂停清空节流状态，退出或切换世界必须恢复干声。
7. 网格调度不尝试中止已发给 worker 的任务。同 key queued 更新覆盖为最新目标但保留最早等待年龄；in-flight 更新记为 replacement，旧结果不挂到场景，完成后立刻以最高近场优先级派发一次最新快照。其他 Chunk 保留年龄公平性。
8. 首个可见反馈以同机 warm 场景不少于 20 次采样；修复前 p95 为 712.9ms、max 为 2761.8ms，最终实现冻结 p95 不高于 100ms，同时要求无饥饿、所有样本完成、阶段数据完整且连续权威前沿产生多次可见更新。

## Behaviour

- Given generator v2 的已存世界，When 继续同 seed，Then 选中 v2 world id，已保存建筑和未物化区域均按 v2 生成，不创建覆盖它的 v3 同名替身。
- Given 没有历史数据的新 seed，When 创建世界，Then 使用 generator v3；同 seed + v3 与 Chunk 加载顺序无关。
- Given v3 自然河段的水列、紧邻岸列、端点、交汇或跨 Chunk 边界，When 比较真实网格水面与岸顶，Then 水面不高于岸顶，河床至少提供一格水深，岸线向外连续过渡。
- Given 玩家从干地走进浅水，When 身体浸没但镜头仍在空气中，Then 水平速度降低、仍可触底行走并播放有界涉水声，不启用水下滤镜。
- Given 身体深度超过游泳阈值，When 按 WASD、Space 或左 Shift，Then 有水阻、浮力与上浮/下潜；松键后垂直速度受阻尼而非保持陆地自由落体。
- Given 镜头在水面附近波动，When 未跨越对应进入/离开迟滞阈值，Then 水下视觉与低通不来回闪烁；真正进入/离开后平滑过渡并各播放一次事件。
- Given 暂停、保存退出或重载，When 世界停止或恢复，Then 不积压涉水/划水事件；重载后的介质状态由实际 voxel/fluid 重算。
- Given 玩家打开水池缺口，When 服务端产生首个 fluid commit，Then 近场 Chunk 获得最高交互优先级；同 key 连续修订合并，不反复占用逻辑槽位，不展示已过期网格，最终 visible revision 等于权威 revision。
- Given 不同 fluid level 与河流方向，When 渲染表面/落水侧面，Then 水位在相邻权威状态之间连续呈现，纹理运动方向与共享 flow direction 一致；没有高于岸边的透明整格侧墙。

## Test Design

### 实现前 RED

- `tests/world/macro-river-v3.test.ts`：固定 v2 样本保持旧值；v3 多 seed 路径、端点、交汇候选与 x/z Chunk 边界的水面/岸高不变量；预期因版本化 macro API 与 v3 规则不存在而 RED。
- `tests/world/water-immersion.test.ts`：不同 fluid level 的身体浸没、浅水/游泳边界、镜头迟滞与 dry reset；预期模块不存在而 RED。
- `tests/app/water-movement-policy.test.ts`：陆地、浅水、深水、上浮、下潜与离水恢复；预期模块不存在而 RED。
- `tests/client/water-audio-policy.test.ts`：入/出水边沿、涉水/划水节流、暂停清空；预期模块不存在而 RED。
- `tests/app/mesh-task-scheduler.test.ts`：追加远方 cold queue + 同 key 十次近场 fluid 修订，断言只保留最新 replacement、无 stale visible、近场优先且远方最终仍获服务；预期当前取消/FIFO 行为 RED。
- `tests/client/world-version-policy.test.ts` 与 server/world/worker 相关 focused 用例：v2/v3 显式选择、默认策略与 procedural mesh 按实际版本；预期当前固定 v2 常量 RED。

### 浏览器与视觉/听觉证据

- `changes/2026-09-05-fluid-experience-repair/e2e/natural-river.spec.ts`：多个固定 seed 的自然河段/横断面/端点/交汇/跨 Chunk，并真实走入、涉水、游泳、下潜、出水；验证视图状态、速度、权威玩家位置、暂停与存退重载。
- `changes/2026-09-05-fluid-experience-repair/e2e/fluid-feedback.spec.ts`：warm 场景重复不少于 20 次真实缺口编辑，采集 edit accepted、first fluid commit、worker start/complete、scene attach、visible postrender 与 merge/supersede 数；输出 p50/p95/p99 与逐段数据。
- `changes/2026-09-05-fluid-experience-repair/midscene/fluid-experience.yaml`：自然岸线、真实进入/水下/离水、连续前沿与流向的视觉语义。程序断言不能代替“自然、清晰、一致”的视觉判断。
- Manual supplement：用耳机真实试听浅水脚步、入/出水、持续划水和水下低通；若无人完成真实听觉验收，保持待验。

## Acceptance & Evidence

| 编号 | 准出条件                                                        | 所需证据                            | 实际结果                                                            |
| ---- | --------------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------- |
| F1   | v3 多 seed 自然河水面不高于邻岸，路径/端点/交汇/跨 Chunk 确定   | Vitest、Playwright-change、Midscene | 通过：确定性横断面、真实河岸截图与 Midscene 语义验收均通过          |
| F2   | v2 已存世界保持原 world id、基础生成与建筑；新 seed 使用 v3     | Vitest、Playwright-change           | 通过：同 seed 同存 v2/v3，旧建筑只在 v2，两个入口均可达             |
| F3   | 浅水、游泳、上浮、下潜、离水物理符合定义                        | Vitest、Playwright-change           | 通过：真实 W+D 入水、Shift 下潜、Space 上浮并从对岸离水             |
| F4   | 镜头水下视觉平滑且迟滞稳定，暂停/重载正确                       | Vitest、Playwright-change、Midscene | 通过：迟滞单测、强水下混合、暂停/存退/切世界恢复均通过              |
| F5   | 入/出水、涉水、划水与低通工程状态正确且无事件爆发               | Vitest、Playwright-change           | 通过：世界声总线低通、UI 干声、暂停无事件增长、退出恢复干声         |
| F6   | 实际音色、响度与过渡可听且与现有风格一致                        | Manual supplement                   | 待真实听觉验收；不可由波形替代                                      |
| F7   | 连续流体修订不饥饿、不显示 stale 网格，最终与权威状态一致       | Vitest、Playwright-change           | 通过：replacement 合并、stale 丢弃、远端公平性和逐帧权威前沿均通过  |
| F8   | warm 缺口样本有完整阶段数据，报告 p50/p95/p99；阈值据基线后冻结 | Playwright-change                   | 通过：合并态 20/20 完成，p50 46.8ms、p95 80.4ms、p99/max 80.6ms     |
| F9   | 受影响 deterministic 检查、world 覆盖率、静态检查与生产构建通过 | Vitest、Static、Build               | 通过：合并态 306 tests，world 行覆盖率 96.32%，Static 与 Build 通过 |
| F10  | 现有 9 项长期浏览器基线无回归                                   | Playwright-baseline                 | 通过：合并态 9/9                                                    |

## Tasks & Current State

- [x] 复核截图、生成规则、玩家控制、音频、流体求解和网格调度根因。
- [x] 与手臂/灯笼/阴影任务发送一次边界与浏览器错峰协调。
- [x] 建立 Breaking 合同、测试路径与明确非目标。
- [x] 写入测试骨架并取得缺少 v3/介质/调度策略的预期 RED。
- [x] 实现 generator v3 与 v2/v3 显式存档选择。
- [x] 实现介质采样、涉水/游泳、视觉与世界声总线音频。
- [x] 实现近场优先、同 key 合并和连续流向表现。
- [x] 完成 focused GREEN、全量静态/构建、change E2E 与 Midscene；真实耳机听觉保持待验。
- [x] 创建本地语义提交，合并灯笼/阴影提交并完成 9 项基线和重叠区域集成回归。

当前没有实现或自动准出阻塞；本 worktree 位于 `codex/fluid-experience-repair`。真实耳机听觉仅作为人工补充项待验，不冒充已完成。账户本周期开始时为 60% 已用，本轮上限为 71%；未使用额度重置。

## Delivery Snapshot

- 实施前合同 SHA-256：`3031a09e98f24f52ec3fa52d2944f4adb19be552387502492060d335016a3e8c`；后续只补充父任务明确的入口/音频范围/连续可见性约束和实际证据。
- 生产路径覆盖 `src/world/` 的 v3 河流、介质与流向，`src/server/` 的版本化权威世界与 20Hz 流体，`src/app/` 的移动、视觉、音频和 latest-wins 调度，`src/client/`/worker 的版本选择与持久化链路。
- RED：新模块导入失败、固定 generator v2、10Hz 流体断言和取消/FIFO 调度断言按预期失败；GREEN：合并态 `pnpm verify:static` 为 69 files、306 tests 通过，world 行覆盖率 96.32%；`pnpm build` 通过。
- 需求 E2E：流体 3/3、灯笼/裂纹/贴墙 4/4 通过；最终 warm 20 次反馈 p50 46.8ms、p95 80.4ms、p99/max 80.6ms，逐帧权威水位由未到达推进到 `[7,6,5,4]`，同一期间 visible trace 由 139 增至 165。
- 长期基线：`pnpm test:e2e` 明确执行并通过 9/9；没有把需求用例混入基线发现路径。
- Midscene：合并态 `fluid-experience.yaml` 1/1、灯笼/裂纹/贴墙 `repair.yaml` 3/3 通过；证据图为 `evidence/natural-river-bank.png` 与 `evidence/natural-river-underwater.png`。真实耳机音色与响度仍为 Manual supplement 待验，未用工程计数替代。
- 功能提交：`7983d39`；与灯笼/阴影提交 `7f2eb57` 的验证合并提交：`3034f85`。冲突按非整格碰撞、水中离岸、版本化 fluid mesh、灯笼模型分类和组合 Harness 契约合并。
- 预览入口：总分支快进后按 README 的本地开发方式启动；本次未发布、未 push、未部署。
