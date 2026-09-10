# 执行记录

## 2026-09-10 S0

- 已冻结main `6c7124a`与Agent源`05b01b0`，创建独立worktree和分支，原checkout未改。
- 用户明确直接批准实施并提供约12h窗口，覆盖本change范围，不再等待二次hash审批。
- 已完成前置源码盘点：独立Character库存、固定技能switch、ECS/Action身份、模块操作/state路由与V4组合身份为迁移热点。
- 已建立spec、测试设计及初版预算；可执行RED、实现与集成验收尚未运行。
- 现有服务保持关闭；未读取.env或输出凭据。

## 证据账本

### 2026-09-10 S1 进行中

- 新 worktree 独立安装 workspace 依赖并合并 lockfile，保留 main 的 bitECS 与 Agent 的行为解释器/认知依赖；未覆盖原 checkout。
- 已接入 Agent/cognition 包边界正反例，以及类型字段 self 与宿主全局 self 的区分。定向命令 `pnpm exec vitest run tests/governance/monorepo-package-boundaries.test.ts tests/governance/runtime-purity-eslint.test.ts`：2 文件、17 测试通过，仅属静态规则证据。
- 新 change 已迁入既有生活/折返/三认知/PG用例，不修改历史 Delivered 断言；新增三 NPC 共用有限食物的1800模拟秒验收和 production preview 入口烟测，均尚未运行。
- A/B 接口对齐：每世界冻结 registry；ECS 单一身体 owner；技能只携绑定 actor 与冻结 provider 通过已注册 operation，再验证 provider 和 actor 权限。公共扩展样例计划使用既有库存合成操作，避免新增任意 owner。
- 全量静态、构建、浏览器、真实模型和 PR 均待后续集成，不把迁入旧代码的历史 GREEN 视作本基线通过。

### 2026-09-10 S1/S2 集成记录

- 新扩展作者路径的 Pack API 边界先取得 RED（内部导入未被拒绝），修正显式受检路径后定向 15 项通过。没有放宽全部 examples 的导入边界。
- 全治理测试曾为 18 文件 93 项通过、1 文件因尚未闭合的 core 类型失败；该结果不是全量静态 GREEN。
- 独立 ESM 扩展的 registry 单元测试已覆盖两次推进实际调用注册 operation。真实 Headless 三角色测试从 ESM/装配失败推进到 world facade 尚无 character API 的功能 RED，接线继续中。
- 从冻结 main `6c7124a` 的独立临时 checkout 以其原始构建器生成 `fixtures/main-composition.json`，并通过正常 Gameplay 命令生成 V4 `fixtures/main-gameplay.json`。保存两个角色、库存及耐久，不以手写近似快照替代迁移证据；生成后已移除该临时 checkout。
- 扩展宿主授权采用独立 `host-admissions.json`，固定完整产物身份和最小权限，不从 Pack 自报权限派生 grant。历史可组合玩法 E2E 只增加该新宿主文件的路由，其需求断言保持不变。
- Web 子任务曾运行带 Docker 的 Agent 测试，超出了该子任务的执行形式约束；已要求停止后续 Docker/模型执行，由主任务接管。主任务独立读回确认临时测试容器已清理，原用户 PG 容器仍停止且未删卷。
- 新增三角色长时有限食物、实际生产 Worker、真实三认知与扩展 Pack 浏览器测试，均尚未取得 GREEN。主任务未启动长期服务、未发真实模型请求、未提交或推送分支。

### 2026-09-10 S2 功能 RED 与进程证据

- `npc-camp-pack.test.ts` 已到达真实身体与库存：三角色创建、发现独立 ESM 能力、Running、存档及首次加工 4 块木板成功；回档后 2 秒产出为 0 而非 4。定位到 live Character record 与 ECS behavior 组件分离，存档误读陈旧出生状态，修复应恢复单一 owner，而非每 tick 复制两份状态。
- `threat-oscillation.spec.ts` 的真实 Chromium 流程运行完整 20 模拟秒后失败：树处于 flee/moving，动作与逻辑时间推进，但身体始终停在 `[-8,57,0.5]`。原始观察、错误上下文与 1/6/20 秒帧保留在忽略的 `harness/results/npc-composable-baseline-20260910/threat-red/`；尚未声称修复。
- `bundled-entrypoint.test.ts` 1/1 PASS：根 `build:agent` 后实际 Node 子进程连接隔离 PG、WebSocket ready（missing-gateway）、SIGTERM 退出码 0、端口已释放。没有发送模型调用。独立 Docker 读回仅保留原已停止的用户 PG，原 checkout 再次确认无改动。
- 全 lint 当前只发现超出 500 有效行的职责聚合文件，按模块拆分，不增加豁免、不压缩格式掩盖规模。首次 Web build 在并行 helper 拆分中间态失败，待稳定重跑，不视为产品构建通过。
- main 的跨宿主 E2E 因递归行为状态类型触发 Playwright 条件类型深度上限；只在已校验 checkpoint 的测试传输边界显式使用 unknown 再转回原 schema，保留完整数据与所有原断言。涉及 browser-world-parity、alternative-playbooks、developer-logic-origin 三文件。
- 新生活夹具清空玩家觅食观察范围上方的叶片来源，避免玩法线新增可再生食物机制偷偷补给；三角色测试增加 world-item ID 不得新增断言，仍只提供初始 256 份世界食物及 8 份玩家食物。
- 长期 docs baseline 已开始更新：新增 NPC 层级/能力/存档说明，维护代码地图、目录规范、README、Harness 与 CI 测试边界；这是本次新增公开合同，不是验证完成声明。

### 2026-09-10 S2/S3 约21:00

- 首次稳定 `pnpm build` PASS：Web 的 Pack、Rust fingerprint、SSG、Svelte/TS 及 Vite 构建通过，Agent bundle 通过；Agent 完整类型与测试门禁仍单列，不把 esbuild 当类型检查。
- `tests/world tests/physics tests/governance --maxWorkers=2`：40 文件、218 测试 PASS，1 文件/1 测试为显式 opt-in codec 性能测试 SKIPPED，无性能结论。
- 三认知浏览器首轮遇到其他项目占用默认4173端口，已中断而未改动对方服务；只清理本轮 `seedlands-resident-browser-76475` 临时 PG（无用户持久卷）。改用已检查空闲的47831。为防同类证据误归属，新 `e2e-server-ownership.test.ts` 先取得默认自动复用的 RED，再改为显式本地 opt-in 复用及 strictPort；CI/production 永不复用。
- 在独立47831上三认知回归取得真实功能 RED：hello→ready→socket关闭，尚未bind，UI恢复未连接；pageerrors为空。协议元数据和错误上下文保留在 `harness/results/npc-composable-baseline-20260910/resident-red/`，没有记录连接令牌。
- T08 已恢复真实持续状态并完成4块木板，无重复产出；完整三身体用例仍因其他两NPC不移动/未进食而未通过。T05定位为普通居民Logic覆盖行为角色的现有动作，按ECS controlSource接线修复中。

### 2026-09-10 S3/S4 约21:25

- 三认知真实 Browser/PG 回归 1/1 PASS（约33.6s）：单 WebSocket、三绑定和独立 journal、应用检查点导出、全新 timeline 恢复并继续。修复前的 hello→ready→closed 根因为受限 BrowserCharacterAuthority 未开放绑定角色能力查询；补齐精确 allowlist 及拒绝伪造目标负例。不是以模拟服务启动代替消费者验收。
- T05/T08 Headless 纵切已 PASS：行为所有权经 ECS controlSource 进入 Logic，现有 actionId 继续沿规划步骤推进；外部 camp-work 持续技能跨回档正确产生4块木板且不重复，另外两NPC继续生活。
- 动作终态历史迁移补齐完成顺序、同时间稳定恢复顺序、额外保留未解除链接与延迟剪枝：定向9文件42项 PASS。main V2/V3 Action迁移测试改为按实际action.id验证绑定，不依赖创建顺序；原身份与已删除目标断言保留。
- 全coverage第一轮：386文件2006项 PASS，13文件51项 FAIL，2文件4项显式 SKIPPED。多数失败为迁入的旧Agent夹具没有显式选择可选行为模块，另有真实集成缺口；该轮不是静态准出。已建立共享显式Overworld测试夹具，不改变小核心默认行为。
- 真实缺口包括容量失败遗留ECS实体、registered combat未给Character交付已提交受击事实、legacy跟随目标失联未终止。修复先由失败用例暴露，随后定向8/8 PASS；全套仍待代码稳定后复验。V4计数器负例转到canonical ECS组件及其incarnation allocator，不恢复平行Character存档owner。
- 约21:17 Web生产构建 PASS；从固定dist启动独立47832 preview，生产Worker/Pack加载、伙伴进食、检查点恢复、真实W输入与T05威胁折返2项 PASS。三NPC完整运行1800模拟秒、有限资源无注入、存活/进食，但夜间往返计数1<2，T04仍FAIL，原始轨迹在忽略的 `harness/results/npc-composable-baseline-20260910/production-first/`，继续分析不降门槛。
- 模型provider只读catalog真实返回 `deepseek-flash`、`deepseek-v4-pro`；当前MIDSCENE配置名 `deepseek-v4-flash-vision-exp` 不在该catalog。本轮网关临时映射到返回的Flash/Pro名称，复用已批准MIDSCENE key/base环境对；不改.env、不持久化凭据、不回退到其他tier。固定网关镜像重建成功，真实三角色旅程显式上限18 Flash、0 Pro，尚未取得结果。

### 2026-09-10 约21:39 三角色集成继续

- 原main再次fetch/readback仍为冻结的 `6c7124a`。旧PR #26/#29/#31保持原状，未推送、未创建新PR。
- Agent完整测试24文件104项 PASS，含真实隔离PG路径；root负责的8个旧NPC夹具及main Action迁移合计9文件43项 PASS、owned lint PASS。测试容器独立读回已清理，原用户PG仍停止。
- 固定生产dist的独立扩展Pack浏览器和渲染主线程阻塞用例2/2 PASS（约31.2s）。截图可见同世界三个身体、三个伙伴tab及真实加工后4件行囊；这只证明对应层级，不替代真实模型任务。
- T04原始轨迹交叉复盘：三角色补给循环15/15/14，巡逻到达69/55/34，事件连续且没有gap；1800模拟秒覆盖72世界小时。三角色均有两次night-action成功及随后白昼巡逻。阿岚第二夜在距离home约1.32处持续running/resting，标准技能到家半径1.5，而旧证据/默认里程碑写1.25，导致漏计。共享 `CHARACTER_ARRIVAL_RADIUS` 统一真实技能、配方与证据，证据另要求phase为resting；仍保留每人至少两轮准出，待重跑。
- 真实三角色首轮11次Flash请求，0 Pro（包含1个未记录完成时间的取消请求）。三人均通过模型回应、不同任务目标、树revision/hash改变检查；60模拟秒身体结果仅2/3到达。已保留失败，不把三次文字承诺算需求通过。
- 第三人故障已由完整轨迹及源码证实：有效camp-move到达任务点的树安装后，两次被其他NPC的1.3m合计AABB挡住；静态体素导航反复重算同路，触发replan-limit。不是早到漏采或模型没改树。新增无模型三身体阻挡夹具；采用现有局部观察、body registry和有界导航合同修复，不关闭碰撞、不传送、不扩大重试数。重构中间态产生的缺import错误不算该导航缺陷的专属RED。
- 21:39额度工具读回失败，本阶段当前额度写NOT_AVAILABLE，不推断已用或继续重试；无兑换/购买动作。

### 2026-09-10 约22:00 定向修复与第二轮全回归

- 容量失败进一步补上完整 `freezeSaveSnapshot` 前后相等断言：曾暴露 body 虽删除、lifetimeHighWater 仍512→513的真实 RED；`validateActorRegistration` 前置后完整快照、编号、身体和角色集合均不变。动作历史10项、容量/main迁移/world历史24项定向 PASS。
- 三身体导航修复定向8项 PASS：第三人绕过两名静止角色、30模拟秒内到达，阻挡者不被推动；覆盖局部感知、不泄漏未观察身体、目标可接近、身体移走和初始轻微穿透向外逃离。原历史夹具无意将两个角色放在同一点，已分开放置，不改动作历史断言。
- 全 workspace `pnpm typecheck` PASS，Svelte 0错误0警告。全 lint 曾只剩两个行为文件超过500有效行，由同职责 helper 收口，尚未把局部通过算完整静态准出。
- 第二轮 `pnpm test:coverage`：393文件2056项 PASS、8文件9项 FAIL、2文件4项 SKIPPED，331.57s。包含仍在收口的legacy目标/死亡/威胁、出生milestone临时差异与导航改动中间态；新增main `advanceRules(-1)` 抛错仍使revision+1的真实回归，交权威推进前置校验修复。
- 并发coverage中的治理与mesh两个5s超时，随后原断言串行复验8/8 PASS（3.33s）。最终全链路将使用Vitest已支持的 `VITEST_MAX_WORKERS=1` 运行 `pnpm verify:static`，与现有CI串行范围一致；不删测试、不改阈值/超时或重试。不将测试运行耗时作为性能收益证据。
- 外部condition throw/非boolean已加入隔离负例；只读milestone增加明确failure诊断、tick故障事件仅对应角色，正在收口出生/查询原子性。UI显示与转义先RED后SSR 1/1 PASS；新增真实外部故障Pack浏览器用例，待运行。

### 2026-09-10 22:08 T04 与可观察故障通过

- 约22:01再次完整 `pnpm build` PASS（Web和Agent分别完成）。固定该dist、独立47832 preview运行两个浏览器用例，2/2 PASS（4.7分钟），退出后端口已释放。
- T04实际1800模拟秒：三人补给循环13/16/15，夜间休息→白昼恢复均2轮，巡逻到达163/112/164。256份初始世界食物、8份初始玩家食物，途中资源注入0、模型调用0、树变更0、浏览器错误0。原始轨迹和10/900/1800秒画面在 `harness/results/npc-composable-baseline-20260910/life-and-provider-second/`；这是本构建的功能证据，最终SHA复验仍待提交后执行。
- 独立负例ESM Pack通过精确host准入后抛condition异常，真实Authority Worker返回milestone.failure，界面明确显示“条件计算失败”，生活树继续patrol。重复读取角色状态相同、继续推进成功、pageerror为空；截图已实际查看，不把SSR测试当浏览器证据。
- 容量原子性、目标保留及main registered-mode再次3文件15项 PASS。snapshot revision差异的根因是准备/flush顺序与revision读取先后，不是授权忽略非法时间；已保证拒绝后的完整快照一致。
- main库存/创造12项首次因本机未安装CI指定 `chromium-1234` 而全部停在launch，未执行产品断言；未下载新运行时。改用项目默认支持的本机Chrome、同一production dist后12/12 PASS（1.5分钟），完整保留原交互/持物/容器/存档断言。CI指定Chromium身份仍待远端准出，证据在 `main-inventory-first/` 与 `main-inventory-local-chrome/`。
- fresh repeat-goal暴露深初始重叠：出生点与starter NPC中心距约0.212，现有单步脱离约束不能走出仍有轻微重叠的首个格子。已回到导航owner修复“仅沿严格减少穿透的前缀退出，退出后不再进入”，不移动测试夹具或取消物理。
- T11后续采样补齐认知等待阶段：每次等待都观察全部三角色，只计已接受新revision及新definition hash之后的到达，避免较早响应的角色已经完成任务却在等待第三人时漏采。仍要求3/3真实身体到达、改树和对白、最多18次Flash，未降低结果条件。该时序覆盖尚待下一轮真实模型验证；首轮第三人的完整轨迹已证实确属阻挡，并非本采样问题。

### 2026-09-10 约22:25 实施冻结候选

- A/B/C已完成互斥ownership并交回，没有子任务执行commit/push。最新全workspace格式、类型与lint均通过，Svelte 0错误0警告；全部core满足500有效行约束，未新增豁免。
- 深初始重叠修复9/9导航定向通过，原repeat-goal夹具未删除starter NPC，原断言恢复GREEN；路径检查整条边的临界点，不只比较端点，不允许途中加深、加深另一初始身体或退出后重入。
- B旧四组29项通过，三模拟日Headless串行158.58s、未放宽180s门限；registry/runtime/review/threat另外4文件15项通过。milestone出生/重复inspect负例、仅旧canonical生活树兼容及同名自定义guard拒绝反例均通过。
- A核心定向10文件53项、重复目标/死亡存档2项、创建/库存/extension admission14项通过，数字存在交集不汇总为不重复总数。主任务另读回ECS/camp/registry/correctness/target 5文件18项通过。
- 主线资产集成与近战体验的固定production Chrome验收3/3 PASS（28.4s）。原main run `34471130876` 读回成功：Chromium job19m41s、Static job15m32s；这些是旧SHA/远端环境的预算线索，不是本change性能对照或准出。
- 下一步：建立正常hooks本地提交并冻结base/head做一次独立语义审阅；绑定提交运行全量静态/构建、全部main浏览器清单及T01–T12，最后才按授权推送新PR。当前仍无PR、无最终全量准出。

### 2026-09-10 约22:56 冻结提交验收及审阅修正

- 正常hooks提交 `de329a95299ea79f725e158f57139210a6dcd0b0`，原本地main和冻结工作树均读回干净。该SHA的 `VITEST_MAX_WORKERS=1 pnpm verify:static` 完整PASS：402文件、2068测试通过，2文件/4测试既有跳过，世界行覆盖率96.96%；coverage总721.07s，原180s三昼夜用例通过。随后 `pnpm build` Web/Agent分别PASS。
- 同SHA本机Chrome：main regression 20/21 PASS；Harness 2/2、资产2/2、近战1/1、库存/创造视觉12/12 PASS；composable 12/14 PASS。原始日志为 `frozen-static-first.log`、`frozen-build-first.log`、`frozen-main-regression.log`、`frozen-main-remaining.log`，对应目录保留失败trace。未启用测试重试，未放宽超时；本机Chrome不等价于远端CI Chromium身份。
- 三项Browser RED分别处理：开发者Logic的Worker接线将原本无Actor绑定的developer policy错误改为player-bound，修复应复用装配时同一developer policy，不能放宽originalActor检查；创造目录测试在异步close尚未完成时连续发Digit2/E，修复应等待菜单真实隐藏，保留槽位/飞行/恢复断言；木剑旅程首击后生物按base/head相同规则逃跑，测试未追赶，继续核对真实攻击距离与回执，不通过取消逃跑或增加点击预算掩盖问题。
- 独立Sol/xhigh审阅绑定上述base/head进行中。P1-1：能力缺少依赖operation的声明，Actor目录未按host grant/Actor权限过滤；P1-2：registry按kind+id而wire按id去重导致合法组合在连接时失败。修正合同为必填有界requiredOperations（self/any scope）、host装配校验、Actor目录/安装/执行同源准入、标准combat也经provider operation；capability id全局唯一且装配时拒绝跨kind重复。实施在另一个隔离修复worktree，保持当前验收树无混入修改。
- P1-3：portable记忆仅验证journal序号唯一与最大值，未拒绝中间消息缺失/窗口历史分叉。修复前新增实际PostgreSQL RED，要求坏档在目标namespace预留前拒绝、合法多窗口往返及后续追加保持连续；不对允许lostRange的世界事件强加journal规则。
- 上述缺口尚未修复或复验完毕，不标Delivered、不推送PR。下一提交需复核delta并重跑受影响与最终全量门禁。

### 2026-09-10 约23:08 首批审阅修正

- Worker developer policy复用装配时同一未绑定Actor的开发者身份，普通Browser owner仍player-bound；不改originalActor校验。木剑旧轨迹敌我水平3.48m超过权威3m，HUD有超距反馈，不能推断七次拒绝各有独立回执。测试增加真实KeyW追随、按当前权威距离≤2.5m才点击，仍8次尝试/90s/击败-拾取-存档全部原断言。首版helper的浏览器async轮询提前返回另有RED，已改显式等待/读取，失败trace保留。
- 木剑、developer启用/禁用和创造模式两项同组复验5/5 PASS（30.4s），`review-world-fixes-final/`；木剑另定向1/1 PASS（15.0s），`review-world-fixes-wood-2/`。Web类型0错误0警告；拥有文件的格式、lint和diff检查通过。这是当前修正工作树证据，待新SHA统一冻结。
- portable连续性先真实PG RED（损坏档被接受），后补完整journal序号、window区间覆盖、从初始到当前的revision链与MEMORY对应。删除Human/AI/Tool消息、分叉window、缺初始window的坏档均在预留namespace前拒绝；合法两窗口往返并追加至seq6/next7。workspace-review/batch-import/persistent 3文件14项PASS，`portable-continuity-{red,green}.log`；Agent和test TypeScript通过。未改变世界事件lostRange合同。
- P2旧v1宿主仍可通过private workspace wildcard子路径访问：README改为如实说明，旧回归不代表resident v2准出；本切片不额外归档历史或收紧所有exports。
- 独立审阅继续发现应用world/cognition仅各自校验hash，缺整体配对及内外source身份检查；resident调度恢复对未知wrapper静默默认、坏深层codec可能先import后失败。两项尚未修复：需分别新增跨合法档案互换反例、恢复前codec拒绝与未决回合连续性反例；新应用格式的完整配对不等于签名或分布式原子事务，通用workspace历史metadata与resident codec须分层，不删旧记忆迎合校验。

### 2026-09-10 约23:32 第二轮协议与恢复修正

- 独立审阅已结束，精确范围base6c7124a6→de329a9：P0=0、P1=9、P2=2；270路径完成inventory，核心/认知/存档高风险链语义深读，但旧v1、表现胶水及全部测试未逐行通读。不把该报告说成新修复SHA已准出。前三项root修复及能力两项、应用配对一项之外，新增调度codec/暂停重连、模型边界、portable内容限额、Factory故障隔离缺口均进入本轮合同。
- runtime codec实际WS+PG RED：未知wrapper被接受；暂停快照重连RED：等不到logicalRounds8。现在严格校验版本、布尔、时间、去重队列/episode，导入前检查；初始化空metadata兼容PG bigint字符串。当前世界为run时显式resume。true/false两种恢复继续保留修复工具回执一次及重绑取消断言。
- 网关及单轮工具新增9个RED，后gateway/Agent/codec/host/scheduler 5文件38项PASS（`gateway-codec-green.log`）；每批先整体准入，超额9次发言、上一批7次观察后再发2次发言均无该批Authority副作用。未调用真实provider。
- 内容限额实际PG RED：重算hash的超大AGENT仍可导入。抽出普通初始化/压缩/runtime写入与portable共用codec；不存储的token估算不伪造反推。第一次GREEN组因双重非法MEMORY的错误优先级变化失败并导致后续fixture冻结，已保持原错误优先级，原断言不改。第二次3文件15项PASS（`portable-content-green-2.log`），源文档不变、坏目标未占用。
- C应用V2配对及pause失败恢复定向通过，仍核对seed身份不能比core更窄。A正在处理Factory无响应时持事务及单WS阻塞；B能力准入预计还需约45–60分钟。当前尚无最终冻结/PR，不把工作树定向结果冒充全量准出。

### 2026-09-10 约23:45 终端边界追加验证

- `ad3cfdcfab4477565bb35260cc56dfbfe7d12b24` 已正常hooks提交32文件，原本地main仍clean；最新fetch的origin/main仍6c7124a6，新分支无PR。该提交delta独立复核进行中，未把工作树后续补丁算进冻结结论。
- 追加RED：权威run !ok/throw后本地错误恢复为run；savedBlocked=true新会话永久无dispatch。现run失败保持本地/Resident暂停并给重试错误；新Channel完成journal恢复、active角色观察后清除旧session latch，下一轮仍正常检查durable预算。dead/未恢复/无模型仍block。实际WS+PG/应用6项合计2文件13项PASS，`resume-admission-{red,green}.log`。
- 追加RED：180000字节reasoning通过网关后因原始字段多份复制无法journal。首次修正遗漏BaseChatModel自动把llmOutput合并进response_metadata，150000正例仍在实际PG写入失败；现按框架最终StoredMessage编码校验512KiB-1KiB。180000和150000拒绝，120000输入产生>480000但<524288字节的实际消息，赋最终请求ID后PG append/readback完整。2文件21项PASS，`gateway-journal-{red,green,green-2}.log`完整保留，不放宽journal限额。Root owned lint与test TypeScript再次通过。
- 标准settler缺少meleeDefinition导致攻击技能固定拒绝，确认旧Agent的unarmed意图在registered combat分支未生效。批准B在标准Actor内容层显式unarmed并复验真正攻击和精确旧snapshot迁移；不越过combat operation或修改伤害规则。A Factory隔离实施进行中。

### 2026-09-10 约23:55 Factory准出及应用V2浏览器往返

- root恢复补丁正常hooks冻结 `f04fe69d2209b0d4c67d9e509236e143fb81007d`；独立审阅36路径+追加10路径：此前journal、pair、codec、paused、portable、gateway批次主体和三个终端缺口静态闭合，新delta无P0/P1。能力两项及Factory尚未包含在该审阅SHA，旧v1 wildcard仍是已披露P2。
- A Factory初版3/3 RED后，事务外模型、短事务幂等重读/预算复核、同identity共享/取消引用计数、closed latch、每个异步准入后检查与INSERT后COMMIT前取消均已落；Host最多3个独立birth，不阻塞clock/checkpoint/其他角色，dispose取消并拒绝晚回。纯mock/wire7项PASS，实际PG原组11项和新增生命周期1项PASS；后者查询pg_stat_activity/pg_locks确认挂起时无事务或advisory lock，abort后0记录、同birth重试1记录。
- 模型deadline按已有网关60/300秒合同分别设65/305秒，Factory315秒，在Browser330秒之前失败；不把Pro随意截为120秒。非2xx响应另有取消未读body的RED→GREEN，15项网关回归通过，不读取或记录provider错误正文。
- 当前工作树 `pnpm build` Web/Agent PASS（`review-integration-build.log`），Web/Svelte类型0错误0警告。该dist下真实浏览器+隔离PG V2配对往返1/1 PASS 22.0s，`app-pair-browser-working/`：版本2、pairHash存在、3workspaces、内外timeline匹配、browser errors=[]，截图已查看。它是集成工作树证据，非最终SHA准出。
- 最后完整Agent串行27文件127项PASS（44.91s，`agent-review-full.log`）；所有测试容器与47832端口清理，仅用户原PG exited容器及数据卷保留。能力分支预计10–15分钟内交回，下一步冻结合并后全量验证和真实模型。

### 2026-09-10 约23:58 能力准入集成冻结

- Factory阶段正常hooks提交 `e5a419a5bf100a6f1e8308d82fe1266079d85c4d`，11文件；独立delta复核中。随后将隔离能力分支commit `c0c1a17eb75b55e0962136cc34f3aa53b389e8ea` cherry-pick为 `596d352173239bfbf462d778792619a1f6ae7838`，32文件，无冲突。host-validation自动合并后已确认新的requiredOperations与root的调度codec/shared history限额同时保留。
- B requiredOperations成为public/wire必填合同，装配校验冻结operation+grant，全局capability ID唯一；目录/安装/出生/执行/恢复使用同源Actor准入，运行时撤权重新拒绝。出生/更新/恢复的坏权限用完整snapshot不变证明原子性。标准攻击走registered combat并真实扣血，settler内容显式unarmed，没有旁路伤害。
- B精确main6c V4及旧Character V1/V2迁移7/7；admission/registry/runtime/wire28/28、control/correctness14/14、threat/review10/10、action-history10/10、client/public-pack6/6、camp/product/wire20/20。分组有交集，不相加为唯一测试总数。子工作树已clean，未push；实际依赖产物仍需root build重建，不能沿用旧Pack摘要。
- 生产写入ownership已全部归还。补公开合同与code-map后冻结全量准出；下一阶段单一生产代码SHA运行verify:static/build、main全部浏览器、NPC确定性与真实模型，再据结果创建main PR。

### 2026-09-11 约00:20 冻结复验与插件边界复核

- `0841b9e45d7bc2294431f02c431f45422d25ce9a` 正常hooks补Factory的BEGIN完成后取消复验；确定性阻塞BEGIN→close→release只执行BEGIN/ROLLBACK，无advisory lock、INSERT或残留事务。root正确路径的main组合检查点与Factory定向2文件13项PASS。
- 该SHA完整 `VITEST_MAX_WORKERS=1 pnpm verify:static` 为FAIL：格式/lint/路径通过，coverage阶段403文件2101项PASS、3文件6项FAIL、2文件4项既有SKIP，763.41s；后续typecheck因串联失败未执行。`final-0841-static.log`保留原始结果。两套裁剪overworld夹具删除Combat/Needs却仍选标准behavior；无melee测试使用现在显式unarmed的settler。只修夹具的明确前提，原无fallback、无副作用、调度frontier和禁止攻击断言不变，待复验。
- 独立复核追加三项真实插件边界：required operation owner缺execute而provider有execute时目录假可用；core无限长required operation ID与wire 160上限不一致；capability version与module version不同时运行中技能无法原样恢复。前两项aux `2f83792b3207635505f192de9d7f3008cad4e173`已无冲突集成为`d9fa71d259b5f703eb963b396eaa7fc7cbe6d7d5`，23项准入/wire与31项公共Pack/迁移定向通过；恢复项仍在独立RED/GREEN实施。
- 原本地main继续clean、origin/main live fetch仍6c7124a6。集成全量测试期间未混入aux修改；当前没有新PR、不报告最终准出。下一冻结需包含剩余恢复修复与明确夹具，再重跑静态、构建、全浏览器和真实模型。

### 2026-09-11 约00:40 完整候选浏览器通过

- `3f4679e13b92bdc231e524a14c94f022f5352383` 冻结构建Web/Agent PASS，`final-3f4679-build.log`；在同SHA串行执行main全部六个脚本，21+2+2+1+12+14=52/52 PASS。`candidate-3f4679-browser-results.json`记录每段身份/时间/退出码，未重试或放宽断言。本机系统Chrome+SwiftShader，仍不冒充远端CI Chromium。
- 同SHA NPC默认8/8 PASS（6.8min），生产Worker独立1/1 PASS（16.5s）。五个默认skip分别是三真实模型、60min实时时长诊断和另行通过的production入口；不能把skip算通过。默认包含独立ESM Pack、单角色三昼夜、主线程隔离、provider故障、真实PG三角色配对恢复、威胁折返和三角色1800模拟秒。
- 三角色原始JSON读回：补给16/16/15次、夜休→白昼均2轮、巡逻到达157/202/202；初始世界食物256份，途中资源注入0、模型调用0、换树0、errors=[]。既有模型首次11 Flash/0 Pro的失败记录仍保留，真实模型尚未复跑。
- 人工查看camp截图发现运行中图先于UI发布，仅Authority sample已是新技能，不能声称图已证明该状态。补DOM等待新revision、sample:prepare-planks/preparing与三个伙伴按钮，不改生产或固定sleep。工作树production定向1/1 PASS（17.8s，`camp-ui-ready.log`），新截图实际可见版本2、preparing与阿岚/青禾/小满三入口；原真实产物与回档不复制断言保留。
- 外部独立版本恢复正常提交`8bfbf31`，完整拒绝后快照相等补证`a84684d`；三处明确夹具调整`3f4679e`保留全部拒绝/无副作用/frontier断言。完整Agent/type与最终全static仍待最新code准出。
- 能力descriptor共享codec aux `92c7fdc505a55bd9a51890806074e40bae7852eb`无冲突集成为`6c216781a5f8f76dbaf1cc7ed1c15c44cc4b048c`。独立复核字段语义分叉已闭合；仍补最终catalog总UTF-8限额及128KiB Resident帧负载证明，不扩大为chunking协议，不宣称各独立字段最大值任意组合均可连接。

### 2026-09-11 约01:00 最后协议边界修正

- 共享descriptor后的完整真实PG Agent suite留下原始RED：`shared-codec-agent-suite.log`中130项通过、同身份并发出生1项失败，模型调用2次而非1次。根因是数据库预检在进程内去重位安装前让出执行，另一个请求可跨过首次完成和去重清理。`5a55709284a27c1c407c8e95292749f0a2a06ead`将共享执行位同步安装于首次DB等待前；确定性延迟第二次pool COUNT复现，原真实PG测试未放宽。`factory-lease-agent-suite.log`完整28文件132项PASS；只保证同进程去重，不宣称分布式模型恰好一次。
- 聚合catalog修复aux `2c9165a958c82dbaa2ea62056ce419c026a93a43`已无冲突集成为`fdac5ec`。core冻结发布和Agent wire共用32KiB UTF-8总量门禁；真实registry exact-limit通过，+1 byte拒绝。实际Resident v2帧实测分别为满目录hello33,917B、Overworld+camp目录与最大预期中文观察无出生bind87,701B、默认出生+初始观察bind12,360B，均小于128KiB；不保证满birth/history/catalog任意组合。
- 定向6文件34项、core/Agent/test类型和格式lint由实施者通过，最终完整static/build/browser/真实模型仍待冻结重跑。长线文档同步了目录总量、纯字节helper归属和Factory去重边界。独立原main仍未修改，无PR、无自动合并。

### 2026-09-11 约01:14 完整覆盖率新反例与夹具修正

- 冻结`79cb53a7d46a20360520b354627da21a8c800a13`的完整静态在coverage失败：409文件2117项PASS，1文件1项FAIL，2文件4项既有skip；753.44s，日志`final-catalog-static.log`。format/lint/paths通过，后置typecheck尚未执行，不称完整静态通过。
- 唯一失败为`secondary-actor-permissions`的pickup/module：夹具去掉inventory operation owner的execute，却保留依赖该操作的标准行为provider，freeze正确拒绝，未到原执行层权限断言。夹具明确不装配无关behavior模块；不补权限、不改生产，全部7项执行拒绝/完整快照/实体引用/延迟撤权断言保留。该suite与行为准入负例定向2文件14项PASS（`secondary-grant-fixture-green.log`）；需新SHA重新完整准出。
- Sol/xhigh最终只读审阅绑定main `6c7124a`→`79cb53a`，295路径风险归类，高风险链逐行覆盖；累计唯一11项P1均闭合，0开放P0/P1。Factory的后续重开归原项、descriptor字段与总量归同一项，不重复计数。保留1项P2：私有Agent包通配exports仍可显式访问旧v1子路径，当前v2入口不受影响，留给独立归档清理。未逐行覆盖锁文件、社区元数据、纯样式、历史文档、生成fixture及部分低风险E2E；源码review不替代当前运行证据。

### 2026-09-11 约01:40 真实模型结果与日程窗口反例

- `14ae71f79eb14422e43179d790293d556bd94b6d`生产Web/Agent构建PASS。真实批次`final-14ae71-real`三角色FAIL（5.8min，14个Flash请求，13个有完成标记），另两项Flash/Pro PASS（3.5min，2Flash+3Pro）。三角色均rev2、不同目标/对白、errors=[]，到达为[true,true,false]，原始轨迹和失败上下文保留，不算T11通过。
- npc-9在事件323.7才接受新树，首个rev2样本world22.48、night/resting、无camp动作；额外60秒结束world0.884，仍未获得白昼任务执行机会。首个模型请求记录约32.6k reasoning字符而无content/tool calls，疑似输出预算耗尽（无finish_reason，仅推断）；后续先发言、再由新轮成功改树，无schema/权限拒绝证据。不把窗口修正描述为模型时延已解决。
- aux无模型实际树重放`be80a46`已集成为`63e13ee`：晚间60秒仅休息、正常推进到06:00后60秒内真实camp-move与camp-wait成功；定向1项PASS（20.87s），类型/lint/format通过。没有调用模型、途中资源注入或重新改树。此夹具只证明日程窗口因果，不复制整段真实三角色历史。
- Sol/xhigh独立复核同意T11给予连续完整白昼60秒，最多660模拟秒，保留420s墙钟和18Flash；要求pause/paused、前后时刻边界、跨夜清零、调用数不增加与原到达/存活/hash/cursor断言。新增每角色截图切换到对应伙伴并收起设置，避免设置面板遮住已验收内容。待冻结后只重跑三角色，不重复已通过Flash/Pro。
- Flash/Pro实际读回：树rev2，断线后tick989→1122且运行patrol；记忆window-1→window-2、MEMORY revision2；两个真实出生场景均重复激活返回同实体。当前累计已发起27Flash/3Pro逻辑请求，网关自身重试次数与计费token未知，不能视为provider计费请求数。专用网关和测试PG均已清理，保留用户原数据库。

### 2026-09-11 约01:58 恢复集成用例预算修正

- `61b00484dfc7dcbf1099aa5b18222439ec21bc71`完整coverage保留唯一RED：external-provider-restore触及Vitest默认5000ms（实际报告5101ms）；410文件2118项PASS，1项FAIL，2文件4项既有skip，787.38s。此前权限夹具与本次night replay已通过。该串行批次在static失败后停止，后续build/browser/真实模型均未执行，不冒充全量准出。
- 此用例包含一次Headless初始化、4个坏档与1个合法档各自完整候选Authority构建/验证，以及多次完整快照导出；不是轻量codec检查。仅为此新增集成用例显式设置30s硬上限，与已有Character runtime/review/threat回归一致；不改任何拒绝、完整快照、start/continue断言，不改全局/CI/E2E/模型超时，不加重试。
- Sol/xhigh只读复核同意；若30s仍在串行coverage超时，不继续扩时，重新定位挂起或隔离问题。定向正常Vitest 1项PASS（test2.88s，总4.12s，`provider-restore-budget-green.log`）；这不是coverage证据，完整静态仍待新SHA。生产源码未变化。

### 2026-09-11 约02:33 冻结证据与调度竞态

- `4407d5242b7094e98478006116879965a18b6dae` Web/Agent build PASS，main浏览器52/52、生产冒烟1/1 PASS；NPC默认6/8 PASS、2 FAIL、5 SKIP（3真实模型、1实际60min长跑、1另跑production）。两失败在首个确定性advance，原测试丢失error详情；continuous已读回paused=true。`dd1f767`仅补pause/advance完整回执，原生产时钟定向2/2 PASS（2.0min），未复现，不能据此关闭原失败。
- 独立确认一个可执行时序缺口：advance已入Harness队列但尚未active时，旧DirectLogic回执排到advance后；新观察又被旧in-flight阻挡，形成队列循环等待。新增P1进入受控顺序RED与Browser owner-only修复；不增加5s响应超时、不放宽身份或权限、不全局绕过restore/checkpoint队列。原两次失败因缺error不能追认必为此因。
- 同`4407d52`真实三角色1项PASS（2.5min），11Flash全部有完成标记、0Pro，3/3以真实身体到达，连续60完整白昼、断线后无新模型调用、errors=[]。累计38Flash/3Pro逻辑请求；两个早期Flash无完成标记，provider重试/计费请求、token和费用unknown。专用网关已清理。三张角色截图目标/身体一致，生命占位符来自选择后UI观察尚未刷新，582个实际观察health均20，不将截图占位符当生命值。
- 真实生成树有明确质量限制：npc-8巡逻path-budget-exhausted后进入无guard永久hold；饥饿monitor正常通知但按公开合同不抢占RUNNING。T11有界任务PASS不证明该生成树长期健康；不因作者遗漏guard就修改解释器语义或禁用合法驻守。默认T04三角色1800秒独立PASS：补给16/16/15、夜休转白昼各2轮、巡逻179/152/238，初始食物256、注入/模型/换树均0、errors=[]。
- camp独立ESM Pack的真实加工、运行中回档与4木板不重复由通过的浏览器断言证明；截图只佐证preparing→patrol和库存显示。应用V2实际PG源/恢复各3binding，3workspace与Actor身份配对、worldHash/cognitionHash/pairHash重算一致；恢复截图不代替数据库行数或摘要证据。
- `4407d52`完整static FAIL：410文件2118项PASS、1项FAIL、2文件4项既有SKIP，818.55s；format/lint/paths通过，后置typecheck未运行。唯一失败为新三昼夜test在186.632s触及180s。保留日志`final-4407d52-static.log`；宿主背景负载仅为观察，未证实因果、不停止无关进程。
- 独立复核确认180s不是spec性能门槛；360次5秒Authority推进与完整事件排空保留。仅此test设240s防挂起预算（失败耗时×120%约224s后取整），不改1800模拟秒、采样、断言、coverage、CI超时或retry；若240s仍超时不继续扩大。先同口径定向coverage，再完整static，尚未准出。

### 2026-09-11 约02:39 队列环修正与带覆盖率定向证据

- aux `999a5aa74cb77ab84faec0a535a5ad73cc45f585`无冲突集成为`798871d1a53159c665565480b4a4274d2e835043`。受控Promise-tail RED中9项有3项失败，分别是推进内新观察未发出、close后旧回执执行、rebind后旧新回执都执行；GREEN9/9。原identity/grant/freshness检查保留，非advance不提升，旧拒绝回执也释放link，后续排队callback无重复副作用。
- 独立Sol/xhigh精确复核该delta无新P0/P1，追加队列环P1静态闭合；同epoch/非法epoch重绑提前取消合法回执的P2正在最小补证。publish实际在slice尾部稳定点，可位于advancePausedSession内部；旧回执仍按当前tick/候选校验，不要求新增slice前hook，不宣称性能优化。
- `4e53826124e03f327fe69a09d7188a1bb3488bc0`仅world-behavior-a的同口径coverage运行：1文件7项全部PASS，测试体195.31s、总196.52s，未触及240s；日志`three-day-coverage-4e53826.log`。只选该文件使全局world行覆盖率58.42%低于原80%，因此命令退出1；没有关闭或降低阈值，不把定向断言通过说成完整coverage准出。最终全static待下一冻结SHA。

### 2026-09-11 约03:27 完整静态通过与独立欠账反例

- 冻结`5f6e01c999cf33028580000f8352e57ea31bb506`完整static PASS：411文件2126项PASS，2文件4项既有SKIP，coverage 789.54s，world行覆盖率96.96%；格式、lint、路径、各层TypeScript与Svelte均通过。Web/Agent build PASS；main六组52/52、生产NPC 1/1 PASS。日志前缀`final-5f6e01c`。NPC默认6PASS/2FAIL/5SKIP，串联真实模型未执行，不宣称全量准出。
- 同epoch/非法empty重绑的队列取消P2经12项受控测试2FAIL→12PASS，aux `63dc144`集成为`5f6e01c`；原始RED/GREEN日志已复制到本worktree并核对SHA256。独立delta审阅无新P0/P1/P2，旧v1 wildcard可达限制仍保留。
- 本次threat失败有明确新证据：observation19在physicsTick88被Authority拒绝，不再是循环等待超时；三角色首advance同样失败，初始activeTime约1.3182s而tick54仅结算900ms，留下约418ms欠账。`940bcc3`只补完整回执的诊断重跑2PASS不能关闭原失败；`23d9101`补观察tick/当前tick/expiry的错误上下文，未改接受语义。
- 真实AuthorityRuntime + DirectLogic owner + Promise-tail队列的受控RED稳定复现：seq1 observedTick4/expiry16/receiveTick20拒绝，seq2 observedTick20/expiry32/receiveTick36仍拒绝；5项中4PASS/1FAIL，105ms。原始日志`authority-worker-debt-red.log`留存，非浏览器偶然失败推断。独立审阅确认这是队列提升之后的另一项Browser freshness P1；正在实现先结算欠账、再逐100ms exact-await，原TTL、权限、epoch和回执候选检查不变。

### 2026-09-11 约03:42 欠账修复的真实浏览器闭环

- aux真实Runtime RED `ad55c6a`及修复`4b3e59e`无冲突集成为`ed518bf`、`0b6d5f8079354a52d12ba08b39c4e1a6f53b6657`。单文件8/8 PASS，Web/test类型和两文件lint/format通过；先结算全部到期lanes，随后逐100ms exact-await，旧回执仍因TTL拒绝，新回执期限内接受。
- exact post抛错时清pending引用和timer、抛原错误，不再拒绝无人等待的局部Promise；accept抛错仍由接收路径保留根因/fatal，clock以既有5秒超时结束，不宣称clock直接返回accept根错误。非法elapsed在副作用前拒绝。
- 同SHA重点Browser `debt-0b6d5f8`三项全部PASS（单NPC三昼夜、threat脱险觅食、三NPC有限食物1800模拟秒），03:36–03:41:51，命令退出0，无重试或改断言。此前`5f6e01c`两个FAIL保留；此轮关闭其运行时缺口，不替代下一冻结全量static/build/main/NPC/production/真实模型。
- Sol/xhigh独立delta审阅无新增P0/P1，新freshness P1静态闭合，累计唯一13项P1闭合。P2的60000ms常量复用，以及prelude自发观察无等待/三lane与commits精确聚合的低成本测试补强正在aux收尾；原真实Runtime反例不改。RED/GREEN原始日志复制到本worktree，SHA256分别`c3873d10d9bfe385f936b010219f69d877ec4d31fa23ce5e28cc2257e77263ac`、`1ff84178d4bbc2bf140e9123ddaf28d6c827d4ea58417ed45151bf33c476635d`。

### 2026-09-11 约04:22 最终机制准出与真实模型新增边界

- 冻结`cb6f1866755bd66437c2b46cd64be40dfc2a8319`完整static PASS：411文件2131项PASS、2文件4项既有SKIP，coverage 784.27s，world行96.96%，全类型/Svelte通过；Web/Agent build PASS。main六组52/52、NPC默认8/8（另5SKIP）、生产NPC 1/1 PASS。`final-cb6f186-browser-results.json`逐组绑定同SHA；NPC保留trace，7.2min，无重试。
- 当前三角色原始181组样本：补给16/16/14、夜休恢复均2轮、巡逻207/175/210；末态均active、health20、tree revision1，初始食物256、资源追加/模型/换树均0。独立Pack运行中1木材→4木板，原世界和RUNNING恢复后再推进仍4，另两角色继续消费。应用V2含3workspace、world/cognition/pair三hash重算一致，源/恢复timeline真实PG bindings各3由同次直接DB断言证明；截图不代替数据库或幂等断言。
- 当前trace的console 404均定位到`/favicon.ico`；main原HTML未声明icon且base公共资源无favicon，本change未改该入口。不是NPC/Pack资源失败，不声称全console为空；旧focused两条无URL的记录仍不可追认。`final-cb6f186-npc-network-errors.jsonl`保留当前来源。
- 真实批次`final-cb6f186-real`：三人格任务FAIL，断线计数13→14；Flash行为调整/Pro压缩及其出生流程PASS；独立Pro出生FAIL，文档校验拒绝。三角色第14次是npc9同一turn的工具回执续步，开始于上一响应结束99ms后且未完成；当前记录没有click/server close时间，不能证明已在真正关闭之后。测试原计数在click前，UI disconnected也不等远端关闭。
- 独立检查发现另外的真实取消缺口：retirement延后dispose，channel/agent的数据库preflight与manifest等待后缺少取消复验，已abort信号仍可进入fetch wrapper。已授权受控RED/GREEN和局部修复；模型请求计数不等于provider实际收到请求，第14次可能在已取消signal下进入wrapper。Pro出生的具体非法字段未被旧产物记录，另查schema与UTF-8文档合同，不放宽校验或盲重跑。
- 本批新增17Flash（15有完成标记）/4Pro逻辑请求，累计55Flash/7Pro；Pro响应有usage元数据但整轮Flash/token/重试计费仍不完整，不伪造总成本。网关容器`915b0381bd327a47dbd156c7463b4868ae1dc29cacb3582cef64f4459c0d7e7e`已删除，原PG保留。全部运行已结束，当前无新PR。

### 2026-09-11 约04:46 取消边界与出生合同收口

- `ac44439`引入同源出生codec：agent/soul provider上限1024码点，运行时仍为4096 UTF-8 bytes，四必填文档拒绝纯空白。新增诊断仅记录字段类型、字节数和是否非空白，不记录出生正文。旧Pro拒绝具体字段仍未知，不用schema缺口追认旧失败原因。独立复核发现Host只校验canonical重建包会漏原始顶层extra，`4fc479c`恢复原始64KiB与精确顶层keys；Factory原始输出同样须拒绝extra，后续补证中。
- aux `6912771`集成为`e844a78`：retirement同步dispose，Channel/Agent在preflight/manifest await后、实际模型dispatch前复验取消，pre-aborted gateway零fetch。组合保留已有整批8工具/3提案预算与出生取消，不退回旧逐工具计数；三处文本冲突按双方owner语义合并。集成定向取消/gateway 21项、Agent整批预算11项PASS；aux真实PG host/rebind 6项PASS。
- `43fd4fd`把T11断开验收绑定精确Browser WebSocket和同一已认证world/epoch的server connection；记录click、transport close、server close、retirement计数与时刻，过渡调用计入原18次总预算。retired仅保证该连接queued inbound与channel shutdown收敛，不承诺共享Factory/provider已完成；此三角色用例无Pro/birth请求。
- aux `0865531`集成为`0f1de68`：真实WS消息先入队、close后释放前序读取，旧实现仍启动import 1次；入口guard后0次。真实PG portable校验中close，旧实现校验完成后写入目标；commit前closed复验后不启动batch且目标为空。两文件8项GREEN，RED/GREEN JSON保留。已进入atomic batch的操作允许在retired前成功/回滚收敛，不声称取消已提交事务。
- 独立复核又指出普通invoke成功后的终态durable receipt/watermark之间不应被abort截断；正补终态尾部阻塞/断连反例。当前仅为修复阶段，未运行新的真实模型，也未发布PR；`cb6f186`全量绿色不冒充当前源码准出。

### 2026-09-11 约04:55 最终尾部反例完成

- `4831170`完成出生raw/stored分形态校验：模型输出精确6字段，存储包精确7字段且birthId一致；非法模型extra在PG连接前拒绝。定向18项PASS，独立复核确认原始包限额与字段P1闭合。组合5文件48项PASS，test类型/相关lint通过。
- aux `291f9ac`集成为`b086bb5`，4个确定性RED全部GREEN：input journal提交后取消能记录failed receipt；真实socket在completed receipt提交后关闭，release前retired尚未发生，release后included watermark一致；markIncluded已提交不再抛AbortError；freeze已提交则执行既有失败收尾。相关20项PASS，原始4FAIL与GREEN JSON已复制留存。
- 整批工具admission、每次实际模型/工具handler边界的取消检查保留；仅把已落盘输入之后的准备纳入失败收尾，并保证成功轮次终态完整。发布后的压缩仍按published标记记录成功，不以取消声称撤销。最后组合回归与独立delta复核后冻结全量。
- `b086bb5`最终组合7文件53项PASS（包含真实PG迟到导入），test TypeScript与相关lint通过。Sol/xhigh复核确认上述birth/queued-import/cancellation/durable-tail P1均闭合，无新P0/P1；原有私有v1通配入口P2与真实模型作者质量限制继续披露。进入同SHA全量重验，不追加功能。

| 阶段 | 状态    | 本change证据                               |
| ---- | ------- | ------------------------------------------ |
| S0   | DONE    | 独立分支、spec和初版估算                   |
| S1   | DONE    | 公共能力/可选模块与单一 ECS owner 纵切通过 |
| S2   | DONE    | 存档及Agent旧行为定向回归收口              |
| S3   | DONE    | 三身体/三认知/扩展Pack纵切通过             |
| S4   | RUNNING | 首轮全coverage与真实模型已运行，仍有缺口   |
| S5   | NOT_RUN | 尚未推送或创建PR                           |
