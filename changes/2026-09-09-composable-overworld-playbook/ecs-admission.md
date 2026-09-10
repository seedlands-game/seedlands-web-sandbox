# S2 ECS 依赖准入补充合同

日期：2026-09-09。状态：**Approved / Implementing**。用户在本任务明确“批准执行”，并授权自主持续推进到 S6；获批原始字节见 [批准副本](evidence/ecs-admission-approved.txt)，SHA-256 为 `ae661e8e916f9286bf84f84ed382cb97f512a12b23aeb5cc9a09050c7c1b7816`。本处仅更新审批状态，不改变适配合同。

本文件补充已批准 spec 的 D3，不扩张玩法、宿主、存档输入或性能目标。审核对象为本文件完整 SHA-256；本文件绑定的实验源码与结果摘要一并属于审核材料。原方案批准继续有效，此处只裁决具体 ECS 依赖与适配方式。

## 推荐与已查明事实

推荐生产依赖锁定 **`bitecs@0.4.0`**，只从根入口使用实体、组件和查询 API；不引入 `legacy`、`serialization`、关系/继承、共享 EntityIndex 或自研通用 ECS。采用理由是当前切片所需的可组合组件能力，以及对现有单世界 owner 和空间/物理接口的接入可行性；不是性能收益。

| 检查                       | bitECS 0.4.0                                                                                | Koota 0.6.6                                                |
| -------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| npm 已发布时间             | 2025-12-06                                                                                  | 2026-04-09                                                 |
| 包内元数据与 LICENSE       | MPL-2.0，二者一致                                                                           | ISC，二者一致；许可文件保留其原始占位署名                  |
| 运行依赖                   | 无                                                                                          | 无；React 与 types 为可选 peer，实验未安装                 |
| 安装脚本                   | 无 install/postinstall                                                                      | 无 install/postinstall                                     |
| 纯 ES2022 类型环境         | `types: []`、无 DOM/Node ambient、不跳过库声明检查，通过                                    | 同样通过                                                   |
| 发布 ESM 入口闭包          | Browser platform bundle 成功；单个发布入口文件                                              | Browser platform bundle 成功；两个发布文件                 |
| 两世界、销毁、旧动作、恢复 | 隔离适配实验通过                                                                            | 同口径实验通过                                             |
| import 可见影响            | 增加 `bitecs-global-wildcard` 与 `bitecs-global-isa` 两个 global symbol；未修改 Number 原型 | 修改 Number 原型的 12 个方法，并使用包内全局 universe      |
| 本期选择                   | 推荐有界接入，关系全局不作为本期状态入口                                                    | 保留对照结果，未选；不额外承担原型补丁与 universe 的接入面 |

版本、元数据、包体来自 [bitECS npm registry](https://registry.npmjs.org/bitecs/0.4.0) 和 [Koota npm registry](https://registry.npmjs.org/koota/0.6.6)，包体的 SHA-512 与 registry `dist.integrity` 一致。浏览器搜索摘要的 Koota 版本曾滞后，未用它替代发布包。许可字段只是查证结果，不将本实验作为法律审查结论；接入保持依赖和许可原文、来源可追溯，不修改或重许可上游库文件。

bitECS 的两个 relation singleton 是明确保留的依赖副作用，不能称为“零全局”。它们不持有本期世界状态或平台端口；本期不调用其关系/继承 API，不向 mod facade 暴露库对象。后续若发现实体、组件、query 或 dispose 的状态跨世界泄漏，拒绝采用并重开 D3；不得自行 fork 修库或换另一库。

## 实验及证据边界

[隔离实验](experiments/ecs-admission.mjs)只在工程目录运行，生产没有导入它。两候选通过正常 pnpm 在独立临时项目中精确版本安装，禁用生命周期脚本；本仓库的 package manifest/lockfile 没有新增 ECS 依赖。下载后的包先静态审查，再执行实验。

每个候选在独立 Node 进程中运行同一组检查：

1. 每世界独立创建组件与 ECS world；同一稳定身份在两世界的坐标、库存互不影响。bitECS 初始内部编号均为 1。
2. 位置/速度、生命、库存分别为组件，领域值只存于组件；身份 Map 只保存字符串到内部 ID 的映射。
3. 返回投影复制，外部更改数组或物品数量不写回状态。
4. 先实际建立 query，再销毁并立即分配。bitECS 在分配前固定调用 `commitRemovals(world)` 刷新延迟删除；内部 ID 1 被复用，query 精确 EID 集、每项组件成员与返回的稳定身份均匹配。另测去除/重新添加 Inventory 的查询筛选；旧外部 Action 引用被拒绝，新实体不继承旧库存。
5. 同一地板、输入、dt，从 ECS 组件与旧 EntityStore 分别读取初值，各自调用既有 `stepBody` 180 步并逐步比较位置/速度；落地相同。实验 adapter 自己维护只存稳定 ID 的派生 bucket，只有其 spawn/move/despawn/restore 更新；跨 bucket 移动、移除及恢复后验证新位置可查、旧位置和已删实体不可查。与旧 EntityStore 的空间查询对照，但生产索引接线尚未完成。
6. 独立 JSON checkpoint codec 保留稳定身份、组件值及分配信息，恢复到当前/新建世界后事实相同；恢复提升 epoch，恢复前外部引用拒绝；该实验没有保存 ActionRuntime 的动作，不能证明存档内动作已迁移。dispose 不破坏另一个世界。
7. 对真实发布入口执行 Browser platform bundle；独立 TypeScript probe 在 `lib: ES2022`、`types: []`、`skipLibCheck: false` 下通过。

这些是 **有界库准入**，不是生产 EntityStore/PlayerState/AuthoritySession 迁移、V1/V2/V3 兼容、完整空间索引、跨宿主 checkpoint 或浏览器产品验收。派生 bucket 是隔离适配实验，复用既有 8 格分桶语义；不是 ECS 库自带空间索引，也不表示生产 EntityStore 的索引已迁移。实验未度量帧率、延迟、GC 或系统负载，不据输出 bundle 字节数宣称体感性能。

初次实验失败保留：脚本的源码根相对路径多向上一层，导致 esbuild 找不到基线文件；修正后通过。类型探针最初把 bitECS `QueryResult` 错当 `readonly number[]`，真实声明也允许 typed array，修正为消费时 `Array.from`；适配层不得把临时 query 视图直接暴露或持久保存。两次均为实验接线缺陷，不记为库行为失败或生产 RED。

## 拟批准的生产适配合同

- 只给 `@seedlands/game-core` 增加精确运行依赖 `bitecs: 0.4.0`，正常 pnpm 更新相应 lockfile；不改全局设置或供应链策略，不新增 React/Koota/其他 ECS 依赖。供应链若拒绝仍停止。
- `server/gameplay` 内提供一个私有 ECS 适配 owner，创建自己的 world、component refs 和 EntityIndex；不共用模块级可变组件。标准模块通过类型化 owner 端口读写，Pack 仍只导入 `mod-api`。
- 稳定身份与内部可回收数值分离。使用每世界默认 EntityIndex，不启用数值 ID 的 version bits；每次 `addEntity` 前执行 `commitRemovals(world)`，不向消费者保留裸 query view。身份分配器/恢复状态必须避免复用已发放的 EntityId；引用携带单独的领域 lifetime 与 epoch，不依赖有限位数回绕。单凭 `entityExists(eid)` 不构成身份校验。
- 生命周期初始化每个组件；删除清除引用值、空间索引、控制与在途动作，移除成员后不再读其槽位。query 结果在每次消费时使用，不能跨结构修改保留内部视图。查询排序及资源争抢按现有逻辑时序/稳定业务 ID，不按 ECS 编号。
- 按 spec 顺序迁身份、位置/身体、生命，再迁需求、库存/装备、控制；`EntityStore`、`PlayerState` 与 `GameplayRuntime` 旧入口逐字段改为转发/投影。不得保留旧字段双写，也不能以整行旧对象附一个 tag 代替组件化。
- `AuthoritySession` 仍拥有物理推进职责，位置提交接到新的唯一状态 owner；空间 bucket 保留为可重建派生索引。先验证玩家、NPC 和掉落物既有物理/战斗/空间回归，再扩大迁移字段。
- Inventory 保留其候选复制与一致替换语义，由 Inventory 组件持有实例；NPC/玩家共用操作入口。ECS 层不改变授权、资源守恒或动作命中规则。
- 保存使用领域 codec 和稳定 ID，不用 bitECS serializer，不泄漏 `$internal`、component refs、内部 ID 或 query buffer；新世界在所有装配/存档校验通过后替换旧世界。V1/V2/V3 的现有迁移仍须真实 fixtures 证明。
- 根公开 facade 不导出 bitECS；静态边界与正反例证明 Pack 不依赖该库或 core 私有实现。测试覆盖两世界、引用失效、组件生命周期、坏存档原世界不变和原 Harness 回归。

## 字段切换与动作恢复合同

| 字段/状态                              | 新唯一 owner                           | 唯一写入口与切换完成条件                                                                                            |
| -------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| EntityId、lifetime、分配序列、组件成员 | 每世界私有 ECS 适配                    | create/destroy/validated restore；旧 EntityStore Map 删除对应权威字段，公开 entities 只投影或转发                   |
| 位置、速度、身体实例状态               | ECS Body/Transform 组件                | AuthoritySession 负责 step 算法，结果只经 body commit 写组件；旧缓存只为同 tick 输入/派生投影，下一 tick 从组件读取 |
| 生命、上限、存活状态                   | Health/Lifecycle 标准组件 owner        | damage/heal/respawn 一致提交；PlayerState getter/setter 只转发，NPC 与玩家不再各有一份 health                       |
| 饥饿、恢复/饥饿累加器、需求            | Needs 标准组件 owner                   | needs tick/食用事务；旧 PlayerState 和 actor needs 的迁入字段删除旧可写存储                                         |
| Inventory 实例、快捷栏、装备/耐久      | Inventory/Equipment 标准组件 owner     | 候选操作→校验→替换；不向 facade 返回可变 Inventory 实例；旧 getInventory 只返回复制投影                             |
| 控制来源、epoch/lifetime 绑定          | Control 组件与现有宿主 gate            | 宿主 bind/revoke/restore；请求 payload 不能自授身份，旧请求的 epoch gate 保留                                       |
| 分桶/近邻索引                          | ECS 适配的派生缓存                     | 仅在 adapter 的 spawn/move/despawn/restore 更新；只存 ID，查询回读组件位置，恢复重建                                |
| 逻辑动作和战斗阶段                     | 现有 ActionRuntime/CombatRuntime owner | 本期不复制动作容器；actor/target 引用从稳定 EntityId 解析并附 lifetime，执行检查点重新验证                          |

迁一个字段组就同时切断旧写面并运行该组回归；不得把两个可写对象用同步函数维持为长期方案。整组尚未切换时仍由旧 owner 负责，不让半迁移状态混入已声明的新 owner。

动作恢复区分两种对象：

1. **恢复前的外部请求、逻辑意图和引用**：SessionEpoch/原始角色控制绑定立即失效；`LogicIntent`、异步路径/策略结果的 identity 与 actor/target lifetime 必须在接收和执行时核对，旧结果不能写入新世界。
2. **checkpoint 内保存的动作**：继续由既有 `ActionRuntime.restore`、Autonomy/Combat codec 解析，在候选世界中迁移引用并恢复合法阶段，不把本实验的“外部旧引用拒绝”套到这些动作上。新格式保存动作 actor/target 的领域 lifetime；恢复时重绑到新的 session epoch，阶段、剩余时间和去重状态保留。lifetime 不匹配的非终态动作以明确失败/中断回执结算，不对新的同名实体执行；终态历史记录保留其原始稳定身份，不要求已销毁目标仍存在。
3. **V1/V2/V3 没有 lifetime 的输入**：先用既有 validator/migrator 读取并建立候选实体表，再给存活实体分配新 lifetime；对合法非终态动作中的 actor/target 在该候选表解析并绑定。缺失目标的动作转为 `failed`，原因 `restore-target-missing`，保留动作与结算记录；缺失执行 actor 等既有非法存档仍在替换当前世界前拒绝。已有旧战斗存档的 `restore-cancelled` 行为继续保留。迁移只发生一次，写出新格式后不再次重置阶段。

生产验收必须补 V1/V2/V3 各版本的非终态/终态动作、目标移除、checkpoint 后同名生命周期变化、旧 LogicIntent 到达、合法恢复继续执行且不重复结算的 fixtures。当前库实验不包括这些用例，因此本合同只批准准确的实现和验收方向，绝不将其标为已通过。

## 运行身份与复现

初版 reviewer 指出的查询/空间/动作/产物身份缺口已记录，初版 JSON 保留为 `*-admission-initial.json`，其 PASS 只适用于当时较窄的检查，不作为完整准入。当前结果包含 Node/pnpm/TypeScript/esbuild 版本、命令及成功退出、实验 hash、隔离 manifest/lock hash、实际运行入口闭包和 control 源文件 hash。

另用 `verify-ecs-artifacts.py` 重新下载固定 upstream tarball，实际计算 SHA-256/SHA-512，并逐文件比较安装后的整个候选包。`*-artifact-receipt.json` 区分 upstream metadata URL、实际下载并核验的 archive URL 与当前 pnpm registry 是否为公共 npm 源；非公共源地址脱敏。原始安装日志没有逐包传输 URL，且命中过共享 store，所以其网络来源明确记 unknown；不把当前 registry 配置追认为历史传输来源。实际执行文件与已核验 archive 全部逐字节一致，独立于源站/镜像传输选择。

从仓库根目录复现（需要 Python 3、Node 和项目指定 pnpm；不要安装到生产 workspace）：

```sh
trial_dir="$(mktemp -d)"
printf '%s\n' '{"private":true,"type":"module","dependencies":{"bitecs":"0.4.0","koota":"0.6.6"}}' > "$trial_dir/package.json"
pnpm --dir "$trial_dir" install --ignore-scripts
node changes/2026-09-09-composable-overworld-playbook/experiments/ecs-admission.mjs bitecs "$trial_dir"
node changes/2026-09-09-composable-overworld-playbook/experiments/ecs-admission.mjs koota "$trial_dir"
python3 changes/2026-09-09-composable-overworld-playbook/experiments/verify-ecs-artifacts.py "$trial_dir" "$trial_dir/receipts"
```

复现时保留所需报告后，只清理自己创建的临时目录。供应链拒绝时停止，不能换源或改门禁。本报告的 manifest/lock hash 绑定本次实际临时项目；复现采用不同 JSON 排版会改变 manifest hash，因此应比较各自完整 receipt，不能只拿版本号推定相同运行身份。

## 停止门与剩余验收

本文件经精确 hash 批准后才安装生产依赖并实施上述迁移；当前只完成隔离准入和具体适配方案，不将 S2 标为完成。发现许可内容或版本摘要变化、跨世界状态泄漏、受支持存档不能保持、需要修改库或改变公开合同，停止并重开该决定。

本补充不重新批准全部 S1–S6，不改变已批准主 spec 的授权边界，也不授权自动 merge。S1 可独立完成其检查；玩法迁移与完整旅程继续由 T04–T14 验收。

## 绑定证据

以下摘要绑定实际实验、包体核验器和当前运行/包体 receipt；冻结后再计算本文件审核 hash。

- `experiments/ecs-admission.mjs`：`1b76b553c13b1ee26fc988e3e118c61da50f3ce37bde067ad447c6df3f70be8c`

- `experiments/verify-ecs-artifacts.py`：`e6f4d267fa7cb5e8f303083ad1a3f22d946a55d9e0e222031b79861f8d5bb6ed`

- `evidence/bitecs-admission.json`：`50cb9e64509b477024fb4fd60680eabe6290f180928a20bd41136bd352a4c90f`

- `evidence/koota-admission.json`：`95736ee662f9f1706aa0b1f690fdfbf9a4f3e684612d7167bf70b9e7d84f9381`

- `evidence/bitecs-artifact-receipt.json`：`515b924b4c7ca46afaeecfa2380523eed1da33a53dbe797bf8de81ae66195147`

- `evidence/koota-artifact-receipt.json`：`34c0572d62d27bb6c4ab8f971af9e41a09a78aad763b5be508bbe5cbae055f0d`
