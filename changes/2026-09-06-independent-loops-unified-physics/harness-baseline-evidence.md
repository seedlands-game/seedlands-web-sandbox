# 长期基线 Harness 证据

## 固定源码与环境

- 源码：detached worktree，`643b01f831494752f0778d245323c5a90883b160`。
- 环境：Node `v26.0.0`、macOS `arm64`、Chromium。
- 生产构建：`pnpm build` 通过，Svelte、源码与测试 TypeScript 均无诊断；Vite 构建 2432 个模块并产出 Authority、Logic、Persistence、Fluid 与 General Worker bundle。
- 浏览器入口：对上述构建启动 `vite preview --strictPort`，Harness 只执行 `tests/e2e` 长期基线，没有扫描或执行历史 change 用例。

## 浏览器结果

- 命令：`SEEDLANDS_E2E_PORT=4293 pnpm harness:e2e`。
- 结果：9 项全部通过，用时 21.8 秒；`load`、`input`、`player`、`interaction`、`streaming`、`persistence` 六个阶段全部为 `PASS`。
- Run ID：`f7aae213-d9f0-47bb-b8e0-263447a699fa`。
- Source SHA：`643b01f831494752f0778d245323c5a90883b160`。
- Benchmark：`PASS`，`initialWorldReadyMs = 1729.28`。该值是本机环境样本，不作为跨机器硬阈值。
- UI 诊断：`staleUpdateCount = 0`，`coalescedUpdateCount = 53`，`domCommitCount = 6`；受控世界中 5 个权威实体、4 个已呈现实例。
- 运行结束后已停止 immutable preview 和 Chrome，未留下持续运行的采样进程。

原始结构化结果保存在：

- `evidence/harness-browser-e2e-643b01f.json`
- `evidence/harness-browser-benchmark-643b01f.json`

控制台原始日志位于 `/tmp/seedlands-harness-e2e-643b01f.log`，没有失败或重试。
