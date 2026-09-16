# 执行拆解与责任映射

本记录为 S0 编制的 [spec](spec.md) 执行拆解，保留当时的顺序与责任判断。用户已批准精确 hash，实际实施与验收状态以 [execution-status.md](execution-status.md) 为准；下文的“尚未”描述属于 S0 计划时点。

## 关键路径

`S0 基线/用例/审核 → S1 通用合同与单一状态 owner → S2 Classic/宿主/存档 → S3 测试迁移与影响选择 → S4 唯一生产线路 → S5 全部新有效基线/独立审阅/PR`

S1 先做一个纵向切片：注册一个非游戏组件与确定性系统，经同一事务、事件、checkpoint 完成恢复；再接真实 inventory 模块。两者通过才迁剩余模块，防止先搬完目录再发现循环依赖。保留 bitECS；行为树继续使用 mistreevous，但只存在于 stdlib 的行为依赖闭包。

| 单元 | 实施与所有权                                                            | 完成判据                                                                | 依赖           |
| ---- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------- | -------------- |
| S0a  | 集成 owner：冻结 source、远端 CI、构建与旧 checkpoint；盘点风险         | 身份读回、样本可恢复、失败与缺口登记                                    | 已部分完成     |
| S0b  | 集成 owner：冻结 spec；独立 reviewer 只读复核                           | 用户审核最终精确 SHA-256；样本补齐计划明确                              | S0a            |
| S1a  | 集成 owner：通用 registry/identity/transaction/clock，拆类型回流        | T01/T02：裸 Kernel 运行；非法依赖反例拒绝                               | hash 审核      |
| S1b  | 领域执行者：stdlib 原组件与机制，单写 owner；宿主集成由集成 owner 负责  | T03/T04：不同装配隔离、行为兼容，无第二份 ECS/clock                     | S1a API 冻结   |
| S2a  | 集成 owner：Classic 独立包、内容/资产、宿主策略与精确旧摘要迁移         | 保留 `seedlands:overworld`、既有数值 ID，builder/click fixture 正常准入 | S1             |
| S2b  | 集成 owner：Web/Agent/Headless 公开 imports、候选恢复                   | T05/T06/T07/T18；旧存档→新→保存→再恢复，无副作用重放                    | S2a            |
| S3a  | 测试迁移执行者：稳定 owner 测试/fixture 与断言账本                      | 活跃构建/回归无历史路径依赖；原 world 语义集合完整                      | S1/S2 API      |
| S3b  | 集成 owner：contracts、可信 base/head 影响选择、执行账本                | T08–T10/T16；未知/删除/移动/自修改 fail closed，非空选择                | S3a            |
| S4   | 浏览器执行者：一个 Classic spec/场景/runner，复用 telemetry、bench 模式 | C0–C5 实际输入与结果关联；T11–T15/T17；性能采样独占窗口                 | S2/S3          |
| S5   | 集成 owner + 一次独立 reviewer：规则/Skill/CI/新有效基线/语义提交/PR    | T19/T20、完整新基线及 build/Classic；远端 SHA/PR 读回                   | S1–S4 全部闭合 |

实施 workers 尚未启动；代码写路径须在 S1 公共 API 冻结后分别指定，不把这张表当作并发写入授权。当前辅助任务仅 Luna/medium 只读测试盘点、Sol/xhigh 一次方案复核。固定算法清单使用脚本；性能窗口不与其他工作并发。

## 源码职责迁移

以下按语义簇映射，实际 322 个 core 源文件须在实施时用依赖图核对；不能按目录名整体机械搬移。

| 旧位置/事实                                                                            | 目标 owner 与 API                                                                                      | 保护                                                                           |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| `server/composition/assembly.ts`、`contracts.ts`、`execution-origin.ts`                | Kernel registry/authorization；先去掉 Item/Action/World 类型回流，作者入口 `@seedlands/kernel/mod-api` | T01–T03；当前依赖闭包 RED 见 s0                                                |
| `server/composition/*registration*`、`registered-operations.ts`、`module-lifecycle.ts` | 通用定义/候选/提交/生命周期归 Kernel；具体内容和行为目录归 stdlib                                      | 原 module-lifecycle、prepared-host-commit、partitioned-state、rule-stages 断言 |
| `gameplay/ecs-entity-owner.ts`、`ecs-actor-*`、`ecs-station-state.ts`                  | Kernel 持稳定身份、分配、组件存储；stdlib 持 Actor/Needs/Station schema 与 codec                       | INV-02/04/08；allocator/epoch/组件引用不复制                                   |
| `game-server.ts`、`game-server-gameplay.ts`、`gameplay-runtime.ts`                     | 拆继承和隐式构造；Kernel 通用运行 owner + stdlib 显式宿主装配                                          | 当前 constructor 无条件创建 Station/Fluid/Gameplay 是必须消除的行为            |
| `world/voxel.ts`                                                                       | Kernel 数值空间/坐标；stdlib 生成算法与格式；Classic 数值内容/材质映射                                 | INV-01/07；不能只移动整个 world 到 Kernel                                      |
| `world/mesh*`、`voxel-model*`、`chunk-generation`、`macro-world`、`ore-generation`     | 按网格派生/生成职责留 stdlib 公共算法；GPU 与实例化仍 Web                                              | 相同语义 coverage 集合；Wasm/TS 完整对等                                       |
| `physics/*`、`server/fluid/*`、`station-*`                                             | stdlib physics/fluid/stations，通过受控空间与提交端口                                                  | 现有候选、sidecar、驻留及回执；无需改算法                                      |
| `gameplay/modules/*`、`simulation/*`                                                   | stdlib inventory/crafting/needs/combat/actions/behavior/navigation/perception                          | 当前 actor 权限、RUNNING、中断、恢复与否定分支                                 |
| `runtime/character-*`、`runtime/behavior-*`                                            | stdlib behavior/protocol 公开入口；不能因目录名 runtime 留 Kernel                                      | cognition protocol 与 Web/Agent 活跃消费者                                     |
| `runtime/platform-ports`、clock、queue、version policy                                 | Kernel runtime/execution，窄只读实例端口                                                               | 纯逻辑、不共享可变全局                                                         |
| `composition/checkpoint-identity`、`gameplay-composition`、`product-playbooks`         | 通用完整性归 Kernel；产品摘要/旧映射及权限策略归 Classic 的可信 host 入口                              | T05/T06；当前加载产物完整性与旧存档兼容分开                                    |
| `gameplay/playbooks/overworld/*`                                                       | `playbooks/classic/src`；普通公开 API 消费者                                                           | ID 不改、default 内容不复制、Modern/Isekai 不伪造包                            |
| `compute/authority-worker-protocol`、authority/headless/harness                        | 通用 queue/frontier 与具体 gameplay payload 分离；host 依赖 stdlib 公开组合端口                        | 唯一 authority、既有协议/命令/checkpoint 支持范围                              |
| `apps/web`、`apps/agent-server`、`cognition-protocol`、`scripts/headless`              | 保持宿主职责，改显式 imports；无 Web↔Agent 互导                                                        | build、真实 Worker、真实 Node/PG 集成分别取证                                  |

## 默认浏览器保护去向

| 旧入口                                                              | 迁移方向                                                        | 仍需要真实浏览器的部分                                                   |
| ------------------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `tests/e2e/regression/world-play.spec.ts`                           | physics/edit/save contract + Classic C1/C5                      | Pointer Lock、移动/跳跃、跨 Chunk、保存重进                              |
| loading-performance、prerendered-start-screen                       | SSG contract + Classic C0                                       | 无 JS 首绘、hydration DOM/输入连续性、失败重试；未经覆盖不能标等价       |
| web-package-runtime                                                 | 构建/worker 合同 + C0                                           | 正式产物实际加载/执行/消费，不能只看 enabled                             |
| gameplay-foundation                                                 | inventory/crafting/combat contract + C2/C3/C5                   | 采集→掉落→拾取→制作→建造/战斗→恢复；保留连招已知 flaky 记录              |
| dynamic-local-shadow                                                | invalidation contract + C4                                      | 当前实体移除后的实际阴影/网格提交；revision 未增仍失效                   |
| developer-world-harness                                             | 原子恢复、epoch、协议 contract + C5                             | Headless checkpoint 在 Browser Worker 恢复并继续交互                     |
| initial-world benchmark                                             | local benchmark + 同一 Classic runtime benchmark                | 一条旅程两种采样模式，禁止复制场景                                       |
| macro-map、runtime-diagnostics                                      | 纯数据 contract；地图/F3 面板待决定并入观察点或显式 GAP         | 不能用后台字段替代 UI 可见性/小视口                                      |
| appearance/animated-model、PR15 asset integration                   | manifest/codec contract；实际工坊 UI/IndexedDB/动画待补覆盖决策 | 不属于纯 Node 集成；不在 C0-C5 中时明确 GAP                              |
| inventory/creative visual、melee showcase、composable、NPC/resident | 先逐重要断言分离规则、无浏览器集成与 C2–C5 观察                 | 仅入口盘点完成，详细断言账本未完成；PG/WS 与专属 UI 不能被总体 PASS 吞掉 |

本表尚非逐断言的最终迁移批准。S3/S4 退出前须为每个重要旧断言填写 Keep/Move/Lower/Integrate/Deduplicate/Retire/GAP、具体新测试与证据；不能仅比较文件数。唯一线路的覆盖取舍要纳入独立基线评审。

## 历史运行依赖清单

- 根 scripts、Playwright discovery、CI、tsconfig.test 与治理测试仍绑定旧 change E2E。
- Pack builder 与 ESLint Pack 边界规则绑定 builder/click-conversion 示例。
- mutation baseline、SIMD corpus/配置/summary、Rust artifact 验证、部分 Agent/视觉 fixture 从历史 change 读取。
- Evidence Skill 的脚本/引用和包装测试须随真实源路径更新；归档工具保留历史能力，用合成 fixture 测试。

S0 当前 fixture/capture 脚本是旧 SHA 证据。S2/S3 将仍有效的 fixture 迁到稳定 owner 并保留 hash，原证据不改写，活跃验证不继续依赖本 change。
