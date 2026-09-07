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
