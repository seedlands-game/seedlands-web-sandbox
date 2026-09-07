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

Breaking / Exploration 的用户 hash 审核只授权其合同中的实现，不自行扩大到发布、其他外部写入、权限变更或不可逆操作。Agile 变更可在已授权范围内自行完成。本用户已长期授权：验收完成后可将功能分支推送至已配置 `origin`，并以目标分支为 base 创建或更新 PR 交给人类审核；用户指定 `local-only`、不发 PR 或其他范围时优先。不得自动合并、绕过分支保护或扩大安全权限。每次 Delivery Snapshot 要说明长期 docs baseline 是否更新及原因；清楚的源码和通用教程不重复抄入上下文。

实施后运行受影响的确定性检查和构建；`pnpm verify:static` 与 `pnpm build` 是分别的基础证据。UI、输入和视觉按当前 spec 选择 Playwright、Midscene 或手工补充，不能互相替代。完成的 change 在明确功能分支创建只含该 change 的语义化本地 commit，并按已授权的 PR 交接规则推进。

默认按任务复杂度选择模型和分工，具体路由见[协作与模型路由](docs/collaboration-routing.md)；这不要求每个任务使用多个 agent。

## 按需上下文

- [目录规范](docs/repository-structure.md)：文件职责、当前布局、静态边界和归档位置。
- [开发治理](docs/development-governance.md)：SDD、E2E 生命周期、证据边界和准出记录。
- [协作与模型路由](docs/collaboration-routing.md)：初始模型选择、分工、独立评审和成本观测。
- [上下文沉淀](docs/context-engineering.md)：哪些决策应写 docs 或晋升为 skill。
- [归档索引](docs/change-archive.md)：显式 ZIP 工具、恢复命令和受保护的历史 change。
