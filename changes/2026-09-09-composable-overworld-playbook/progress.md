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
