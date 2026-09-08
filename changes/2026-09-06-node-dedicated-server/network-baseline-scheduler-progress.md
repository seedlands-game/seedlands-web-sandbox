# 完整输入调度接缝的阶段记录

本阶段完成 opt-in 的完整权威输入与真实网格调度接口。整个 Node change 仍 Active；生产 app 尚未启用远端会话，客户端 consumer 的组合验收继续进行。

## 已实现与真实 RED

- `MeshTaskSource` 以判别联合隔离 integrated 的 canonical 接纳与 `authority-complete` 的纯派生结果核对。完整 source 无 Authority canonical 上行方法，构造和切换 main-snapshot 均拒绝。
- 完整输入副本按具体 taskId 登记 lease。取消、替换、scenario 代次变化不提前释放；实际结果/取消完成/已经终止的 worker 失败后结算。post 失败、重复回包和 dispose 均只结算一次，dispose 先 terminate。
- `ComputeWorkerPool` 修复真实失败顺序：RED 中 onFailure 看见 worker 尚未终止；epoch-switch 的 onDrop 甚至允许再入旧队列；dispose 回调也早于终止。现在先摘除/终止 slot 再通知 active 任务，epoch 切换关闭同步准入，目标 epoch 和嵌套 switch 均不能绕过。
- 初始调度 source 用例 4 项 RED、pool 3 项 RED/1 项 GREEN；新接口和失败顺序完成后，扩充至 10 项 GREEN。完整生成规则的另外 20 项见 [worker 计划与证据](network-complete-baseline-worker-plan.md)。

`mesh-task-source.ts` 保存 source/port 合同、完整 dispatch 准备与结果路由，调度器维持现有状态机，文件通过 500 有效行门禁。原 `AuthorityOverlayCopy` span 仍只计准备输入，未因提取函数将 dispatch 编码和诊断混入旧指标。

## 验证

官方 Node 22.23.2：

- `vitest.baseline-scheduler.config.ts`：2 文件/10 项通过；包括真实 `runWorldComputeTask()` 和 `structuredClone` transfer。此组 source 验收回调是接口夹具，不能替代随后真实 consumer 组合用例。
- 完整 worker runner：20 项通过；既有 scheduler/retry、compute pool、browser compute runtime、worker 5 文件/35 项通过。
- 基线 codec 只读 runner：1 项通过，真实 333 条与单列 synthetic 32 KiB 页均由生产 reassembler 消费；实际 raw/derived 文件 hash 也重新核对，不只相信 artifact 中的 pin 字符串。
- 目标 Prettier、ESLint 与测试 TypeScript 通过；此检查点没有把上一批 1074 项完整静态结果当成本批重跑。
- 浏览器 build 通过，日志 `/tmp/seedlands-complete-worker-scheduler-build.log`，保留既有大 bundle 提示。Node 五入口构建通过，日志 `/tmp/seedlands-complete-worker-scheduler-node-build.log`；manifest 为 `sourceSha=eeb54c3755b428ef62a44987f3096737bd92f34c`、`sourceDirty=true`，source inputs SHA-256 为 `8897157545cfd4104a2855b0775618c2ed2d8f605eb9578983133a240be2d3fb`。不把产物标成未来提交 SHA。

## 独立复核与限制

两个 Terra/high 子任务独立核查计划/实现，其中一方复跑 10/10；transitioning 准入门与 taskId 结算已纳入。审阅曾把 `beginScenario()` 清理 latestTasks 误读为清理 activeTasks，该判断已通过源码核对撤回；保留 scenario 回归，不把它写成修复了一个不存在的泄漏。

直接 port 取消发送若抛错，不能在未终止 worker 时简单调用 fail 释放预算；保持 active 到真实结果或 dispose。当前生产 BrowserComputeRuntime 已由 pool 捕获底层 post 失败并先终止。任意第三方 port 违反同步 terminate 合同不属于本次已验证路径。

本阶段没有新 UI、socket 或正式性能样本。codec 的包体差异不是速度结论；原型临时目录不进入生产包。完整 consumer、真实镜像/提交失效与浏览器远端旅程分别验收，不能以本页的调度夹具代替。
