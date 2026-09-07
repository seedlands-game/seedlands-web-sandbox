# 数据平面修复与性能方案准出

## 背景与目标

用户要求先实际修复 AoS/SoA 开销，完成 TS 与 Rust 对照，以分项数据形成采纳方案，再以新方案对冻结空白对照验证计算与用户可感知指标。此前审计和 SIMD 实验不构成本需求完成。

## 范围与不做事项

落实 EntityStore 无用返回副本、collision baseline/generated 所有权、fluid 独占输入、导航校验与 open 集合分配、mesh 大数组打包。沿用现有 corpus 和参考实现，补齐 TS 原版、同布局 TS、Rust Wasm（适用项含 SIMD）、已有 MoonBit 的浏览器对照。对每项给采纳、保留 TS 或延期理由；只有等价且有净收益的候选进入正式消费者。

不改世界生成规则、存档格式、权威状态机、Worker 并发数和 WebGL2；不实现 Node/NAPI、GPU compute。Logic 直连、完整 packed PhysicsFrame、完整导航语言迁移等高成本方案需按本次测量证明必要性，不为形式上的 SoA 而扩展。

## 关键决策

- 在现有实验 worktree 延续；冻结父提交 79e05c5 为本轮 A，另保留最初 P0 身份用于历史比较。A 不包含本次修复，Wasm 默认关闭。A′ 为采纳的 TS 修复，B 为 A′ 加经分项采纳的 Rust；B 未优于 A′ 时正式方案选择 A′。
- 本轮用户已明确授权落地、实验及按结果执行新方案；结合此前自主 SDD 授权，完成本合同后直接本地执行，不再等待重复确认。保留 spec hash 及改动理由，不声称用户逐字审核了新 hash。
- 先测试 RED，再改生产。公开 copy contract 不弱化；独占输入采用显式消费接口，原纯函数继续不变输入。任何 alias、陈旧 revision、取消/失败路径变化均阻止采纳。
- TS 数据结构优化单独归因。Rust 同算法、布局、corpus、并发、复制路径对照；内核时间与消费者总时间分开。性能窗口串行，浏览器均 headless。
- 分项至少 10 个平衡顺序配对 block（正式配置每变体至少 1 秒并覆盖完整30个corpus的预热，120个测量任务），以 block 为统计单位；报告均值、p50/p95/p99、绝对差和配对 bootstrap 区间。计时量级不足时批量计时并明确范围，失败样本保留。结合实际频率判断收益，不机械沿用上一轮 0.2ms/任务硬线。
- 采纳需严格等价、可信计算或分配收益、可控维护成本，且统一实验无明确用户体验回归。轻量删除冗余副本可凭确定的分配下降和无回归保留，不能宣称未测出的帧收益。
- 统一 A/A′/B 10 个平衡 block：同浏览器、画质、尺寸、seed、缓存策略、固定五 Worker。记录进入可玩状态、真实输入窗口帧间隔分位数、Authority/Logic CPU 与 physics cost、编辑至可见延迟、内存/GC（可采集时）。未采集项写 NOT_COLLECTED；headless 不替代实体设备游玩验收。

### 同机资源预约补充

用户在实施过程中明确提示 Node Dedicated Server 任务也在同机运行。正式分项与统一实验均须经 `/tmp/seedlands-benchmark-reservation` 原子目录锁；所有参与任务的测试/构建同样避开对方采样。锁记录任务、run id、PID 与 UTC，只释放自己持有的锁，不抢占其他任务或终止用户进程。Node 任务先使用约三分钟窗口，本任务继续代码编辑。此前 11 项预检标记资源隔离未核验，仅用于正确性/runner 调试；不得作为最终采纳依据。采样记录预约区间及系统负载/可用内存，不能承诺操作系统和用户活动绝对静止。

### 分项结果驱动的 TS 控制组补全

第一轮10对正式分项显示W14原TS到Rust任务节省0.391ms，但相同密集查表布局TS到Rust仅节省0.042ms；W15相同布局TS反而快0.013ms。因此先在纯TS编解码采用有界连续输出、密集palette查表与索引CRC循环，保持字节/格式/优先级不变，再复测真实生产TS，不能拿未优化TS作为Rust唯一对照。W10第一轮 fixed 仍经Uint8Array.from callback/装箱，与生产嵌套填充不符；保留原记录但禁止用于生产ROI，改为与生产一致的索引循环后单独重测三种批量。

### 正式统一实验的证据加固

在首次 smoke 后、正式整体采样前收紧：Worker诊断记录实际实例化字节的SHA-256，B必须匹配冻结SIMD产物；不允许用同时预取scalar/SIMD清单冒充实际选型。CPU采集先连接全部role，再并发开始/停止，并检查窗口长度。三个变体均为独立origin，即使最终B只选TS。生产构建后写入源码指纹，runner比对冻结dist全量文件及source绑定，逐run复核服务内容。真实轨迹与工作计数按同block比较，无法等价的样本不得当语言收益；真实用户端到端结果单独解释。

### 首轮正式组合回归后的消融决策

`combined-final-1` 的30run与10组门禁全部有效。B（W02–W07）相对A′编辑p99均值56.1834→65.0074ms，慢15.71%，配对区间0.44–32.99%；CPU增量无显著收益，不能仅用对原版的提升宣布全部候选通过。分段均值显示B的mesh Worker耗时5.6200→4.2095ms，但edit→commit由14.8400升到17.8825ms。该证据提示提交前阶段，尚不能证明W07是唯一原因。

按已授权消融规则先撤出W07默认集合，仅保留同驻General的W02–W06；Fluid继续采用已修复TS消费路径，减少一个18MiB实例。保留W07代码、等价性和128-frontier分项正收益，不把原型删除或宣布算法无价值。先修改默认选择测试并观察RED，再改默认配置；重新构建、冻结后执行新的完整10 block A/A′/B。若收缩集合仍有明确用户体验回归，最终采用TS修复，Rust仅保留显式实验选择，不继续无限追逐组合。

增补流体失败恢复组合用例：Authority真lease→main clone→Worker transfer→consume→abortLease→原始数组与frontier保持→重试候选等价。该用例锁定已有所有权语义，不改变生产算法。两个正式批次均完整保留，第二批为新候选确认，不混池、不删样本。第一批资源已明确交还Node执行约5分钟功能检查，结束通知后再继续本任务重负载。

## 可验证行为

1. Given 相同实体/世界与输入，When 原版与修复逐 tick 执行，Then 状态、拾取、碰撞、revision 和顺序等价，公开查询副本仍隔离。
2. Given 已移交的独占缓冲，When 消费路径执行，Then 省去额外全量副本；Authority 保留的校验快照不被改变。原纯函数对可复用输入保持不变。
3. Given 非法/重叠导航窗口与负坐标、同优先级路径，When 优化执行，Then 与冻结实现逐项相同；unknown 仍 fail closed。
4. Given 相同数值输入，When TS/Moon/Rust 执行，Then 字节/字段一致且无隐藏 fallback；Wasm 关闭/加载失败时完整 TS 回退。
5. Given 冻结采纳清单，When 统一 A/B，Then 以真实观测解释核心成本和用户体验差异，组合回归时消融或撤回该项。

## 测试设计

生产前新增 tests/server/data-plane-_.test.ts 与 tests/world/data-plane-_.test.ts，覆盖无返回写入、所有权消费与原输入保护、导航 oracle、mesh 大数组容量。先记录 API 缺失或分配计数不符的 RED，再实现。Rust 采用同 corpus 真产物等价测试，核心 host 编译与边界门禁继续执行。

本 change 的 e2e 保存分项及统一对照 runner，不增加长期基线。真实键盘和编辑路径复用已有生产 Harness，按帧/可观察状态等待。没有视觉设计改变且严格 mesh 等价，Midscene 为 N/A；Playwright 仍执行真实输入回归。

## 验收与证据

| 条件                                        | 证据类型                     | 实际结果                                                                                                           |
| ------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| 冗余副本/导航分配修复且语义等价             | Vitest / Static              | 通过；公开副本/transfer/失败回卷/导航oracle/大mesh/codec字节测试，见分配账本与实现记录                             |
| TS原版、同布局、Rust与MoonBit分项及采纳原因 | Playwright-change / Vitest   | 正式TS 8类用例、首批11项和修正5项；各10配对block；W10旧装箱控制排除，W14/W15采用修复TS复测                         |
| 总方案与逐项数据冻结                        | Static                       | 通过；原方案hash295a4c…，消融方案hash68bdc5…，完整正文见adoption-plan.md，逐项采纳/不采纳及限制齐全                |
| 统一空白对照、计算和用户感知指标            | Playwright-change            | 两批各10组/30run全部门禁有效；第一批W02–W07因编辑p99相对A′回归未采纳；第二批General W02–W06通过，见results.md      |
| 回退、真实输入与既有核心行为                | Playwright-baseline / Vitest | 8项生产headless回归通过，涵盖真实输入/移动/支撑/跳跃/存档/streaming/地图；标量与TS回退单测通过                     |
| 静态组合、host核心及生产构建                | Static / Build               | 最终verify:static通过：176文件、845测试通过，3文件/5测试既有跳过；world行覆盖96.89%；host7项通过；最终生产构建通过 |
| 视觉语义及设备验证                          | Midscene / Manual supplement | Midscene N/A：无视觉设计变化，mesh字节等价；没有实体设备/有头FPS验收，不以headless代替                             |
| 同步最新主干后的路径与行为兼容              | Static / Build / Playwright  | 通过：合入 `origin/main@c777ba8` 后，`verify:static`、生产构建及8项浏览器回归均通过                                |

## 任务与当前状态

- [x] 恢复审计、SIMD、父实验及授权；冻结A提交。
- [x] RED/GREEN：实体、所有权、导航、mesh和codec；独立评审缺口修复。
- [x] Rust纯核心/标量/SIMD适配和确定性；正式分项测量。
- [x] 形成采纳总方案并冻结，保留不采纳数据。
- [x] 两轮统一实验，执行W07消融，最终默认General W02–W06。
- [x] 生产headless回归、最终静态检查、交付记录；完成后创建本地语义提交，不push。
- [x] 在独立收尾分支合入 `origin/main@c777ba8`，保留主干目录重组与WASM数据平面行为。
- [x] 重新执行WASM产物门禁、静态检查、生产构建与浏览器回归，回填真实结果并创建本地语义提交，不push。

## 交付快照

本轮已完成。收尾分支 `codex/data-plane-adoption-main-sync` 合入 `origin/main@c777ba811cf4a77500f43e3e1af8c814b725443c`；原工作分支 `codex/moonbit-wasm-workload-experiment`，冻结空白A为 `79e05c53e8c8d199c24b438165c7f62aa69efc70`。原最终生产源码指纹为 `7fc44871d060d3973f062d7a52981d140dcca7ce6cec112b69c574d24a7f353a`；第二批实测SIMD产物为 `320402dd0e3b8df902a106ef1a584f56236bad6ad3075628e42bce8b341b14d4`。主干同步改变源码路径与指纹，但未改变已采纳算法、W02–W06默认集合或W06标准SIMD选择；没有重跑A/A′/B性能采样，不能把旧性能数字重新归因于同步后提交。

变更包含：server/entity与导航热点；client碰撞buffer显式消费；fluid Worker独占输入；world mesh融合与codec布局；纯Rust core、Wasm adapter及产物；默认选择与回退；确定性测试；本change的分项/组合runner及证据；README运行说明。AoS控制平面/SoA数据平面、SIMD和WebGL2规范已在父提交AGENTS.md中落地，本轮遵守并补上实际修复。

- `pnpm verify:static`：最终通过，见 `evidence/validation-static.log`。
- `pnpm build`、`pnpm perf:adoption:freeze`、`SEEDLANDS_E2E_PORT=4281 pnpm test:e2e:regression`：通过，见 `evidence/validation-build-regression.log`。
- Rust host及标量/SIMD严格等价：见 `evidence/validation-core-artifact.log` 与构建manifest。
- 分项执行入口 `changes/2026-09-07-data-plane-adoption/e2e/{data-plane-ab,workload-ab}.spec.ts`；正式环境变量与样本数记录在raw和reservation中。统一入口 `combined-adoption.spec.ts`，显式10 block、固定production三个origin；两个完整汇总各自保留，不混池。所有需求用例留在本change，未提炼进长期基线。
- 流体失败组合用例因文件长度限制移至 `tests/server/data-plane-fluid-lease.test.ts` 后重新通过全量静态/coverage，原测试文件恢复，未改生产实现。
- 实际结论、增量收益、尾分位数口径、copy字节、维护代价和不采纳理由见 `adoption-plan.md`、`results.md`、`evidence/allocation-ledger.md`。
- 主干同步保留新目录结构，并将 `wasm-experiment-selection.ts` 移入 `src/client/compute/`；数据平面测试与当前实现import同步更新。历史A对照runner仍只在显式准备冻结checkout时运行，但日常TypeScript检查不再依赖遗留 `/tmp/seedlands-adoption-baseline`。详见 `evidence/main-sync-validation.md`。
- 同步后 `pnpm wasm:verify`、`pnpm wasm:rust:verify`、`pnpm rust:check` 通过；WASM产物为9788 bytes、SHA-256 `e342dd87279fe651eba7e649a6b5c0db172bd7653dbbf6380c272f88a7f7b17a`。
- 同步后 `pnpm verify:static` 通过：178文件/854测试通过，3文件/5测试既有跳过，world行覆盖96.89%，Svelte 0错误0警告，TypeScript三段检查通过。`pnpm build` 通过，2442模块完成生产构建；`SEEDLANDS_E2E_PORT=4281 pnpm test:e2e:regression` 8/8通过。
- 长期文档基线无需新增页面：主干代码地图已把计算运行时归入 `src/client/compute/`；仅在主干精简后的 `AGENTS.md` 中保留本change既有的数据平面/Wasm约束。

限制：RSS/GC/多并发扩展效率未采集；native本轮只有host正确性，不声称native性能上限。没有完整物理/导航语言迁移、packed PhysicsFrame、Node/NAPI、独立Rust server或GPU变更。首轮W07相关尾延迟是组合警讯，两批不是随机交错的W07单因素因果试验。第二批不显著回归也不等于所有设备绝无回归。默认保留TS开关和失败回退；无push、发布或主分支合并。
