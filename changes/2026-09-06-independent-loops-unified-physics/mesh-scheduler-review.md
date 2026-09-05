# 网格调度故障与公平性闭环

## 测试先行

本阶段落实 A12 在计算池之前的调度边界。审查发现：固定流体网格优先级仍可饿死 streaming；实际池失败回调没有接回旧 Mesh 端口；调度器在核对任务身份之前递减执行计数，迟到/重复结果可能释放别的任务的槽；成功准备租约缺少释放路径。

先新增两个 Scheduler RED：失败后继续派发且重复旧结果不影响新槽；持续流体任务下 streaming 仍前进。原有 4 项通过、新增 2 项失败。随后 BrowserComputeRuntime 增加真实适配端口 RED，首先因交互优先级被硬编码为 streaming 失败。

## 修订

- 两级队列都按派发次数老化；上游交互优先级透传计算池。
- Mesh 端口新增可选 `onerror({ taskId, error })`，计算失败、合并取消和入队背压回到调度器，释放对应活动任务而不影响其它任务。上游可通过 `cancel-mesh` 请求合作式取消。
- 以活动任务 ID 核对完成与失败；正在异步接纳的同一结果不会重复执行。同步准备/传输异常、异步接纳异常都有回收路径。
- 完成、失败、取消最终回执和关闭均释放准备租约；已完成或未知回执不重复释放。主线已将临时准备释放与客户端 canonical 镜像卸载分开。
- 失败或无效结果清除未完成请求标记，后续正常 streaming 可重新请求。较新 replacement 继续保持排队，不被旧任务失败抹掉。

## 证据与边界

`pnpm exec vitest run tests/app/mesh-task-scheduler.test.ts tests/client/browser-compute-runtime.test.ts tests/client/compute-worker-pool.test.ts tests/client/compute-task-queue.test.ts`：4 个文件、29 项通过。

相关 Prettier/ESLint 通过。source TypeScript 检查仍受主线新旧 World 接口切换的并行诊断影响，本次模块没有诊断。最终静态、构建和浏览器故障/持续流体旅程待完整接线后统一执行。
