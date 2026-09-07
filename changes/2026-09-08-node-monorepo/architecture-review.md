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
