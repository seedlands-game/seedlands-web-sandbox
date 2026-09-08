# TS fallback 常规 Chromium 基线独立评审

## 完成状态

**通过。** 冻结提交 `47f3ad79c30a34cbb9ad02e7a21cbacfcafbf15a` 中的 `web-package-runtime.spec.ts` 适合加入 `test:e2e:regression`。未发现阻塞项。

## 提交和推送

- 评审对象：`47f3ad79c30a34cbb9ad02e7a21cbacfcafbf15a`；评审时当前 HEAD 与其一致。
- 固定合同 `baseline-review.json` 的 SHA-256 已核对为 `83813a08a12f9a2a6f4773484d86daffdf03b0acc8e5ca75843e529077dc5a59`。
- 本角色未修改源码、测试期望或历史证据，未暂存、提交或推送；现有未提交文件保持不动。

## 变更

仅新增本独立评审报告：`/tmp/seedlands-monorepo/baseline-review.md`。

## 验证结果

### 长期价值

通过。现有 `tests/e2e/regression/world-play.spec.ts` 使用默认实验参数，当前默认是 WebGL2、Wasm 开启、SIMD 开启；它能保护默认启动与游戏旅程，却不能证明显式 `?wasm=off&simd=off` 仍可完成启动、Worker 握手、区块生成、mesh 提交和首次 PlayCanvas 帧。新增用例明确断言 `requested.wasm=false`、general Worker 为 `status=off/effectiveArtifact=off`、且有非零加载和渲染区块，保护了产品文档长期承诺的 TS control/fallback 路径，也直接覆盖三包迁移容易破坏的 Web→core→Worker 运行时链路。

### 重复度

可接受。默认 `world-play` 与本用例共享 `startHarnessWorld` 启动旅程，但选择分支不同；默认路径不能替代显式 TS fallback。`tests/e2e/benchmark/initial-world.spec.ts` 已有相同 fallback profile，但它属于性能采样：每个 profile 建独立 context、采三次并等待 30 秒，不适合承担每次常规回归。新增用例是对该长期行为的轻量提炼，而不是重复保留整套 benchmark。

### 确定性与失败诊断

通过。URL 同时固定 `renderer=webgl2`、`wasm=off`、`simd=off`，测试使用固定 seed、单 worker、串行 Playwright 配置与统一 Harness 就绪条件，不依赖随机操作、像素阈值、外部服务或性能门槛。`startHarnessWorld` 的 Harness 等待在超时时会附带完整 snapshot；后续四类断言会分别把参数解析、区块加载、首次渲染和 Worker 实际选择的问题定位出来。当前默认 `generalWorkerCount=1`，所以 `arrayContaining` 对 `off/off` 的断言能覆盖全部 general Worker；以后若把该旅程改为多 general Worker，应随实质旅程变更重新评审并改为断言全部 worker 为 `off/off`，这不是当前阻塞项。

### 真实渲染断言

通过。`renderedChunks` 不是静态 DOM 或仅生成完成的信号：PlayCanvas adapter 把 mesh instances 挂入场景并注册 `postrender`，repository 只在该回调后把带非零 triangles 的 chunk 放入可见集合；Harness 的 `renderedChunks` 来自这个集合。因此 `renderedChunks > 0` 证明 TS fallback 产出的 mesh 至少完成一次真实 PlayCanvas 场景挂载和 `postrender`。它不检查最终像素、材质或视觉质量；本基线目标是 fallback 启动和渲染链路存活，视觉语义并不属于该用例范围。

### 运行代价与维护负担

通过。冻结证据中定向用例为 1/1、4.8 秒；同机完整回归由 14/14、20.1 秒变为 15/15、22.3 秒，观测增量约 2.2 秒且仍为一次短世界启动。用例只有 15 行，复用共享 Harness 和稳定 snapshot 契约，没有截图、黄金文件、专属 fixture 或外部依赖。文件暂留 change 目录，但 `test:e2e:regression` 使用显式路径执行；若未来归档或移动该 change，必须同步迁移该基线文件/脚本路径，属于可见且低成本的维护责任。

## 限制

- 按合同不重复运行浏览器；结论基于源码审阅以及冻结日志 `m3-browser-ts-fallback.log`（1/1、4.8 秒）和 `m3-browser-regression.log`（15/15、22.3 秒）。
- 本评审只判断新增 TS fallback Playwright 用例及其常规 regression 入口，没有扩展到全仓、生产规则、性能结论或远端可玩验收。

## 剩余工作

- 源码与测试无剩余修复。
- root 只需在当前 change 的 spec/Delivery Snapshot 记录本次独立评审为通过，并保留该用例在常规 Chromium regression 执行入口中。
