# P3 统一 A / A′ / B 进度

## 预注册控制

- A：端口 `4188` 的冻结 `f2454937a4217d88420e1f21ac8ffda4e94847ea` production 产物；runner 还会校验 P0 冻结的六个主/Worker JavaScript SHA-256。
- A′：当前 production 产物，URL 强制 `wasm=off`。必须能从 kernel Worker 的 CDP target 读取到 `status=off`、空 `selected` 与空 memory。
- B：同一当前 production 产物，`SEEDLANDS_WASM_SELECTED` 传入 P2 冻结的非空正收益集合。所有实际请求 kernel 的 Worker 必须 `status=ready`、`memory.failed=false`；任意 fallback 使整次统一评测无效。
- 仅使用仓库唯一 `playwright.config.ts`。浏览器由 runner 以 `--headless=new` 启动；CSS `1920×1080`、Medium、DPR `1`，预期内部 Canvas `1689×950`。不允许 headed。
- 十个 block 各包含 A/A′/B 一次，共 30 次运行。固定顺序让任意两变体的先后各 5 次；A、B 的三个位置计数均为 `3/4/3`，A′ 为 `4/2/4`。统计独立单位是完整 run/block，不把帧或 30 个流体事件当独立样本。
- 每次运行先清空对应 origin 的 storage；同一个 Chrome 进程保留 HTTP/编译 cache，首个样本不丢弃。每个 block 使用同一固定 seed，变体间执行同一真实键盘轨迹：5 s 预热，随后 W/D/S 各占 30 s 测量窗口的三分之一。
- 主指标：进入世界至 ready、30 s 自然真实输入所有页面/Worker active CPU、frame p95、physics p95、30 次流体编辑至可见的运行内 p95。A→A′、A→B 都以十个 block 的 run unit 做 10,000 次 paired bootstrap，改善为正表示耗时减少。

## 诊断与证据

- Worker CDP 只读取 `self.__seedlandsWasm` 的 `selected`、`status`、`reason`、`memory.failed` 与 `memory.memory.buffer.byteLength`；不序列化 `KernelMemory` class、exports 或整个诊断对象。
- 固定 5 Worker 由 Harness 与 CDP target 双重检查；Wasm memory buffer 按 Worker 求和并检查 96 MiB 合同。
- 记录 Chrome/视口/DPR/内部尺寸、A 与当前 source SHA、当前未提交 tree hash、资源 SHA-256、block 顺序、seed、输入轨迹和 Worker 数。运行前后 tree hash 不同则全部样本无效。
- 每个 run 立即写摘要与 gzip level 9 raw profile；raw 清单保存压缩字节数、SHA-256 和有效状态。异常、超时、fallback 与页面错误保留并继续后续 block，不选择性删除或覆盖。独立 `SEEDLANDS_P3_RUN_ID` 目录已存在时 fail closed。

## 当前状态

- [x] 建立 `e2e/combined-ab.spec.ts` 与小型共享辅助。
- [x] 接入根任务提供的 `e2e/ab-statistics.ts`，以 run unit 生成 paired bootstrap CI。
- [x] 默认 skip；只有 `SEEDLANDS_P3_COMBINED=1` 且正收益集合非空才可启动。
- [ ] P2 冻结 `SEEDLANDS_WASM_SELECTED` 与候选产物 source/tree/resource identity。
- [ ] 在通知根任务并获得串行性能窗口后执行 30 次 headless 运行。
- [ ] 写入真实结果、CI、绝对值与限制。
