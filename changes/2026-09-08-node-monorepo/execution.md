# 三包迁移实施记录

## M0：迁移前 RED

- 合同检查点：`b1c8d06`；实现合同 SHA-256：`7c29f9f57b2e908dc6253b8e149b207a63ec3ceaedb0060a83cc73b5d9652bf5`。
- 环境：macOS arm64，Node `v22.23.2`，pnpm `11.25.0`。
- 命令：`pnpm exec vitest run tests/governance/monorepo-package-boundaries.test.ts --no-file-parallelism --maxWorkers=1`。
- 结果：预期 RED，1 个文件中 4/4 用例失败。工作区尚未声明 `apps/*`、`packages/*`，三个 package manifest 与 core 专用 tsconfig 均不存在。
- 原始日志：`/tmp/seedlands-monorepo/m0-red.log`。

后续阶段只在新增事实形成后追加，不覆盖本次 RED。

## M0：合入最新 main

- 合入：以普通 merge 将 `origin/main@5557f34` 合入本分支；冲突文件为 `package.json`、`eslint.config.mjs`、`docs/collaboration-routing.md`、`src/client/compute/compute-worker-pool.ts`、`src/worker/world-compute-task.ts`。
- 语义整合：保留 Node `logic` lane、running byte 账本与 `failLane`；浏览器池拒绝 logic lane，并同时保留 Worker ready/失败回退诊断。终止与故障回调前先物理摘除 slot/Worker，避免回调再入恢复旧资源。完整 Authority mesh 输入继续严格校验并直接消费 canonical/fluid，不调用生成回退；普通输入仍可使用 main 注入的 TS/Wasm kernels。
- 自动合并复核：`authority-runtime` 同时保留无快照实体更新、宿主激活/输入清理提交和不可用 action 的提交前副本；task queue 同时保留上述 Node 资源合同与 main 的 lane 失效传播。
- 定向单元：8 文件、45 项通过；日志 `/tmp/seedlands-monorepo/m0-focused.log`。
- 生产源码静态：Svelte 0 error/0 warning、生产 `tsc --noEmit` 与冲突相关 ESLint 通过；日志 `/tmp/seedlands-monorepo/m0-static-focused.log`。
- Web 兼容构建：Rust artifact 指纹、预渲染检查及 Vite production build 通过。Node 五入口构建通过；日志 `/tmp/seedlands-monorepo/m0-builds.log`。
- 浏览器回归：当前 14 项 Chromium regression 全部通过，覆盖预加载/预渲染和 8 项长期游戏旅程；日志 `/tmp/seedlands-monorepo/m0-browser-regression.log`。
- Node 产物：五入口真实启动/关停/恢复与 SIGKILL durable 恢复 4/4 通过；日志 `/tmp/seedlands-monorepo/m0-node-artifact.log`。
- `pnpm typecheck` 的生产检查通过，但历史 Delivered 数据平面对照源码中的绝对 `/tmp/seedlands-adoption-baseline` 在本机仍存在，使 8 个 `@ts-expect-error` 变为 unused；原始日志 `/tmp/seedlands-monorepo/m0-typecheck.log`。这不是合入行为错误；M1 以包级类型入口排除冻结实验的临时绝对路径依赖。

## M1：三包源码、依赖与平台边界

- 建立 `apps/web`、`apps/node-server`、`packages/game-core` 三个 workspace 包。浏览器源码、Vite 入口与资产归 Web；Node CLI、线程、子进程、文件与锁适配归 Node；世界、物理、运行时、权威规则和纯计算任务归 core。Web 与 Node 仅经 `@seedlands/game-core` 的分域 subpath exports 消费共享逻辑。
- core 的 TypeScript 环境仅含 `ES2022`，不含 DOM、WebWorker 或 Node ambient types。需要克隆、UTF-8 fatal 解码、取消、单调计时、timeout 与 yield 的纯逻辑通过只读实例端口获得能力；浏览器、Node、测试入口分别注入真实 `structuredClone`、复用的 `TextEncoder`/fatal `TextDecoder`、`AbortController` 与 `performance.now`，没有可重配共享全局或算法降级。
- Web 源码类型检查使用 `vite/client`，Vite/SSG 工具配置由独立 `tsconfig.tools.json` 获得 Node 类型。Node 构建的 metafile 明确拒绝 `apps/web`、PlayCanvas、Svelte、Tone 与 Vite 产品依赖。
- 三包类型检查和构建通过；Web production build 保留 Rust 指纹、预渲染和默认/TS 回退代码路径，Node 构建生成五个独立 ESM 入口。日志：`/tmp/seedlands-monorepo/m1-typecheck.log`、`m1-build-core.log`、`m1-build-web.log`、`m1-build-node.log`。
- 包级测试按职责通过：core 90 个文件、595 项通过且 4 项既有 skip；Web 107 个文件、409 项通过；Node 21 个文件、124 项通过。引用浏览器 Wasm wrapper 的 world/server 等价测试归 Web，根级完整回归入口未缩减。日志：`/tmp/seedlands-monorepo/m1-core-test.log`、`m1-web-test.log`、`m1-node-test.log`。
- 包边界及 world/runtime/Node 静态定向检查 4 个文件、22 项通过；ESLint 与路径 lint 通过。全仓 coverage、临时目录隔离安装、浏览器回归和真实 Node 产物恢复将在 M2 冻结验收，不以本检查点替代。
