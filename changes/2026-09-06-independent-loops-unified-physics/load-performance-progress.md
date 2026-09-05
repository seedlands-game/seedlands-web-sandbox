# 权威受控负载与计算池对照进度

## 合同

本记录只覆盖 A9/A12 的受控负载，不替代 `loop-performance.spec.ts` 的自然路线。浏览器证据必须使用同一台机器、前台 Chrome、1920×1080 CSS、DPR 2、Medium 画质及既有 0.88 内部比例，分别运行一个流体保留槽加一个通用槽、一个流体保留槽加两个通用槽。结果只报告实测差异；三槽配置没有预设胜出结论。

受控场景通过生产命令和世界编辑建立：权威状态中至少 16 个 `active` 自主角色、64 个掉落物物理身体、1024 个真实流体 frontier 位置。角色和掉落物都位于当前近场碰撞区域并继续参加权威物理/规则推进。场景不修改 seed、`generatorVersion` 或质量配置。

每个配置至少采集：

- 浏览器、源 SHA、CSS 视口、DPR、Canvas 内部分辨率、硬件并发数和可用 JS heap 数据；
- rAF 帧分位、每个物理步真实成本分位、最大物理债务；
- 流体 pending/in-flight/accepted/rejected/returned 真实权威计数；
- 计算池实时/峰值任务数与排队字节、按 lane 的 Worker 侧任务经过时间窗口；浏览器没有标准的 Dedicated Worker CPU-time API，因此不得把经过时间冒充线程 CPU time；
- 流体从编辑、目标区域 `fluid-v2` 权威提交、目标 Chunk 的 Worker 网格、场景挂接到 `postrender` 首见的 20 个样本；
- Mesh 排队和完整可见延迟，且在持续交互流体任务期间，先进入队列的 streaming trace 最终完成。

流体样本必须在 `beginFluidFeedbackSample({x,y,z,radius})` 中固定目标区域和开始时 Chunk revision。`fluid-v2` 提交只有在变更 bounds 与目标区域相交、且对应目标 Chunk revision 前进时才能成为该样本的首次提交；其他 Chunk 或同 Chunk 其他区域的水流提交不能抢先完成样本。可见完成继续要求匹配该提交 revision 的网格 trace 已出现 `visible-postrender`。

## RED 设计

`e2e/authority-load-performance.spec.ts` 先声明以下缺失观测，作为生产接线前的类型 RED：

1. Harness 快照尚未暴露流体权威诊断、计算池峰值/Worker 任务成本和权威身体近场分类。
2. `beginFluidFeedbackSample` 尚未接受目标区域，现有 tracker 会把第一个无关 `fluid-v2` 提交绑定为样本。
3. 计算 Worker 回执尚未携带 Worker 侧任务经过时间，无法对 2/3 槽位解释吞吐与帧差异。

预期先由 `pnpm exec tsc -p tsconfig.test.json --noEmit` 在上述字段处失败，再实现最小观测并转 GREEN。按主任务调度，本代理不启动浏览器；生产构建后的 Playwright 实跑、性能附件和最终 2/3 槽位取舍由主任务在不可变产物上完成。

## 当前状态

- [x] 冻结负载、采样和目标流体归因合同。
- [x] 记录测试类型 RED：`tsconfig.test` 在目标采样参数、流体/身体/计算诊断共 13 处因接口缺失失败；计算池专项 1 项因峰值和 Worker 耗时字段缺失失败。
- [x] 补齐有界真实观测与目标归因：权威流体/身体、计算队列峰值和分 lane Worker 经过时间均来自生产对象；流体完成要求目标 bounds/revision 与完整 Worker→attach→postrender trace。
- [x] 定向 Vitest 5 文件 31 项、源码 TypeScript、ESLint、Prettier 与 diff check 通过。生产构建已执行到 Svelte/source TypeScript 通过，随后被并发 A12 RED `tests/worker/compute-worker-entry-lifecycle.test.ts` 引用尚未建立的模块阻塞；不是本任务诊断。
- [ ] 不可变浏览器产物完成 2/3 槽位实测并回填结果。
