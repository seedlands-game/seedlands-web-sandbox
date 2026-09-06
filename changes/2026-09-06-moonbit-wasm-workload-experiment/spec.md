# MoonBit / Wasm 高收益计算负载实验

状态：**调研与方案完成，等待用户审核；尚未开始 Wasm 实现和性能准出。**

流程：Exploration 方向调研后形成 Breaking 实施合同。涉及生成、Chunk、物理、渲染计算和跨语言边界；本轮按用户“先产出方案审核”的要求停在精确SHA-256审核，不修改生产代码、测试口径或工具链配置。

## 背景与目标

从已同步远端的最新主分支建立独立实验worktree，盘点游戏所有计算责任，识别有正净收益的批量内核。优先考虑用户感兴趣的MoonBit，在满足正确性、兼容性和成本要求、且不明显逊于备选时采用。保留TypeScript作为对等实现和回退路径。

完成态是可追溯的负载清单、语言选择证据、每个达到门槛的项目的分项A/B，以及所有正收益项合并后的新老版本统一A/B；结果可以是“部分采用”或“没有值得迁移的项目”，不能把引入Wasm本身作为成功。

基准提交：`f2454937a4217d88420e1f21ac8ffda4e94847ea`。文件树：`538fe7a9327e4841c2cd2da5ab84d4a4d834968b`，与远端`origin/main`的`3938eed27793cd342558165d061792ab9f12dd2a`一致。

## 范围与非目标

范围：

- 调研MoonBit语言、版本固定、编译/测试/调试/包管理、Wasm/GC/ABI，以及Rust、AssemblyScript、C/C++、Zig、Go/TinyGo对照。
- 盘点启动、主线程、Authority/Logic/General/Fluid/Persistence Worker与GPU路径，逐项评分并记录不迁移理由。
- 13个预选候选逐项成本筛选；所有通过成本条件的项目均完成独立A/B，不只实现第一项。具体边界见附件。
- 独立内存、批量数值接口、可观测回退、确定性测试、浏览器兼容与性能验证；保持现有状态所有权。
- 汇总全部通过项目并做统一A/B、必要消融、说明真实收益与不确定性。

非目标：发布/push/线上响应头变化、Wasm共享内存或嵌套线程池、重写整个游戏、换渲染引擎、调整画质来跑分、新世界生成版本、新存档格式、新物理行为或新AI规则；不复活旧模拟热路径，不迁移宿主DOM/GPU/I/O本身。

## 关键决策

### 语言与线程

默认MoonBit线性内存Wasm；WasmGC只做有界备选。用网格、数值生成、流体三个代表内核与Rust做同算法/同ABI对照：MoonBit端到端几何平均成本不比Rust高10%以上，任一代表项不高20%以上，没有能力阻断时优先MoonBit。语言对照不过不代表允许引入第二个生产工具链；先提交异常原因和可 review 的取舍，或该项保留TS。

保持5个后台Worker默认：Authority、Logic、专用Fluid、General、Persistence各1个；另测2个General时的6Worker模式。Wasm Instance在所属Worker上同步执行，独立非共享Memory，不额外创建线程。物理候选在Authority本线程执行；本地玩家预测需要时使用同一数值合同，不增加逐tick消息往返。宏观地图搬到General时必须增加TS Worker控制组。

### 实现边界与缓冲区协议

计划新增 `wasm/seedlands-kernels/` 保存MoonBit源代码，`src/compute/` 保存后端合同、ABI检查与纯适配，浏览器加载/资源URL/Worker生命周期留在app/client/worker边界；具体职责不能让world反向依赖浏览器。已有world函数仍是TS参考入口，通过注入纯计算端口或上层任务分派选择后端，不在world内fetch/instantiate或读取Worker全局。

ABI只使用有版本的数值参数、长度、偏移、显式状态码及预定义字段表：体素u16、流体u8、坐标有符号整数、索引u16/u32、必要的f64/f32。内部ID可做一次批量字典映射，不能改变稳定排序；边界要验证长度、offset溢出、对齐、输出容量和负坐标。MoonBit对象头/引用计数布局不作为合同。

每个任务输入为不可变快照；Wasm写入自有工作区，产生候选或派生网格，不直接持有/写入GameServer。权威提交仍经现有World.edit/GameServer事务与revision/read-set校验。准备副本、工作区、回传副本均计入成本，不宣称全程零拷贝。

长运行任务按自然块/网格阶段分片；每片之间返回Worker事件循环检查取消与epoch。同步Wasm调用不能被普通postMessage中断，不声称把检查写在调用前后就能随时抢占。不得为分片改流体批次顺序或物理fixed step。

### 回退和状态一致性

正式实验提供 `ts`、`moonbit` 与自动能力选择；按W01等编号开关，开关只用于Harness/启动配置，不增加普通玩家设置负担。初始化先加载/验证真实产物并运行小型已知答案自检；缺特性、404、错误MIME、实例化失败明确标记原因并使用TS。显式Wasm基准遇到回退必须判为不合格样本，不能把TS结果写为Wasm成绩。

trap/OOM/ABI错误时，尚未提交的任务用原始不可变输入重跑TS；传输输入已经detach时必须从仍持有的权威revision快照重建。只允许一次有效结果进入现有门禁，过期任务丢弃。Authority物理必须先得到整个合法批次再应用状态；不能半批更新后又TS重算。回退停用该实例并记录故障，不无限重试。实例重建不携带上一epoch的工作区或身份映射。

Wasm与TS必须严格维持生成、流体、Mesh字节/顺序、存档与物理离散分支合同。默认不开SIMD、relaxed SIMD或fast-math。数学兼容无法证明时保留该项TS，不能修改生成版本、物理容差或测试预期掩盖偏差。

### 收益和维护门槛

采用附件明确的评分、成本账本和门槛：静态≥65分预选；预估内核节省覆盖新增边界成本至少2倍；实测端到端p50改善≥15%且95%CI下界>0，并满足绝对节省/高频CPU/启动完工的价值门槛。小于门槛、错误、不确定、工具链代价过高都标记不迁移。

分项共13项，当前只是先验。P0必须重新测量所有CPU类别的热点/上界，更新低分异常项；不允许以本方案的静态分数永远排除实际高收益负载。发现原清单漏项、需要调整生产边界或实质修改迁移范围时，更新附件hash并重新review。

## 可验证行为

- Given同seed、generatorVersion和跨Chunk坐标，When选择TS或MoonBit并改变加载顺序，Then基础体素、halo、Mesh类别/几何及存档结果一致。
- Given相同版本快照和输入序列，When执行流体、导航或物理，Then有序候选、路径、每tick离散状态一致；旧epoch/read-set/意图仍被原门禁拒绝。
- Given任一内核失败/取消/内存增长，When继续游戏或切换世界，Then没有半次权威提交、旧视图访问、双重提交、持久内存泄漏或永久挂起。
- Given原始TS、仅一项Wasm和全部通过项三个模式，When使用固定环境与相同工作负载，Then日志能区分真实后端、冷启动、准备、复制、内核、回传、用户可见延迟，不以微基准替代体验。
- Given不支持Wasm特性的浏览器或普通无隔离头部署，When进入/保存/继续游戏，Then走明确回退并保留正常功能；不依赖SharedArrayBuffer。
- Given分项正收益但组合退化，When执行统一A/B，Then保留失败数据、做消融和最终复验，不把分项百分比相加作为总收益。

## 测试设计

完整样本、用例路径、预期RED、分项/组合控制组和统计方法见 `ab-plan.md`。本轮未写正式可执行用例、未改生产配置；获准后先按该测试设计创建用例并记录真实RED，再实现。

P1如需可丢弃工具链/ABI样本，只在独立 `/tmp` 目录制作，不导入或放入生产src/tests/public/构建入口；原型源码不作为正式交付。正式内核必须按已审合同重新落地并验证。MoonBit/Rust benchmark数据可保留为带版本hash的证据。

完整静态检查与构建仅在实施后运行；本轮另外执行了主分支合并的定向回归与构建，这不是Wasm准出。

## 验收与证据

| 编号 | 准出条件                                                                | 证据类型                                                                    | 当前结果                   |
| ---- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------- | -------------------------- |
| A1   | 主分支同步、冲突处置、独立worktree可恢复                                | Static、Build、Vitest                                                       | 已完成；见交付快照         |
| A2   | MoonBit/其他语言、线程选择、30类负载评分、13项候选及排除理由完整        | Manual supplement（源码与官方资料调研）；Static                             | 方案已形成，待审核         |
| A3   | 固定工具链可重复构建，ABI批量通道和三类Rust对照通过首选条件             | Build、Vitest、Playwright-change；Manual supplement（MoonBit测试/构建记录） | 未执行                     |
| A4   | 所有过成本门槛项目逐项A/B且正确性通过，未迁移项理由完整                 | Vitest、Playwright-change                                                   | 未执行                     |
| A5   | 内存、取消、增长、错误/能力回退、版本与权威边界符合合同                 | Vitest、Playwright-change、Static                                           | 未执行                     |
| A6   | 所有分项正收益集合统一A/B；反协同消融和最终结果透明，满足组合与资源门槛 | Playwright-change、Manual supplement（真实设备）                            | 未执行                     |
| A7   | 真实游玩输入、存档恢复和现有核心旅程不退化                              | Playwright-baseline、Playwright-change                                      | 未执行                     |
| A8   | 表面/水/裂纹/人物运动连续视觉语义不变                                   | Midscene、Manual supplement                                                 | 未执行                     |
| A9   | 静态全套、world覆盖率≥80%、MoonBit检查与生产构建通过                    | Static、Build、Vitest                                                       | Wasm变更未实施，不主张通过 |
| A10  | 更新最终负载决定/收益/风险/源SHA并创建仅包含本change的本地语义提交      | Static、Manual supplement                                                   | 本轮仅方案快照；实验未交付 |

没有可接受正收益项时，可以交付“实验结论：不迁移”，删除正式生产接入、保留报告和必要历史证据，不能把A4/A6虚报为性能通过。额外浏览器/设备不可用则标明未验证范围，不能宣称全浏览器准出。需求E2E保留在本change；不提炼进长期基线，因此本轮不触发独立基线准入评审。

## 任务与当前状态

- [x] 确认主分支分叉，保留回退引用，pull并解决旧命令功能与最新整合版本的冲突。
- [x] 基于最新文件树建立实验worktree；主工作区保留main。
- [x] 调研官方语言/工具链，读取最新循环/纯计算/通信和历史性能证据。
- [x] 建立30类负载清单、13项预选、收益阈值、分项与组合A/B合同。
- [ ] 用户审核本spec的精确SHA-256（附件由下列摘要绑定）。
- [ ] P0：当前产物全负载profile、A/A噪声和成本筛选，冻结实验manifest。
- [ ] P1：固定工具链、ABI/兼容性探针及MoonBit/Rust代表比较。
- [ ] P2：逐项RED→实现→GREEN→A/B；失败/低ROI标注不迁移。
- [ ] P3：全部正收益项组合A/B、线程预算对照、反协同消融。
- [ ] 完整准出、交付快照与仅本地commit；默认不push。

## 交付快照

### 本轮Git同步和隔离结果

原目录 `/Users/chlorinec/Code/voxel-sandbox-foundation` 本来已在main且无未提交修改，本地`863ff08`与远端整合`3938eed`各有1个独有提交。先建立 `codex/main-before-wasm-research-20260906` 回退分支，再执行 `git pull --no-rebase origin main`。

出现13个冲突路径。核对远端已包含本地命令Shell、历史/复制交互、Headless和当时change合同，且服务端命令与浏览器入口已扩展/重构；保留远端集成实现，移除远端已删除的旧`app-elements.ts`，清除自动合并产生的重复中文README段落以及旧版Shell/CSS残留。合并提交`f245493`保留两侧历史，未reset/rebase，且树hash与远端完全一致。main因保留本地历史显示ahead 2，属于预期；没有push。

新worktree：`/Users/chlorinec/.codex/worktrees/moonbit-wasm-20260906/voxel-sandbox-foundation`。

新分支：`codex/moonbit-wasm-workload-experiment`。

### 本轮验证

- `git diff origin/main --exit-code`：通过，合并后文件树与远端相同。
- `pnpm exec vitest run tests/server/server-command.test.ts tests/server/server-headless-cli.test.ts tests/app/command-history.test.ts`：3文件16项通过，覆盖冲突涉及的命令/无头/历史能力。
- `pnpm build`：通过，包括Svelte 0错误0警告、TypeScript和Vite构建。既有主包体积警告仍存在，不是本次引入。
- 本轮新增文件仅位于本change目录的方案文档；已复用锁定依赖完成文档格式检查、路径检查和diff检查；不更改锁文件。
- 未安装MoonBit；未执行Wasm性能实验、完整静态coverage、浏览器/Midscene新准出。不将历史性能或上述合并检查算作迁移收益。

### 绑定附件

以下三份附件为本实施合同的一部分，审核时以它们的SHA-256固定内容；实质修改必须同步更新本spec，导致review hash变化。

- `research.md`：`53644402d7bf9f8b89bebb90d2400677f26cf9ea1e4657ca4c9e52aa54a73ac6`。
- `workloads.md`：`fd8cc7d73e0aa7652be97515a1f1c41ff8fc4e26c9950f5143d16409dfe0d4d3`。
- `ab-plan.md`：`97675e736486df7ebdf250afbc68c5a74025deb45c1d761060983f61c3cfe3a4`。

本轮提供方案概述 `overview.md` 供快速阅读；它不覆盖本spec及上述附件的细则。
