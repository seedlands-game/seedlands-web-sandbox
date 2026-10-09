# PR41 当前源码 CI 与可玩性修复

## CI browser job resource budget checkpoint57（本地闭合，继续V2修复）

15:52附近开始，实际25分钟RED后45分钟GREEN，现有工程选择器15/15；初版正则ESLint空格失败保留并等价修正，最终完整verify:static:ci实际EXIT0。仅job资源上限与失败后只读附件改变，各测试时限/断言、retry/flaky策略、生产artifact和部署边界保持。Browser55/56原始FAIL不被改写，PR仍不可合入。详见evidence/ci-browser-budget-checkpoint-57-01.md；随后正常feature提交推送及精确新SHA CI。传统/AI预算与15:45真实UI请求保持，不购买或扩大每周额度。

实际CI54 run37949472227/job113884710636的首轮主旅程15.3分钟FAIL，原一次诊断重试于15:34:55被job取消；五项其他CI SUCCESS、部署SKIP。首轮V2耗时行不能计完整PASS，取消使原runner最终错误/报告不完整。源码明确主旅程900秒、visual240秒、CI retries1且failOnFlakyTests=true；Classic配置下Modular互斥跳过。原job25分钟小于主旅程与视觉两次的38分钟最大预算，尚未计setup/upload/cleanup。

冻结最小工程修复：仅将Chromium job资源上限25→45分钟，覆盖38分钟runner加7分钟setup/附件/上传裕量；原900/240/90秒及动作/poll、一次retry与flaky拒绝不变，生产build仍只一次且Chromium只校验/消费既有artifact。正常失败仍失败，取消/skip仍不合入。先确定性读取实际workflow/config/spec，断言job预算至少覆盖既有完整runner及5分钟裕量，取得25分钟RED，再45分钟GREEN；同一检查保留唯一runner/原重试和flaky拒绝。新工程合同纳入现有test:ci-selection，不增Playwright旁路线、不将job时长当性能阈值。

先等Browser56实际终态以保持artifact/source冻结；然后必要静态/工程合同、自然hook、核对最新远端后正常feature commit/push。workflow的部署trigger/权限/目标不变，只有此前授权的PR preview，禁止main/生产/merge。传统0.12PD×120%=0.144PD；AI25min×120%=30min，从实际开始时计有界checkpoint。14:09真实周剩85%，15:45再次请求实际UI；约60%停止，未知费用/工时不得折成周占比。

## Failure presentation readback checkpoint56（原完整运行失败，诊断交付）

完整静态与build实际EXIT0；原唯一runner实际EXIT1，1 FAIL/1 visual PASS/1 Modular SKIP、总14.9分钟。主旅程12.4分钟在V2铁资源准备的原45秒移动时限失败，`Real input route timed out before 78.5,-0.5`，未耗尽900秒。最后canonical/player停稳于x82.845/z-0.509、grounded且无collision，距目标4.345格。V1已返回并进入V2，但Browser55相同production bytes的门mesh失败仍保留为不稳定证据，不能由这次关闭。新failure只读revision/末256trace成功附加；仍无完整V2/C4/C5/恢复/全194、Modular产品或组合性能准出。详见evidence/browser-checkpoint-56-01.md。15:45真实周额度刷新仍待主对话。

接续3f784078与Browser55真实失败。只在原失败附件增加只读presentation readback：玩家/当前瞄准所在Chunk及六个面邻居的Authority与实际rendered revision，以及现有有界PerformanceTelemetry导出的末256事件。只在失败后读取，不加每帧扫描、不改变玩法/worker/mesh owner、不影响原断言poll、时限、retry、renderer或quality。观察用于区分目标提交丢失、authority accept拒绝、上传排队与postrender等待；不把全局队列空当门已可见，不将诊断当性能A/A/A/B或产品GREEN。

先必要格式/类型/静态核验，再新identified artifact与原唯一完整Classic runner，run ID `pr41-classic-browser56-01`，不追加旁路线。传统0.15PD×120%=0.18PD；AI30min×120%=36min，15:35附近开始、16:11附近checkpoint。14:09真实周剩85%，15:09请求仍待当前UI；60%停止线保持。CI54仍在运行，不抢推取消。

## Current artifact / original browser revalidation checkpoint55（完整运行失败，证据保留）

新build实际EXIT0，唯一原runner实际EXIT1：主旅程8.3分钟在V1木门closed mesh原5000ms期望[0,0]实际[-1,-1]；visual PASS、Modular SKIP，总9.9分钟。正式阶段附件确认C0–C3 PASS；农业/V1耗时行不是完整PASS。体素93/94和geometry正确，失败时compute269/269、running0/queued0/failed0，但generationQueue2/meshingQueue1/uploadQueue1，rendered18。当前不能证明mesh丢失或新门可见；无完整V2/C4/C5/194/恢复或性能准出。artifact/source与原始trace身份及剩余风险见evidence/browser-checkpoint-55-01.md；结果原目录移动保留，未改历史sealed证据。

source3f784078。15:10附近开始，重新构建一个identified production artifact并用原唯一Classic旅程、原900秒、原C0–C5/V1–V4/视觉断言及默认本地retry策略检验；不新增partial/side Playwright路线，不把前驱CI步骤完成当当前PASS。新run ID `pr41-classic-browser55-01`；原dist44/test-results按原目录移动到Root独立retained路径保留，不复制或删除sealed证据。新结果/trace按新run ID记录，完整本地trace用于定位CI53 C4/总时限问题；此前artifact域名403未获新授权，不绕过网络边界。此轮正确性验证不加CPU/native profiler、不作为AA/AB或性能收益证据，无CPU亲和性/质量变更。浏览器开始到结束不改apps/packages/scripts等源身份，只有独立证据/spec可写。

传统0.3PD×120%=0.36PD；AI30min×120%=36min，15:46附近必须checkpoint。Group54已提交正常push，CI54待结果；PR仍Draft/未合并/未生产部署。14:09真实周剩85%，15:09已请求当前真实UI，60%停止线保持。

## Registered surface transport motion checkpoint54（本地闭合，继续产品闭环）

14:10–15:07有界片完成：stdlib78/78、Authority37/37、最后前沿10/10及完整verify:static:ci EXIT0；实际运动、veto旁路、mounted crossing、stale、伪造与双车相对碰撞RED均保留，详见evidence/registered-motion-checkpoint-54-01.md。Classic Pack精确字节对照相同；本片没有本地build/browser/performance PASS，整体产品仍未完成。

接续2e120b62。下一有界片完成显式非Classic surface transport 的正常 accepted world-space输入→manual registered system→同一physics prepared frontier，不能把world-space moveX/moveZ直接当车辆局部throttle/steering。新增显式motion module/policy，按canonical heading投影前后与转向；现有纯motion builder提供候选，loaded provider/完整vehicle+rider扫掠与当前实体相对运动由Host派生几何端口。载具pose/velocity/component/fuel及rider新seat与所有普通body更新一次mixed series发布，沿原128×192容量、原按实体数的Kernel batch计数；系统操作veto/permission拒绝时普通实体保留原physics fallback，载具保持当前canonical pose，乘员留该pose派生seat并保持对应速度；stale拒绝时不得用先前普通physics结果覆盖已变化owner，本tick保持当前权威实体及seat、下tick重算。14:40实际moving-veto RED证明普通stepBody会按载具已有velocity自行推进（z0.570320→0.581309），因此transport普通分支必须显式保持canonical body，不以maxSpeed=0/acceleration=0误当冻结。无第二position、cargo、relation或motion时钟owner，无自动module grant；新增固定产品Host transport系统许可不得由Pack请求扩大。

14:43 additional bounded collision correction：普通角色的既有碰撞投影需包含current mounted rider身体（座位派生位置），否则车辆底座上方的角色实际扫掠可从x0穿到x6，停住transport不能撤销普通角色已计算的路径。仅派生本步collider，不新增relation/position owner；自体rider仍排除。

module只消费当前transport与派生geometry/motion观察，不复制整次普通body数据给registered操作；Host持有短生命周期本tick frame并在prepare/apply前核对world revision、entity lifetime/component/pose、输入tick/epoch与候选精确重推导。无配置世界保持原路径。surface policy明确acceleration/drag/maxSpeed/steeringRate/fuelPerMeter并有界冻结，只用于当前实例definition/provider。扫掠采用保守旋转包围体与乘员compound volume，未知阻挡并请求已有chunk；角色与载具互相的相对位移必须纳入，不以目标位置overlap冒充连续碰撞。路线运动、真实燃料/货箱交互、旧载具迁移、renderer/UI及完整Classic/Modular随后独立闭环，本片不宣称完成运输产品。

先取得正常目录/部署/use挂载/receiveInput后实际静止RED；GREEN须检查同tick载具与seat移动/速度、货箱/fuel/lifetime保持，当前输入重放/错epoch不额外控制、下车恢复walking、world/entity/unknown支持或扫掠拒绝及registered规则veto/stale不半提交。固定motion模型与owner/physics/部署/关系/死亡回归按实际影响验证；最后当前精确SHA完整浏览器/性能仍不得被单元替代。

14:10附近开始；传统1.2PD×120%=1.44PD，AI约60min×120%=72min，最迟15:22附近有界checkpoint，不盲目超时返工。14:09主对话产品UI确认真实周剩85%（含其他任务），60%停止线保持，无法将工时/credits/token换算真实周占比。一个现有精确Luna/medium独占正常Authority运动fixture文件，禁止再委派；Root独占生产/spec/其他测试与集成，协调同属PR预算。所有新输出独立run ID。

## Mesh preparation commit race checkpoint53（异步接缝已验证，尚未证明 CI 根因）

两层竞态RED与实际BrowserAuthorityClient路由RED后，12文件60/60及最后MessageEvent夹具6/6 PASS；完整verify:static:ci EXIT0。原main-snapshot反例初版FAIL与两个fixture类型失败保留并修正；worker-first一次刷新及连续提交反例通过，旧/后继trace独立。详见evidence/mesh-preparation-checkpoint-53-01.md；CI52尚未终止，不抢推取消。

接续8dceef28；CI51原浏览器失败含新门下半Chunk无门材质mesh（axes[-1,0]）和另一attempt路线跌出支撑。只读源码发现结构提交仅查询latestTask或已有repository record，漏掉已请求但queued/preparing/failed的Chunk；异步prepare期间强制后继还会沿用旧准备租约。先用真实MeshTaskScheduler的worker-first路径与World.consumeServerCommit重现：prepare持有revision1，结构提交到revision2，旧租约释放，必须重新准备并派发/接受revision2，不能丢失请求或发布revision1。fluid同样保持现有revision可见屏障和interactive-fluid优先级；完全未请求、未呈现的offscreen Chunk不被新增入队。

13:48原有main-snapshot连续流体修订反例揭示无界重新准备会饿死Worker，初版候选31项中1FAIL，保留失败。实际main-snapshot在派发时读取实时owner，保持原合并/一次准备合同；worker-first每次派发前至多重新准备一次，期间新提交保留后继至结果结算，旧结果不得被普通呈现接纳。新增119次提交压力夹具覆盖两次prepare后仍派发、旧结果零发布、最终revision121接纳；不删原反例、不降低断言。

本片仅修当前请求的新鲜度及提交路由，不增加重试次数/超时、不改assert/输入/质量/World owner、不将unit异步租约夹具声称真实Authority或浏览器根因。先RED，最小生产修复后GREEN及既有调度/流体/提交回归、完整静态；新增夹具纳入现有Classic headless选择器。原浏览器仍须同一精确生产artifact完整复验，CI52正在运行，不打断它。传统0.25PD×120%=0.3PD；AI约30min×120%=36min，13:46附近开始，最新13:10真实周剩85%（含其他任务），60%停止线不变。长期docs仅在实际职责改变时更新；全部输出独立run ID。

## Parked transport collision checkpoint52（正式静态碰撞消费者已验证）

正常目录/deploy/Survival/input实际穿透RED后，consumer1/1 GREEN，完整transport snapshot保持。Root Authority四文件24/24、stdlib八文件36/36与完整verify:static:ci EXIT0；canonical yaw检查取得部署占位/出口两个有效几何RED并统一修复。Classic Pack control/candidate字节相同3bb6fb96，无browser/性能PASS声明。详见evidence/transport-collision-checkpoint-52-01.md。13:10真实周剩85%、60%停止线保持，正式registered motion与完整产品仍未完成。

接续4a477ad8，实际运输 motion 接缝检查发现普通角色的 `stepBody` 与角色分离只查询体素，停放运输虽有显式 definition body 和 canonical pose，却不在这些碰撞候选中。先修这一正式消费者缺口，作为后续运输连续运动的必要基础：从当前 world-local ECS 投影 transport body colliders，复用既有 swept AABB 求解；普通 walking/flight/world-item、角色分离与已存在的 geometry recovery 使用同一当前载具体积，transport 自身不撞自身，mounted rider 仍从 seat 派生。已退役/已 restore 的实体不得被长期缓存；未配置或无 transport 的世界返回原 PhysicsWorld，体素 unknown blocker/流体/active chunks 保持。

当前载具体积以 definition AABB 和 canonical yaw 旋转后包围盒表达，静态 yaw0 与旧 definition body 保持；只由当前实例 definitions 解析，不猜 archetype、不添加第二 position/relation owner。连续运动尚未接线，旋转包围盒是保守体积，不声称精确旋转多边形碰撞。本组不增加 motion policy/操作、Host grants、输入字段、浏览器断言/时限、画质或 legacy vehicle 迁移。

13:27非对称实际ECS geometry fixture取得2 FAIL/1 PASS：当前physics body selector已读canonical yaw，但部署占位与出口投影仍用未旋转definition体积，导致允许占用旋转载具、两个safe出口实际重叠。修复范围包含这两个同体积消费者及route deployment候选yaw，统一使用同一body helper。layer/mask保持原值；world-item经过相同PhysicsWorld端口，但原Item mask不与Character层相撞，本组不改变此策略。fixture首次inventory=null违反原空容量数组合同，不计行为RED；改为[]后的两个几何断言FAIL为有效RED。

先实际 Authority 正常 deploy、accepted receiveInput 与 physics tick RED 穿过停放实体；GREEN 检查角色持续移动在载具体积前停止且 canonical transport/关联/payload 保持，mount 后不会自撞或偏离 seat，移除/恢复后没有旧 collider；已有 voxel unknown/角色/拾取/关系回归按影响验证。非对称 definition yaw 对照覆盖实际 body selector 与保守 AABB；不把直接 owner seed 当正式部署证明。只读候选和同一现有 physics batch 保持，最终 payload/revision/source 新鲜度仍由 owner 校验。

传统0.3PD×120%=0.36PD；AI约35min×120%=42min，13:14附近开始。13:10产品UI真实周剩85%（含其他任务），60%停止线不变。新输出独立run ID；完成本片后继续正式registered motion与两向连续实体碰撞、Classic/Modular产品和原浏览器验收，不把静态障碍物修复当运输产品完成。

## Manual system cadence checkpoint51（通用 cadence 与精确 V4 兼容已验证）

真实assembly RED后新增夹具6/6、原lifecycle8/8与Classic checkpoint两文件12/12 PASS；最后只改fixture immutable构造后的新文件3/3补验。生产/测试类型、scopedlint与完整verify:static:ci实际EXIT0。Classic entry不变假设FAIL后，从精确前驱Host与正式loader校验的真实Pack导出完整V4；候选恢复先RED零写、唯一完整前驱迁移后GREEN，默认definitionMap保持且foreign digest/definition拒绝。证据及未通过浏览器边界见evidence/manual-cadence-checkpoint-51-01.md。本组未实现运输运动，继续正式产品和原浏览器验收。

接续ecb7213f，正式运输运动接缝审查确认 `bindSystem` 必须绑定已注册system，而现有interval/every-advance都由gameplay schedule推进；不能用假长interval或lifecycle start冒充physics tick，也不能让两个时钟重复推进运输。先增加显式通用 `cadence: 'manual'`：Host可按已有system principal/resource审批调用其唯一注册operation，lifecycle advance/preview不调它，schedule snapshot仍记录该system且remainder严格0。manual无interval和时间排序依赖；scheduled/manual间before/after依赖拒绝，避免承诺不存在的时序。旧interval/every-advance定义、顺序与快照保持；Classic entry identity是否不变由精确字节核验决定。

本片只改cadence合同、注册/身份校验、调度及legacy schedule投影，不实现运输运动、不扩Host resource grants，不修改input协议、browser/性能或sealed证据。先实际assembly RED拒绝manual；GREEN验证真实registered system binding/invoke、无自动调用/预算消耗、显式权限拒绝、manual snapshot恢复/非零remainder原状态不变、坏interval/dependency/serialized identity拒绝及原调度回归。运输控制仍需后续把当前已接受world-space moveX/moveZ与原body batch在同一prepared frontier发布，不能将moveX/moveZ误作车辆局部输入或独立前后提交。传统0.15PD×120%=0.18PD，AI约30min×120%=36min，12:38附近开始；11:40真实周剩86%，12:07新读数仍待主对话，60%停止线保持。

12:42精确前驱Classic entry字节核验FAIL：control c1ef197e…与candidate 8b732487…不同，实际diff仅嵌入pack的checkpoint identity validator加入manual合同。原默认entry不变假设撤回；兼容处理扩展预注册为从精确前驱actual runtime导出的完整V4 identity，新增唯一确切前驱，不广泛匹配digest、版本或重解释字段。取得旧档真实来源和实际恢复/foreign identity拒绝后才可提交；若36分钟边界内无法完成，保留可恢复证据并继续有界诊断，不把字节失败改写为PASS。

## Mounted death settlement checkpoint50（正式死亡结算已验证；运输产品未完成）

实际Authority正常部署/use骑乘后，显式death policy的direct Vitals致死RED在prepare期被悬空rider校验拒绝；不是缺policy。共享death series现从当前owner精确id+lifetime派生解除关系replacement，与actor死亡/退役和四容器掉落同一allocator/frontier提交，原128×192上限保持。风险反例抓到手造alive replacement仍被当death候选接受，补health0/lifecycle dead门禁后拒绝零写。新Authority3/3与stdlib5/5 PASS，含注册Combat、非零运输velocity/payload/lifetime保持、存活rider、四容器drops、重放/新鲜度/容量拒绝、mounted死亡保存恢复/复活以及无policy fail-closed。根原death63/63、transport owner14/14、Classic死亡/复活/特殊伤害25/25 PASS。类型与格式完成状态见evidence/transport-death-checkpoint-50-01.md；本组无browser/性能验收声明。

接续7ff66457，实际骑乘后致死的Vitals/registered Combat/Needs现有共同death inventory settlement必须在同一prepared series清除transport rider并推进该component revision，不能先解除关系或让dead/despawned rider悬空。从同一个当前EntityStore transport component选取精确actor id+lifetime关系，保留transport pose/velocity/fuel/cargo/lifetime，只生成transports replacement；与death actor/四容器drops/despawn/其他survivors沿原单allocator/frontier和128×192上限共同预检、apply，容量/源新鲜度失败原owner全部不变，未骑乘世界原顺序/数量保持。除正式death producer之外的一般死actor/despawn仍要求显式关系settlement，不在底层EntityStore偷偷自动修复或丢弃rider。

先真实mounted player致死producer RED（缺death policy failure不算该RED）；正式非Classic policy的direct Vitals与注册Combat/Needs caller GREEN证明dead/retired关系清除、物品只掉一次、幸存者仍挂在原transport、cargo/fuel/pose/ref保持、重复/prepare后变化/capacity失败零写。mounted死亡checkpoint恢复/respawn证明关系不会重现，实际无policy仍按原fail-closed行为。传统0.45PD×120%=0.54PD；AI约55min×120%=66min，12:08附近开始。无Classic identity/legacy迁移、运输运动/UI或browser/performance修改；完成后继续正式产品与真实验收，不能由death模型夹具代替玩家玩法。11:40产品周剩86%、60%停止线保持。

## Transport registered mount/dismount checkpoint49（上下车与静态骑乘已验证；运输产品未完成）

实际正式caller RED缺state owner，接线后partition类型失败按原合同修为两个component；最终2文件20/20 PASS。实际use/alternate、四项selection、重复/堵seat、world/player占出口、自然unknown frontier、规则veto/forge、receiveInput+flight/walking/jump physics、mounted portable恢复/坏rider active restore零写已验证。风险审查抓到first player-blocked出口仍选中后拒绝，实际RED12/13；出口投影过滤真实players后可选另一个安全出口，GREEN20/20。deploy后World edit原transport:undefined不是setup错误，真实RED保留且physics/recovery已统一definition body selector。根68/68 owner/physics、48/48 dispatch、原geometry8加新增4PASS；完整static原EXIT2仅最后编辑中Classic tuple错误，其余format/paths/lint/生产types/Svelte0/0有效，最终scopedlint/stdlib与Classictypes补验、规则66/CI选择14均PASS。详见evidence/transport-relations-checkpoint-49-01.md。

接续07ed9416，只实现显式非Classic relation module的真实Authority interact entity primary上车、self secondary下车。配置moduleId/operationId，requires正式运输能力；operation只读actor与transport投影，返回关系/空间候选，Host重建并使用同一个prepared EntityStore participant发布transport rider+revision和角色位置/零速度，保持单一transform/lifetime owner。验证四项selection revision、当前目标lifetime、存活/唯一双向关系、当前距离/加载射线、seat和出口的真实body AABB及world/entity占位；unknown/blocked出口拒绝且全部owner/revision不变。只为显式注册module提供Host stateport，不自动扩张Host权限或module可写owner。

Authority从当前ECS状态派生mountedSeatConstraints；本片transport body仍静态，mounted player跳过独立walking/flight/gravity/separation/recovery的position写入，真实receiveInput+physics tick不能偏离canonical seat。恢复沿原完整preflight和transport关系校验，实际mounted portable checkpoint重开仍同实体/lifetime且seat约束生效。先缺正式API/真实caller RED，GREEN覆盖成功/重复/过期lifetime或selection/已乘/阻挡或未知出口/规则veto与候选改写零写、正常physics输入及portable恢复。传统0.8PD×120%=0.96PD；AI约90min×120%=108min，11:32附近开始；最近真实周额度10:10剩86%，10:40更新未返回，60%停止线保持。

不改变Classic pack/旧V4 identity、legacy vehicles、旧voxel0–88/Chunk bytes、浏览器断言/900秒或sealed证据。运输运动、燃料/货箱UI、Classic与Modular真实产品、mounted death结算、非空legacy迁移与浏览器仍后续片，不能由本组静态关系或模型夹具宣布完成。

## Transport registered deploy checkpoint48（正式 Authority 部署已验证；运输产品未完成）

实际正常 Authority interact 从 WORLD_PERMISSION_DENIED 的2FAIL/1PASS修到7/7 PASS；覆盖 surface/route 部署、库存同次消费、加载几何/占位与选择新鲜度、registered after-rule veto/候选改写零写、静态body推进及便携checkpoint恢复。未知definition用同一persistence写入并实际source.server.restore()拒绝，当前owner与畸形存档均保持。根授权18/18、owner/Kernel/Authority/恢复37/37，完整verify:static:ci实际exit0（冻结5、格式/路径/lint/完整types、Svelte0/0、规则66/CI选择14）；先前半编辑types失败独立保留。Classic pack同构建配置精确HEAD control overlay与candidate entry bytes SHA256同为c1ef197e7fea7248a65488494881cbf84cbda77823d09291edf596183184da18，不替代生产build/真实玩法。详见evidence/transport-deploy-checkpoint-48-01.md。

接续72462e84，将显式Pack运输定义与部署绑定接入world-local EntityStore及正式注册Actor operation；新增defineTransportInteractionModule配置moduleId/operationId/definitions/deployments/routes/surfaces。deployment绑定存储itemId和definitionId；route provider由RouteDefinitionV1和注册voxel集合表达，surface provider由namespace id、voxel集合与surfaceOffset表达。显式配置改变definition identity，不改默认未配置世界、旧Classic pack identity或legacy vehicles。本片先用非Classic Pack的真实Authority performAction(interact)做RED/GREEN，不把直接runtime facade调用算产品通过。

正式部署使用现有item-interaction registry和Actor授权；operation返回只读候选，由单一host state port重建并校验，然后库存消费和transport创建同一次prepared EntityStore发布。校验存活角色、四项selection revision、真实当前选中物、射线/距离、已加载route/surface、definition/body AABB静态及实体占位、候选/规则改写与owner新鲜度；失败inventory/entity/issued/sequence/gameplay/world保持。prepare/apply都检查当前加载几何；不将unknown视为空气，不给模块可写world/owner或新增隐式Host权限。deployment后Authority body使用显式definition AABB；运输位置仍由同一canonical transform持有，本片部署实体为受约束静态body，不承诺运动/骑乘已实现。元数据与lifetime进入accepted gameplay view。缺定义世界不创建transport child；Kernel候选restore显式使用同一运输定义，坏child原owner零写。

RED覆盖自定义surface pod与route cart的实际Authority入口；GREEN验证一次扣物品、accepted entity/reference/component、重复占位/未知surface/错物品/selection stale拒绝，规则veto/forge与prepare后变化零写。World-local非Classic ID证明模块无Classic常量。限定此片不动原浏览器断言/时限、旧voxel0–88/Chunk bytes、sealed evidence、Classic identity迁移和legacy facade；随后必须继续mounted physics、Classic producers/consumers、存档及真实浏览器验收。传统1.2PD×120%=1.44PD；AI约110min×120%=132min，11时附近开始。真实周额度最新仍10:10剩86%，更新请求未返回；60%停止线不变。

## Transport prepared entity publication checkpoint47（有界基础已验证；产品接入未完成）

在已提交5912eab1的ECS owner上增加host-only prepared transportSpawns与transport component replacements；玩家库存消费与运输创建共享同一EntityStore participant、allocator reservation与commit frontier。prepare/validate不写真实component、inventory、issued IDs、sequence或lifetime；apply前再次核对owner/epoch/allocator、目标transform/immutable component、所有rider生命周期和唯一性。更新definition不得在同一lifetime改换，component revision恰好+1；位置/速度只写canonical transform。metadata与cargo在prepare时冻结复制，未知definition/溢出货物/错revision/重放/owner已替换/重复ID/冲突target/退役引用/坏array一律零写。裸reference不带worldId；不同world数值相同的reference不能仅凭这些字段判源，后续Authority envelope/Host绑定仍须保证实例隔离，不声称本组解决此边界。默认world item/station/actor参与者及192×128 series原额度与顺序保持，不吞掉新类型或放宽500行门禁。

先做实际missing API/ignored spawn RED；真实EntityStore验证库存+spawn同次publication、invalid候选零写、取消/prepare期间状态变化与重复apply拒绝、混合world-item/station/transport allocator、多segment单一frontier及rider恢复关系。已有owner/shadow状态不作第二份canonical位置owner；future actor death/despawn不得使已接受运输rider引用悬空，候选预检必须检查该关系。此组仍不是Pack/Authority正式部署或浏览器产品PASS，legacy车辆迁移/骑乘physics/container与真实输入仍未完成。传统0.55PD×120%=0.66PD；AI约70min×120%=84min。10:10真实周剩86%、约60%停止线；不跑重复性能候选或扩大限额。

## Transport lifetime ECS owner checkpoint46（有界实施；尚未验收）

实际owner缺type/API RED后，新增货箱单槽overflow反例抓到normalizeStack并不限制待分槽count，补实体分配前stack-limit预检。最终owner+既有ECS/model3文件17/17 PASS；Web四文件24/24有效回归，加修正局部NPC profile的V4 codec文件5/5，合计29/29。完整静态首轮在Authority port旧enum处失败，原format/paths/lint/sealed5有效；修正canonical enum派生后余项完整types、Svelte0/0、规则/CI选择实际exit0。500行门禁未放宽，拆类型与纯校验职责；必要V4 regression追加既有headless/type路径。详见evidence/transport-owner-checkpoint-46-01.md；正式生产消费者、legacy迁移与浏览器验收未完成。

先落实单一transform owner：新增transport entity/type和bitECS component，由显式world-local TransportDefinitionRegistry与同一items registry校验。component只存definition/yaw/routeCursor/rider stable lifetime/fuel/cargo/revision，不重复position/velocity，也不存跨restore失效的epoch；完整TransportStateV2从当前ECS transform、velocity和当前epoch/reference投影。snapshot沿用EntityStore V2增加optional transports child，旧缺省为空；restore在candidate ECS完整创建、定义/容量/货物/唯一rider及实际actor lifetime验证全部通过后一次替换，失败保留原owner、epoch、序列、issued IDs和状态。不同world registry不混用，缺配置、缺/重复/额外child、错误生命周期、退役引用和空间/库存非法输入fail closed。

先做真实EntityStore缺type/API的RED，再所有权/移动投影/生命周期、未知定义/容量、存档原子失败、rider唯一性、旧snapshot兼容的GREEN；不把纯模型fixture当Authority产品验收。此组只建立必要owner接缝，后续正式prepared deploy、Pack/Host权限、Authority caller/view/physics/container与V4 legacy非空vehicles迁移仍需独立落实。旧Map没有ECS lifetime，不能猜reference、丢弃或假称已迁移；本组保持其原保存字节与行为。旧voxel0–88及Chunk bytes不动。固定工具检查相关types/lint/现有ECS与snapshot回归，暂不跑重复浏览器或性能实验。传统0.6PD×120%=0.72PD；AI约75min×120%=90min，09:40实际周剩87%、60%停止线保持。

## Logic terrain 派生缓存候选 checkpoint45（预注册后 A/A 失败；已撤回）

唯一组件实验于10:05:37.758–10:05:38.427 UTC完成；reservation与子进程实际exit1，status=A_A_NOISE_FAIL。四对A/A噪声分别6.229527529626598%、15.174364395031265%、32.23019034291813%、1.933799408579085%；最大32.23019034291813%超过原15%门槛，A/B NOT_RUN。完整50输入两轮deep equal通过，容量峰值2023 cells；这些正确性结果不能覆盖性能否决。未追加样本、重测或改变门槛；生产3文件、脚本/类型选择与code-map均恢复当前HEAD，新增夹具移出工作树。原候选9文件、patch、manifest、RED/GREEN、静态原失败及修复余项、raw/reservation全部保留Root独立路径。详细闭合见evidence/logic-terrain-checkpoint-45-01.md；不宣称组件收益或采用。

精确5d91421远端run37910217197终态：Architecture、Static、Deterministic modules、Classic headless、Production build五项SUCCESS，Chromium FAIL、Cloudflare SKIP。headless87文件575/575；Chromium首次在铁资源路线walkTo目标78.5,-0.5超时，retry1在V1门交互原5秒断言期望[2,2]实得[2,0]失败。远端与本地Browser34失败分别保留，不能以任何构建或旧Browser25宣布可合入；PR仍OPEN/DRAFT、mergeable=true、merged=false。

计时细节在首个样本前固定：50个synthetic pose输入，五个相邻x位置各重复10次，使用同一实际GameServer canonical Chunk；不冒充浏览器原始世界负载。每个arm/sample各warmup200次再计时200次，A/A按A1/A2、A2/A1交错，噪声为abs(A1-A2)/min(A1,A2)×100；p95为nearest-rank。Chunk边长实际32，32768-cell预算沿用原协议；早期夹具错误profile/Chunk Y和readonly resolver赋值失败均保留，不改生产常量或阈值。

Browser34精确5d91421/build33原三测试终态main FAIL、visual PASS、Modular条件SKIP，17.6min；C0–C3、作物/导航、V1完成，V2石块[90,31,2]采矿1.0/1.2秒时触及原900秒，C5未到达。精确Authority URL/asset/hash的嵌套CDP采样实际COMPLETE、无错误，UTC09:23:23.838–09:23:43.880、1701样本。采样delta20.27291秒与Node capture20.042772417秒不同，不混用。按函数身份合并后createTerrainWindow self1.922548秒、buildLogicObservation inclusive2.660231秒；prepared mutation JSON比较self0.979733秒。嵌套指标不可相加，诊断不等于性能准出。

候选只改变重复terrain occupancy构造；A为现有逐格peekLoadedVoxel，B为Authority实例内派生缓存。canonical Chunk实例提供opaque identity与revision的只读stamp，无voxel/Chunk可写对象泄漏；相同identity/revision/bounds/固定semantics才能命中，输出occupancy每次独立复制。改块、换Chunk（含同revision）、卸载、bounds改变、跨Authority实例均失效；不缓存null，保留逐格revision一致预检，缓存总cells<=MAX_LOGIC_TERRAIN_CELLS，剪除不再参与窗口。其他逻辑状态、输入频率、物理/玩法、Worker传输、renderer、画质、trace、900/45/20秒与断言保持。

先实际RED：未实现cache导出或缺少有效复用失败；GREEN负例覆盖修改、换实例、卸载/重新加载、bounds、输出buffer被修改/transfer、容量、不同owner及不一致stamp。复用现有buildLogicObservation默认A合同，新增实际GameServer/Authority builder消费者对照。实验只使用同一bundle和固定loaded Chunk/语义/actors/bounds序列，记录source/worktree、lock、bundle、corpus hash与Node身份，独占reservation运行，不与测试/构建并发。组件主指标为同等输出的完整窗口构造/复制墙钟中位数；每sample200次、warmup200次，A/A四对交错后A/B八对AB/BA平衡。A/A最大配对相对差>15%即停止、不得追加无新证据重试；B中位收益>=10%且超过A/A最大噪声、p95不回退>5%、输出逐字节相同、派生容量不超上限才组件通过。所有失败/raw保留，未达标恢复A并删除生产候选。组件通过仍不宣称FPS/whole收益；当前已接受栈为control的原完整浏览器及组合整帧A/A/A/B未完成前不得宣称采用或可合入，最多一次有界消融。

传统0.25PD×120%=0.3PD；AI约45min×120%=54min。09:40产品UI周剩仍87%，约5天17小时重置，含其他任务；60%停止线不变，费用/credits分母未知不换算。运输Task90只读计划保留Agent独立路径，不是实施或产品证据。

## 精确 Authority Worker 采样 checkpoint44（仅诊断；未选优化）

Browser33精确b17dc509/build32原完整3测试闭合：main FAIL、visual PASS、Modular条件SKIP，17.4min。C0–C3、作物与导航、V1完成；V2在铁资源准备的walkTo→waitForSnapshot触及原900秒，C4/C5未到达。末态双端位置约80.865,32.6,-0.461，落地/无碰撞，不认定永久卡住；128帧中位tick25.05ms/gap446.2ms/同步receive39.6ms，仅描述该窗口。

原生20.171419372秒采集COMPLETE、无dataLoss、126610事件、33862305bytes，UTC08:22:44.089–08:23:04.260；全部原始闭合trace/元数据/失败字节/派生保留Root browser-33独立路径。GPU SwapBuffers29次inclusive wall19158.374ms、原生tdur70633us；CrGpuMain RunTask CPU383.521ms，不能把等待说成着色器CPU或GPU执行时间。DedicatedWorker169480 TimerFire(timerId1)1460次，inclusive wall12352.965ms、tdur8728654us；该线程整体RunTask CPU9639.469ms，不能相加。源码Authority唯一8ms周期与此相符只是推断，尚未直接确认该trace线程owner。V2闭合Playwright调用中snapshot1467次约118996.569ms，PointerLock/关包click各24次约35656.342/34289.279ms；调用可能重叠，不据此采纳旧slimSnapshot或压缩旅程。

下一步只在原唯一main hook启用SEEDLANDS_CLASSIC_AUTHORITY_CPU_PROFILE=1，默认关闭、与主线程CPU/native trace互斥、benchmark拒绝。固定延迟360秒、20秒10ms V8 sampler；原runner从同次artifact receipt精确唯一assets/authority-worker-*.js及其hash派生选择器，CDP Target.getTargets只接受当前page同origin、完全匹配该pathname的唯一worker，记录实际target URL/id/context、source/run/asset/hash/UTC/elapsed。不依线程编号或timer频率猜owner，不暂停worker、改变线程/频率/品质/输入/协议或原900/45/20秒。

使用已安装Playwright官方CDP类型明确支持的Target.attachToTarget(flatten=false)、sendMessageToTarget/receivedMessageFromTarget嵌套会话及Profiler接口；不patch SDK私有connection。协议失败、目标缺失/歧义、目标退出、超时、attach/start/stop/detach错误保留为诊断FAIL，未开始timer提前取消；pending请求有界且清理，子会话与browser session均detach。所有附件diagnosticOnly=true/eligible=false，不作为整帧性能。实际missing模块RED保留，三诊断fixture26/26、scoped lint及完整verify:static:ci PASS；fresh build和原完整browser采集仍未运行。传统0.2PD×120%=0.24PD；AI约40min×120%=48min。08:55实际周剩仍87%、约60%停止；当前不可合入，未完成全194/真实Modular/组合整帧A/A/A/B。

## 有界 Chromium 原生 trace checkpoint43（仅诊断；未选优化）

Browser32 精确1b6ba70d/build31原完整3测试为main FAIL、visual PASS、Modular条件SKIP（17.2min）。C0–C3、Creative作物及导航、中性目标下地图map-1/81pixel/revision2与作物保持、V1完成；V2在followEquipmentRoute→mineResources→prepareCraftedIronArmor的keyboard.up触及原900秒，C5未到达。实际地图截图与失败字节/闭合trace保留Root独立browser-32路径，不把步骤耗时作为通过依据。

同失败128帧CPU样本中位tick22.5ms、interTick gap402.35ms、同步receive29.55ms；同窗之外1200帧p50为442.4ms，不能相减或宣称GPU归因。V2阶段独立10.010824402秒原生CPU观测显示gpu-process五工作线程合计26.58CPU秒、renderer主线程2.45秒、单DedicatedWorker5.23秒；宿主四核CPU预算保持。现有V8主线程sample和同步receive不能覆盖这些native/Worker占用，不改变线程数、CPU亲和/额度、renderer、品质或trace/输入断言来消除失败。

下一诊断只在原唯一Classic main hook启用SEEDLANDS_CLASSIC_NATIVE_TRACE=1，默认关闭，与CPU sampler互斥、benchmark模式拒绝。使用Playwright Chromium browser CDP Tracing官方类型已声明的getCategories/start/end/IO stream：先发现并记录实际categories，固定Node延迟360000ms开始、采集20000ms，实际UTC/elapsed/source/run/类别/数据丢失状态如实保留。选择toplevel/gpu/cc/viz/devtools.timeline及存在的gpu.service/debug类别；缺核心类别拒绝，不用截图类别。原生buffer16MiB、返回JSON stream64MiB上限、chunk64KiB、完成等待10秒，所有路径关闭stream与session。早期main失败取消未开始的timer；start/end/read/detach失败保留并使诊断失败，不以吞错制造通过。所有附件diagnosticOnly=true/eligible=false；raw trace区分原生任务和跨线程调度，不把重叠task相加当整帧GPU时间或FPS收益。

先做实际可执行session/timer/stream生命周期负例与GREEN，纳入原headless/type/selector路径；复用有效生产/static结果，只跑新增相关检查，然后新精确SHA build/原完整browser采集一次新证据。传统约0.2PD×120%=0.24PD；AI约40min×120%=48min。07:39真实周剩88%，含博客等共用账户用量，约60%停止。未完成全产品、C5、真实Modular与整帧A/A/A/B，当前不可合入。

## 导航正常输入与 target-first 共存 checkpoint42（诊断后有界修复）

Browser31 精确6e1a1f26/build30原完整3测试为main FAIL、visual PASS、Modular条件SKIP（8.1min）。C0–C3和Creative作物完成；已正常选中指南针/时钟/地图并显示accepted HUD，但地图第一次右键后的原5秒SVG断言FAIL，尚未运行V1/V2/C5。原始trace/results/失败字节保留独立browser-31路径。不可由step耗时宣称导航PASS。

现有输入优先voxel target，其次held self；实际crop dispatcher对非种子/非肥料所持物品执行目标收割。新增导航旅程沿用了成熟作物的瞄准方向；先用真实Authority与前端secondary helper组合取得该触发的定向反例，区分目标收割与self地图更新。若反例确认，只用既有真实Pointer Lock鼠标瞄准邻近中性Stone地面再右键，保留target-first生产行为、原map owner/HUD/map-ID/inventory断言和期限；导航后立即复核待保存作物仍stage7，不把真实目标交互改成无条件self，也不以admin更新地图。修复后定向测试/必要静态与原完整browser重新验收。传统0.15PD×120%=0.18PD；AI约25min×120%=30min，周额度读数待主对话更新、60%停止。

Browser31只读原生CPU观测：固定10秒GPU process五个Thread工作线程合计约25.12CPU秒、renderer主线程1.97CPU秒，宿主cpu.max为400000/100000（四核总预算）。第一份角色字段只是未核实的browser默认值，后独立显式--type扫描确认为gpu-process/renderer并保留原件。此为诊断而非GPU执行计时或因果/收益证据，不修改环境资源、安全策略、render质量/输入/trace，不选优化候选。

## 正式导航 producer / consumer checkpoint41（实施中；未验收）

整体复验实际结果：Classic headless 84文件552例PASS；stdlib 153文件1101例PASS、Headless CLI同一宿主navigation resource未许可导致7例FAIL；静态format/冻结5/5/paths/lint/产品types与Svelte0/0通过，Classic夹具读取可空inventory slot导致后续types失败。下一步仅补工程脚本Overworld的明确navigation读/写/执行许可（不采用Pack自请求权限、不改其他Playbook许可），显式排除null slot，再复验受影响CLI/Authority夹具、types与未运行规则/选择器；复用有效结果。

复用既有 Authority interact self，无新增动作/协议 target。新增可组合 navigation-items policy，Classic storage item ID 与 voxel→颜色配置移至 Playbook；windowRadius0..4、色值0..15保留既有 V1 child 保存接受边界，不虚构128×128需求。Classic 从 player body feet 下方一个 voxel 采样已加载表面；未知 cell 不填色、不加载、不调用 MacroMap。已有地图 center、scale、像素与map-ID序列保持；缩放索引解释不变。

导航模块声明自己的 actor resource/state/operation，纯 operation 读 observation、写 candidate；唯一 NavigationItemsRuntime 提供 prepared port，验证 actor/selection/loaded samples/map/revision/lifetime 与授权，拒绝伪造候选、额外写、旧 revision、取消/after-rule veto 和跨生命周期重放后才替换状态。指南针出生点、时钟世界时间与当前选中地图只经 Authority accepted gameplay view 进入 HUD；地图更新从真实右键 self consumer 进入正式 owner，客户端不存第二份地图。实际旧 composition 身份取自 Browser30 已结束原完整 trace 的 world.checkpoint export；新前驱仅精确V4 allowlist，缺省 navigation child 恢复空 owner，畸形 child 在原预检拒绝。

验证先覆盖 policy 与实际 registered owner/Authority caller 的定向 RED/GREEN、失败前后 snapshot/inventory不变和旧V4恢复，再必要静态/构建与原唯一完整 browser。UI成功、恢复、整帧性能及194完成只以实际结果为准；本组不修改原期限/输入断言/renderer/trace，不宣称当前可合入。传统约0.8PD×120%=0.96PD；AI含浏览器约90min×120%=108min；未知额度分母不换算，06:09实际周剩89%、60%停止。Luna仅独占policy/fixture，根集成。

## 主线程采样结果 checkpoint40（whole 已失败；未选生产优化）

Browser30 精确63f8d24c/build29，原完整runner main FAIL、visual PASS、Modular条件SKIP。C0–C3、Creative作物与V1完成；石镐制作/关闭工作台已发生，随后进入铁资源路线，原900秒终结。真实75033样本覆盖900.139563秒并含生产应用，但idle/program约56%/20%无法直接定位主要空档；同步receive、UI比较和光照样本不足以建立GPU/trace因果。只固化原始profile的有界派生与真实旧V4 composition投影，不声称性能GREEN，不恢复已否决slimSnapshot，不改输入/断言/期限/质量/trace。证据在evidence/cpu-profile-result-40-01，原始大文件保留私有Root。06:09实际周剩89%；当前仍不可合入，持续正式producer/consumer与完整玩法验收。

## 主线程 sampling 诊断 checkpoint39（确定性与静态完成；真实采样待运行）

Browser29精确6b459cbf/build28 whole1 FAIL、visual1 PASS、Modular条件1 SKIP，V1与新作物完成并进入V2，stone-pickaxe的placeOneEach→committedPointer在900秒失败。最后camera[78.47565,32.6,0.45011]、Authority[78.47565,32.6,0.45011]。同128帧gap中位439.45ms、同步receive38.7ms/17次，配对比例中位9.037%、sum(wall)/sum(gap)9.676%；仅同步receive占用，不能证明整体消息处理或GPU因果。原始trace/results/失败字节保留私有Root browser-29-results、browser-29-failure-39-01.json。

只在现有唯一Classic spec的主旅程启用可选Chromium Profiler sampling：SEEDLANDS_CLASSIC_CPU_PROFILE=1，默认关闭，采样间隔固定10000微秒。原生产artifact、输入/断言、trace、renderer、质量、线程、20/45/900秒不变；benchmark启用时拒绝采样，所有profile标diagnosticOnly/eligible=false。启动前固定runId/sourceSha，正常及失败均stop→attach原始profile→detach，启动/停止失败仍清理并保留失败，不吞掉错误。profile只覆盖当前主线程isolate，timeDeltas为相邻样本微秒间隔，不能将采样归属视为精确函数wall、Worker或GPU执行测量。先用fake原CDP port验证benchmark拒绝、命令顺序、start/stop/attach异常清理与元数据原样保留；真实采样仅由新artifact的原完整runner取得。

主spec已500有效行，只将原beforeAll/afterEach与新增诊断beforeEach按同一生命周期抽到classic-support/diagnostic-hooks.ts；原headless检查、exitPointerLock、visual/modular跳过失败采集及stage/restore引用保持，不新增runner或改选项。必要types/lint与新hook测试后构建/运行；未定位主要热点前不增加生产优化。旧slimSnapshot仍拒绝。只读Task72纠正旧Task66：Authority interact已支持self，无需新增action/协议；未来导航注册producer/accepted-view/UI仍未实现。

checkpoint38派生JSON的serverPosition:null是字段名查找缺失，不能表示Authority无位置；原失败真实字段serverPlayerPosition已核实，本组新的diagnosis记录真实字段并保留旧派生与原始字节。最新05:40实际周UI仍剩89%，60%停止；传统0.12PD×120%=0.144PD、AI含18min浏览器约35min×120%=42min，未知额度分母不换算比例。根必要静态cpu-profile-static-39-02.log PASS（冻结5/5、全格式/路径、scoped lint、完整Classic types、CI选择14），联合4文件18/18 PASS；spy类型与cause失败保留。完整V2/V3/V4/194/恢复和组合整帧AB仍未完成，无合并/生产部署。

## 相邻帧空档 receive wall 诊断 checkpoint38（确定性与静态完成；浏览器待运行）

Browser28精确5f3f679/build27 whole1 FAIL、visual1 PASS、Modular条件1 SKIP。V1已结束并进入V2，石镐制作返回工作台在900秒上限失败；末尾Pointer Lock错误发生于超时退出附近，不认定为首因。最后128样本同步tick中位21.05ms、renderEnvelope3.2ms、interTickGap434.95ms；不同窗口不能相减，GPU/Worker/trace因果仍未知。原始结果保留在私有Root browser-28-results，失败原字节browser-28-failure-38-01.json。

只在原BrowserAuthorityClient worker.onmessage外层测同步receive全调用（含早退及回调），finally计数并原样传播异常。实例注入单调now；有界累计runtimeEpoch/generation/count/totalWallMs，不按消息无限缓存。epoch切换、dispose或非法/倒退时钟使累计身份断链，重入仅计外层，副本冻结；读取不暴露写入口。frameend记累计baseline，下一frameupdate只对相同epoch/generation且有限非递减的累计差输出receiveGapWallMs/receiveGapCount，wall差不得超过该gap；首帧/缺phase/换app/reset/不可用/非法累计皆null，有效无receive才为0。不得跨断帧或epoch串样。

同步入口不包括structured clone进JS前、排队、异步后续、Worker CPU、GPU及其他task。只回答已完成同步receive的空档占用，不宣称因果或FPS收益。保持原owner、协议、selection、线程、renderer、trace、质量、45/20/900秒及唯一完整Classic runner；不用旧slimSnapshot候选。RED覆盖实际client调用者、异常不吞、重入/clock失效/epoch/dispose，frame字段正确差值及断链反例；GREEN后必要lint/types/观察和client回归，新artifact唯一browser读取证据。

05:10真实UI剩余89%、约5天21小时重置，60%停止；传统0.15PD×120%=0.18PD、AI约25min×120%=30min，未知credits/API分母不换算周比例。根receive-gap-static-38-01.log完整静态PASS，冻结5/5、Svelte0错误/警告、规则66与CI选择14；联合4文件26/26 PASS，原fixture/行数失败保留。长期docs仅记录实际观察owner。完整V2/V3/V4/194、恢复及组合整帧AB仍未完成；不合并、不部署生产。

## 门撤退双端路线 checkpoint37（确定性与静态完成；浏览器待运行）

Browser27精确32422f99/build26 whole1 FAIL、visual1 PASS、Modular条件1 SKIP。C0-C3和作物通过，V1关闭门探测后retreat readiness20秒FAIL，未进入V2；不声明V1通过。实际geometry93是x[0.8125,1]薄门，plan contact70.4925、approach69.4925。松开探测W后首snapshot camera69.49097、Authority70.49250；旧walkTo固定KeyS在camera已越过approach时直接返回，trace之后无任何S，camera追上70.4925后纯wait不可能使双方到门体素外。这是有效实际RED，不是瞄准或900秒失败。

只将V1关闭门后的retreat调用复用已有walkEquipmentRoute的双端邻域/arrival、推进tick/ACK与drift重试，保留原碰撞探测、ground/collision、门内外体素/几何/mesh、20/45/900秒及全部V1/V2断言。其他walkTo/物理/渲染器/时钟不改；不创建新runner。既有对应路线及door readiness回归为必要确定性检查，随后新build27/browser28唯一完整入口验证。

Browser27最后128样本tick中位21.25ms、renderEnvelope4.95ms、renderTail0ms、interTickGap675.7ms；同步循环外间隔占大头但不推定GPU/Worker/trace因果，保留原样本与trace。本组不是性能改善声明。最新04:38真实UI89%、含博客等同期用量，60%停止；传统0.05PD×120%=0.06PD、AI约10min×120%=12min，非周额度换算。本组Classic全类型/scoped lint及6文件51/51路线/门回归PASS；生产/其他既有静态沿用有效结果，无生产源码修改。完整V2/V3/V4/194及组合整帧AB未闭环，无合并/生产部署。

## 完整tick边界诊断 checkpoint36（确定性与静态完成；浏览器待运行）

Browser26精确669ca56b/build25 whole 1 FAIL、visual1 PASS、Modular条件1 SKIP。C0-C3/新作物/原V1通过，V2在stone-pickaxe的回工作台路线耗尽900秒，不能视作永久路线死锁。最后128个CPU样本update中位19.5ms、中心render1.8ms；原frame窗口1200帧中位459.1ms。窗口不同且相关计时不能相加推导因果，旧center render明确遗漏canvas/device边界。

只扩观察至同帧frameend：framerender→frameend renderEnvelopeWallMs包括完整render调用，postrender→frameend renderTailWallMs包括device收尾，frameupdate→frameend tickWallMs；previous frameend→new frameupdate interTickGapWallMs首帧/断链null。仅五事件完整有限有序pair在frameend入样，缺phase/重复start/倒退不串frame；仍capacity128、冻结复制/reset/destroy清理。所有是CPU/driver墙钟或事件间等待，不是GPU/cull时间，仍不更改renderer、trace、质量、时钟、线程、玩法、路线断言或900/45/20秒。

适配原observer合同测试并以新增envelope/gap/缺frameend行为取得RED→GREEN，必要types/lint后新build26/browser27唯一完整入口；保存Browser26原始trace/failure/128样本，不直接重跑相同源码。最新实际03:55UI90%，账户另博客任务不能精确归因，60%停止；传统0.08PD×120%=0.096PD、AI约10min×120%=12min，非周额度换算。新观察6/6及联合PerformanceTelemetry共2文件12/12 GREEN、生产与Classic types/scoped lint/格式PASS；沿用本组未改变的checkpoint35完整静态与77文件526项结果。完整V2/V3/V4/194及组合整帧AB仍未完成，无合并/生产部署。

## 公开帧事件诊断 checkpoint35（确定性与静态完成；浏览器待运行）

Browser25精确939e0165/build24 whole结果1 FAIL、1 visual PASS、1 Modular条件SKIP。C0-C3、新负Z双田创造种植/成熟/收割/库存保持及原V1均PASS；V2完成木镐、石镐，在铁资源准备前回工作台走廊时达到900秒整场期限。最后player[78.5315,32.6,-0.555]、ground=true/colliding=false，未证明永久路线停滞。保留原始trace与failure，不提高900/45/20秒或弱化玩家/ACK断言。

默认PlayCanvas2.21.4不写有效updateTime/cullTime/renderStart；不可直接暴露初始化计时作为测量。本组只添加公开事件配对只读CPU wall观察：frameupdate→framerender包括同步update/input polling；prerender→postrender仅中心render与driver调用，不含resize/frameStart/frameEnd，不是GPU/cull时长。容量128，同帧完整有限非负pair才入样；重复start、缺事件、clock倒退丢弃，换app/reset detach并清空，snapshot冻结独立复制。不得改变renderer/线程/质量/时钟/玩法/性能阈值。

先取得有界emitter时序、missing/invalid/reset隔离及冻结复制RED，再GREEN；选择器纳入现有Classic headless，必要format/lint/types后新build25/browser26唯一完整入口读取诊断。最新03:55真实UI90%，账户另有独立博客任务、不能精确归因PR41，60%停止；传统0.15PD×120%=0.18PD、AI约20min×120%=24min，不换算周额度。确定性77文件526/526、完整verify:static:ci通过（冻结5/5、Svelte0错误/警告、规则66、选择器14）；最初Game行数与新JSON格式失败保留，必要修正后复验。完整产品与组合A/B未闭环，长期docs仅更新实际owner地图。

## 作物视线隔离修正 checkpoint34（静态验收完成；浏览器复验待运行）

Browser24（489c1941 / build23）完整结果 1 FAIL、1 原visual PASS、1 Modular条件SKIP。新双端/ACK路线完成两块田真实创造种植0/施肥7、第一田收割与恢复Survival库存保持，实际批次8/12；尚未运行保存恢复。随后原V1水支撑[68,30,2]从approach[66,2.5]连续12次实际命中新增Farmland[67,31,2]；作物田块挡住既有视线，不能删除原V1断言或跳过。

只将新增plots改为[67,31,-2]/[69,31,-2]、approach改为[x-1.5,z+1.5]，全部仍在原Stone/Air范围内。原V1水[68,31,2]、door[70,31/32,0]、jukebox[76,31,2]及对应approaches保持；新田块z[-2,-1]与这些视线/站位不共享目标列，V2沿z=-0.5中心线与农田边缘距0.5。静态坐标不等于真实body sweep/LOS PASS。继续复用原walkEquipmentRoute与正常UI/鼠标，原C0-C5、V1/V2、aim12次、45/900秒、visual/modular和画质不变。

保留Browser24原receipt、failure、五个crop观察及截图；旧task55/57静态审查遗漏已由readonly61纠正，不重写旧失败。必要format/lint/types后新build24/browser25唯一完整入口检验，未改变生产源码或新建runner。预算03:09真实UI90%，约5天23小时重置、60%停止线；本修正传统约0.1PD×120%=0.12PD、AI约10min×120%=12min，非周额度换算。完整V2/V3/V4/Modular/194与组合整帧A/B尚未闭环。

## 作物路线消费者修正 checkpoint33（确定性验收完成；浏览器复验待运行）

Browser23（7a675c50 / build22）完整 correctness 结果 1 FAIL、1 visual PASS、1 modular 条件 SKIP，未达到 V1/V2/C4/C5。第一田 [67,31,2] 经真实创造 UI/鼠标完成 stage0→7→harvest，实际 GPU 8 vertices/12 indices、清理为空，夜间截图可见幼苗/成熟/移除；此仅局部消费者证据，不是 whole 或 Survival PASS。第二田瞄准 [69,30,2] 连续12 null。失败双端 x≈65.329、z≈0.4998、y≈32.6、速度0、onGround true；新crop helper固定KeyS，而原reachedRouteTarget对S使用xDelta≤0，因此向更大x的第二站提前返回，没有真实走到approach。

修正仅在crop-journey复用既有walkEquipmentRoute的fresh-heading方向选择、双端邻域/arrival、ground/collision、推进tick/ACK与drift重试；删除新crop固定KeyS调用，初次和restore同一路线合同。不修改标准walkTo、route-progress、Authority物理或瞄准12次/超时/画质。既有回归覆盖被复用流程，必要静态检查后用新build23/browser24唯一完整入口验证；不因首次局部PASS跳过第二田或保存恢复。原Browser23 receipt/trace和六个crop附件独立保存，source/artifact不复用。

预算最新02:41真实产品UI90%，60%停止线不变；本小消费者修正约传统0.1PD×120%=0.12PD、AI约10min×120%=12min，不换算周额度。完整V2/V3/V4/Modular/194与组合整帧A/B仍未完成，无合并/生产发布。

## 作物真实输入与观测 checkpoint32（接线与确定性验收完成；浏览器未验收）

为checkpoint31补实际产品证据，仅扩展唯一完整Classic旅程及只读BrowserProductHarness，不另造runner或developer玩法写入。cropStageSnapshot()返回runtimeEpoch/gameplayRevision、accepted Authority cropStages的冻结独立复制，以及当前adapter live GPU batch的只读摘要：Chunk/呈现ID/阶段/soil positions、Mesh.getPositions实际vertexCount、primitive实际indexCount、材质绑定的light参数是否存在、local enable/mesh visibility标志。参数存在和enable不是实际照明/可见性结论，须结合真实截图。ready/authority实例/gameplay引用/runtime/rendered-world epoch不一致时返回null；无新权威crop Map、写API、wire版本或route-slim重试。

先API/新观测契约RED，GREEN证明getter就绪/新鲜度拒绝、复制冻结不修改既有view或GPUmetadata、实际mesh计数而非从authority猜数、destroy/epoch后的空资源与灯光绑定观测。正式新字段纳入原selector/types；旧fixture只补必需接口，不放宽原owner/epoch断言。

真实路线复用既有已铺平/已加载Stone走廊。不得猜自然土壤/水/高草坐标；可通过正常mode UI/创造目录选择dirt-block并按既有placement helper用真实右键放土，再木锄→小麦种子→white-dye完成锄地/0→7。此为创造模式农业消费者验证，不冒充完整Survival材料/骨粉/水化自然成长链。收割/施肥实际已由authority-player-action的正常interact fallback→dispatchAuthorityCropTarget进入registered prepared host，不能因item selector里无独立项而重复新入口。明确的新plots只能使用原floor/air覆盖、避开原build/workbench/V1/V2targets与bodyClearance的支持格；用同样瞄准/双端到达/ACK/碰撞/20s/900s合同，运行后才能登记坐标通过。保留第二株进入原C5 portable save/继续，并校验新epoch的accepted crop及实际mesh；不跳过V2或把部分步骤改记whole PASS。原每个阶段、原visual与modular条件、画质/线程/PointerLock合同保持。

planned captures含stage0/mature/harvest空/restore截图与只读观测附件，失败亦保存原始receipt/trace；新的精确source/artifact build22/browser23，不能使用4db dist。本组未运行browser或性能；完整V2/V3/Modular/V4/194和组合整帧A/B仍待闭环。预算02:41真实UI90%、约6天重置，60%停止；子片保守传统1PD×120%=1.2PD、AI约1h×120%=1.2h，实际费用/模型元数据与周额度分母不可换算，不额外探测或购买。现有PR持续修复授权不变，无合并/生产发布。

## 作物 Chunk 呈现消费者 checkpoint31（接线与确定性验收完成；浏览器未验收）

承接checkpoint30内容合同，只新增派生渲染消费者。唯一CropRuntime仍拥有种植/阶段/时钟；Web仅消费accepted AuthorityGameplayView.cropStages，按已呈现terrain Chunk、presentationId和stage批处理非碰撞crossed-quads，不创建逐作物Entity、体素、碰撞体、可写crop Map或新提交。缺presentationId的旧投影不绘制；声明的未知ID/非法stage/position失败关闭、清理overlay并报告既有runtime错误UI，不默默显示替代物。渲染与normal soil-target action保持分开的合同。

新增纯CropStagePresenter<Resource>位于app/world；constructor(catalog.crops, adapter)，adapter只有create(batch)/destroy(resource)，batch含chunkKey/cx/cy/cz/presentationId/stage/definition/positions（soil positions，readonly）。update(epoch, projections, residentChunkKeys)仅保留相同内容签名的GPU资源；坐标按floorDiv/CHUNK_SIZE含负坐标与边界。新增client/presentation/crop-stage-geometry纯生成批次positions/normals/uvs/indices，相对Chunk原点，base=soilY+1，两片对角双面cutout平面，尺寸完全来自Pack；每作物8 vertices/12 indices，无写World/Authority接口。

World drainCommits在terrain attach之后协调overlay，Chunk卸载立即销毁相应batch，beginScenario/world-restore清理全部，dispose终止late update。accepted crop删除/成长/恢复在下一正常frame交付；无变化不重建GPU批次。PlayCanvas适配器只创建按chunk/stage批次Entity与Mesh/Material/Texture，关闭碰撞与shadow体，无terrain repository替换；World销毁batch，visualResources销毁材质纹理，异步加载/部分创建失败完整回收。继承旧场景epoch与资源owner，不增加Worker/Kernel状态或素材域名。`world-crop-presentation.ts`窄协调器连接resident keys/错误UI与GPU资源，避免继续扩张World类；作物材质复用现有voxelBlockLightGlsl与terrain的只读光照砖。terrain替换时bind新砖，更新直接观察原GPU纹理；卸载/恢复/退出先撤除引用，不销毁借用砖。夜间光照与透明轮廓需在新artifact实际画面验证，mock仅证明生命周期。

先API RED及旧缺消费者观察：此前Task45实际rg确认cropStages无Web消费者，浏览器可见性预期为在正常种植后应看到stage0、施肥后stage7、收割/移除土壤后消失，restore后如实重现。新增纯测试用实际新owner合同先失败，GREEN覆盖空/旧投影、resident限制、同签名复用、0→7、删除、负坐标/边界、unload/epoch/dispose、未知资产与非法数据/部分创建失败清理、8/12几何与Pack尺寸，不把fake adapter当视觉证据。静态门禁与相关headless回归后仅以新的精确source/artifact、唯一完整Classic入口检验真实输入/作物可见与生命周期；不加debug teleport/setView，不改既有断言/期限/画质，不复用4db dist，不宣称性能提升。

预算02:09UTC产品UI实际周剩余90%，约6天重置；约60%停止线保持。本有界消费者预估传统1–2PD、AI约1–2小时，模型/费用与真实周额度不可换算。当前获授权持续PR修复及正常feature推送；不合并/自动合并/生产部署。V2超时、V3/Modular正式producer、V4完整旅程、194项产品矩阵、组合整帧A/B仍未完成；渲染通过也不自动闭环这些项。

## 作物 Pack 呈现合同 checkpoint30（内容合同完成；呈现未验收）

本组补齐此前仅有 position/stage 投影的内容合同，未完成浏览器呈现验收。CropPolicy 可选 presentationId 是经原 CropRuntime 冻结的只读内容元数据；无标识的旧配置继续只投影原字段，有标识时每条 cropStages 增加同一个通用 presentationId，不泄漏成长时钟、不改 crop checkpoint 字节或新增状态 owner。Classic 声明 seedlands:wheat-crop，八个阶段资产完全由 Pack 指定；stdlib/Web 不硬编码 Classic 作物或体素。

Pack presentation schemaVersion1 新增可选 crops 数组。每项 id 唯一，stages 必须恰好8项，每项只含 texture、height、width；texture 必须是相对路径并进入 manifest resources、资源锁、SHA256 校验与同源读取，height/width 为有限正数且不超过2。缺 crops 的旧Pack保持有效；声明错误、未锁定资源、重复作物、阶段数不合法均失败且释放已创建URL。不得用既有地形 faceMaterial 槽位伪装作物或改体素/碰撞语义。Classic 提供8张本仓库原创16×16 SVG透明纹理，后续按Chunk crossed-quads消费者另组实现。

先有效RED：旧loader拒绝合法crops扩展，旧Authority投影不含配置标识。GREEN覆盖旧格式兼容、完整8阶段加载/锁校验/销毁、缺失资源与错误尺寸/重复id/阶段数量拒绝、标识冻结与非法id、Authority旧/新配置及成长/恢复仍保持独立投影。不以这些确定性测试宣称实际可见或正式玩法PASS。Pack/模块定义变化仅新增 Browser22 在4db1a0b实际捕获、与cd5同玩法定义的精确 V4 predecessor；不猜摘要或使用wildcard。保持旧 captured identities 及sealed evidence不变。

预算沿用本PR：01:41UTC真实产品UI周剩余90%，包括其他账户任务；约60%停止线。当前子片预估传统1PD、AI约1–2小时，实际模型会话与credits/API/周额度换算不可核实，不另做探测或估算比例。授权为当前PR持续修复、正常feature提交推送，无合并/生产发布。验证以 focused RED/GREEN、生产静态检查、相关headless回归为准；渲染、真实输入、完整V2/V3/V4/194项与组合整帧A/B仍未完成。

## 独立输入事件路线观测候选 checkpoint29

终态：候选29未采用。源码 `4db1a0bdd86e8a8e2422b829d422fc560896bd78` 的 Browser22/window `pr41-cloud-browser-22` 为 FAIL / NOT_RECORDED，主旅程 FAIL，visual/modular SKIP。20次观测为4warmup+完整16次A/A，所有实际输入事件计数0，固定owner/profile身份唯一、同任务精确投影通过；A/A左右median为53.69309150000481/62.12084249999316ms，偏差15.696155249297933%超过15%否决线。未采A/B，不能以接近门槛或部分样本宣称收益。生产API、路线切换、工程probe、测量接线及相关测试/selector全部撤回至cd5源码；保留原始附件、trace、窗口回执与候选checkpoint，不追加同条件重采。当前read-boundary候选停止，继续正式玩法消费者与主旅程其他瓶颈。

新证据：Browser21/window28在14次精确同任务投影中，仅input ack由743推进至755；位置/视角/速度/ground/collision/world/runtime/generator不变，测量区间无Playwright键鼠调用。Controller每次prediction advance仍发送生成命令，ack应视为可推进的流水线确认时钟。本轮28已FAIL并撤回，不复用部分样本作A/A或收益。

候选29仍只检验相同的只读路线投影边界，不改生产输入、物理、世界、预测、渲染、quality、pulse、到达、期限、存档或正式玩法断言。新的测量身份以工程层短生命周期DOM输入事件观察器冻结：keydown/up、pointerdown/up/move、mousemove、wheel、blur/focus、pointerlockchange的总事件序号须不变。观察器仅在当前页面测量窗口安装，拒绝已有实例，finally移除全部listener与自有probe；不得消费/阻止事件或写任何玩法owner。固定三轴双端位置/速度、视角、ground/collision、world revision/runtime/generator、quality/render backend/请求实验配置/worker counts；同任务完整与精简字段包括tick/ack仍须精确相等。physicsTick/ack在样本之间只允许非递减，safe integer/owner-ready规则不变；其倒退或实际输入事件变化均否决，不允许把真实新输入或epoch替换当自然时钟。

先用旧固定ack实现取得有效RED：真实协议允许保持中性/无DOM事件时tick/ack单调前进，旧实现仍拒绝；输入事件变化但姿态暂未改变时旧实现无法拒绝。GREEN覆盖事件监听安装/全量清理、成功与失败清理、owner同任务不等、pose/world/profile改变、tick/ack倒退、非法计时、输入事件变化、无输入时钟前进，保留之前导航双端与真实键鼠handoff断言。确定性时钟fixture不作性能证据。

性能维度、完整唯一canonical入口、独占窗口、4warmup/8对A/A/8对ABBA-BAAB、15%噪声否决与20%改善门槛保持28注册值；原始样本新增实际probe事件序号、tick/ack及固定身份，在失败时也保留。新source/artifact/window独立，全部原Canonical断言继续，whole FAIL不能通过资格。非收益/否决后再次撤除候选，不通过更换阈值、选择器、baseline或重复同条件采样改绿。最新预算01:09 UTC产品UI剩余91%，仍共用PR预算，约60%停止；本轮无当前A/A或性能结论。

## 路线只读观测候选 checkpoint28

终态：候选未采用。源码 `8255157424f8f7f776b8c4224092744e9392385b` 的 Browser21/window `pr41-cloud-browser-21` 为 FAIL / NOT_RECORDED，主旅程 FAIL、visual/modular SKIP。仅取得4次warmup和10次A/A观测，未达到A/A资格，未进行平衡A/B。14次同任务投影全部精确相等；第14次input ack从743推进至755，其余位置/视角/速度/ground/collision/world/runtime/generator不变，trace测量区间无Playwright键鼠调用。客户端预测循环仍持续发送命令，ack是流水线时钟，不等同物理输入状态。本轮固定ack合同不能满足真实流水线；不放宽本轮否决线、不追认部分样本。生产API、路线切换、测量接线及相关候选测试/selector撤回到父提交cd5；原候选checkpoint与失败原始记录保留。后续若需要新实验，须先登记独立输入事件观测与tick/ack单调新鲜度合同，而非简单移除校验或盲目重试。

Browser20 的2142次V2快照，CDP编码值中位90335 bytes、合计193283849 bytes；trajectory中位约51KB，其次是waterTransitions/compute/authority诊断。此后验体积不是延迟因果证据。注册单一候选：增加只读routeSnapshot，直接从与完整snapshot相同的Controller/已接受Authority owner复制player/server三轴位置、三轴速度、viewAngles、onGround/colliding、physicsTick/input ack。缺少/未就绪/非有限owner数据返回不可用，不沿用完整诊断snapshot的默认假坐标。完整snapshot及所有版本、呈现、光照、存档、失败诊断保留。

先取得有效RED：当前完整投影含无关诊断且在owner缺失时提供默认坐标，不满足新路线投影合同；再验证新投影精确等价、独立只读副本、无写入，以及原双端到达/velocity/tick/ack/grounded/collision条件不变。仅设备路线与真实移动内部观测可切换；其余消费者继续完整snapshot。所有原Pointer Lock/真实键鼠、pulse、到达/邻面判断和900000/45000/20000期限保持。失败时仍取完整owner诊断。

保留理由涉及观测成本，必须受控A/A+A/B：只在唯一canonical spec的同一次当前artifact/同浏览器/同固定Classic低质量场景/同窗口运行；A=完整snapshot过CDP后在Node投影相同字段，B=同owner在浏览器投影后过CDP。除投影边界外不改变渲染、Worker、输入或世界状态。每次测量前同一同步页面任务内比较完整投影和B字段精确相等；owner不可用、字段差异、输入状态变化、world/runtime身份变化均否决。记录原始样本、顺序、source/artifact/profile与观测值；payload大小标清逻辑JSON/实际CDP编码，不推断网络bytes。

先有界warmup，再A/A交错8对，median偏差须<=15%；通过才做平衡ABBA/BAAB至少8对，B端到端观测elapsed median改善须>=20%，所有原玩法断言保持。无确定收益或超过否决线，撤除候选及路线切换，保留失败证据，不改benchmark baseline、不追加盲目重试。候选通过也只证明读出边界成本；完整当前SHA玩法、必需CI和既有frame优化的组合端到端A/B仍独立待验。实施前无RED/GREEN/A/A/A-B结论。

测量执行细化：使用既有 `SEEDLANDS_CLASSIC_BENCHMARK=1` 的完整无选择参数入口，额外开关 `SEEDLANDS_ROUTE_OBSERVATION_AB=1` 只在C0正式初态就绪后采样，不另开浏览器线路。4次有界warmup、16次A/A与16次平衡A/B；每个页面同步任务的owner等价证明计入两臂相同开销。固定站立、零速度、输入ack/三轴位置/视角/碰撞/世界revision/runtime/generator身份，physicsTick自然推进不作身份变化。结果独立attachment保存，只有整段canonical及独占窗口均PASS才有资格采用；失败的部分测量不得另写成功声明或绕过现有receipt。字节数只标逻辑UTF-8 JSON，实际CDP编码仅由保留的原始trace另行取证。

作物支撑观测改变 Block capability 定义身份；V4 兼容仅增加 Browser20 在精确 source `c3ac4d81996b3693f2f86fa60d045d7ce2a3d31c` 导出的完整前驱身份，保持所有已有捕获不变。先验证此前驱当前被拒绝，再验证单点允许后存档恢复原作物且正式挖掘可清理；篡改任一 Pack integrity/定义字段继续拒绝，不允许通配或以新组合构造旧身份。

### 注册作物支撑状态清理 checkpoint27

只读owner检查发现：普通注册方块破坏/替换和注册soil-transform不观察crop-cell，也不参与CropRuntime清理；支撑变为不支持的voxel后，advance只跳过成长，checkpoint仍保留孤立作物。冻结目标：同一注册观察/授权和prepared transaction内，支撑改变为当前CropPolicy不支持的voxel时删除该位置的唯一crop记录；支持土壤间转换保留记录。不得绕过注册观察直接读取/修改owner，不创建第二map或提交后补清理，不改变普通方块drop或新增未定义的crop-drop；未加载/unknown、stale和准备失败均不能删除作物或部分扣物。没有crop时也观察expected null，以拒绝准备后并发种植造成的孤立状态。

RED先覆盖实际完整Classic Authority注册种植→Survival begin/正常clock finish、Creative立即begin、portable保存/新Authority恢复/清理后二次恢复；原土壤方块drop/工具状态保持原语义。race注入明确区分owner并发测试与正常玩家action，不用reentrant registered action制造非法fixture。实现还须覆盖有实际非Classic policy的支持→不支持soil-transform、支持→支持控制及缺省未装作物模块的普通block操作；注册状态依赖缺失必须明确拒绝，不能弱化观察集或权限门禁。可见crop mesh、上邻格覆盖语义及额外drop不属于本片证明，继续作为后续正式V2工作。

### Browser19 建造前身体清场 checkpoint26

source `259e09ef28758f85efaf5d022288a8e669969561` 的完整 Browser19 为主旅程 FAIL、visual PASS、modular SKIP。C3 首次建造目标 `[52,31,0]` 保持 Air；点击前相机/Authority eye 为 `[51.855609,32.600002,0.499404]`，实际 Controller interactionAttempts 从5到6，不能将失败解释为没有点击。正式 player body 半宽0.32、eye offset1.6，候选格和身体重叠。下一片先以相同坐标和正式碰撞 owner 取得 RED：仅瞄准支撑格仍不提供建造空间。建造前经已有真实键盘路线退至 `[50.5,0.5]`，沿用严格双端 settle、grounded、collision 和45秒期限，再通过实际 ray 与目标卡确认支撑格及上邻面。原建造方块、扣物、网格与后续验收断言不变，不绕过碰撞、不直接 teleport/setView，不增加 timeout。此片是正确输入前置条件，不宣称性能收益。

Visual 单击只读 attachment 证实 pointer lock 与未暂停保持；interactionAttempts 0→1、目标3→0、邻格3不变、worldRevision36→37。Browser18 的单击失败原因仍未证实；一次通过不抹除旧 FAIL。18/19 导出的 compositionIdentity 完全相同，生产 artifact digest 不同，不混用两个产物身份。

### Browser13 session 反馈接线

`765eef9f` 的Browser13为主旅程FAIL、visual PASS、modular SKIP；C0启动卡原10秒期限失败，未到C3。原生phase显示worker约6.43秒、first-visible约2.90秒，剩余启动步骤使总量越过期限；不能增加timeout或声称持续攻击产品验收通过。

组合入口复查发现Game传入攻击结果callback，但startBrowserWorkerSession未继续转发给实际BrowserAuthorityClient。先使用实际session入口、真实Authority/Logic客户端和受控worker派送重现：有效当前epoch回执已接受，feedback调用仍为0。候选只添加可选callback并转发，保持既有receipt去重/epoch/revision门禁；重复receipt只能反馈一次，不改Combat平衡。新完整browser仍待验证。

启动候选：Graphics/材料准备和Authority bootstrap期间没有可玩World，loading卡始终覆盖画布，但现有app.start已不断执行全分辨率空场景render。仅在该初始化窗口关闭autoRender，保留app update与Worker/世界生成；World、Controller及frameLoop安装后、等待first-visible之前恢复autoRender。不会改变质量、可见Chunk门槛或10秒断言；是否减轻实际争用必须由新browser和phase marks判断，不能预先宣称性能收益。

### Browser12 持续指针输入补验与 CI 元数据边界

worker 输入租期在 service 和新包准入时都检查；期限内没有 service 时，排队续期也不得复活已过期手势，必须真实新 mousedown。实际 release、blur、PointerLock 丢失、hidden 和 dispose 经已安装 Controller 输入链取消后，独立推进 Authority 不得新增攻击，已开始 swing 保持原结算。

CI1df 的 Chromium 作业于16:57:42开始 Harness，17:05:07才开始测试，并记录 GitCommitInfo 全 PR diff 超时。已安装 Playwright 1.62.1 的 gitDiff 实现先无filter fetch PR base，再完整diff；这会重新下载 sparse 排除的历史 blob。仅关闭可选 HTML git diff 元数据采集，commit 元数据保留，source SHA/digest/lock/artifact identity 和实际三测试 canonical receipt 原门禁保留；不提高 job/test timeout，不改变重试或验收选择。

状态：实施中 / Agile，用户明确授权持续诊断、最小修复、验证和处理 review，直到完成或预算停止线。

## 目标与边界

基线 head `2d144c366dbae8323516a5de9f73bb64029b12fa`，base `fba4486e433c145db658f6b1598b70c47f759c8a`。恢复专用 Codex Cloud 快照后，修复当前 CI 与真实输入旅程至可审阅、可合入状态。继承 Classic 当前 spec 的行为，不扩大产品功能，不改写 sealed evidence，不降低断言、不伪造 GREEN。禁止合并、自动合并和生产部署。

推送前再次核对远端并保留他人修改。用户已明确允许本次修复过程自动发布 Cloudflare `pr-41` 公开预览；仅沿用已有 workflow，不推 main，不触发生产发布。仅使用现有安装与网络授权。

## 行为与测试设计

1. Given 完整当前领域 fixture，When stdlib consumer projection 和 route motion 执行，Then 既有 allowlist、深复制、非法输入、14 directed edges 断言全部通过。先重现 CI 的 32 个失败，再修 fixture/import；不为不合法输入提供生产默认值。
2. Given Classic runtime 的 loaded-cell/media 合同与正式生存模式，When difficulty/lighting/special-damage 测试执行，Then 既有持久化、复活、原子编辑与死亡拒绝断言通过。先保留当前 4 个失败及根因证据。
3. Given manifest 绑定的历史字节，When 格式门禁执行，Then 不改写其内容；明确区分不可变字节与活跃代码格式检查，并验证精确 manifest 项。非证据源码格式检查保留。
4. Given 当前 source 唯一 build 的已校验 artifact，When 唯一 Classic Chromium 线路使用真实键鼠/Pointer Lock，Then 当前 C0-C5、装备恢复、V1 和 visual 既有断言通过，failure/flaky 保持失败。瞄准与视觉诊断先取正式 owner/readback 的证据，不以 timeout 扩大或补状态代替修复。
5. Given pnpm 11.25 当前锁定要求，When CI 使用 Node，Then 工具链满足其 Node 下限；核实现有 Node22.12 的实际 CI 执行和潜在不兼容，不能由云环境成功推导旧 CI 成功。

## 验收与任务

### Browser02 新证据与第二修复组

空闲机器 Browser02 仍为 FAIL：默认 `walkTo` 的 target `[33,0.5]` 在 aim 内观察到 client/server x≈35.04、z≈0.386、grounded/non-colliding，已经满足外层既有 `reachedRouteTarget`；默认分支却未传入该 predicate，继续转向直至 18 moves 耗尽。本组让默认分支同样在 helper 返回 `route-reached` 时停止，使用原 predicate/坐标/容差，不增加 observation、move、timeout 或键盘 pulse。不把 angle-aligned 视为到达；原 equipment 的额外刷新与严格双端 handoff 保留。

Visual 两次均在同一全缓存 light-ready 条件失败。缓存 `register` 无条件使邻居 dirty，即使其 Authority halo revision 完全未变；为该语义先取得 RED。本组仅允许 revision 未变的既有 cache entry 保持有效，真实 edit/residency 变化、unknown→loaded 和新 entry 必须失效。每次 drain 至多重建一个 brick，原 visual 全缓存与 worldRevision 断言不变。不宣称性能收益。

实施前回归：默认到达期间不得再发 mouse/keyboard，未到达仍走原 pulse；邻居注册但 halo 字节身份不变时只新 entry pending，真实 halo revision 改变时全部受影响 entry dirty，unload 与 stale release 仍保持资源隔离。

### Browser03 新证据与第三修复组

Browser03 的 C0/C1 PASS；C2 完成前三个原木采集/拾取，第四目标 `[45,31,0]` FAIL。trace 的反向接近 pulse 在 camera x≈41.547 时已满足旧 ack/grounded predicate，但 Authority x≈40.797、velocity x=-4.5，随后停在 x≈39.730，退出五格交互范围。等待不能以较早 ack 代替 key-up 的实际完成。本组要求 pulse 后 Authority 三轴速度为零且 camera 与 Authority 对齐，再判断到达；不提高交互距离、不放宽读出、不扩 timeout。真实轨迹值纳入确定性反例。

Visual 同一 readiness 条件仍 FAIL，30 个缓存 brick 累积重建137次而 worldRevision 固定9。为相同 chunk/halo revision 的网格资源替换先取得 RED：新 sink 应使用原有效体积；旧资源迟到释放不能移除新 sink，revision 改变必须重新计算。每次 drain 一次重建与全缓存 ready 断言保持。缓存复用是否消除实际 visual FAIL 仍待当前产物验证。

### Browser04 诊断闭包

已推送修复 source `7cb68b5c917a86afcf74f3d1641fc48cdc5e9037` 的 Browser04 C0/C1/C2 PASS；C3 的 buffered/secondStep 为 true，secondDamage 的 UI 读出为 false，随后正式快照中固定目标已移除。尚不能区分伤害结果丢失、UI 合并或完成时序。Visual 原全缓存 ready 断言仍 FAIL，缓存局部修复未关闭该实际缺口。

下一轮只补必要的只读失败诊断：Combat 保存 owner player/target 查询及 DOM observer 已观察文本；Visual 保存 pending brick、cached/current Authority halo revision。所有成功/失败 predicate、timeout、点击、输入与世界状态保持，不用 readback 代替真实操作，也不据此宣称通过。缓存诊断只在失败时构造，不增加正常每帧扫描。

修复提交的稀疏 evidence gate 审阅反例：skip-worktree 路径存在 dangling symlink 时，`existsSync` 为 false，错误回退 HEAD blob 并 PASS。用实际临时 Git sparse flag 和原四个 blob 重现 RED；应使用 lstat 拒绝所有非普通文件，再允许真正不存在的 S 路径读取精确 HEAD。

远端 run37776529858 的 deterministic/Classic headless/build 已 PASS，Architecture 在四项 formatting 修复后继续到了 ESLint，并首次暴露 sealed `git-40-canonical-discovery/manifest-closure/strict-manifest.mjs:33` 的 `no-regex-spaces`。其 SHA-256 `fd4b7d09…b412` 被原根 MANIFEST 绑定；禁止改写。仅该精确文件加入 ESLint 例外，并加入原字节门禁第五项；其它代码的规则保留，负例继续验证修改、缺失、普通与悬空 symlink 都被拒绝。

- [x] 最小恢复：Node22.23.3、pnpm11.25、Rust1.88/Wasm target；匹配 Chromium151 实际 click/key/pointerlock/mouse/WebGL2 PASS；工作区干净且远端一致。
- [x] 确定性 fixture/import RED→GREEN：stdlib47、Web12。
- [x] 历史证据格式边界与工具链核实：4/4原字节、11个门禁正反例；pnpm11.25要求Node>=22.13，CI固定22.23.3。
- [x] 第一组源码 static/deterministic/Classic headless：全 static PASS；Kernel28、stdlib1080、Classic62。此前并行负载下5个timeout保留，隔离后同源码GREEN，不放宽timeout。
- [ ] 当前 artifact 唯一 Classic 真实浏览器验收。
- [ ] 精确最终 SHA 的 CI、冲突、review 与 PR 状态读回。

### Browser05 真实键盘边沿

Browser05 在 C2 接近首个原木前失败；连续快照的 Authority/player 坐标不变且 velocity 为零，frameMs≈1.59s。生产控制器仅在 render update 采样 keys Set，100ms KeyS down/up 可全落在两帧之间。先用实际安装的 keyboard handlers 和正式 InputCommandBuffer 取得 RED：不调用 update，按下后 Authority 连续消费移动，100ms 后松开消费 neutral；预测不得凭键盘事件制造物理步。修复应通过同一 epoch/sequence/target-tick stream 即时提交键盘状态，保留 render 固定步预测与现有门禁。重复 keydown 不重复提交，UI/暂停不接受按下；松开、blur 不能留下粘滞输入，jump edge 与 movement revision 保留。真实浏览器断言、pulse、timeout 均不变。

Visual 第三个 closeup FAIL 的 pending13 中六个尚无 volume，其余为 halo unavailable→loaded 的真实变化，worldRevision 仍9，Authority 无 eviction。尚不能归因于 CPU 光照计算或 GPU 帧成本。下一轮在既有失败诊断添加 light rebuild 的实际 elapsed（last/total/max）；只记录时间，不改调度、质量、ready 或 timeout，不把计时当作性能 GREEN。

本组 RED 为实际 keyboard handler 的两例无输入包；修复后 input/prediction/transport/light/mining 六文件43例 PASS，共享采样抽取后 focused controller/prediction26例及最终 keyboard12例 PASS。全生产、根/tool/Classic 测试类型检查 PASS。首次完整 static 在 controller max-lines 处失败；按原500行上限抽取方向/按键采样后 scoped ESLint PASS，保留失败日志。新 source 的浏览器与远端 CI 仍待验证。

### Browser06 窄路线与 light 收敛

source `107c7fc984290dcfeb71a6e739f71785a46caf1c` 的完整 attempt 为2 FAIL/1 SKIP。C0-C3/V1完成；V2失败于workbench corridor `[78.5,-0.5]`，并未完成装备/C4/C5。末端双端 x≈78.499673、z≈−0.636142、velocity0，原走廊±0.08仍未满足；固定80ms脉冲可跨过该窄窗口并反复大幅转向。下一组保留所有到达/双端/grounded/collision断言、45s deadline和既有最大pulse，按当前位置剩余距离与正式player加速/最大速度选择更短的末段真实按键脉冲。不增加转向观察或mouse step，不通过状态设置移动玩家。先用原失败坐标、正式stepBody与30/60/120Hz验证固定pulse越窗和自适应pulse收敛。

Visual FAIL 时generation/meshing均0；cache30、pending3、rebuild94，三个pending均无volume。last build/apply40.4ms、累计8.0644s、max540ms，计时仅属该运行，不作性能GREEN。nearest-only调度允许重复变脏的近brick一直抢占较远新brick；为此先构造连续近halo revision变化、远brick未获重建的确定性RED。调度保持每drain最多一个真实重建、默认最近/稳定key tie-break，等待超过有限重建轮数的项按等待年龄优先以免饿死。不得提前把未重建项标ready、扩大visual timeout或改变质量；实际FAIL是否因此关闭仍待新artifact验证。

本组路线RED首轮因测试遗漏PhysicsInput.verticalIntent而无效，已保留；补齐正式input后有效RED为3 FAIL/4 PASS，30/60/120Hz均在原窗口外。自适应pulse GREEN 7/7；与原瞄准/装备handoff/光照联合验证10文件117/117 PASS。light公平性独立RED为8 PASS/1 FAIL；GREEN9/9，重复失效保持首次等待年龄，满8次真实重建后优先最老项，其余保持nearest/key。首轮类型检查暴露BodyConfig字段可选，已加入正式player配置缺失时失败的类型收窄；日志保留。尚未运行新source的Browser07，不以单测证明visual或完整旅程GREEN。

### Browser07 Authority观察与光照区域读取

source `d39d63096216d466ccf4e17affafc4cca90e3abd` 为2 FAIL/1 SKIP；C0-C3完成，V1 closed-door probe失败，未进入V2。probe实际keyDown到keyUp约1.404s，before tick24212，唯一接触观察tick24305（+93）与x70.492499正确接触面；原1250ms/75tick窗口内没有两次持续接触观察，原6tick hold断言如实FAIL。RAF等待依赖低帧率renderer而Authority持续推进。下一片仅移除读Authority碰撞观测前的RAF依赖，按新鲜physicsTick轮询同一正式只读RPC；重复tick时有界让出，原1250ms/最大physicsTick、6tick hold、位置/横向/ack/断言保留，keydown/up保持finally释放。先保留渲染帧停顿而Authority推进的确定性RED，不通过降低hold或增大期限关闭。

Visual skeleton-front closeup仍FAIL：cache29、pending18、rebuild92；13项是unavailable→loaded的真实halo变化，5项尚无volume，meshingQueue1。累计真实build/apply9.9408s、max656ms；公平性已修但未关闭实际fail。假设为每cell重复chunk/guard/string查询造成大量主线程占用；候选仅改同步派生区域读取，27个chunk guard一次验证，再复制已知体素到有界密集Uint16/loaded Uint8缓冲，未知保持fail-dark，原R8/flood/halo/revision/one-per-drain/ready/timeout/质量均不变。既有Authority mirror仍是唯一来源，不暴露其可写底层buffer、不transfer owner数据；新派生buffer归消费者，大小/有效长度/复制bytes显式记录。

性能候选在实现前冻结：A=当前逐cell getVoxelIfLoaded，B=当前同身份collision baseline经有界dense region adapter；唯一轴为输入读取方式；固定64³区域与相同27chunk/voxel/semantics/revision，包括unknown、loaded Air、光源和阻挡。预约窗口中先A/A检查两组median偏差<=15%，超线仅诊断不宣称收益；再交错AB/BA各至少8对，主要指标为完整buildLight elapsed median，B需改善>=20%，否决项为输出levels任何byte差异、缺失/陈旧chunk被当loaded、owner buffer被修改或生命周期泄漏。次要指标记录派生copy bytes/分配量与source-read count，不声称整帧/产品收益。候选不达线则删除新生产路径。若通过，还须新artifact唯一Classic端到端验证两项组合，不用微基准替代产品或比较旧非同环境Browser数据。测试先证明dense区域negative/chunk边界/unknown/guard/当前revision语义，再证明B输入实际被生产light reader消费；无新证据不重复完整browser。

本组收口：closed-door runner独立RED→GREEN与原oracle18/18；根审阅补充RPC晚于wall/tick预算两项拒绝后，同一联合6文件共48例中43有效PASS、5例region suite补验5/5 PASS，构成48例闭包。首个region suite4例RED为2 FAIL（262144而非27读取、整数加法溢出）/2 PASS；region基元GREEN4/4。完整联合首轮47/48，失败是fixture未遵循browser release cache删除与pending lease生命周期，已保留失败后用真实guard pending/release/delete/finish路径复验。Web生产types含svelte零错误/警告、Classic types、12个TS路径scoped lint与13个变更文件格式检查通过；新完整browser待验证。

性能证据01有锁与原始A/A/AB，但未绑定正式measurement declaration；保留而不冒充完整身份收据。证据02补齐local declaration、dirty candidate source/bundle digest、window identity与原始样本，预约输出为PASS/RECORDED。A/A median43.714/44.255ms、偏差1.224%；16对交错AB/BA，A44.015ms/B11.154ms，局部完整build下降74.658%，262144输出bytes完全相同。候选source digest `624b774362cc0c3f1fa21bf9b9efd2d671ca80b2b703a8d7c857a009243867cd`，benchmark bundle digest `6d8c9ca28df83a5654fee37ffb48247b5e14ac6a6479570aee41365c94c9867c`。64³派生copy786432bytes、owner transfer0，窗口内没有其它测试/build/browser；不推导整帧收益。生产batch仅在实际BrowserAuthority mirror port可用时启用，同步捕获每chunk的现有guard，复制行到consumer-owned buffers，不引入可写owner泄漏或长期新缓存；缺port的既有严格fixture保持原逐cell读取，不制造loaded默认值。block-light consumer测试明确禁止退回per-cell并逐byte比较同源control；negative/boundary/unknown/Air/guard/stale/release/alias反例保留。

### Browser08 真实转向观察与护甲覆盖

精确source `3d00b3b93a32ef433b3d181cafedf200944b9ef6` 的Browser08：主旅程FAIL、视觉PASS、modular按Classic产物SKIP。C0-C3及V1全部完成；V2仍在workbench corridor `[78.5,-0.5]` 的原45s deadline失败。末端Authority/player一致于x78.673859/z−0.609932、静止/落地/无碰撞；反向修正连续80px真实mouse move各等待两次RAF，原窗口内未完成最后转向。先构造渲染帧延迟但真实mousemove已更新yaw的RED。候选仅为route转向去掉与其读取无关的双RAF；默认体素/实体/视觉mouse helper继续等待双RAF。保留真实PointerLock/鼠标事件、80px上限、18moves/19observations、失败分支、45s deadline、Authority静止及原位置窗口；不设置yaw、位置或世界状态。转向仍读取实际controller yaw，不认为发送事件就证明角度完成。新source完整Browser仍须验证，原PASS视觉不覆盖其它source。

原V2要求全部16件护甲，不以四铁UI和五件metadata测试替代。本组冻结当前Classic平衡literal oracle：leather helmet/chestplate/leggings/boots = 1/3/2/1 points、max durability55；iron =2/6/5/2、165；gold=2/5/3/1、77；diamond=3/8/6/3、363。固定registered zombie-claw基础3，单件损失分别为3乘以(1−points×0.04)，测试逐行写literal预期而不从registry推导oracle。正式Authority inventory-pointer pickup→错误槽拒绝且视图不变→正确槽装备→持久化新实例恢复；完整Classic注册combat producer解析唯一hit、耐久3→2并snapshot恢复。不得改用直接applyDamage；此组headless证据不代表UI/death-drop/respawn矩阵或全物品链完成。

本组初始route render依赖RED为1 FAIL/1 PASS：原18次转向额外双RAF累计28.8s；移除route专用等待后原合同等4文件40/40 PASS。补充实际walkTo两种refresh路径与实际controller mouse handler无render时的方向捕获，联合有效42例通过（原不变25例与补验17例）。护甲33例初跑即PASS，属于新增覆盖，不制造行为RED；首次格式FAIL已修。Luna并发较早types读到mouse helper旧签名而FAIL，根最终Classic types与五个TS路径scoped ESLint PASS。原trace十进制字面量触发两轮no-loss-of-precision FAIL，保留日志；改为Number原始字符串读取，不更改坐标或lint规则。完整Classic headless含新矩阵24文件95/95 PASS。将新护甲文件加入原headless命令和Classic test types，不能只运行一次然后让CI遗漏。

### Browser09 输入投递时钟与护甲死亡闭包

精确source `991b4b435c3afb08569cc5dddc1973d530a19a57`：Browser09主旅程FAIL、visual PASS、modular SKIP。资源条全部放置后，首次木材采集前返回 `[78.5,-0.5]` 的45s窗口失败；末端Authority约94.999734、client约95.099731，Authority静止但render呈现滞后。约844s时prediction累计12335次authority-resync；正常本地传输的inputLead只有2ticks，输入基于已排队的旧snapshot tick，真实键盘边沿虽即时捕获仍可能已被Authority消费。下一候选只修输入调度估算，不修改Authority位置、世界状态、固定physics步长、输入拒绝规则或路线期限。

冻结方案：Browser Worker在周期snapshot envelope附可选跨同浏览器realm的单调绝对capture时间（performance.timeOrigin+now），不加入AuthoritySnapshot、持久化或确定性owner。Browser client仅在原epoch/order gate接受该snapshot后绑定时间；新的已接受但无时间消息清除旧估算，旧epoch/重复/倒序不得覆盖。输入调度基准为当前snapshot tick加采样年龄对应的floor ticks，年龄有限且非负、上限2000ms；paused不外推，缺失/非法/未来时间回退原tick。只作为PlayerInputStream的target基准，预测body/reconcile仍使用原snapshot；既有配置的传输lead保留。restore/new epoch清除时钟，所有原late/out-of-order/too-far-ahead与256pending门禁不变。该估算不是Authority tick或性能收益证据。

先用stale snapshot tick100、Authority consumed130、input scheduling base130构造RED，期待capture与render输入target132并被原InputCommandBuffer接受；补充30/60/120Hz、paused、无时间、未来/NaN、年龄上限、旧epoch/倒序/restore清除的边界与实际BrowserClient→controller连接。新artifact完整browser必须验证，不以helper单测替代产品验收。

护甲闭包另用原16行literal balance覆盖注册zombie-claw致死、inventory/cursor/crafting/armor四来源只掉落一次、耐久3→2、死亡存档新实例恢复（epoch更新/lifetime保留）、死者拒绝后续攻击、正式respawn健康20且不恢复旧armor、再次存档无重复掉落。初始health1仅fixture配置；死亡必须由注册Combat producer结算，不直接applyDamage。先运行新增覆盖，如原实现已满足则记新增PASS而不制造RED；加入正式headless选择和Classic类型检查。

本组确定性RED分别2/16与3/17（旧target102，预期132），修复后capture/render/interrupt维持同一序列。7文件81/81 PASS包含原0/50/150ms transport fault覆盖、真实键盘边沿/neutral、epoch/order/restore时钟、护甲16件死亡闭包；补充world-item位置/lifetime保存验证后仍PASS。stdlib与Web生产types、Classic测试types通过。初次scoped ESLint因有效行数500上限FAIL，保留日志并按已有职责拆出水体采样和session control、独立snapshot envelope type，不降低门禁。最新 `991b4b43` CI run37794086450终态FAIL：architecture/deterministic/headless/build/static PASS，Chromium FAIL，preview SKIP；CI首次start-card10s超时，重试combat仅5/5/2伤害且未见衔接/第二击，visual两次原20s未ready。云内visual PASS不覆盖CI。连接器artifact下载引用可得但本云读取403，暂以job日志确定症状，根因尚未关闭。

最终补验：新增原too-far-ahead拒绝反例13/13 PASS；输入相关6文件66/66 PASS，护甲死亡16/16构成82例有效闭包；完整Classic headless25文件111/111 PASS，CI选择/冻结证据12/12 PASS。测试专用types首轮因配置位于仓库外无法解析type roots失败；修正配置后暴露现有fixture缺craftingGrid/matched recipe IDs/完整frontier与直接改readonly snapshot，已修为完整fixture和测试自有副本，最终专项types PASS。原断言、输入limits与sealed bytes保持不变。新artifact/browser和新SHA CI尚未运行，不能宣布可合入。

本组审阅补充structured-clone非法metadata反例：BigInt原先先减法而抛TypeError，1 FAIL/16 PASS的RED已保存；改为先验证finite number再计算年龄，17/17 PASS。该拒绝仅回退调度tick，不修改snapshot或Authority门禁。

### Browser10 内外路线进度交接

精确source `98b9a115376fc7645c5c78949d1460d33d16c786`、build10的Browser10为2 FAIL/1 SKIP；C0-C3/V1完成，V2首次workbench corridor失败，visual skeleton-front仍未ready。实际轨迹在一次静止pulse后从 `[78.4337,32.6,-0.4564]` 到 `[78.5587,32.6,-0.5803]`，越过目标x但z超出原±0.08走廊。内层walkTo继续以KeyW作约180度转向，约26秒后回到目标另一侧，又开始反向转向并耗尽45秒；外层已有KeyW/KeyS选择逻辑未收到这次已完成pulse的进度。

本组先验证实际walkTo与实际equipment driver组合的RED：完成、确认ack、静止、落地且无碰撞的pulse越过请求方向的x边界时，应将双端位置仍在既有±0.45 x邻域的进度交回外层，让外层按当前x选择下一次真实KeyS/KeyW；返回进度不表示到达，z不在±0.08内必须继续纠偏。仅equipment路线启用此交接；普通walkTo语义不变。保留最终双端到达、原0.06/0.08/0.45窗口、45秒deadline、80ms上限、真实键鼠及所有新鲜性/grounded/collision门禁。禁止以更宽z窗口作为成功或增加deadline。visual失败pending13中9项真实halo变化、4项尚无volume，下一修复组另行建立因果证据。

### CI连击输入与渲染时钟隔离

CI991正式query-player-state给出lastResult `sequence:3,comboStep:0,damage:2`；目标12HP收到5/5/2，三次均第一击。源码wood-sword第一步windup0.18/hit0.08/recovery0.24，衔接窗口0.18–0.50s；实际controller仅render update重复攻击，frame约447ms。下一定向RED使用真实安装mousedown、完整Classic registered Combat和单调假时钟：render停止，Authority仍按60Hz推进；200ms真实按住重复应在窗口内buffer第二步，结果必须literal第一击5、第二击7。对比旧447ms渲染驱动可作诊断，不调Combat时间窗，不使用绕过controller的攻击或写combat状态。

候选仅将按住指针的攻击重试按200ms单调deadline排程到有界主线程timer；render与timer共享同一deadline，晚callback每次最多一次，不补积压。每次读取当前真实控制器yaw/pitch及摄像机位置、现有目标/range/LOS，正式Authority仍决定接受/衔接/伤害。鼠标松开、失焦、PointerLock丢失、隐藏、UI/暂停、模式变化、world销毁/控制器dispose必须停；矿物破坏的elapsed进度继续由原render/Authority路径负责，timer不得额外推进采掘。真实键鼠与HUD连击完整browser仍为最终门槛。

### CI98 检出超时与持续回归

run37800926606的Classic headless于15:27:36开始无filter的depth1 fetch，15:42:36在既有15分钟job期限被取消，测试未运行。Chromium于15:37:31开始fetch，15:43:33才checkout，15:45:01开始旅程，16:02:43被取消；终态cancelled不冒充测试FAIL或PASS。历史大证据整仓下载是独立CI环境问题，不能通过提高测试期限掩盖。

保持checkout的原pinned action、精确ref、architecture/deterministic fetch-depth0、其他depth1及job权限/期限。使用该pinned action的non-cone sparse-checkout（源码自动fetch blob:none），代码/docs和历史spec保留；archives/reports/harness产物与历史evidence只按需Git blob取。直接被legacy测试读取的pre-death-v4-identity精确文件明确物化；新repair evidence物化。五个sealed原字节门禁仍运行，缺失只能用skip-worktree HEAD精确blob，不能删manifest或跳过验证。以实际Git临时小fixture测试每个checkout block的patterns：保留代码/docs/spec与必要fixture，排除历史大证据，缺失项保持indexed S且HEAD原blob仍可取，不复制真实历史。

将本组真实route handoff与held attack定向合同加入原Classic headless持续回归入口并纳入测试types，保留原25个完整Classic合同，不替换或减少既有覆盖。根因图单独记录已证明/待证明与证据边界。

本组checkpoint：有效held attack RED在第三次fixture完整后取得，前两次Structure port/target predicate fixture失败保留不计行为RED；GREEN联合5文件50/50、采掘另3文件34/34、单调旧gate补验14/14。完整新headless入口27文件125/125 PASS；Web生产types零错误/警告、完整Classic types（含新held attack）与9个TS/MJS scoped ESLint PASS。路线新fixture类型首轮FAIL已补齐严格字段；CI sparse首轮新evidence未物化FAIL后修正，13/13门禁PASS。根有界审阅输入生命周期、共同deadline、最终路线窗口与pinned sparse action源码，尚无本组未处理可证实finding；不代表完整PR审查或产品可合入。下一步需要光照调度因果验证，再运行新artifact唯一browser。

### Browser10 derived light 调度的判别合同

World.drainCommits原每render只调用一次真实cache.rebuildNearest；在慢帧与新的Authority halo到达时，正确dirty会持续积压。先用真实ChunkBlockLightCache与真实World.drainCommits建立无render推进的RED，不从“pending13”直接认定调度是唯一根因。候选只把derived light队列服务移至有界主线程timer；repository mesh drain与全部可见/postrender预算不变，flood/R8/revision/未知阻光/全部cache ready语义不变。每timer turn最多一次build/apply，复制最近实际camera position，有dirty才继续；以max(16ms,上次完整build/apply耗时×4)让出主线程，禁止零延迟积压循环或同时启动多个timer。dispose先取消timer再销毁sink/cache；已释放key/陈旧replacement沿原生命周期隔离。

定向测试区分调用者与pure helper：只调用一次实际World.drainCommits后、render不推进，真实dirty cache仍须完成；新的halo revision到来须重新计算，未完成不得ready；重复request不产生并发timer，取消后不得写sink，负camera输入拒绝。固定假时钟是调度功能证据，不冒充性能测量。若定向闭包通过，先同一唯一Classic spec按既有selectionArgs执行visual correctness subset（不宣称主旅程或性能GREEN），再新artifact完整验收。可观测耗时只诊断，不从Browser10跨source数据宣称FPS收益；若性能结论需要，另冻结同源A/A及交错A/B窗口。当前candidate尚未运行产品浏览器，原visual FAIL仍未关闭。

Browser10仍有803次prediction authority-resync，但次数不能区分late、capacity或target-out-of-order。下一browser之前仅增加按client生命周期隔离的只读已接收input-decision计数，记录decision与requiresResync，不改sequence/epoch/order/owner拒绝逻辑或包timing；只在失败attachment读出，无每帧扫描、逐包日志或玩家状态写入。用实际client消息router验证重复/旧sequence不计、不同client隔离、读取副本不可修改；计数不当输入延迟测量。新CI e3b8f938检出约1秒，五项静态/构建/headless全部PASS；Chromium主旅程两次start-card原10秒等待FAIL，visual首轮原20秒未ready、重试start-card FAIL。启动失败额外只读DOM alert/按钮disabled/label与card display，输出有界诊断到失败attachment及job log；保持所有启动等待与验收predicate，先取得状态证据再诊断，不任意提高timeout。测试hook的相同失败采集抽到evidence helper以保留500行边界。

### Derived light 当前 halo 身份与 readiness

新增判别反例：真实 cache 已完成一次构建后，reader 的 Authority halo revision 改变，且没有人为调用 invalidate/register。此时旧 volume 不得让 snapshot.ready 继续为 true；下一次 rebuildNearest 必须能发现并重建此变化。先取得该反例 RED，再决定修复。候选仅比较已注册 brick 的 27 个 halo 身份并标记 derived dirty，不读取全体 voxel、不修改 Authority 或 flood/R8 语义。已 dirty 的首次等待序号必须保留，避免重复扫描使公平性失效。此检查是正确性合同，不宣称帧率或整体性能改善。

### Browser12 主线程停顿期间的持续攻击

source1df46ae0/build11的visual-only为1/1 PASS、全缓存ready且worldRevision41/lightRevision41，12GLB呈现、页面/响应/渲染错误为空，截图检查可见封闭房间未照明与glowstone照明差异。完整Browser12终态2 FAIL/1 SKIP：C0-C2完成，C3连击buffer/第二步可见但第二步实际damage2、sequence3/comboStep1，原7点断言FAIL；未到V1/V2/C4/C5。该次失败frameMs961，receipt分类accepted1164/late367；不能由计数证明战斗原因。后续visual启动仅有loading card、无alert/buttons，原10秒FAIL；旧子集通过不覆盖该失败。

下一个判别RED必须同时停止render和主线程timer回调，让完整Classic registered Combat仍按独立Authority时钟推进：真实mousedown持续按住应通过正式攻击入口形成literal第一击5、第二击7且第二个sequence就是第二段，而非两次第一击后剩余2。当前主线程timer只证明render独立，未证明长主线程任务期间可玩。

若RED确认此边界，候选把持续指针意图交给现有Authority worker的串行hostOperation节奏服务；每200ms至多一个正式AuthorityAction.attack，不补积压、不改Combat窗口/伤害、权限、range/LOS、lifetime或位置owner。worker根据最近真实yaw/pitch与当前Authority实体/位置重新选目标；输入epoch/递增sequence、释放、失焦、解锁、隐藏、UI/暂停、模式/世界替换、dispose及有界失活lease必须停止，旧packet不得复活意图。首次mousedown仍立即执行，采掘elapsed沿原路径。该输入状态仅瞬态，不进入存档，不新增Classic硬编码或第二套Combat owner。先验证实际consumer和取消/新鲜性反例，再新artifact原完整browser。

Browser-local pointer envelope携带递增sequence、同次gesture、绝对monotonic采样时间与方向；不扩公开GameplayAction或存档协议。2秒lease过期/生命周期或模式变化会退休gesture，旧renew不得重启，必须新按下。结果按runtimeEpoch拒绝旧世界、 bounded64去重并允许当前窗口内重排commit一次交付；gameplay既有revision gate保留。必要的500行边界仅把既有request/transaction计数与post失败生命周期整体抽到request sender，行为与原client合同不变。

启动失败先追加只读boot阶段/时间诊断，区分scene/material/worker bootstrap与首chunk可见等待；不提高10秒、不改变加载成功或质量口径。新证据后才能选择产品修复，不能仅再跑同源码重试。

## 模型与预算

主力按用户指定 Sol/high/default；一个有界独占测试 fixture 子任务使用精确 Luna/medium，不再委派。禁止 ultra/Astra 开发。所有工作共享每周总额度40%上限，保守剩余约60%停止；本云工具没有真实周额度 UI 查询，依赖主对话提供读数（14:26 UTC剩余94%，包含同账户其他任务），不由 token/credit/API 金额换算百分比。收到停止即保存进度。

## Delivery Snapshot

### 作物时钟与正式入口 RED（checkpoint 19）

默认 Authority gameplay20Hz 每次推进0.05秒，现有 CropRuntime 的 Math.floor(seconds) 丢弃不足一秒部分；真实 Authority 累计一秒后 crop tick=0。修复只在唯一 CropRuntime owner 累计时间，旧 V1 child checkpoint 缺 fractional 字段按0恢复，新 checkpoint 验证 finite、0<=fraction<1，fresh restore 后不得丢失余量。相同总时间不同合法 cadence 应得到相同 tick/作物状态；水化、loaded 边界、seed/random与成熟上限保持。测试可用既有 crops.plant 搭建时钟前提，明确不证明正式种植。

同时真实 Classic Authority 的 loaded Farmland/Air、reachable、selected wheat-seeds 与当前四 selection 值下 performAction(interact/use) 返回 item-no-interaction；成功扣种与 stage0 checkpoint 为下一正式 producer 的验收目标。Generic机制/Classic内容归属、原range/LOS/新鲜度门禁与失败原子性必须保留；植物呈现、收割、骨粉及完整恢复仍需后续独立完成。

### 正式种植提交子片

复用唯一 CropRuntime child owner；stdlib 接收明确 Pack soil/empty/water/seed/drop 配置，删除农业机制中的 Classic voxel/item literals。新 registered crop component 仅投影该 owner 的单位置记录，与已有 Block actor/voxel 观察走同一个 prepared host，模块不能自行写 map/inventory。正式 seed interaction 保留当前四 selection、loaded hit/adjacent/独立 above、range/LOS 与 actor authority；host重推导候选、核对精确观察集合，先验证 inventory/crop 全部participant再提交。Survival 扣一粒种子并增加 stage0 crop；Creative 增加作物但不改生存背包；重复、未知上方、错误地面/物品、过期选择或提交期世界变化均不得部分提交。

本子片在土壤上记录作物，不制造 soil WorldCommit（土壤/上方 voxel 均未改变）；child仍是唯一阶段 owner。可见阶段应由该 child 的只读投影呈现，尚未实现则必须保持产品验收未完成。旧精确75f V4 composition 来自 Browser17实际checkpoint，只允许V4明确predecessor，禁止合成宽松身份迁移。非Classic内容必须能通过同一registered玩家路径种植，具体标识由自己的Pack提供。

### 作物阶段公开投影子片

实际 registered seed interaction 后，AuthorityRuntime.view 必须从唯一 CropRuntime owner 输出只含 position/stage 的 cropStages；不得泄漏 subSeconds、内部时钟或可写 owner 引用。Authority 正常推进后新 view 反映成长，先前 view 保持独立；空记录及恢复后的记录如实投影。旧 Worker fixture 缺可选字段时仍可启动，生产投影始终输出数组。该字段经现有 Worker structured clone 与 gameplay revision 门禁交付，不新增存档/网络 wire 版本，也不改冻结 v1/v2 reference corpus 的字段合同。当前片仅证明公开投影，不证明 mesh、射线选择或正式收割。

### 正式收割与骨粉子片

继承当前Classic完整农业合同与194项item identity。既有bone→3 white-dye配方就是本内容目录的骨粉来源；不新增bone-meal物品或第195项。具体 fertilizer item/growthStages 由Classic crop policy声明：white-dye消耗1，使未成熟小麦到stage7；已成熟拒绝且不扣物，Creative不消耗。stdlib只处理配置，不持有这些具体标识。

既有 farmland/crop cell 的 target-first right-click 经过原Authority interact action与四selection门禁。use持有种子仍走种植（重复occupied，不意外收割）；use持有配置肥料走施肥；空手/其它物品的use及alternate走收割。收割未成熟只返种子，成熟返小麦和种子；Creative只移除作物，不改变Survival背包。所有返回物必须先在detached候选里完整容纳，随后与唯一crop owner变更在同一prepared Block host原子提交。若第二种掉落无法容纳，第一种也不得漏入owner。种植/施肥/收割不制造soil WorldCommit。

scope内RED先用实际正式种植→正常Authority成长→空手interact收割及既有white-dye施肥取得。负例包括满包二次产出失败、成熟肥料、stale四selection、loaded/range/LOS与prepared crop/inventory/voxel race；Creative与fresh portable restore继续通过实际入口。当前片不声称左键植物ray、mesh、土壤破坏清理或完整Browser农业完成，这些仍保持产品验收缺口。

### 未使用几何配置的 Worker meshing 候选

精确75f生产诊断的18个任务已有Worker阶段trace：meshing总9891.8ms、generation3424.5ms、halo2758.9ms；不同任务排队等待不可相加为critical path。原适配器只因Pack注册过任何geometry就使所有Chunk的W04/W05退回JS，即使实际canonical/halo未使用这些定义。本候选只允许在既有完整36³派生窗口确认没有任何注册geometry voxel后复用既有W04/W05；canonical、halo/AO邻居或水顶额外单元有自定义geometry时仍走原JS，失败保持原fallback/failed语义。保留seed、voxel/geometry/semantics、质量、Chunk数量、bytes与真实browser断言，不新增mesh owner。

A=当前whole-task geometry→JS fallback；B=每task完整窗口检测并按实际使用选择既有kernel，唯一轴为geometry适用判断；full preparation+mesh+pack均计时。固定相同天然Chunk与含custom-body/halo/water-top负例、相同已有scalar Wasm与同一机器，warmup后A/A交错8对median差<=15%，然后AB/BA交错至少8对。主要指标为full call elapsed median，B需改善>=20%；否决项为任意输出typed-array byte、material/category/layout/order差异、custom几何误用kernel、未知/缺失输入当Air、owner buffer变更或failed状态污染。记录窗口identity、输入digest、copy bytes、所有原始样本；未达线删除生产候选而保留证据。即便通过也只证明局部meshing，组合新artifact唯一Browser仍需原完整验收。预注册时尚无RED/GREEN/A/A/AB。

实施结果：ABI调用缺失RED、三文件11项GREEN；独占35-01测试断言通过但stdout原始report缺失，wrapper FAIL/eligible=false，保留。35-02只增加计时结束后的raw JSON写入，A/A偏差2.9188476%，完整任务A/B中位765.3202725/14.4374225ms，98.113545%改善；五组输出bytes/metadata与输入哈希保持，window PASS/RECORDED，候选保留。具体身份、原始样本及copy边界见 `evidence/unused-geometry-35-02/README.md`，不写成整帧或产品结论。

### 构建身份读取边界

现有 artifact.sourceIdentity 先调用完整 readWorkingSnapshot，读取/hash 所有物化文件，然后才选 code/config；新 build 不得全量读取历史证据。只给 readWorkingSnapshot 增加可选路径选择参数，artifact 用原 source predicate 在任何文件读/metadata 前过滤。默认 Harness snapshot 语义不变；sourceSha/sourceDigest/lockDigest 的算法、具体路径集合和源码变更拒绝规则不变。RED 用独立临时 Git fixture 和 fs read guard 拒绝历史文件读取；GREEN 还验证历史内容不影响源码摘要、源码变化仍改变摘要、默认 snapshot 继续完整捕获其输入。CI 纳入这一确定性工程合同，不能借过滤排除真实 code/config。

实施中。新运行使用独立 ID。静态/构建不替代产品验收；旧 Browser25 不为本 head 背书。长期 docs baseline 暂不更新，待修复事实确定后记录理由。

### Browser18 完整真实转向与单击诊断（checkpoint 25）

47f5af6/build17 的唯一 canonical attempt 已终止为 2 FAIL / 1 SKIP：C0-C3 和 V1 已执行，V2 在原 900000ms 总时限耗尽；视觉单击目标仍为 voxel3。失败、末尾 Pointer Lock 清理及 trace 保留，不能把阶段耗时行计为 PASS。局部 meshing A/B 不代表整帧；本次末尾 frame interval p50=449ms、p95=1091.4ms，未取得整帧性能准出。23:01UTC 产品真实周剩余91%，初始差7个百分点包含其它任务，停止线仍约60%。

V2 trace 中453次 mouse.move 的调用耗时合计约180229ms，2088次完整 snapshot 约184233ms；嵌套等待不可叠加为 critical path。旧辅助器对每次真实鼠标 delta 限80px，180度需要多达18次事件。冻结新的 correctness 输入合同：路线和精确 voxel helper 可用一次有限的最短完整转向（yaw<=180度、pitch仍由同一观察计算）进入既有 Pointer Lock handler，之后必须重新读取实际 view/target；不能直接 setView、修改状态、重新锁定来伪装命中。旧逐步 correction 保留为测试 control；19-observation/18-move 路线失败上限、180-attempt voxel上限、到达/邻面/grounded/Authority settle、所有操作断言及900000/45000/20000等时限不变。RED 使用现有真实输入适配与几何 ray，反向固定 pose 的成功仍需实际目标观测，但最多两次 gesture；无响应或卡片与ray不一致仍失败。GREEN 后再做新的生产 artifact 真实浏览器；本片不宣称 FPS 或 A/B 性能改善，也不更新 benchmark baseline。

视觉单击的旧 trace 已确认点击前 fresh ray 命中 [0,61,17]、Authority未暂停，无交互反馈；最终暂停 modal 出现在断言失败后的 exitPointerLock 清理，不是点击前根因。下次同一真实 down/up 前后追加只读 target、pointer lock、player-state/action反馈与提交观察，失败时也保存；不代采集、不降低单击断言、不增加 poll时限。具体生产修复待最后确认边界后再决定。
