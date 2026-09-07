# 统一 A / A′ / B runner 运行说明

## 目的与边界

`e2e/combined-adoption.spec.ts` 只在本 change 准出时显式运行。它执行十个平衡顺序 block，每个 block 各运行一次 A、A′、B，共 30 个独立页面会话。A 是提交 `79e05c53e8c8d199c24b438165c7f62aa69efc70` 的冻结 production build；A′ 是当前采纳后的 TypeScript production build；B 是 A′ 加最终选中的 Rust workload。若分项结论没有选中 Rust workload，B 会作为 A′ 的同 build 复跑，`SEEDLANDS_ADOPTION_SELECTED_RUST` 留空是合法的最终方案。

runner 自行启动一个 `--headless=new` Chrome 进程并通过 CDP 连接。不得同时运行其他浏览器性能任务，也不得在采样期间修改工作树或重新构建服务目录。每次运行清空对应 origin 的 storage；HTTP 与编译缓存由同一 Chrome 进程自然共享，首个样本保留。

## 服务准备

先确认冻结工作树的提交，再从其已经生成的 `dist/` 启动 A：

```bash
git -C /tmp/seedlands-adoption-baseline rev-parse HEAD
cd /tmp/seedlands-adoption-baseline
pnpm exec vite preview --host 127.0.0.1 --port 4190 --strictPort
```

第一条命令必须输出 `79e05c53e8c8d199c24b438165c7f62aa69efc70`。A′ 在当前工作树完成 production build 后使用独立端口：

```bash
cd /Users/chlorinec/.codex/worktrees/moonbit-wasm-20260906/voxel-sandbox-foundation
pnpm build
pnpm exec vite preview --host 127.0.0.1 --port 4191 --strictPort
```

若 `SEEDLANDS_ADOPTION_SELECTED_RUST` 非空，再用第三个终端在 4192 提供 B。当前 Rust 选择由 URL 的 `wasm=<comma-separated-selection>` 传给生产入口，因此 4192 可以服务同一份 production build；独立 origin 用来隔离变体缓存和诊断：

```bash
cd /Users/chlorinec/.codex/worktrees/moonbit-wasm-20260906/voxel-sandbox-foundation
pnpm exec vite preview --host 127.0.0.1 --port 4192 --strictPort
```

若最终方案为纯 TypeScript，不启动 4192，B 自动复用 4191 并显式使用 `wasm=off`。

## 精确调用

纯 TypeScript 方案：

```bash
SEEDLANDS_ADOPTION_COMBINED=1 \
SEEDLANDS_ADOPTION_RUN_ID=final-ts \
SEEDLANDS_ADOPTION_A_ORIGIN=http://127.0.0.1:4190/ \
SEEDLANDS_ADOPTION_APRIME_ORIGIN=http://127.0.0.1:4191/ \
SEEDLANDS_E2E_PORT=4191 \
pnpm exec playwright test changes/2026-09-07-data-plane-adoption/e2e/combined-adoption.spec.ts \
  --project=chromium --workers=1
```

含已冻结 Rust 选择的方案：

```bash
SEEDLANDS_ADOPTION_COMBINED=1 \
SEEDLANDS_ADOPTION_RUN_ID=final-rust \
SEEDLANDS_ADOPTION_SELECTED_RUST=w04,w05 \
SEEDLANDS_ADOPTION_A_ORIGIN=http://127.0.0.1:4190/ \
SEEDLANDS_ADOPTION_APRIME_ORIGIN=http://127.0.0.1:4191/ \
SEEDLANDS_ADOPTION_B_ORIGIN=http://127.0.0.1:4192/ \
SEEDLANDS_E2E_PORT=4191 \
pnpm exec playwright test changes/2026-09-07-data-plane-adoption/e2e/combined-adoption.spec.ts \
  --project=chromium --workers=1
```

需要指定 Chrome 时追加 `SEEDLANDS_CHROME_PATH=/absolute/path/to/Google\ Chrome`。`SEEDLANDS_ADOPTION_RUN_ID` 必须保持唯一；证据目录采用 `evidence/combined-<run-id>/`，已存在时 runner 会 fail closed，避免覆盖既有样本。

## 采样与有效性

每个运行先等待真实可玩状态：至少一个 Chunk 已加载且已渲染，generation、meshing、deferred remesh 和 upload 队列均为空。随后执行 5 秒可见帧 warmup 和 30 秒真实 Playwright 键盘输入 `W → D → S`，采集帧间隔 p50/p95/p99、Authority physics cost p95，并通过前后状态和分段 checkpoint 确认玩家实际移动、physics tick 实际推进。

CPU 使用 CDP 1 ms sampling profiler，同时覆盖 main、authority、logic、fluid、general、persistence 六个 target；缺少或重复 target 会使该运行无效。编辑至可见使用生产 `World.edit()`、fluid scheduling、Worker mesh 和 post-render 可见 tracker，预热 3 次后保留 20 个带分段时延的样本，并汇总 p50/p95/p99。

Heap 仅记录各 isolate 在 CPU profile 结束时 `Runtime.getHeapUsage` 返回的快照，不称为峰值。当前协议不能提供同口径、可归因的全进程 RSS，也没有启用会改变负载或无法覆盖全部 isolate 的 GC instrumentation，因此两项分别记录为 `NOT_COLLECTED`，不以零值代替。

每个运行保存摘要 JSON 和包含原始帧、物理、编辑分段、CPU profile 的 gzip 文件。checkpoint 在每个运行后重写；即使某一运行页面错误、状态超时、profile 缺失或样本不足，失败原因和已采集 raw 仍会保留并继续后续 block。单运行上限为 5 分钟，总测试上限为 2 小时。

最终 `combined-summary.json` 包含当前 Git source SHA、含未提交内容的 tree hash、每个实际服务资源的 SHA-256 清单与派生 build hash。runner 结束时重新计算 tree hash；采样窗口内源码发生变化会使全部运行无效。统计仅在十个 block 的三个变体均有效时生成，以 run/block 为配对 bootstrap 单位，同时给出 A→A′、A′→B、A→B 的均值、绝对差、改善百分比和 95% 区间。
