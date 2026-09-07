# 执行与授权记录

2026-09-06：用户回复“ok”，批准上一轮spec SHA-256 `4f3ce7b0b0fd84d35994c2bd338ccb573572cca156a747cda7ac0347c7d2a992`，并明确授权主负责人自主推进SDD、架构取舍、模型分派、验证与准出，过程中无需再次确认，完成后汇报。该授权允许本地实施与必要的合同细化；默认不push、不发布。

主负责人承担架构、工具链/ABI和首个MVP；Sol/high负责独立P0浏览器profile设施；Terra/high负责13候选接口和成本审计。各自有独立文件所有权，性能测量串行，生产内核实现待初次MVP接口稳定后分派。

当前状态：P0与P1准备进行中，尚未有Wasm性能或准出结果。原批准spec与三个附件保持原文，通过本记录补充授权和后续事实。

## 用户修订：只使用无头浏览器

2026-09-06 22:00 左右，用户明确要求所有浏览器测试使用 headless，避免有头窗口干扰工作。立即中止本任务有头 P0，关闭其独立 Chrome；既有数据标为中断前诊断，不能与 headless 混合。该指令覆盖原 ab-plan 的 headed 主环境和手工设备验收要求。后续同设备、同 headless 模式、同1920×1080 CSS/画质/DPR/内部尺寸做 A/A 与 A/B；不宣称已验证可见窗口下的真实游玩帧率。

## 已验证的实现里程碑

- 首个隔离 MVP 验证 raw offset/length、独立 memory、无 imports。正式内存生命周期先 RED 后 GREEN，5/5。
- W02 生成器2/3、四seed、五坐标区间及覆盖编辑共40组，与原 TS 和相同布局 TS 对照逐体素一致；回退另测，成功分支断言实例未停用。
- W07 三十场景、每场四次顺序事务，在随机源水/退水/未知邻块下，完整候选与原 TS 逐字段一致，输入不改写。
- 新边界 world 禁止 compute/loader 依赖，compute 禁止网络/DOM/权威服务，规则先真实 RED 再 GREEN。
- W03 只返回原语义 halo/流体/hash，macroContextCount 将报告预计算实际列数，不冒充原懒查询缓存命中数；此诊断字段变化需在分项结果中说明。

## 构建与实验口径细化

- 本地固定 MoonBit `0.1.20260827`、moonc/core `0.10.11+6ff76a5f9`，锁定下载归档、编译器和自带 `moon-wasm-opt 125` 的 SHA-256。普通 release 未自动执行 Binaryen 后处理，因此 MoonBit 与 Rust 参考均追加相同 `-O3` 和标准 Wasm 功能参数；不启用 relaxed SIMD、fastmath 或共享内存。
- 分项语料、生产适配、同布局 TS 对照和 Rust 三代表参考分离。微探针只用于发现错误或构建差异，不用于准出；正式结果要求预注册的 10 个配对运行。bootstrap 曾因 LCG 低位取模在 2 对样本上退化，已先 RED 后修正为高位缩放取样，2 项统计测试 GREEN。旧诊断 CI 不采信。
- 网格迁移是一整个描述符计算单元：W04 的 greedy/AO 与 W05 的水面/特殊模型分别用场景分项测量，生产必须共同满足条件，不能把同一个 mesh 函数重复计算收益。
- 生成与 halo 的预计算列布局对 TS 也有效；与原 TS 的总差值和与同布局 TS 的语言增量必须同时报告。
- WasmGC 在独立 `/tmp` 原型验证：277 字节模块，在 Node 与 Chrome 152 headless、`crossOriginIsolated=false` 下执行 `sum_to(100)=4950`。只证明该浏览器和小型 GC 导出可用，不证明三类生产内核吞吐；线性内存 ABI 仍是当前方案。
- 为避免所有 TypeScript 开发者被迫安装第二套语言工具链，交付锁定的 Wasm 与源码/产物哈希清单。普通生产构建只验清单，不下载或调用编译器；修改内核后必须用固定工具链重建。清单缺失、源文件增删改、产物篡改均 fail closed，2 项治理用例先 RED 后 GREEN。

## 用户方向修订与本次暂停点

用户新增长期双环境、Rust core三产物合同，并补充要求“大规模实现前先汇报供审核”。按其明确冲突优先级，浏览器Integrated Server与Node Dedicated Server均长期保留，Node-API不是即将删除的桥梁。停止扩大服务端MoonBit单环境投资，保留所有已有MoonBit公平对照；浏览器分项与统一AB继续属于下一阶段正式产品决策，未被取消。

当前停止于：P0正式headless已完成；旧P2只有1–2对诊断，新的schema2完整矩阵未启动；P3runner已写但从未启动统一采样；Node纯Rust三adapter尚未实现。现有功能开关仍默认关闭。主负责人/子agent停止新算法与产品接入，仅做保全、修订方案、独立审查和已有成果完整性检查。

保全修复：独立审查发现mesh输出容量过宽、fluid返回指针仅验证arena范围；分别补真实RED后修复。全coverage初跑800项中只有W04随机语料超默认5秒，794通过、5跳过；插桩运行约8秒，仅该例改30秒预算，全部强等价断言保留，重新执行全仓核验。该失败保留，不把单文件coverage替代全仓80%门槛。

## 最终范围澄清

用户随后明确：Node Dedicated Server与Rust Node-API只用于解释Rust-first决策背景和长期演进，现在不需要实现。当前spec/overview/ab-plan已再次收敛为浏览器Integrated Server的Rust-first实验；Node/NAPI/pool/多端正式产品验收与成本全部移出当前范围。Node只读审计与多环境矩阵保留为未来参考，不据此实施。继续保持用户此前“扩大实现前先汇报审核”的门槛。

全量并行coverage第二次运行唯一失败为W07三十场景四tick强等价在V8插桩下36.5秒超过30秒；796通过、5跳过。仅该case预算改为60秒，不减少corpus/断言，重新跑正式静态入口。

最终保全：`pnpm verify:static`与`pnpm build`均通过，797 tests GREEN、5 skipped，world行覆盖96.64%。最终当前scope经Sol只读复核，无Node/NAPI实施/验收/成本残留。旧原型仍默认关闭，停在用户要求的方案审核点。
