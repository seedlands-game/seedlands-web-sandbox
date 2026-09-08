# Seedlands 开发约定

## 先读什么

普通代码修改先读本文件、相关源码和当前 spec；移动文件再读[代码地图](docs/code-map.md)和[目录规范](docs/repository-structure.md)；架构或路线决策才读[长期对齐](docs/living-world-alignment.md)；追溯已归档历史才读[归档索引](docs/change-archive.md)。运行命令只以 `package.json` 为准。

方案、spec、评审和交付记录使用简体中文。README、CONTRIBUTING、SECURITY、CODE_OF_CONDUCT、ASSETS、TRADEMARKS 与 `.github/` 社区入口可用英文主文和中文镜像。不得读取、输出或提交 `.env` 或密钥；`node_modules/`、`dist/`、`midscene_run/` 等依赖和运行产物不得提交，但可在验证中读取。

## 不变量与源码归属

- 基础世界由 `seed + generatorVersion` 唯一确定；体素保持紧凑数值；编辑只经 `World.edit()`；渲染是 Chunk Mesh，不是逐体素 Entity。
- `server` 拥有权威世界、规则和存档；`client` 是协议适配、预测和派生镜像；`app` 是浏览器组合、输入、PlayCanvas 与 Svelte；`worker` 只放执行入口和传输适配。
- `world`、`physics`、`runtime` 保持纯逻辑。`world` 不依赖 DOM、Worker、PlayCanvas、`server` 或 `client`；不得把 app 行为反向搬进这些目录。
- 新 app/client 文件先按[目录规范](docs/repository-structure.md)选择既有职责目录。顶层仅保留已审阅的组合入口；ESLint 负责拒绝 client→app 反向依赖和未归属的顶层文件。`src/app/player-view-offsets.ts`、`src/client/performance-telemetry.ts` 仅为两个 Delivered change 的冻结路径兼容入口；新代码不得使用，待对应历史 change 归档后删除。
- 移动入口或职责时更新代码地图；不要预建 `engine`、`plugins`、`shared` 等抽象。

## 控制平面、数据平面与性能边界

- 控制平面优先 AoS（对象/结构体集合）：表达领域对象、命令、状态机、关系、权限和生命周期，以可读性和建模清晰为先；不要为了形式统一把低频对象机械改成列数组。
- 数据平面优先 SoA（按字段连续数组）或紧凑数值缓冲：用于已测量的高频批量扫描、物理/导航计算输入、网格/体素处理及跨 Worker/Wasm 边界。数组必须定义类型、容量、有效长度、稳定索引、版本与所有者。
- SoA 不等于零拷贝。规范必须区分对象遍历、分配、显式复制、structured clone、ArrayBuffer transfer 和 Wasm 入/出拷贝；性能变更记录每段 bytes、频率、生命周期与延迟，禁止仅凭 AoS/SoA 名称推断收益。
- 数据平面在边界建立并按 epoch/revision 或 dirty 范围增量更新，复用有界 scratch/缓存；禁止无证据地每 tick/每实体全量 AoS→SoA→AoS 往返。缓存必须失效可验证，不能读陈旧世界；权威状态和提交规则仍由既有 owner 持有。
- Worker 传输优先移动独立的派生缓冲所有权；权威仍持有的底层 buffer 不得因 transfer 被 detach。新多跳消息必须审查 transfer list 与每一跳的复制，缓存共享只读视图不得向可变消费者泄漏。
- 共享 Rust 算法放在纯 `world-kernels` core；Wasm ABI、SIMD target intrinsics 和未来 Node/native 宿主适配分层维护。核心不得依赖浏览器、Node、Node-API、Wasm global 或网络服务；依赖闭包与源码边界由静态检查和正反例测试约束。当前不因此扩展 Node Dedicated Server 或 Node-API 实现范围。
- SIMD 只用于等价且连续的批量核。先比较相同算法/布局/线程的标量与标准 SIMD，计入准备、复制、边界和输出；保留能力探测与标量回退。默认不开 relaxed SIMD/fastmath，不以核倍率冒充整帧收益。
- 当前保留 PlayCanvas 的 WebGL2 渲染后端，不更换为 WebGPU，也不引入 WebGPU compute 或其他 GPU 通用计算加速。已有 GPU 渲染/材质着色维持边界；兼容着色源码不等于启用 WebGPU 后端。后续改变此决策需独立需求与端到端证据。

## 轻量交付门禁

任何生产、产品、架构、配置或测试口径变更先在 `changes/YYYY-MM-DD-kebab-name/spec.md` 写可验证行为、测试设计、验收和任务状态，先取得可执行 RED 或记录不可自动化的观察预期。细化的 Agile / Breaking / Exploration、证据分层、change 生命周期、spec 内容和交付快照要求见[开发治理](docs/development-governance.md)。

模糊需求澄清时，先把用户要获得的结果、长期愿景和硬约束，与用户提出的技术路线分栏记录。前者是需求依据；后者默认只是待验证假设，除非已有项目决策或当轮用户明确将其设为约束。智能体负责读取现状、核对仍然有效的一手资料、主动指出错误前提，并给出有理由的推荐，不把迎合用户方案当作澄清完成。默认比较复用、购买/接入、改造和自建，以“到达下一个可验证体验的剩余总成本”为主要口径；成熟社区能力满足硬约束时优先复用，只有候选不满足硬约束，或其接入、迁移、运行与维护总成本有证据高于自建时，才有证据地选择自建。调研深度与影响面和决策价值成比例。完整记录格式、候选门禁和反例见[开发治理的模糊需求澄清模式](docs/development-governance.md#模糊需求澄清模式)。

凡以更快、更省、更稳、更低延迟/资源/成本或“某技术更优”为保留理由的改动，必须做独立分项 A/B；这里的 A/B 是受控工程对照，不要求线上分流。旧 control 因安全公告、许可证、平台弃用或硬兼容约束不可安全运行时，可用静态合同淘汰，但不得宣称未对照的运行时收益。未触碰已测瓶颈、产品门槛、工程预算或用户可感知边界时不提前优化，优先处理贡献最大的短板和最终消费者能感知的主指标。每个候选先固定假设、A、B、主/次指标、否决项和停止线；一次只改变一个被测维度，或明确不可拆的实验单元。计时实验先用 A/A 测噪声，再做除预注册轴外同身份、同环境、同负载的平衡/交错 A/B，保留失败与原始样本。计划共存且影响同一目标路径的通过项，还须执行组合端到端 A/B，回归时有界消融；超出预先声明的否决线即不得采用。无确定收益时保留更简单的现状，删除未采用生产分支并留下结论。完整证据层级、技术选型对照和历史反例见[开发治理的优化与技术选型实验](docs/development-governance.md#优化与技术选型实验)。

Breaking / Exploration 的用户 hash 审核只授权其合同中的实现，不自行扩大到发布、其他外部写入、权限变更或不可逆操作。Agile 变更可在已授权范围内自行完成。本用户已长期授权：验收完成后可将功能分支推送至已配置 `origin`，并以目标分支为 base 创建或更新 PR 交给人类审核；用户指定 `local-only`、不发 PR 或其他范围时优先。不得自动合并、绕过分支保护或扩大安全权限。每次 Delivery Snapshot 要说明长期 docs baseline 是否更新及原因；清楚的源码和通用教程不重复抄入上下文。

实施后运行受影响的确定性检查和构建；`pnpm verify:static` 与 `pnpm build` 是分别的基础证据。UI、输入和视觉按当前 spec 选择 Playwright、Midscene 或手工补充，不能互相替代。完成的 change 在明确功能分支创建只含该 change 的语义化本地 commit，并按已授权的 PR 交接规则推进。

默认按任务复杂度选择执行形式、模型和分工，具体路由见[协作与模型路由](docs/collaboration-routing.md)；优先使用已安装的全局 `agent-work-routing` skill，未安装时使用本 change 的版本化源。这不要求每个任务使用多个 agent，人类直接选择的模型不受重路由。

有效性能采样必须经[性能执行窗口](docs/performance-execution.md)串行取得；普通功能测试、并发 agent 的机器负载或历史结果不能冒充当前性能证据。

## 按需上下文

- [目录规范](docs/repository-structure.md)：文件职责、当前布局、静态边界和归档位置。
- [开发治理](docs/development-governance.md)：SDD、E2E 生命周期、证据边界和准出记录。
- [协作与模型路由](docs/collaboration-routing.md)：初始模型选择、分工、独立评审和成本观测。
- [性能执行窗口](docs/performance-execution.md)：机器级阻塞锁、固定验收职责、取消和进程清理。
- [上下文沉淀](docs/context-engineering.md)：哪些决策应写 docs 或晋升为 skill。
- [归档索引](docs/change-archive.md)：显式 ZIP 工具、恢复命令和受保护的历史 change。
