# 三包边界的准出审阅清单

本页由 root 维护；是待验证的架构检查，不是已通过结论。用户已明确批准三包边界及实施，以下细化不扩大功能范围。

1. game-core 包含跨端权威规则，不能把全部 server 目录误移入 Node；内部 world/physics/runtime/server 依赖规则继续有正反例保护。
2. 迁出 worker 中的纯任务执行和协议后，不允许 core 通过类型导入、动态 import、路径别名或文件路径回到 Web/Node。不得用 globalThis as any、自造宽泛 DOM 声明或 skip 全部检查来伪造纯核心。
3. 若核心需要单调时钟、yield 或调度，复用或注入窄平台端口；浏览器/Node 入口提供真实环境实现，保留取消与时间语义。ES2022 自身标准库能力不属于平台泄漏。
4. 包间通过声明的 subpath exports 引用。允许内部私有 workspace 的 TS 源码导出供既有 Vite/esbuild 消费，不能因此声称是已发布 npm 的通用 JS 包。Node 最终产物必须自包含。
5. core/Node 的独立安装验证必须隔离于宿主根 node_modules，不以根完整 install 后 pnpm --filter 构建替代。共享通用工具仍可根管理，但 Node 包构建不依赖 Web typecheck/资产/源目录。
6. 三包依赖不需要三份 lockfile；运行依赖归各自包，根 dev tooling 可共享。只有 web 消费 Svelte/PlayCanvas/Tone，Node 产物 metafile 边界同步迁移后路径。
7. main 的 SSG/预加载/Worker ready、Wasm 默认与 wasm=off 控制保留；Node TS 不自动纳入 Wasm ABI 或 browser fetch loader。
8. shared compute queue 自动合并也需审阅 logic lane、running byte 账本、failLane 和回调再入。完整 baseline 始终零程序化回退，cache 与 transfer 副本物理所有权仍分离。
9. CI 明确分别执行 core、web、node 及全仓检查；Node 五入口、URL/Worker 路径、锁文件来源、资产 manifest/hash 要按新结构实测，不只替换字符串。
10. 当次与 Active 回归可以迁移，Delivered/Archived 的历史来源 hash 与结果不得重写成新路径/新结果。新 change 说明哪些旧用例现在继续保护；不利用历史冻结大面积删除现行回归。

最终结论：待实施者冻结 HEAD 后独立验收，并记录发现/修复与最新证据。

## M1 源码差异复核

root 对冻结提交 f7960dd 相对 0380926 的核心迁移进行去路径噪声比对，40 个核心文件有实际文本调整。平台端口为实例注入的只读窄接口，两端提供原生 clone、fatal UTF-8、monotonic clock、timer/abort，未采用 JSON 深拷贝或 Date.now 代替。文件移动本身不视为算法改变。

发现并交回实施者的两项语义偏差：

- P1：AuthorityRuntime.create 在异步 restore/bootstrap 后移除了旧的可选实时时钟重锚定。Web 启动传 startTimeMs=0，首次实时 wake 会把加载期间的时间视为模拟积压。需恢复真实宿主在启动完成后重锚定，并保持 headless 虚拟时钟原语义；补可控延迟启动的 RED→GREEN。
- P2：HeadlessSession 的 bootstrap/mesh 原先使用 compute 默认微任务 yield，新平台接线引入每次 checkpoint 的 setTimeout 宏任务等待。应只注入测量时钟，保留原微任务调度；原 executeWhileDraining 的宏任务让出仍经平台端口提供。

当前为 f7960dd 审阅发现，不是最终缺陷状态；等待实施者修复和对应证据后回填。

## M1 独立静态复核

Terra 对冻结 f7960dd 的 manifests、exports、编译环境与测试配置进行只读复核。实际源码依赖方向正确，但发现 P1：原静态规则未普遍拦截跨包文件路径绕过 exports、core 反向依赖两端、Web/Node 互引和未声明包依赖。已交回实施者增加解析源文件归属的规则及可执行负向用例；本阶段不记为通过。

迁移前清单冻结在 0380926：239 个 tests/ 测试路径和 101 个 change-local 路径在 f7960dd 全部保留。239 项由 core 90、Web 107、Node 21、根 Vitest 18、根 Playwright 3 项构成。根 Vitest 执行其中全部 236 个 .test.ts。

101 个 change-local 路径实际包含 81 个 Playwright .spec.ts，以及 Active Node change 的 20 个 Vitest .test.ts。后者由 19 个专用配置覆盖，具有定向运行入口，但不被根默认 test 或当时的 tsconfig.test.json 自动覆盖；部分入口依赖外部语料。路径存在、可定向运行、默认执行、类型检查和历史冻结必须分别陈述，不将历史 PASS 作为本次证据。Active Node 的必要子集和类型检查覆盖交回实施者在 M2 明确。

## f720798 修复复核

root 已实读修复差异：AuthorityRuntime 在 restore/bootstrap 后使用显式 startClock 重锚，Web 与 Dedicated 宿主接入实时时钟，Headless 仍保持虚拟起点。新增回归令加载期间时钟前进 5 秒，再 wake 20ms，要求 physicsTick=1；实施者保存了迁移错误补跑 4 步的 RED 与修复后的 GREEN 日志。Headless 两处纯计算恢复默认微任务 yield，测量时钟仍经端口注入。

Active Node 的 20 个专项测试源码及配置纳入独立 tsconfig；新增 portable runner 选择无需外部语料的 4 文件 35 项，CI 单独执行。完整历史语料性能结果仍不作为本次证据。新增包依赖解析规则和负向探针、隔离构建脚本进入本阶段的独立复核；最终行为验收待收口。
