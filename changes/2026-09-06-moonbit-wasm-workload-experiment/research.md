# MoonBit、Wasm 与线程选型调研

> 版本提示：下文保留原 MoonBit 优先语言研究；选型与预算已经由本次修订 `spec.md` 覆盖。共享计算默认 Rust，浏览器 MoonBit 只作已有实现的公平对照。Node/NAPI是未来背景，本次不实现。

调研日期：2026-09-06。结论来自本次读取的官方资料与最新源码；下面的性能判断均为待验证假设，不是 MoonBit 实测成绩。研究对象为 `f2454937a4217d88420e1f21ac8ffda4e94847ea`，其文件树与远端 `3938eed27793cd342558165d061792ab9f12dd2a` 完全一致。

## 选型结论

优先尝试 **MoonBit → 线性内存 Wasm → 现有 Worker 内同步执行批量内核**。它具备本项目需要的数值类型、独立 Wasm 产物、显式导入导出和工具链基础，尚未发现必须排除它的能力缺口。这里批准的是实验方向，不能提前宣称它不比 Rust 慢。

用 Rust 对网格、数值生成、流体三种代表性内核建立同算法、同 ABI、同优化级别的参照。若 MoonBit 端到端成本相对 Rust 的几何平均差距不超过 10%，任何代表项不超过 20%，且没有正确性、浏览器或可维护性阻断，按用户偏好优先 MoonBit。超出差距且置信区间排除噪声时视为“明显更差”，先定位复制/算法/编译参数，再决定该项保留 TS 或提出 Rust 例外。不会为了语言偏好降低项目的净收益门槛。

## 语言和工程能力

MoonBit 是静态类型语言，提供模式匹配、枚举、结构体、泛型、trait、错误处理和数值数组。`Int`/`UInt`、`Double` 比 JavaScript 的单一 `number` 更适合显式表达整数和浮点内核，但迁移需要逐处选择类型，不能机械翻译 TS。项目涉及闭包回调、字符串 Map key、对象排序和 TypedArray，这些都需要重新设计计算边界。[语言基础](https://docs.moonbitlang.com/en/latest/language/fundamentals.html)

本次官方更新列表最新明确发布条目为 2026-08-19 的 v0.10.9；`latest` 文档显示 v0.10.11。发布页与滚动文档不是同一版本锁。本机 PATH 未发现 `moon`，本轮未安装或实际编译，不把文档版本当作已验证工具链。实施首步须取得官方稳定发行的精确版本、编译器提交标识、core 版本、下载 URL 与 SHA-256，并冻结在实验记录中；不能把 `latest` 用作可复现版本。[官方更新](https://www.moonbitlang.com/updates/)

`moon` 统一管理创建项目、检查、格式化、构建、测试、基准和依赖，`moonc` 是编译器；有 VS Code 支持。官方提供 macOS/Linux/Windows 安装方式及二进制校验和。采用项目独立工具链目录，CI 缓存以完整版本和锁文件为键；不改用户 shell 配置，不在运行游戏时下载编译器。[下载与校验](https://www.moonbitlang.com/download/)、[构建教程](https://docs.moonbitlang.com/en/latest/toolchain/moon/tutorial.html)

工程落地要求：`moon check`、`moon fmt`、`moon test` 和 release Wasm build 接入专门包脚本；Node/Vite 只消费构建产物；正式生成物由构建产生，不手工修改。源映射/调试产物与发布优化产物分开；记录干净构建、增量构建耗时，记录故障定位是否需要逆向运行时布局。MoonBit 单测是补充，跨语言契约仍由 Vitest 和浏览器验证。新增 `.mbt` 命名/格式规则须进入当前项目的可执行门禁，不把 TS coverage 冒充 MoonBit coverage。

## Wasm 与 WasmGC

| 维度     | 线性内存 Wasm：本次默认                        | WasmGC：有界备选实验                                   |
| -------- | ---------------------------------------------- | ------------------------------------------------------ |
| 数据边界 | 数值 offset/length，明确的二进制输入输出       | 默认使用 GC struct/array，需要另证 TypedArray 批量通道 |
| 内存管理 | MoonBit 对象有引用计数成本；内核尽量复用工作区 | 借用宿主 GC；尾延迟和对象交互需实测                    |
| 工程适配 | 与体素、Mesh、存档数值缓冲相符                 | 对对象丰富的程序可能便利，本项目不能先假定占优         |
| 兼容策略 | 检测真实产物所需 Wasm 特性                     | 额外检测 GC、实际启用的 string builtins 等特性         |
| 决策     | 首先完成 ABI 和小内核验证                      | 仅在不增加逐元素 FFI、且真实批量结果更好时启用         |

MoonBit 官方区分 Wasm、WasmGC、JS、C、实验 LLVM 后端。WasmGC 默认不使用线性内存表示普通数据。FFI 文档明确未列出的类型没有稳定 ABI；不能把 MoonBit 内部数组指针偏移猜成公开协议。[FFI 与数据表示](https://docs.moonbitlang.com/en/latest/language/ffi.html)

`moon.pkg` 的链接设置支持 memory 导入/导出、上下限、shared-memory 和线性堆起点。计划利用显式工作区及受控 Wasm load/store 封装，而不是依赖对象头。必须先验证工作区与语言堆不重叠、增长后视图重建、失败后释放，才能正式接入；如实现需要大量未文档化技巧，该后端不通过工具链门槛。[包配置](https://docs.moonbitlang.com/en/latest/toolchain/moon/package.html)

首个产物只导出批量函数与能力/ABI 版本查询，避免日志、文件、时间或环境依赖。官方更新与 FFI 页面对打印导入有版本差异，因此以 `WebAssembly.Module.imports()` 检查实际产物，不为通用日志引入 WASI polyfill。[Wasm 集成说明](https://docs.moonbitlang.com/en/latest/toolchain/wasm/index.html)

SIMD 与多线程是两回事。第一轮采用标量双精度与精确整数语义；固定 SIMD128 可以作为通过标量门禁后的独立 A/B 因子，不能只给某一语言开启 SIMD。尚未实测 MoonBit 对各负载的自动向量化效果，不把“支持 Wasm”推导为“自动 SIMD”；不使用 relaxed SIMD/fast-math 改写确定性结果。

## 与其他方案比较

以下适配判断是针对本项目的工程推断，不是跨语言性能排行榜。

| 方案               | 适配优点                                      | 主要代价                                                  | 本次定位                                 |
| ------------------ | --------------------------------------------- | --------------------------------------------------------- | ---------------------------------------- |
| 现有 TS + Worker   | 已交付、JIT、无新增工具链和 JS/Wasm 复制      | Map/对象分配、密集循环可能占用 CPU                        | 必须保留的真实基线与回退实现             |
| MoonBit            | Wasm 导向、统一工具链、数值类型和高级语言能力 | 版本变化、双语言维护、ABI/RC/数值一致性要验证             | 用户偏好下的首选实验                     |
| Rust               | LLVM、内存所有权、显式数值布局、Wasm 生态     | 学习与绑定成本、编译链更大；不是整个 std 可用             | 三项代表性对照及必要时的备选             |
| AssemblyScript     | TS 风格、npm 工具链、直接生成 Wasm            | 不等于 TS；动态特性/闭包限制，运行时 GC 选择增加工作      | 若 MoonBit 工程接入明显不合算，再考虑    |
| C/C++ + Emscripten | 成熟数值库、LLVM、低层控制、pthread 路径      | 没有现成待复用 C 库，SDK/胶水及手动内存代价偏高           | 无充分理由引入；成熟外部算法库才有优势   |
| Zig                | freestanding Wasm、分配器和导出控制直接       | 新语言学习与工具版本适配，手动内存责任                    | 小型底层内核备选，不扩成第三条生产语言线 |
| Go / TinyGo        | Go 语法与一定生态，TinyGo 有浏览器 Wasm 流程  | Go/TinyGo 的目标、调度、GC 和 JS 胶水不同；不是无成本复用 | 本项目无现有 Go 资产，优先级低           |

Rust 的 `wasm32-unknown-unknown` 是少宿主假设目标，但文件系统、线程创建等 std 能力不能照搬。其 SIMD 特性也须显式管理。[Rust 目标](https://doc.rust-lang.org/rustc/platform-support/wasm32-unknown-unknown.html)、[Rust SIMD](https://doc.rust-lang.org/core/arch/wasm32/index.html)

AssemblyScript 官方明确其与 TS 的静态语义差异，且“编译成 Wasm”不会自动加速对象和宿主交互；有 incremental/minimal/stub 等内存运行时选择。[介绍](https://www.assemblyscript.org/introduction.html)、[限制](https://www.assemblyscript.org/status.html)、[运行时](https://www.assemblyscript.org/runtime.html)、[性能说明](https://www.assemblyscript.org/frequently-asked-questions.html)

Zig 官方给出 freestanding Wasm 用法；TinyGo 有独立 WebAssembly/浏览器指南。二者具备生成 Wasm 的路径，不构成本项目收益证据。[Zig](https://ziglang.org/documentation/master/#WebAssembly)、[TinyGo](https://tinygo.org/docs/guides/webassembly/)

编译器仓库采用 MoonBit Public License，不能笼统说成整个工具链 Apache-2.0。官方说明允许用户自行选择 MoonBit 源码及编译产物的许可；core 单独采用 Apache-2.0。我们只使用固定版本工具链生成自有计算内核，记录第三方清单，不修改/分发编译器服务。若未来涉及编译器分叉或托管编译服务，应另行核查适用条款。[编译器说明](https://github.com/moonbitlang/moonbit-compiler#license)、[许可证原文](https://raw.githubusercontent.com/moonbitlang/moonbit-compiler/main/LICENSE.TXT)、[core](https://github.com/moonbitlang/core)

## 线程与通信的细致取舍

用户所说“每个线程内独立 Wasm 线程”在浏览器的具体实现应为：**每个承载候选计算的 Web Worker 拥有独立的 Wasm Instance 和非共享 Memory，Wasm 调用在该 Worker 线程上同步执行**。Instance 不会再创造一条线程；没有“Worker 数 × Wasm 线程数”的嵌套线程池。

| 方案                                 | 数据与调度代价                                             | 部署影响                                        | 结论                                                       |
| ------------------------------------ | ---------------------------------------------------------- | ----------------------------------------------- | ---------------------------------------------------------- |
| 现有多 Worker + 各自独立 Wasm        | 消息队列；每实例工作区；显式复制；易取消/隔离错误          | 正常 Worker/Wasm 资源加载，不要求共享内存隔离头 | 默认                                                       |
| 一大个 Wasm 放主线程                 | 没有新增 Worker 消息，但长计算阻塞输入和渲染               | 简单                                            | 拒绝用于生成/网格/流体；仅已有同步玩家预测可例外           |
| 单个全能 Worker + Wasm               | 跨职责数据可能少，任务互相阻塞                             | 简单                                            | 不合并 Authority/Logic/Fluid/Persistence，避免拖慢物理时钟 |
| 多 Worker + 共享 Wasm Memory/Atomics | 可减少大数组复制，但锁、竞争、竞态和取消复杂；堆需线程安全 | 需要跨源隔离等条件                              | 默认不开；本 change 不修改响应头                           |
| Wasm pthread/Rayon/语言内线程池      | 本质仍依赖宿主 Worker 与共享内存，不是免费额外并行         | 构建和运行能力均须支持，可能要双产物            | 没有证据需要，不启用                                       |
| GPU compute                          | 大批并行可能受益，CPU 读回/确定性/兼容有额外成本           | 另一个渲染和设备边界                            | 本次不选；不把现有 GPU 绘制转 Wasm                         |

浏览器共享内存路线通常需要安全上下文、COOP `same-origin`、COEP `require-corp` 或 `credentialless`，及允许的 Permissions-Policy；跨域资源也要满足相应加载规则。额外要求主要是**部署响应头和跨源资源兼容**，不是每步计算需要网络往返。Emscripten 的 pthread 也以 SharedArrayBuffer/Workers 实现，不能仅设置编译选项就视为部署完成。[MDN 隔离条件](https://developer.mozilla.org/en-US/docs/Web/API/Window/crossOriginIsolated)、[Emscripten pthread](https://emscripten.org/docs/porting/pthreads.html)

普通 ArrayBuffer 转移后发送方被 detach；TypedArray 应转移其 buffer。Wasm 线性 Memory 的底层 buffer 不应当作可任意交接的普通结果缓冲：首版把结果复制到专用 ArrayBuffer 后转移，输入则复制进工作区。模块可缓存或在可行时 structured clone 已编译 Module，但每个 Worker 的状态/内存独立；编译和实例化开销分别计数。[可转移对象](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Transferable_objects)

当前固定默认拓扑为 Authority 1 + Logic 1 + Fluid 1 + General 1 + Persistence 1，共 5 个后台 Worker；`generalWorkers=2` 共 6 个。保持这个默认，不按 `hardwareConcurrency` 盲目扩满核心。各角色仅在有获益内核时惰性加载 Wasm。A/B 分别在 5、6 Worker 两档内比较，不能把多一个 Worker 的吞吐增益归于语言。

物理是特殊例外：若批量物理内核通过门槛，在 Authority Worker **原地同步调用**，不把每个物理步发到 General Worker 等待返回。本地预测必须保持同一数值合同；有需要时在主线程惰性加载同一标量内核，但单玩家调用若不划算则继续经过严格对等验证的 TS。不能改变物理频率、补帧上限、推进顺序或输入回放规则来改善跑分。

地图是另一个例外：目前在主线程分片采样。若迁移，应先建同拓扑 TS Worker 控制组，再比较 Wasm；地图工作复用 General 的低优先级、可分片任务，不增加常驻线程、不饿死近场网格或启动任务。

只有未来证明“复制占大头、独立内存路线持续不能达标、共享内存原型仍有明确额外净收益、实际发布平台和资源全部支持隔离、工具链分配器并发安全”时，才值得提交新的共享内存方案审核。当前 MoonBit 文档的 `shared-memory` 开关不等于已经验证其完整多线程运行时。

## 多产物修订的官方依据

- [Node-API 官方文档](https://nodejs.org/api/n-api.html)：Node-API 提供跨 Node 版本的 ABI 稳定边界，但 Node/V8/libuv 私有 API 和外部依赖不自动继承该保证。它适合长期 adapter；OS/arch/libc 产物仍需分别构建和运行验证。
- [Node worker_threads 官方文档](https://nodejs.org/api/worker_threads.html)：CPU 密集工作适用 worker pool，逐任务创建 Worker 的成本可能抵消收益；ArrayBuffer transfer 和 shared memory 是不同所有权方案。新实验固定 pool 和复制策略后比较语言。
- [napi-rs TypedArray](https://napi.rs/docs/concepts/typed-array) 与 [AsyncTask](https://napi.rs/docs/concepts/async-task)：借用/拥有输入、异步计算和返回 JS 的生命周期属于 adapter 责任。当前计划优先受控 Node worker 内同步调用，不叠加多个线程池。
- [Rust wasm32-unknown-unknown 目标文档](https://doc.rust-lang.org/rustc/platform-support/wasm32-unknown-unknown.html)：该目标不提供常规宿主 OS 能力保证。把纯算法与宿主适配分开，才能让相同 core 真正复用于 native 和 Wasm。

上述资料证明机制和约束，不证明本项目 Node/Rust 比 Chrome/TS 更快。吞吐、RSS、GC、边界与多平台成本必须按新矩阵实测；共享资产价值属于架构判断，不能替代性能证据。
