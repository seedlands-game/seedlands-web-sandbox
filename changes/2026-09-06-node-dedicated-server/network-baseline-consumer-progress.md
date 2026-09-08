# 完整权威基线的客户端消费检查点

## 本批结果与边界

本批把已验证的基线接入真实客户端缓存、网格调度器和网格算法。整个 Node change 仍 Active；实际 app 尚未创建远端会话，上游认证/interest、GPU 可见旅程、GUI、WAN/CI 与迁移性能准出继续未完成。

消费入口见 `src/client/authority/network-baseline-consumer.ts`；类型、验证和共享网格准备按职责拆分。消费者绑定单一连接身份，owner 必须由后续可信会话提供。模块不提供认证，也不把任意收到的网络字节视为可信 owner。

- 共享碰撞缓存、不可变网格准备、worker transfer 副本分别计量。先准入后分配，共享 owner 不重复持有 27 组完整数据；每个物理 worker 任务持有独立副本直至实际结算。
- 按所有邻块的版本更新使旧 preparation 和旧结果失效；释放一个 owner 不清除其他 owner 的水位，最后一个 owner 释放后清除对应 key 的状态。
- 碰撞提交只将当前 owned key 的视图交给既有 reducer，仍保留全局提交序列窗口及原完整 commit 回调。缓存因缺口被删除时同步回收账本，不为未拥有的 key 建立 guard 或发出基线请求。
- 当前 commit 的 reducer 与账本先同步完成，再发出有界 unknown 回调，最后发出原 commit 回调。任何回调重入 close 都终止剩余回调及同批后续 commit；关闭仍等待已派发 worker 的真实 settle。

## RED、独立审查与修复

Sol/high 实施消费者，Terra/high 独立只读审阅，root 负责集成和统一验证。初始 RED 为消费者模块缺失；随后覆盖身份、完整项、预算、共享/取消、水位和缓存提交生命周期。

root 检查补齐了共享高版本使旧任务失效、非最后 owner 的 guard 保留、删除缓存的账本对齐、未拥有 key 的过滤及单连接身份。Terra 独立审查发现回调关闭后同批仍继续处理的 P1；新增两项真实 RED 分别复现 `onCommit` 和 `onUnknownChunk` 重入关闭，修复后 4 文件/19 项定向通过。Terra 再次核对最终源码，确认该 P1 关闭，也审查了窗口溢出触发 unknown 的同类路径，未发现新增阻断。

最终消费计划 SHA-256：`913a26fc8fd2978479a91f1a8602b2c3676d36d154d8b6631c91ccae011f26c1`。

| 生产文件                                   | SHA-256                                                            |
| ------------------------------------------ | ------------------------------------------------------------------ |
| `network-baseline-consumer.ts`             | `2d5ab5481fd6d67d49392f0f545162040069717d21cc3dfd652d8c657a0ede7e` |
| `network-baseline-consumer-types.ts`       | `ba9d5ffc7271a7d066ddf1d514e3a86d56bdc7f14122ca81fd78d810e6714005` |
| `network-baseline-consumer-validation.ts`  | `7cd9c5fb726ec5c9423fe60cd716edfa8ebae503122637b87afe331fc7ed32de` |
| `network-baseline-consumer-preparation.ts` | `6ee5105c16ad999c19e098de20053b1e36d0648540456f0167ec1372570181c1` |

## 真实组合证据

[组合计划](network-baseline-client-integration-plan.md) 和 change-local Vitest 使用冻结 r2 原始/派生文件及当前 codec evidence 指向的解码 artifact；实际读取并核对文件 hash，默认不覆盖生成物。

链路为 C0 实际解码 artifact → 生产 reassembler → 本消费者 → 真实 `MeshTaskScheduler` → `structuredClone` transfer → 真实 `runWorldComputeTask()`。54 个 buffer 实际 detach 后缓存保持独立，算法返回的两个程序化生成计数均为零；consumer 接纳新结果，邻块提交缺口后删除缓存、回收账本并拒绝旧结果。它证明真实模块组合，不是浏览器网络、Web Worker 进程或 GPU 可见性测试。

组合用例首次失败是测试将 Uint16 元素数与字节数混淆，修正后通过；不把这一测试错误写成生产 RED。完整 worker 门禁和 pool 结算的真实 RED 另见 [调度记录](network-baseline-scheduler-progress.md)。

本批还修复 C0 完整 frame 边界：历史 v1 接受 1 MiB raw payload 加封套形成的 1,049,093 B frame；独立 v2 的 encoder 和 decoder 均拒绝，合法 32 KiB 页及 333 条真实消息继续通过。v1 保留不覆盖，未锁定全部 npm 依赖的限制明确记录，见 [codec 记录](network-baseline-codec-progress.md)。

最终整仓、change runner 和构建结果统一见 [阶段快照](validation-summary.md)。本批没有正式性能采样或协议采用；功能测试的运行耗时不用于收益判断。
