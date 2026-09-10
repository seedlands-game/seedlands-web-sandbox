# 连续实施进度

用户授权：主合同和 ECS 补充合同均已批准；自主持续推进至 S6。普通实现缺陷先记录并修复；重大范围改变、无法保持受支持存档、供应链或外部依赖阻塞才升级，不绕过门禁。S6 交付后由人类审核/合并。

## 当前恢复点

- 基线：S2 阶段提交 `22b68c9774d4fa7e6ef085b1a9ecc55cd7ac8786`，基础门禁通过；独立 reviewer 只读该固定 Git tree。
- S2a 已集成：bitECS 精确安装、每世界 EntityStore owner、稳定身份/lifetime、位置/速度/生命与派生空间索引；同 ID 恢复会更换运行 epoch，旧引用失效。
- S2b 已集成：玩家/NPC 共用生命、需求、库存/装备组件；PlayerState 只经绑定引用访问同一 owner。7 项组件集成测试与相关既有测试通过，最终全量 static 已通过。
- S2c 已集成：Action/Combat v2 已完成并接入真实 AutonomyRuntime；宿主观察、逻辑意图、物理执行和玩家输入/异步动作在执行前复核身份。V4 组件存档和 V1/V2/V3 显式迁移已完成并交回主任务；候选世界验证后显式释放。最终无竞态 static/build 均通过；S2 阶段提交交给独立审阅。
- 主任务拥有依赖/锁文件、治理文档、PlayerState/Inventory、Autonomy/Authority 集成；Action/Combat 子任务已交还所有权。Pack 组合身份保存留给 S3，当前不声称完整新存档合同完成。
- 已设置本任务定时续跑；恢复时先检查本任务活跃子任务与当前 git 状态，复用其工作，禁止重复派发或覆盖改动。

## 后续依赖顺序

1. S2a：可组合 ECS 实体状态 owner、稳定身份/lifetime、派生空间索引、旧门面兼容。
2. S2b：玩家/NPC 的生命、需求、库存/装备与控制逐字段切换，去掉旧权威存储。
3. S2c：保存组件/组合身份、V1/V2/V3 迁移与动作/epoch 绑定；坏输入不替换当前世界。
4. S3：第一方 Pack/Playbook 与标准机制真实接线，规则阶段、生存/创造和世界创建/恢复。
5. S4：工位、加工/储物、木石铁成长、食物昼夜和完整基础循环。
6. S5：替代 provider/Playbook、跨宿主、错误恢复，公开 API 候选整理。
7. S6：全量确定性门禁、真实浏览器与视听旅程、独立审阅、PR/CI/mergeability 读回。

## 问题记录

- 原配置 registry 未同步 devalue@5.9.2，曾阻塞正常 pnpm add；公共 npm 已验证版本存在。用户随后明确授权本项目全部使用 npmjs，现写入项目 .npmrc 并恢复安装，不改全局源、旧依赖版本或供应链策略。S1 的失败与修复保留在 evidence 和 s1-evidence。
- S2 已接入实体组件、生命周期和 codec；模块注册的调度、事务与 Pack 组合身份仍待 S3 真实消费者，不能沿用 S1 静态通过宣称完成。

- npmjs 安装成功，锁文件仅新增 bitecs@0.4.0；生产安装包 87 个文件 SHA-256 全部匹配获批包体 receipt，包名、版本和 MPL-2.0 元数据一致。项目 registry 读回为 https://registry.npmjs.org/。

## 验收原则

每个切片在生产修改前取得相应 RED，集成后运行受影响测试；阶段末分别运行 verify:static 与 build。基于逻辑测试、浏览器行为、视觉体验和远端 CI 的结论分别记录。不并行构建与全量覆盖率检查，避免再次引入既有 ESLint 测试超时。

## S3 当前分工与恢复点

- S2 修复提交：`13b62f9`（allocator/path 校验）与 `5ff491f8cf3ddc3adf90d02774f8a51f7618a442`（致死命中恢复）。独立回读确认原 3 P1 与 1 P2 已关闭；新发现的 resultSequence 耗尽 P2 已在当前工作树补 RED/GREEN 和前置容量检查，待 S3 冻结后再回读。
- S3a 内容隔离已完成并交回；S3b 已有注册状态/操作/规则、原子候选提交、保护读取、不可变事实、限量排队与同步重入拒绝。真实 player/NPC ECS 库存转移 4 项通过，不以协调器测试冒充完整玩法集成。
- 第一方物品/配方/战斗定义已归 `playbooks/overworld/`，旧 helper 读取同一来源。默认 Pack 通过公开 facade 组装 content/inventory，扩展后注册的物品/配方进入最终每世界内容表；namespace 与旧 storageId 映射显式校验并记录。
- 当前已有 `scripts/build-gameplay-packs.mjs` 构建单 ESM、manifest 和 SHA256 lock，实际 loader 读回通过，产物仅在忽略的 dist/packs。已接入 Browser Worker 与 Headless 产品启动；每次候选恢复重新装配。真实 headless /seed smoke 与 Browser 检查点往返定向通过；篡改 ESM 的负例正确阻止启动。初次 Browser 正例超时保留，后续冻结源再统一复跑。
- 生命周期 API：显式注册 start/stop operation 与 interval/before/after system；同步显式推进，最多 256 次补跑，余量快照恢复，操作失败进入 failed。尚未把现有 gameplay 调度全部交给注册机制。
- GameplayRuntime 已接受 composition、由 provider 解析内容，并在 V4 写 Pack lock、定义映射、codec、规则/系统顺序。缺失/不同摘要/不同 codec 在替换 owner 前拒绝；对应 4 项测试通过。旧 V1-V3 仅允许宿主显式开启默认 Overworld 迁移。完整 frontier 与模块调度保存仍待接入。
- S3d UI、创造物理、方块交互与 S4 工位/物品实例候选均已交回主任务，当前写入冻结后由主任务统一收口。机制迁移 reviewer 只读，不修改源码。
- 当前无全量 S3 static/build 或浏览器准出结论；定向 composition+治理测试最近 8 文件/60 项通过，后续新增 checkpoint/allocator 用例另有独立日志，最终应再汇总当前树。

- 模式 ECS owner、普通 self principal 命令链、实际安全落地、创造需求/伤害免除与模式/目录存档已取得定向 GREEN。注册操作在恢复后清理 binding/subscriber/queue；旧 actor lifetime 再使用被拒绝。GameServer 实际资源目录进入 Headless/Browser authorizer，模式 UI 命令固定普通 browser-player 的 self 权限。
- 权威 PhysicsSnapshot 新增派生 movement revision/flight speed，预测和 replay 复用同一 stepBody flight 模式；模式变更清理旧预测并拒绝旧 movement revision 的迟到输入。未经历模式变化的旧 survival 输入保持兼容。真实 Headless flight/input 与预测 2 文件/4 项 GREEN，相关完整输入回归仍待运行。
- 已知仍缺：完整 Ruleset/标准机制注册迁移、生命周期与模块 frontier 保存、UI/真实飞行旅程、S4 实际工位/成长世界接线、S5 替代 provider/跨宿主、S6 全量/独立审阅/PR。不得标记整个 S3 已完成。

- 实际跨 binding 同步重入已补 RED/GREEN：每世界共享提交锁，事实监听器只能排队到后续显式推进；每次排队消费总计最多 64。无效时间推进先校验，再消费队列，避免失败调用改动世界，新增原子拒绝用例通过。
- S4 物品实例已接入实际 ECS 世界掉落物与库存候选，give/drop/V4 restore/pickup 保持独立耐久状态。默认工具耐久扣减、工位 ECS 生命周期与注册操作尚未完成。

- S3 产品接线检查点：全量 static 1351 passed / 4 skipped 与 build 已分别通过；四项真实 Browser 场景通过，截图复核发现并修复按钮布局覆盖。最终布局修复后 static/build 再次分别通过，Browser 4/4 再次通过；4173 已释放。详细失败、范围和仍缺口见 [检查点](s3-product-checkpoint.md)。剩余机制已取得一次独立只读复核，按 [闭环切口](s3-mechanism-closure.md) 实施。

## S3 机制闭环恢复点

- 可运行检查点已提交 `7a474da217071621930f9745ae3a700050fcddb3`，提交后工作树曾确认干净；该提交包含最终 static/build 与四项 Browser 定向验证的产品接线，未标记 S3 完成。
- 当前 `s3_mode_ui` 名称复用为生命周期合同实施者，只拥有 lifecycle-contracts/lifecycle-registration/module-lifecycle 与自身测试、设计、证据；原 UI 路径已经归还主任务。
- 当前 `s2_action_restore` 名称复用为持久授权来源合同实施者，只拥有 world-authorization、新 execution-origin 与自身测试、设计、证据；原 Item/Inventory 路径已经归还主任务。
- 主任务拥有规则阶段、composition identity、真实 Gameplay/Authority/存档与后续原子 owner 集成。两个 child 不改这些路径、不运行完整 static/build、不提交。
- before/effective input/operation/after 已补三项决定性 RED 后取得 GREEN，加既有事务回归共 2 files / 10 tests。规则阶段进入组合身份，反向跨阶段依赖在装配时拒绝。尚未声称默认 needs/combat 已迁成真实注册操作。

- 持久来源 child 已返回：稳定 subject 的精确宿主映射、Pack/module 和原 actor lifetime 校验、恢复重新授权合同通过，getter 输入在读取前拒绝；当前还未接入实际 Combat 当前/缓冲动作。
- 根任务已接入 actor/system 操作联合：独立 system principal、准确注册 system ID、world operation target；不虚构 originalActor，不允许管理员或服务主体互换。真实 manager 的 system binding 随恢复代次和 dispose 失效。独立机制 reviewer 已完成，当前只读，无源码所有权。
- 明确 world Ruleset owner 与只读状态 observation 已接入实际 Mode 操作和 V4；before/effective input/after 阶段进入冻结组合身份。默认 needs/damage/place 规则仍待实际迁移。
- 实际 GameplayRuntime 已接入组合世界的唯一 ModuleLifecycle 时间与 V4 moduleSchedule；新世界首次推进/保存激活，直接恢复不先 start，恢复成功使旧 binding 失效。保存前有界排空队列，仍有工作则拒绝保存。真实 0.4+恢复+0.6、无重复 start、坏 schedule 无替换、撤权拒绝、循环队列拒绝通过；当前定向 composition 14 files / 78 tests GREEN。本次新增尚未由全量 static/build 或 Browser 覆盖。

- 生命周期补强已返回且归还全部路径。当前无写入 child。此轮 full static 1380 passed / 4 skipped、build 与 Browser 4/4 分别通过；失败和修复、仍缺口见 [机制检查点](s3-mechanism-checkpoint.md)。下一切片：ECS 与 World 参与者的完整预校验和无失败同步 apply，随后实际 needs/Combat 消费。未改变 S3/S6 状态。

- 机制检查点已提交 `df8a8f263f60082f0786cb05394302206eca46b4`，提交后工作树曾干净，Browser 4173 端口已释放。`s2_action_restore` 再次复用，合同 `/tmp/seedlands-s3-handoff/entity-atomic.json` 限定为 prepared ECS participant，拥有 EntityStore、EcsEntityOwner、ecs-actor-state、新 prepared-entity-mutation 与自身测试/设计/证据。Root 拥有 World 单编辑参与者和后续实际协调器；旧其他 child 均已返回。

- ECS participant child 已归还全部路径，当前无 child 写入。真实 drop/pickup 与放置/挖掘已采用 prepared ECS/World 参与者，定向故障与真实 GameServer 测试通过。正在冻结全量验收，见 [原子检查点](s3-atomic-checkpoint.md)。needs/Combat/致死原子结算与 S4–S6 仍未完成。

- 原子参与者冻结验收：full static 1398 passed / 4 skipped、build、Browser 组合 4/4 与真实采集合成战斗保存旅程 2/2 分别通过；任务 4173 端口已释放。形成下一可运行检查点，S3 仍在实施。

## 生命、动作与注册机制继续点

- 原子检查点已提交 `24ac343`，提交后工作树曾确认干净。当前 root 负责 vitals/needs、Action settlement、Gameplay/Autonomy 与后续注册接线。
- `s2_action_restore` 正在实施 Combat 当前/缓冲来源和 V3 codec，固定合同 `/tmp/seedlands-s3-handoff/combat-origin.json`，hash `a7aa39ed7895279e32aebcbe565fe7a9d5fdad1d74fd2affb68cfb928575238c`；只拥有 CombatRuntime、combat-runtime-snapshot、新 combat-origin 与自身测试/证据。`ecs_review` 正在只读复核真实 world-target 系统与有界 actor 候选调度接缝，无写权限。
- root 的普通玩家致死/饥饿死亡已取得 3 个真实 RED 并修复，NPC 掉落耗尽删除实体的 RED 也已修复；相关 3 files / 21 tests GREEN，日志 `/tmp/seedlands-s3-npc-vitals-green.log`。Combat active phase、Action 终态事件的跨 owner 完整原子性仍未完成，不能把 ECS 的通过冒充该结论。
- ActionRuntime 新 prepared settlements 最多 128 项，先完成所有结果 clone，再安装终态；普通 finish 复用。不可 clone 结果已复现先改状态的旧漏洞。定向测试不得在 child 半成品状态下解释为生产回归：一次 Combat `acceptOrigin` 尚未写完的并发采样失败保留 `/tmp/seedlands-s3-action-settlement-green.log`，待 child 交回后统一复验。

### 注册 Needs 接线进行中

独立机制复核已返回；采用 world system + 5 个各 128 actor 的状态分片，共用一次 ECS 分配预检和提交。已新增 Needs 模型、规则与 host owner 候选，正在接入实际 Gameplay/Autonomy，尚未取得该切片 GREEN。Combat 持久来源子任务已返回，实施者继续 Prepared Combat frontier；其 owned Combat 文件仍由该实施者独占。S3 Implementing，S4–S6 未准出。

### Needs 注册消费者冻结准出

Combat 当前/缓冲来源及 Prepared Combat 子任务均已归还路径；没有写入 child。默认 Needs 已由真实注册系统处理，Browser/Headless 使用显式 system policy；无 Needs 组合关闭隐式玩家/NPC 分支。旧 V3 NPC phase、跨片死亡/掉落失败与 Action 结算定向通过。full static 1433 passed / 4 skipped、build、Browser 组合 4/4 和真实玩法旅程 2/2 分别通过，4173 已释放，见 [Needs 检查点](s3-needs-checkpoint.md)。只读 reviewer 正在复核该冻结切片。下个切口是 prepared attack request（含 zero-windup）与真实 actor-origin / registered damage 消费，S3 仍 Implementing，S4–S6 未准出。

- Needs 检查点最终修复与准出：独立审阅发现并关闭 513 retained actor 恢复 P1，根复核补齐 20Hz phase 精度；最终 full static 1435 passed /4 skipped、build、Browser 6/6 分别通过。独立 bounded pass、43/43 source SHA 匹配，当前无 reviewer 或写入 child 活跃；4173 已释放。准备语义提交后进入 prepared request + registered damage。

## 注册 Combat 继续点

Needs 检查点已提交 `37c1619`，提交后工作树确认干净。复用 `s2_action_restore` 实施 prepared Combat request，合同 `/tmp/seedlands-s3-handoff/prepared-combat-request.json`，hash `cbc543538066e1bb7bcef4be9b5bd15f45152a1a6fb4c59794ec1e68dba9dc79`，仅拥有 CombatRuntime、prepared-combat-mutation、新 combat-request-candidate 和该切片的测试/设计/证据。Root 拥有 ActionRuntime prepared start、注册 Combat 与宿主 origin 接线；reviewer 已返回。上一轮通过不能覆盖本轮未提交的新代码。

Prepared request 子任务已交还全部路径，当前没有写入 child。Action/Combat 接受候选及注册库存/时钟容量修复已冻结通过 full static 1446 passed /4 skipped、build 和 Browser 6/6，4173 已释放，见 [接受检查点](s3-prepared-acceptance-checkpoint.md)。`ecs_review` 只读复核后续真实 Combat 接缝，合同 `/tmp/seedlands-s3-handoff/combat-host-review.json`，hash `d0221cdf57d7fffb5d6a824d4dbc08ac58075bef083a2dbd8834ebe487e4269c`；不拥有写路径。S3 Implementing，下一步仍是注册攻击/调度/延迟伤害与宿主 origin，并非 S3 或 S6 准出。

接受检查点已提交 `e0ceac6`，提交后工作树曾确认干净。只读接缝复核已完成，采纳 typed candidate + host prepareCommit（最终 value 写前复制）与 after 第四参数。Root 已补 host envelope、冻结入口 operation ID 防止 after 规则被 request 对象修改绕过、prepared owner 路由；相关 composition 17 files /100 tests GREEN。另有 actor authority、perception、Combat damage/effects 定向 GREEN，当前尚未接入默认产品，不能用早期 static/build 覆盖这些新文件。

Combat 纯模块子任务合同 `/tmp/seedlands-s3-handoff/combat-module-candidates.json`，hash `d301900e51e92345fefbae186d5bd5a9e85ac01e1ea431c0a322bf0c8a65bbdf`，48 小时新 envelope hash `608ce6a28da025c2d3e1ae39de93099c5e7b99e1f5a0d46e530b13b3e43f4e5f`。子任务已交还 3 个 Combat 模块文件、候选测试和自身证据；5 个纯候选测试 GREEN，无活跃写入 child。Root 正在实际 host owner/Autonomy/Gameplay/Browser/Headless 接线，方案见 [注册 Combat](s3-registered-combat-design.md)。其原 test-project 缺失 root 尚在创建的 effects 文件只是并发中间态，待全部写入结束后再统一验收。

## S3 注册 Combat 实际消费恢复点（2026-09-10）

- 当前在 `e0ceac6` 之上接入零状态写候选、host prepareCommit、真实 ECS 投影、共享 Combat/Action/ECS/Perception 提交、Browser/Headless 当前主体策略和命令入口。移除 Combat provider 的组合明确 unavailable。
- 临时恢复校验 owner 使用当前来源策略；权限失效时玩家 Action 与 Combat 一同取消。空闲 Combat system 不占用最后一个 gameplay revision。定向组合/恢复/Headless 24 文件 149 用例通过。
- 生产路径冻结后 `pnpm verify:static` 通过：295 文件 passed /2 skipped，1481 用例 passed /4 skipped；Svelte 0 errors/0 warnings。随后 `pnpm build` 通过，仍只有既有 PlayCanvas 大包提示。日志为 `/tmp/seedlands-s3-registered-combat-static.log` 与 `-build.log`。随后 Browser 6/6 通过（26.5 秒）且 4173 已释放；独立只读复核仍在运行。完整范围与后续问题见 [注册 Combat 检查点](s3-registered-combat-checkpoint.md)，不以此标记 S3 完成。
- 下一轮必须解决/复核：连击切目标后的 Action/Combat 身份恢复合同、Mode/Inventory 取消的事务迁移、脚本控制实际入口的来源保留，以及完整标准模块边界。S3 仍为 Implementing；S4 工位与耐久实际消费、S5 替代组合、S6 全量旅程/交接未完成。

### 注册 Combat 后续复核与 Mode 接线（2026-09-10）

`2686a5e` 独立复核已返回两个 P1：宿主 post-hook 读取可变请求，以及 resolve 内部失败被取消路径吞掉。两个有效 RED 与修复后 13/13 focused GREEN 已取得；新 Action 目标归属修复同时覆盖连击第一目标死亡后的保存恢复。全部新增代码尚未跑 full static/build，不计阶段准出。Mode prepared owner 子任务正在独占 mode-runtime、mode-state-port、prepared ECS pose 扩展及自身测试；root 负责 Autonomy 取消和实际接线。S3 仍 Implementing。

真实脚本 `start-action attack` 绕过注册 Combat 的 RED 已确认并修复；实际 Headless 的直接攻击/Action 攻击、无权限拒绝、换别名恢复和当前撤权共 5/5 focused GREEN。真实创造快捷栏规则 veto 的 RED/GREEN 已取得；Mode 与 Combat 联合候选含 result allocator 耗尽负例 17/17 focused GREEN（后续追加快捷栏后 18/18）。Inventory transfer 失去当前武器时 Action/Combat 原子取消的 RED/GREEN 已取得；普通六项库存消费者接线见 [设计](s3-inventory-consumers-design.md)，仍在实施。

## S3 库存与 Mode 检查点（2026-09-10）

真实库存六类注册消费者、Mode prepared owner、命令来源保留、Action/Combat 目标恢复与 prior Combat P1 已闭合。独立复核发现并修复 craft receipt 使用旧 input、最终 clone 后世界几何陈旧两类问题；最终 full static 1528 passed /4 skipped、build、Browser 6/6（25.7 秒）分别通过，4173 已释放。独立 reviewer 对最终源码回读无剩余发现，见 [库存与 Mode 检查点](s3-inventory-mode-checkpoint.md)。S3 仍 Implementing；继续 Place/Break 与 give/remove，S4–S6 尚未准出。

## S3 方块实际消费者检查点（2026-09-10）

Place/Break/clock/finish 已接入真实注册 owner，开发者 give/remove 采用 prepared ECS。单操作 clock/finish 边界已独立复核；完整消费者审阅仍在进行。冻结 full static 1561 passed /4 skipped、build、Browser 6/6（30.3 秒）分别通过，4173 已释放，见 [方块检查点](s3-block-consumers-checkpoint.md)。先前窗口候选因绕过 clock 规则被新增 RED 否决并删除，失败日志保留。S3 继续 scripted Logic 与地面食物消费接缝，S4–S6 未准出。

### Block 独立复核修复检查点

已修复 V4 挖掘恢复 codec、分帧计时漂移、配置嵌套别名三项 P1 及硬度零值 P2，独立审阅 bounded pass。最终静态 1583/4、build 和原定 Browser 6 项通过。额外旧木剑体验场连续攻击断言失败已保留日志，列入 S6 演示复验，不声明整体准出。详见 s3-block-consumers-checkpoint.md。继续 scripted Logic 实际 principal 与 ground food owner；S3 仍 Implementing。

## S3 Logic / Feeding 接线及木剑重置恢复点（2026-09-10）

- 真实 scripted Logic 保留 Harness principal，逐 actor 检查 world.action execute；Combat 不借自治来源，默认开发者稳定 subject 支持跨宿主 alias/current policy。
- 地面食物消费已注册并统一预备 ECS needs、world-item、即时 Eat Action 与 Combat/自治效果；旧 pending Eat 在隔离恢复验证中取消，食物/needs 不变。
- 第一轮冻结消费者树 static 1618 passed / 4 skipped、build 和本 change Browser 6/6 分别通过，基础 gameplay-foundation 2/2 通过。其后独立复核指出 actor execute 未独立检查，已补两条有效 RED 并修复 principal+module 两层授权，最终完整复验待完成。
- 木剑旧回归再次失败，trace 捕获重置复用 retired EntityId；已改为每次实例 UUID 角色身份、准确清理及重置 Promise 复用，真实 ECS 双次重建 3 项定向测试通过。Browser 旧回归改为等待旧目标消失及新目标齐备，不沿用旧 DOM 瞬态作为成功。最终 Browser 复验未预填。
- 当前 S3 仍 Implementing；默认方块/生物内容归属、S4 实际工位/成长、S5 替代玩法、S6 完整旅程/PR 仍未交付。没有推送或 PR，也没有新增外部依赖。

## S3 跨目标授权与方块内容检查点

Inventory / Block / Combat 已补原始 actor execute 的调用者与模块检查，延迟采集/命中重新验证，实际撤权反例由 RED 转为 GREEN。默认方块定义已归 Overworld，并由规则 capability 提供实际世界查询，省略 provider 不隐式返回默认内容。完整 static 1632 passed / 4 skipped、build、Browser 12/12 分别通过；任务 4173 端口已释放。准确证据见 [跨目标授权](s3-secondary-actor-permissions.md)与[方块内容](s3-block-content-design.md)。

S3 核心实际消费者已接入；仍需默认内容与替代装配共同验证收尾，阶段保持 Implementing。S4 工位 owner 与工具成长接线继续推进，候选函数通过不代表世界/保存/UI 已完成。没有推送、PR 或合并。

## S4 / S5 集成冻结准备（2026-09-10）

工位 ECS/保存/驻留、木石铁耐久与 V4 矿物、可再生食物、实际 UI 成长已实现；成长生产 Browser 1/1、两日 Headless 1/1 与静态中间检查 1733/4 分别通过。角色配置与可选生态正在最后收尾，独立点击转换/纯建造 Headless 2/2 已通过，当前世界独立物品模型回归 20/20。详细失败与证据见 S4 工位记录和 S5 provider 记录。

最新主干已读取到 `baeba09`（#27，CI 与动态阴影）；将先保存当前实现提交，再同步此已合并基线并重跑最终 static、build、Browser。新增跨宿主与生存 HUD 浏览器场景尚未运行，不预填准出。S6 还需固定提交独立审阅、完整 T01–T14 映射与 PR/CI 读回。自动续跑保持，未停止目标。

## S6 当前恢复点（2026-09-10 08:18）

生产实现当前 SHA `50ff14c`：full static 1759/4、build、生产 Browser 10/10、dev regression 21/21、资产/木剑/#25 5/5 全部通过，CI 同配置 dev 新场景另复验 10/10。最后一个 Combat 无近战目标被错误拒绝的问题已修复并补真实 owner 正反例。完整对照见 acceptance-map.md，演示与原始截图见 demo.md。所有任务服务停止，4173 已释放。

根正在提交 CI 新场景步骤和验收文档，生产源码未变。S6 独立 reviewer `s6_final_review` 对 61901d3 全分支及 50ff14c 修复 delta 持续只读审阅；修复 delta 已初步确认闭合，完整报告待返回。之后按具体 findings 修复/复验，再 push/创建 PR 并跟进当前 HEAD 必要 CI 和 mergeability。尚无 PR、不自动合并，heartbeat 未停止。
