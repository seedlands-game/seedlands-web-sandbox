# 断言成本对照

绑定主干 `01bab28ace506685f39c1d4a86fec541cbbf2f1b`，唯一实验轴为五个测试文件的 17 处大型缓冲/含缓冲结构比较。保留 corpus、场景、随机 seed、所有元素、输入未修改断言、单 worker、默认隔离和 V8 覆盖率配置。使用 Node 标准库 `deepStrictEqual`，不添加运行依赖或自定义 hash 比较器。

## 原始样本

同一 macOS arm64、Node v24.20.0、依赖和 vitest.config，通过 `scripts/benchmark-window.mjs` 串行取得。完整身份与原始日志在 `evidence/comparison.json` 和相邻 `.log`，测试计时含完整 Vitest runner；不含 pnpm 前置安装检查的等待。CI Node 22.12 / Ubuntu 是另一环境，不能外推同样比例。

| 顺序 | 比较器               | Vitest 墙钟 |
| ---- | -------------------- | ----------- |
| A1   | Vitest toEqual       | 97.55 s     |
| A2   | Vitest toEqual       | 97.32 s     |
| B1   | Node deepStrictEqual | 21.90 s     |
| A3   | Vitest toEqual       | 90.24 s     |
| B2   | Node deepStrictEqual | 21.08 s     |

A/A 相对差异约 0.24%；A3 相比前两轮也有约 7% 漂移，保留不剔除。B 均值 21.49 s，相对交错 A3 减少 **76.19%**，超过预设最低 15% 和 A/A 噪声两倍，且使用更快的 A3 作为保守比较。只声明这五文件组件级收益，不声明整个 CI 提速 76%。

所有五轮均 5 文件、11 用例通过，world 行覆盖率均为 66.45%。**命令均 exit 1**：局部选样未达到未修改的全局 80% 门槛。这不是代码断言失败，也不是完整 coverage 验收通过；最终全量覆盖率门禁必须独立通过。该失败和报告完整保留。

## 语义复核

- 不改输入、生产算法、Wasm artifact 和任务数量，全部被比较值继续参与断言。
- 原生 strict 比较检查类型、嵌套结构和全部有效视图；不会只比较 buffer 长度。Node 的 strict 比较比原 loose `toEqual` 在 prototype/缺失字段等方面更严格，不能声称对任意 JS 值语义完全相同；本 corpus 全部通过。
- 额外一次性反例探针验证 Uint8/Uint16/Uint32/Float32 的首、中、尾元素变更、长度、数组类型和嵌套 revision 差异全部抛 `ERR_ASSERTION`；有效区间相同但 backing buffer/offset 不同的视图通过。使用标准库而不维护新的比较器。

## 复现

在相同依赖的 base 与本分支独立 checkout 中，保持同一机器单独运行下列命令；禁止并行。先 A/A，再 B/A/B，保留非零 exit 和 coverage 输出；本命令用于组件计时，预期因局部选样返回 coverage exit 1。

```sh
node scripts/benchmark-window.mjs --wait-timeout-ms 1000 -- \
  pnpm exec vitest run \
  tests/world/wasm-mesh-equivalence.test.ts \
  tests/server/wasm-fluid-logic-equivalence.test.ts \
  tests/world/data-plane-rust.test.ts \
  tests/world/wasm-world-kernel-equivalence.test.ts \
  tests/world/wasm-halo-equivalence.test.ts \
  --coverage --maxWorkers=1
```

最终生产门禁仍是 `pnpm verify:static`、`pnpm build` 和当前 CI 的完整 Playwright commands。静态 steps 拆分只是让耗时和失败可定位；本次未增加 runner/shard，也未改变 GitHub required checks。浏览器时序修复按功能反例验收，不将取消成功截图或减少重试单独包装成已测性能收益。

一手规则：[Node strict comparison](https://nodejs.org/api/assert.html#assertdeepstrictequalactual-expected-message)、[Playwright failOnFlakyTests](https://playwright.dev/docs/api/class-testconfig#test-config-fail-on-flaky-tests)、[Playwright CI 单 worker 建议](https://playwright.dev/docs/ci)。
