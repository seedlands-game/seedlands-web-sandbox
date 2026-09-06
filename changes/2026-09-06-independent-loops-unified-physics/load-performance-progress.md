# 权威受控负载与计算池对照进度

## 合同

本记录只覆盖 A9/A12 的受控负载，不替代 `loop-performance.spec.ts` 的自然路线。浏览器证据必须使用同一台机器、前台 Chrome、1920×1080 CSS、DPR 2、Medium 画质及既有 0.88 内部比例，分别运行一个流体保留槽加一个通用槽、一个流体保留槽加两个通用槽。结果只报告实测差异；三槽配置没有预设胜出结论。

A/B 使用相同 seed、坐标、命令顺序和编辑体积；每个配置在隔离 Browser Context 中从空存储启动。玩家相机 y=50.6 对应脚底 y=49。20 个水样本位于同一近场，逐样本将相机朝向目标且不移动 streaming 中心。原始附件必须先于性能阈值断言写出，确保未达标时仍保留可分析证据。

受控场景通过生产命令和世界编辑建立：权威状态中至少 16 个 `active` 自主角色、64 个掉落物物理身体、1024 个真实流体 frontier 位置。角色和掉落物都位于当前近场碰撞区域并继续参加权威物理/规则推进。场景不修改 seed、`generatorVersion` 或质量配置。

每个配置至少采集：

- 浏览器、源 SHA、CSS 视口、DPR、Canvas 内部分辨率、硬件并发数和可用 JS heap 数据；
- rAF 帧分位、每个物理步真实成本分位、最大物理债务；
- 流体 pending/in-flight/accepted/rejected/returned 真实权威计数；
- 计算池实时/峰值任务数与排队字节、按 lane 的 Worker 侧任务经过时间窗口；浏览器没有标准的 Dedicated Worker CPU-time API，因此不得把经过时间冒充线程 CPU time；
- 流体从编辑、目标区域 `fluid-v2` 权威提交、目标 Chunk 的 Worker 网格、场景挂接到 `postrender` 首见的 20 个样本；
- Mesh 排队和完整可见延迟，且在持续交互流体任务期间，先进入队列的 streaming trace 最终完成。

流体样本必须在 `beginFluidFeedbackSample({x,y,z,radius})` 中固定目标区域和开始时 Chunk revision。`fluid-v2` 提交只有在变更 bounds 与目标区域相交、且对应目标 Chunk revision 前进时才能成为该样本的首次提交；其他 Chunk 或同 Chunk 其他区域的水流提交不能抢先完成样本。无水面过渡的网格可在新静态资源首次 `postrender` 后完成样本；有水面 Morph 的网格在初次挂接时仍处于进度 0，只能在首次非零进度实际经过 `postrender` 后完成。被 held、取消、卸载或更新代际替换的旧 Morph 不得误报可见。

### 水面真实首见 TDD

预置用例覆盖：repository 初次 `onVisible` 必须携带是否仍有过渡待显示，scheduler 的一般 Chunk 首见仍立即完成；Morph 进度 0 和 held 状态不完成流体样本；首次进度大于 0 后还需一个 `postrender` 并写入 `water-transition-progress-visible` trace mark；在该帧前取消、卸载或换代不会回调；若动画直接完成到进度 1，则最终静态水面实际 `postrender` 也可作为首见。`FluidFeedbackTracker` 必须读取新的过渡 mark 计算 `attachToVisibleMs/totalMs`，不能回退使用较早的初次挂接时间。

### 流体 revision 首见屏障

真实负载证明，普通流体传播可在较早流体网格的计算期间持续推进同一 Chunk revision。现有 replacement 合并会丢弃每个已经完成的较旧结果，直到流体暂时安静；因此 Worker 计算只有十余毫秒，提交到 Worker 开始仍可等待数秒。

修复采用生产 `fluid-v2` 提交语义，不由 Harness 采样开关启用。每个已经有可见资源或在途请求的流体提交，按其真实 Chunk revision 建立每 Chunk 一个首见屏障。满足屏障 revision 的已准备网格先完成一次真实非零水面进度 `postrender`，期间同 key 后继只保留一个最新 replacement；首见后立即派发最新状态，并把连续流体提交合并成最多一个下一屏障 revision，不按 revision 数量增长。普通编辑仍不能成为流体传播样本的首次提交。

Authority 已经准备的 materialized canonical 可由客户端对 Worker 回传进行逐值复核，用于显示该已接纳历史 revision；它不重新写 Authority，也不降低客户端碰撞镜像 revision。Worker 自行生成的 procedural canonical 仍必须由 Authority 接纳。取消、卸载、场景 epoch 和销毁必须同时清除屏障、下一屏障及延后 replacement；普通 streaming 继续使用原合并与老化规则。

### 边界准备分段诊断 TDD

`commitToWorkerStart` 从流体提交时刻量到 Mesh 调度器向计算池提交任务前，是一个复合区间。第一层诊断只补现有客户端 trace：每个 Chunk 请求记录 `prepare-start` 与 `prepare-end`，`WorkerQueueWait` 和同步 `AuthorityOverlayCopy` span 导出时携带同一 `traceId`。这样单个真实边界目标可分别量出调度等待、异步 `beforePrepare` 和同步 Worker 输入复制；不改任务优先级、预算、流体归因或性能阈值。单样本 E2E 允许用显式环境变量选择原 20 个目标中的一个，仍建立并核验完整 16 个角色、64 个物件、1024 个背景流体格和全部目标井。

预期 RED：性能 telemetry 的已完成 span 当前丢失 `traceId` 导出字段；调度器在 `beforePrepare` 前后没有 mark；单样本固定采第 0 个目标，不能直达已知慢边界。若真实证据把约 400ms 定位到 `beforePrepare`，再补 Authority/Persistence Worker 内部数据库、事务读取、批次解码和 codec 的有界分项；若不在该段，则不扩展持久化协议。

## RED 设计

`e2e/authority-load-performance.spec.ts` 先声明以下缺失观测，作为生产接线前的类型 RED：

1. Harness 快照尚未暴露流体权威诊断、计算池峰值/Worker 任务成本和权威身体近场分类。
2. `beginFluidFeedbackSample` 尚未接受目标区域，现有 tracker 会把第一个无关 `fluid-v2` 提交绑定为样本。
3. 计算 Worker 回执尚未携带 Worker 侧任务经过时间，无法对 2/3 槽位解释吞吐与帧差异。

预期先由 `pnpm exec tsc -p tsconfig.test.json --noEmit` 在上述字段处失败，再实现最小观测并转 GREEN。按主任务调度，本代理不启动浏览器；生产构建后的 Playwright 实跑、性能附件和最终 2/3 槽位取舍由主任务在不可变产物上完成。

## 当前状态

- [x] 冻结负载、采样和目标流体归因合同。
- [x] 记录测试类型 RED：`tsconfig.test` 在目标采样参数、流体/身体/计算诊断共 13 处因接口缺失失败；计算池专项 1 项因峰值和 Worker 耗时字段缺失失败。
- [x] 补齐有界真实观测与目标归因：权威流体/身体、计算队列峰值和分 lane Worker 经过时间均来自生产对象；流体完成要求目标 bounds/revision 与完整 Worker→attach→postrender trace。
- [x] 定向 Vitest 5 文件 31 项、源码 TypeScript、ESLint、Prettier 与 diff check 通过。生产构建已执行到 Svelte/source TypeScript 通过，随后被并发 A12 RED `tests/worker/compute-worker-entry-lifecycle.test.ts` 引用尚未建立的模块阻塞；不是本任务诊断。
- [x] 修正受控负载准备顺序：先建立平台、16 个角色、64 个物件与 20 个独立目标井，等待 50 个近场 Chunk 加载、Mesh/上传队列清空且 84 个实体已经呈现，再激活 1024 个水源。`setTimePaused(true)` 只控制世界时钟倍率，不作为流体暂停手段。
- [x] 每个目标样本以 `try/finally` 写出目标九宫格、目标 Chunk revision、流体 pending 阶段、计算池状态和最近 16 条目标 trace；单个样本超时也保留完整归因链。
- [x] 在不可变 `afe170f` 的生产预览上得到排除 streaming race 后的真实 RED：准备态为 `loadedChunks=50`、`renderedChunks=37`、所有 streaming/Mesh/上传队列为 0、`presentedEntities=84`、`triangles=4778`。第一个隔离目标首见总耗时 `915.7ms`，其中编辑到目标 `fluid-v2` 提交 `701.8ms`、提交到 Worker 开始 `175.3ms`、Worker `17.8ms`、挂接到可见 `20.8ms`。原始日志为 `/tmp/authority-load-ready-target0-debug.jsonlog`。
- [x] 定位首段延迟为权威流体 FIFO：1024 水源形成的普通 frontier 排在单格玩家编辑前，单个 128 格 lease 无近场优先入口。先写 `tests/server/fluid-interactive-priority.test.ts`，确认普通/交互公平、队内提升、8192 hard cap、reject/abort 精确恢复、Gameplay 采集/放置和 Harness 单格编辑共 6 项预期 RED，hard cap 项保持 GREEN。
- [x] 实现两条有界 frontier：每个无 cleanup 的 128 格 lease 先取至多 32 个交互格并保留 96 个普通格；普通格不足时才用交互格填满剩余预算。已排队格提升不增加 pending，未知格在 hard cap 下不增长，拒绝或中止按原 lane 和顺序恢复。只有 `player-edit` 或真实 `player` 实体发起的单 `edits` 提交进入交互 lane；多编辑与 mutation buffer 继续走普通 lane。
- [x] 优先级定向 7 项、既有流体事务/运行时、Gameplay 与世界事务合计 5 文件 61 项及测试 TypeScript 通过。
- [x] `5904dc0` 与 `0d6ec9f` 的准备门禁均在流体采样前 fail closed：16 个新增角色、64 个新增物件、50 个已加载 Chunk 和空 Mesh 队列满足，但 `nearPlayer=79`。先把实体生成移到静态几何完成后，结果仍为 79；附件进一步显示新增角色与物件坐标交叠，统一实体 pair separation 会把至少一个身体推出平台。夹具将角色和物件分区放置；没有减少实体、降低画质或放宽 `nearPlayer>=80`。`0d6ec9f` 原始 JSON 为 `/tmp/seedlands-0d6ec9f-authority-load.jsonlog`，ready 快照解码为 `/tmp/authority-load-ready-general-1-0d6ec9f.json`。
- [x] 水面真实首见预置 3 组 RED：repository 只回报普通挂接、adapter 未在非零 Morph 实际渲染后回调、tracker 会消费更早的普通 `visible-postrender`。实现保留一般 Chunk 的 scheduler 完成时点；只有流体反馈在 `transitionPending` 时延后，adapter 于首次非零进度或最终静态终态之后再等一个真实 `postrender`，并写 `water-transition-progress-visible`。repository 按当前已安装的 task/resource 身份拒绝卸载或换代旧回调。
- [x] 水面首见定向 3 个文件、18 项及完整水面/反馈 7 个文件、31 项通过；修改文件 Prettier、ESLint、源码/测试 TypeScript、Svelte 检查与生产构建均通过。held、非零进度、取消、卸载、终态 `postrender` 和新 trace mark 均有确定性覆盖。
- [x] 在不可变 `58f19d0` 产物上完成 2/3 槽各 20 个真实样本：两配置都完成 20 次真实非零水面进度 `postrender`，但二槽 p50/p95 为 `718.0/2064.8ms`，三槽为 `220.5/2564.7ms`，均为 RED。Worker 约 `13–20ms`、挂接到首见约 `32–60ms`，主要延迟是连续流体 replacement 下 `commitToWorkerStart=0.6–2.58s`。帧 p95 为 `17.2/18.2ms`、物理 p95 为 `1.3/1.4ms`，排除物理与主帧为主因。原始日志 `/tmp/seedlands-58f19d0-authority-load-full.jsonlog`，解码附件 `/tmp/seedlands-58f19d0-authority-load-evidence/`；源 `58f19d0b6c2a1610753da2005a13ce5716913ab1`，夹具 SHA-256 `7d105f4c730839bc4848dc2fb0395ada3aeb363bf509060407d4def877730add`，bundle manifest SHA-256 `a8746884b18c16a5866d70c8598811b6b5a480329a25b968d5e43a4a2e546a4b`。
- [x] 单元 RED 锁定生产 `fluid-v2` revision 屏障、连续 replacement 只保留一个最新后继、首见后恢复、普通编辑不完成传播样本、取消/epoch 释放，以及历史 visual canonical 不回滚碰撞。修订后水面、repository、scheduler、反馈与客户端 7 个文件 50 项通过；相关 ESLint、源码与测试 TypeScript、Svelte 检查和生产构建通过。
- [x] 在不可变 `45090ef6d27c7c2b08129d696644b161a231a8cb` 产物复跑一个真实样本：目标 rev `28→30`、相邻派生水位 7、`merged/superseded=0`，说明滚动屏障已消除数秒饥饿；但总延迟 `118.7ms` 仍为 RED。分段为编辑到首个流体提交 `30.8ms`、排队 `0.8ms`、Worker `22.9ms`、Worker 到挂接 `29.2ms`、挂接到真实非零进度 `postrender` `35.0ms`。原始 `/tmp/seedlands-45090ef-a9-single.jsonlog`，附件 `/tmp/seedlands-45090ef-a9-single-evidence/`。
- [x] 两项固定帧边界先各得到定向 RED。修复后，最后一个 Mesh part 仅在本帧 `maxCommitMs/maxFrameCommits` 仍有预算时立即 attach；水面过渡改由 PlayCanvas `prerender` 使用真实 elapsed 推进，并在同帧 `postrender` 证明非零进度已渲染，held 不累计时间且取消退订。相关水面、repository、scheduler、反馈与客户端 9 个文件 62 项通过，ESLint、源码与测试 TypeScript、Svelte 检查和生产构建通过。
- [x] 在 `git rev-parse` 为 `643b01f831494752f0778d245323c5a90883b160` 的 detached 构建目录复跑同一真实样本，得到 `85.9ms`：目标 rev `28→30`，相邻派生水位 7，`edit→commit 28.1ms`、排队 `0.7ms`、Worker `25.0ms`、Worker 到挂接 `14.9ms`、挂接到真实非零进度 `postrender 17.2ms`，`merged/superseded=0`；frame p95 `16.8ms`、physics p95 `1.6ms`。但原始 `/tmp/seedlands-643b01f-a9-single.jsonlog` 及附件中的 source 字段被误填为不存在的 `643b01f4fbb42b4ad83a93c13ccb70ff804395f7`，原文件保留不改；正确 SHA 另由已归档 Harness 构建清单与浏览器证据关联。该样本只作为历史链路诊断，不作为最终同源硬证据。
- [x] 同一 `643b01f` 不可变产物的 2/3 槽各 20 样本已保留完整附件，但仍为实质 RED：二槽 p50/p95/max 为 `132.2/2726.9/2814.0ms`，三槽为 `115.2/2747.6/3129.5ms`。前 15 个目标为 `51.2–179.1ms`；第 16 个目标进入 `-1,1,-2` 后，`commitToWorkerStart` 为 `2712.5/3015.9ms`，期间同 key 合并 `121/120` 次。该 Chunk 不是未准备的远景：两配置在激活水体前都已有 `loadedChunks=50`、`renderedChunks=34`、`triangles=4252`且生成/Mesh/上传队列为 0，目标自身为已读取的 revision 9 Air。原始日志 `/tmp/seedlands-643b01f-a9-full.jsonlog`，解码附件 `/tmp/seedlands-643b01f-a9-full-evidence/`。
- [x] 删除两个实时独立世界必须产生完全相同 `submittedTasks/submittedBytes` 的无效断言；输入仍要求相同 `scenarioSource`，每个配置仍独立核验 16 个新角色、64 个新物件和至少 80 个近场权威身体。
- [x] 新增延迟 `beforePrepare` 的确定性 RED：准备期间连续 120 次同 key 流体修订后，旧实现将准备调用两次且未派发 Worker；根因是 `beforePrepare` 尚未返回时该 key 未计入占用，新请求写回 `queued`，旧准备返回又因同 key 在队列而丢弃，持续修订可无限重复该路径。
- [x] 准备阶段现以每 key 一个 `preparingRequests` 记录为占用；期间的同 key 请求只合并为一个最新 replacement。准备返回后，本次快照继承最新请求身份、优先级和屏障，直接派发已包含最新 revision 的 Worker；不再为已被该快照包含的 replacement 重复准备。取消会使旧准备失效，返回后只释放租约，同 key 新代际继续。定向 scheduler 13 项 GREEN。
- [x] `12f87932b12b6911282d34f7c26e185542f24359` 不可变产物的复验仍为 RED：二槽 p50/p95/max 为 `185.6/1317.1/1625.2ms`，三槽为 `184.1/1083.6/1218.3ms`。准备阶段修复把最后一行目标的数秒排队约减半，但未消除同 Chunk 的持续合并。当时系统处于电池 18% 放电，Chrome 节能后帧 p50/p95 降为约 `33.3/34–35ms`，相比前轮 60Hz 环境把挂接首见至少增加一帧；但 `commitToWorkerStart` 仍有 `1.0–1.46s`，不能由节能解释。运行前有一次因 source 环境字段误填而在 30 秒内中止的准备运行，不列入证据；正式附件已记录完整精确 source SHA。原始 `/tmp/seedlands-12f8793-a9-full.jsonlog`，附件 `/tmp/seedlands-12f8793-a9-full-evidence/`。
- [x] 复核发现原“独立目标井”不封闭：3×3 石平台把中心和 `x+1` 挖空，`x+1` 正好是边缘，首见后水会继续流向 `x+2` 外界。同一 Chunk 的 revision 增量从首样本 `28→30` 增至后续 `59→72`，新 Chunk 首样本为 `9→28`，与合并计数从 0 增至 `62/90` 一致。目标井现扩大为 5×5 石平台，仍只保留中心 source 和 `x+1` 一个 derived 空格，并在每样本前后记录 `x±2/z±2` 四个封闭边界以及 source/derived 下方的连续石底。这不改变 20 个目标、16 个角色、64 个物件、1024 个独立背景 frontier 或 100ms 门槛。原开放水道结果只作持续扩散压力证据，不宣称其饥饿已闭环。
- [x] 电池供电下隔离临时 Chrome profile 的空白 rAF 因果探针使用每帧实际移动和变色的色块：显式 `performance_tuning.battery_saver_mode.state=1` 时 4 秒 115 帧、p50/p95 为 `33.3/33.4ms`，显式设为 `0` 时 236 帧、`16.7/16.7ms`；两次启动前后 Local State 值均保持。正式性能仅在 Playwright 自己的一次性 profile 写入禁用值，不修改用户 Chrome、系统电源、画质、分辨率或负载，并单独记录电池环境与包装脚本摘要。
- [x] 5×5 夹具首个隔离样本验证为 `81.3ms`：四面边界与两格石底提交前后均为 Stone，中心 source 与相邻 level-7 derived 均正确，目标 revision `28→30`、`merged/superseded=0`。随后完整运行在样本前 fail closed：`load-actor-8` 仍有权威身体，但已从 `[1,49,-5]` 移至 `[-2.1173,11.000001,-11.8650]`，掉下平台后因垂直距离约 38 格不再属于 32 格近场。它是混排在 `night-stalker` 近邻中的 `settler`；生产逻辑会让非 `night-stalker` 对可见威胁选择逃跑。16 个专用角色现统一使用 `grazer`，消除该混合威胁且 Stone 掉落物不是其可食目标；仍逐 ID 核验全部角色和 64 个独立物件都存在且位于近场，不用 starter 数量补足门禁。原混合生态仍由自然/功能旅程覆盖。
- [x] 全 `grazer` 的下一次单样本仍在采样前 fail closed：`load-actor-12` 从 `[5,49,-5]` wander 至 `[0.1858,11.000001,-11.9621]`，再次越过 z=-11 平台边缘；原始 `/tmp/seedlands-a9-c139cb5-single.jsonlog`。实体平台只向正 z 扩至 14，两排角色改置于 z=3/7，目标井仍在 z≤-12、背景水池仍从 z=15 开始，三者不重叠。角色保持 active 且真实运动，不修改角色逻辑或近场门槛。
- [x] 为避免用有限边距掩盖更长时间的 wander，受控夹具在玩家身后建立 `x=0..10,z=1..12,y=49..51` 的三格高封闭石围栏。16 个 `grazer` 位于其中并继续参加生产移动、角色 pair separation、实体/方块碰撞和权威步进；不冻结或循环传送。准备门禁逐体素核验 126 个围栏边界全部为 Stone，并逐 ID 核验 16 个身体仍在围栏内部。围栏位于朝向负 z 的相机背后，不遮挡 20 个目标井；64 个物件与背景水池位置不变。
- [x] `b459510a6555a7fcec2a0018d4861d864e20490b` 的围栏夹具单样本完整 GREEN：126/126 边界为 Stone，16/16 专用角色在围栏且近场，64/64 专用物件近场，目标井边界与石底提交前后完整；首见 `69.2ms`。同源 20×2 完整运行仍为 RED：两槽 p50/p95/max=`83.0/498.0/598.3ms`，三槽=`86.0/512.0/585.8ms`；帧 p95=`18.0/18.4ms`、物理 p95 均 `1.8ms`。前 15 个目标大多为 `53–88ms`，最后 z=-36 行进入 cz=-2 后，两配置 10 个样本的 `commitToWorkerStart` 均为 `404.8–496.7ms` 且 `merged=0`。原始 `/tmp/seedlands-a9-b459510-full.jsonlog`，附件 `/tmp/seedlands-a9-b459510-full-evidence/`，运行时电池 12% 供电且一次性 profile 明确禁用 Chrome 节能。
- [x] 为边界 Chunk 的重复准备增加 RED：中心 `(0,1,-2)` 的 halo 含未驻留 cz=-3。源码检查确认旧实现每次 `ensureNeighborhood` 都会向串行 Persistence Worker 发最多 27 个独立 `load`，每个各自建立并等待一个 IndexedDB readonly transaction；`b459510` 浏览器证据确认边界样本的 `commitToWorkerStart` 为 `404.8–496.7ms`。`27×16ms≈432ms` 只是与观测吻合的根因假设，当时没有逐事务浏览器 trace，不能作为“每个 IDB 事件耗一帧”的实证。修复将一次 Mesh halo 中尚未缓存或在途的坐标合成上限 27、坐标唯一的 `load-batch`，在 Worker 原有 `taskQueue` 内用一个 readonly transaction 同步发出全部 get；没有增加长期 missing 缓存。加载 registry 以精确 durable claim、带 identity 的中心 neighborhood lease、逐 key load token 和单调 generation 统一所有权：最后一个流式 lease 释放后迟到批次不缓存且被取消的 prepare 明确失败；精确读取或另一重叠 halo 仍在消费的 key 继续得到 found/missing；尚无结果的 `loadSnapshot` 探测不消费 exact claim；旧 lease 的迟到完成不能释放同中心新代际。普通 save 与 save-frozen 在开始时记录 generation fence，成功清理 fence 之前的 cache/在途读取，保留之后发起的 durable load，失败不应用 fence；已成功但在消费前被 save 替代的 exact 结果会明确抛出 superseded 错误并结束 claim，不会伪装成存档缺失或留下幽灵消费者。正式反例另覆盖 27 key/1 transaction、相邻 halo 只追加 9 key、整批身份异常无半批发布和 dispose 迟到回执。
- [x] 与实现者独立的 Sol/xhigh 复审批准 `e1c57c5+4f6f259+81770f5+1935444` 的确定性与资源边界。复审者实际重跑共享 batch/exact release、保存后发读取、保存前旧读取 fail closed、纯 neighborhood 释放后迟到不驻留四个独立反例，以及正式 client/registry/Worker 3 文件 18 项；相关 ESLint、完整测试 TypeScript、Svelte/source TypeScript、生产构建和 diff check 均 GREEN。本批准只覆盖实现正确性，不替代浏览器 100ms 性能门禁。
- [x] 在 `git rev-parse` 为 `1935444d6ac409620113e5cd006df44e7f7e76c7` 的 detached 不可变构建上完成 2/3 槽各 20 个样本，结果仍为 RED：二槽 p50/p95/max=`81.7/482.0/484.7ms`，三槽=`87.3/497.3/498.0ms`；帧 p95=`18.3/16.8ms`，物理 p95=`1.8/2.1ms`。两配置最后 5 个 `cz=-2` 样本的 `commitToWorkerStart` 分别为 `400.2/403.5/405.1/403.9/404.8ms` 与 `399.1/394.9/401.6/399.7/396.0ms`，全部 `merged=0`，Worker 本身为 `17.4–18.7ms`。因此本轮产物虽然在实现上把最多 27 个消息/事务合成了一个批次，仍没有消除边界预派发阶段的约 400ms 等待；“27 次独立事务”不是完整根因。
- [x] 本轮原始日志为 `/tmp/seedlands-a9-1935444-full.jsonlog`，解码附件为 `/tmp/seedlands-a9-1935444-evidence/`。附件 `sourceSha` 因启动命令漏传环境变量而记录为 `UNSPECIFIED`，原始文件保持不改；同源关系以 detached worktree 的直接 `git rev-parse`、该目录的生产构建和 bundle 清单核验，故此元数据缺口需随证据陈述。运行期间电池从 6% 降至 4%，但一次性 Playwright 临时 profile 使用 SHA-256 `043f712ee6c0beb485e8087b29618c593a5d75abd7e41ac053844e4d5408acc9` 的包装脚本仅在临时 `--user-data-dir` 禁用 Chrome Energy Saver；帧分位也证明本轮保持约 60Hz。没有修改用户 Chrome、系统电源、画质、分辨率或负载。
- [ ] 浏览器附件当前没有投影 persistence 的 `idbGetCount`、`loadTransactionCount` 或 `decodeSamplesMs`，所以本轮只能把长段定位在 `requested/queued → worker-start` 这个复合预派发区间。当前 `WorkerQueueWait` span 在取出请求时结束，随后才等待 `beforePrepare`；附件按 `event.args.traceId` 过滤，但 span 导出没有携带该字段，无法从已归档附件分出两段。名为 `worker-start` 的 mark 实际写在向计算池提交 Mesh 任务之前，后续池内排队则包含在现有 `workerMs`，同样没有独立分段。下一轮应先增加有界观测：`prepare-start/end`、计算池实际 slot dispatch、Persistence Worker 的数据库/事务 get/整批 decode 时长及各 codec 数量；在此之前不能断言是 IndexedDB request 回调逐帧，也不能断言是 `procedural-diff-v1` 的同步 `makeChunk` 解码。电量恢复前不重复浏览器性能采样。
- [x] 第一层分段诊断取得预期 RED：性能 telemetry 导出的 span 没有 `traceId`，scheduler trace 没有 `prepare-start/end`，单样本入口也不能选择第 15 个边界目标；两项 Vitest 失败，测试 TypeScript 另有一处参数数量错误。实现后，span 导出携带所属 trace，异步准备前后各写一个 mark，单样本可用显式索引选择原固定目标且默认完整 20 样本路径不变；相关 2 文件 21 项、测试 TypeScript 和生产构建已 GREEN。
- [x] 在源码 `dad6157ede221168186669442e765d0d43a8e010` 上只运行第 15 个原固定边界目标，测试实际失败：JSON 记录 `unexpected=1`、`skipped=1`，总首见 `519.6ms`，不能用外层命令显示的退出状态替代测试结果。该 trace 的 `WorkerQueueWait=18.4ms`，`prepare-start→prepare-end=416.1ms`，同步 `AuthorityOverlayCopy=0.2ms`，Mesh Worker=`22.0ms`，其余挂接与真实非零水面首见约 `31.4ms`；frame p95=`17.0ms`、physics p95=`1.7ms`。实证把主要等待限定在异步 `beforePrepare`，排除了 scheduler 取队列、同步准备输入复制和 Mesh Worker 本身。原始日志 `/tmp/seedlands-dad6157-a9-boundary.jsonlog`，解码附件 `/tmp/seedlands-dad6157-a9-boundary-evidence-v2/`。
- [x] 第二层诊断只为一次 `beforePrepare` 返回有界请求级汇总：Authority 总准备、持久化等待、同步快照复制，以及 Persistence Worker 的任务入队至实际开始、数据库就绪、单事务读取、整批解码、总经过时间、found/missing 与 codec 数量。单批仍最多 27 个 key，回执被当前 Mesh preparation 消费后即丢弃，不复用已有累积 `decodeSamplesMs`，不增加长期事件或缓存。实现前 client/runtime/scheduler 的 3 文件 34 项中有 10 项按预期 RED；实现后相关 5 文件 41 项、测试 TypeScript、受影响 ESLint、完整生产构建和 diff check 均 GREEN。本层没有改 ComputePool、调度策略或 100ms 门槛。跨 Worker 已完成 span 在客户端接收时按 duration 反推起点，只能读取各自时长，不能把图中的绝对位置当作同一时钟时间线；`authorityPrepareMs` 包含 `persistenceWaitMs`，`totalWorkerMs` 包含 queue/read/decode，禁止相加双计。`ensureNeighborhood` 只返回本次新建批次的细分；若本次全为 cache hit 或只等待共享在途 load，则仍有真实 `AuthorityPersistenceWait`，但没有伪造批次分项。
- [ ] 只有修复实测主段后，再以不可变产物重跑 2/3 槽各 20 个样本且两者完整 p95 均 `≤100ms`，才批准性能门禁。自然 A/A/B 也尚未在最终调度与持久化实现上复验。
