# P0 Worker-first A/B 结果

**运行标识：** `3481236b-eaff-4378-97ff-1ad74401eaf1`  
**代码：** `e0fa0c99132fc7de11c5b97f50e218d68237b1dc`  
**环境：** macOS arm64、Node `v24.20.0`、Chromium、1280×720、Harness benchmark profile。  
**场景：** 排空初始队列后，以固定 seed `worker-first-ab` 进行单向 crossing；每个 sample 至少 20 个 Chunk 在 `postrender` 后可见。

## 方法

在同一 Playwright test 中按 `A → B` 交错五次：

- **A / `main-snapshot`：** Main Thread 生成 canonical 和完整 Halo，Worker 只 meshing。
- **B / `worker-first`：** Worker 生成 provisional canonical、Halo 和 mesh；Main 仅验证后接受 canonical，再按帧 commit。

每个 variant 有 5 个独立 sample；没有按性能结果剔除样本。原始 JSON 位于本机忽略目录 `harness/results/worker-first-ab.json`，包含全部 frame、trace 与环境字段；GPU timestamp 不可移植，本次为 `NOT_COLLECTED`。

## 结果

| 指标（每 variant 5 个 sample 的中位数） |        A |        B | B 相对 A |
| --------------------------------------- | -------: | -------: | -------: |
| frame p95                               |  140.8ms |   17.4ms |   -87.6% |
| frame p99                               |  446.6ms |   17.7ms |   -96.0% |
| long frame 数                           |       21 |        1 |   -95.2% |
| request-to-visible p95                  | 2681.2ms | 2422.4ms |    -9.7% |
| request-to-visible p99                  | 2808.8ms | 2555.8ms |    -9.0% |

逐次 frame p95：A=`134.9, 145.3, 144.4, 140.8, 132.5ms`；B=`17.5, 17.2, 17.4, 17.6, 17.4ms`。逐次 request-to-visible p95：A=`2307.5, 2936.2, 3061.0, 2681.2, 2077.4ms`；B=`2614.4, 2246.8, 2672.8, 2309.6, 2422.4ms`。

## 结论

保留 B。它稳定消除了由 Main Thread `makeChunk()` / Halo 采样引起的 frame 尾延迟，且 request-to-visible 的尾延迟没有回退、实际小幅改善。每个 B sample 仍有一个约 `390–447ms` 的最大帧，该指标不能归因于 P0：本轮只证明其不再形成持续的 streaming burst。下一阶段应先用新增分段 trace 归因该单次最大帧；在没有 worker queue、draw submission 或 GPU 证据前，不启动 Worker Pool、WebGPU 或渲染分类优化。
