# 远端基线进入现有客户端的接线计划

## 目标与当前状态

本页把完整 Authority capture、公开参考分页/重组与现有客户端消费路径接起来，补充早期 [会话梳理](client-session-integration.md)。当前只是下一切片的实施合同草案；尚未新增 Remote adapter、网络监听或 GUI，也没有冻结 codec、传输或缓存配置。实施依赖 [基线参考计划](network-baseline-reference-plan.md) 完成并经独立审查。

原始 Host 语料调用真实 `createProceduralMeshInput()` 的结果只证明纯算法在完整输入下可避免程序化生成。客户端接线还必须证明所有权、每项版本、失败清理和现有 worker 调用，不能把语料测试当作这些行为已完成。

## 已核实的生产边界

- `src/client/authority/authority-mesh-preparation.ts` 的旧入口只对 main 执行 revision guard，overlay 没有 revision；不能直接把公开 descriptor 降为旧 payload 后声称整组输入已验证。
- `src/client/authority/authority-collision-mirror.ts` 已提供基线安装、版本门禁和连续 delta 应用。较新 collision cache 不应被旧 baseline 回退；delta 的 `previousRevision` 不匹配时失效并重新请求。
- `src/app/world/mesh-task-dispatch.ts` 与 `src/worker/world-compute-task.ts` 的本地路径允许缺 canonical 后自行生成；`src/world/mesh.ts` 允许缺邻接块后程序化补齐。远端必须在调用前拒绝缺项。
- `WorldAuthorityPort` 定义在 `src/app/world/world-runtime.ts`，仍混合镜像读取和 `editWorld`、`acceptWorkerCanonical` 等本地能力。远端组合入口需要受限客户端端口，不能将这个接口原样转成网络请求。
- `src/client/compute/mesh-task-snapshot.ts` 通过 task、epoch、main revision、halo revision 判断 mesh 是否仍有效，但当前 worker-first dispatch 的 haloRevision 只是 `worker-input-${sequence}`，`WorkerInput` 没有 overlay revision 通道。远端需要增加由完整、规范排序的版本向量导出的稳定身份，并在调度与结果接纳两端核对，不能只改字符串而遗漏提交失效。
- 现有 `PlayerController.collisionWorld()` 先检查 `getChunkRevision()`，为空时返回未知 voxel；`VoxelCollisionWorld` 对未知块使用阻挡。虽然底层 `getVoxel()` 缺缓存返回 Air，不能因此宣称现有预测会穿过缺块。远端必须保持 revision 不可读门禁，并区分未知阻挡和完全暂停预测两种行为。

## 最小接线与所有权

新增客户端消费层负责已通过 reference reassembler 的 owned LE/raw blocks。它不解码 wire、不认证玩家、不发送任意编辑，也不替服务器生成 canonical/fluid。目录按现有 `src/client/authority/` 职责组织；具体文件拆分由实现前测试和大小门禁确定。中性客户端合同不得反向导入 `src/app/world/` 类型；由 app 组合层适配 World，或提取不依赖 app 的共享合同。

现有 World 每轮 streaming 调用 `setFluidActiveChunks()`，编辑路径调用 `editWorld()`，mesh scheduler 的 worker-first 结果接纳强制经过 `acceptWorkerCanonical()`。实施时必须拆开这些能力：远端 streaming 只改变表现兴趣，不控制服务端流体活动；远端交互只走有限 action；worker 结果仅做本地身份与 canonical 等值核验，不允许不匹配时退回 `accept-generated-chunk` 上行。不能用空实现掩盖仍在调用的权威操作。

可信 session 层先建立 owner，身份为连接代次、interest id、主 key、purpose 与单调 owner generation。每个 owner 显式登记其依赖 key：mesh 为精确 27 项，独立 collision 为一项。只接受该 owner 的 request/bundle；取消先使 owner 失效，再异步回收仍在重组或传输中的资源，迟到数据不得重新建立 owner。

共享 key 的引用计数独立于一次 baseline 请求的 lease。取消一个 mesh owner 只移除它的 preparation 与引用；同 key 仍有其它 mesh 或 collision owner 时，不调用 guard.release、不删除共享 collision cache。最后一个 owner 释放时才回收其缓存与门禁状态。连接代次变化则使全部旧 owner、请求、mesh 任务和预测输入失效。

接纳 bundle 的步骤必须原子：

1. 在大块 LE 转换和安装前，校验当前连接/owner generation、request、purpose、主 key、generator version、27/1 项完整性、每项 key/revision/role、两类 block 长度与 descriptor 一致性。
2. 对每个 key 检查当前 commit 要求的最低 revision。主项的 `minimumRevision` 不替代 26 项 overlay 的当前版本要求。任一项过期、缺失或身份不符则拒绝整组 preparation，不安装半组，也不回退生成。
3. 对 canonical 用显式 little-endian 数值读取构造目标平台 `Uint16Array`；fluid 按字节复制。禁止假设客户端 CPU 字节序。所有解码结果由消费层持有，不保留可被上游修改的入参视图。
4. 在同一同步步骤中再次核对 owner/版本，然后安装独立 collision cache 与完整 mesh preparation。使用现有 `cacheAuthorityCollisionBaseline()` 保留更新版本；若因此 mesh 与要求的版本向量不同，拒绝旧 preparation 并重新请求，不能混用不同时间的任意块凑成一组。
5. 通过独立的 `snapshotForWorker()` 返回完整 canonical、fluid 与 26 份 overlay 的 transfer 副本；现有 dispatch 会转移这些 buffer，不能交出缓存自身的 view。回包受 task/连接代次/main revision/完整 halo 版本身份检查。worker 结果只用于客户端 mesh，不调用 Authority 的 canonical 接纳或 Fluid/Logic 候选提交。

当前 reassembler 在产物交给消费者时释放其在途预算。消费层必须在接纳输出前预留独立 cache/preparation 字节；不能以“16 MiB 重组上限”声称客户端整体有界。预算不足时停止接纳并明确重同步/收紧兴趣，不能先无界缓存再驱逐。共享 canonical、可变 collision 副本、不可变 preparation、worker transfer 副本与 GPU 资源分别计量；具体候选额度需与 streaming 需求和 N2 数据量一起记录，不在本页凭空确定。

## 提交、重网格与失败

`WorldCommitPresentationReferenceV2` 先按现有 worldRevision 重排和 per-key delta 门禁进入 collision mirror。严格连续的 delta 调用现有生产应用逻辑；链断或重排溢出时将对应 key 标为不可读，至少保留现有未知阻挡与禁止缺版本重放的行为。是否在远端同步状态完全暂停本地 advance，必须在接线前定义并测试，不能把现有未知阻挡描述为已经暂停。不能把缺失块当 Air，也不能让新 pose 被误认为已具备碰撞输入。

任何 main 或 overlay 的新要求都使依赖它的 mesh preparation 失效。维护 key 到 mesh owner 的反向依赖，并在调用现有仅按 `meshChunks` 调度的 `World.consumeServerCommit()` 前，按全部 `chunkRevisions` 使相关 owner 失效，避免只刷新提交中被直接编辑的主块、遗漏 halo 依赖。失效并不立即销毁已有可见 GPU mesh；是否保留旧画面由表现策略决定，但旧 preparation 不得用于新任务或冒充当前碰撞数据。

取消和断连只关闭本地会话资源，不暂停或停止共享 Node 世界。重连必须经过新的 welcome 与完整同步屏障；不自动进入同 seed 的本地世界。可靠 action 的未知结果依旧保持未知，不能因重新获取基线而自动重发。

## 用例与准出

在实现前将以下用例落入当前 change 的测试路径，记录预期 RED。只有具有独立评审认可的长期核心价值，才考虑提炼到长期基线。

| 场景                                                      | 必须观察到的结果                                                                        | 证据类型          |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------- | ----------------- |
| 原始真实 capture 经参考投影、乱序分页、重组进入消费层     | 每项 canonical/fluid 与原始 hash/数值一致；实际网格算法两个生成回退计数均为零           | Vitest            |
| 缺任一 overlay/fluid、错误版本或旧 owner                  | 在实际网格算法及缓存安装前拒绝，零生成调用、零部分安装                                  | Vitest            |
| 两个 mesh owner 与 collision owner 共享 key               | 单个取消不影响其他 owner；最后释放才移除共享状态；晚到旧页/任务不能复活                 | Vitest            |
| 收包后入参被修改，或 hash/LE 转换期间取消                 | 消费结果不受入参影响；取消之后不可安装，清理完成前保持相应预算                          | Vitest            |
| main/overlay 提交、连续 delta、链断、重排溢出             | 现有 collision 应用路径正确推进或失效；所有相关 mesh preparation 失效；预测不读取落后块 | Vitest            |
| worker transfer、cache 预算不足、worker 未结算时取消/关闭 | postMessage 转移后缓存未 detach；准入前拒绝大分配；独立副本按实际所有权结算，无提前减账 | Vitest            |
| 实际浏览器远端候选连接与 mesh worker                      | 完整基线后可见地形；无 canonical/fluid/logic 上行；旧代次回包无效                       | Playwright-change |
| 连接/同步/断连与数据不可用状态                            | 用户能辨识等待与失败，不能误称保存或同步完成                                            | Midscene          |
| 边界与生产包                                              | 客户端不导入 Node builtin；受影响检查和生产 build 通过                                  | Static、Build     |

这些用例必须调用真实客户端和 worker 消费入口；不得在测试 support 中自建 reducer 来替代生产行为。Vitest 不替代浏览器旅程，Playwright 也不替代视觉语义。网络候选试玩属于 N4 选型输入，正式默认 wire/GUI 采用仍要等 N2–N4 的证据门；不能先要求正式采用才能做候选验证，造成循环依赖。

## 与性能实验的连接

客户端取消程序化生成会增加服务器 canonical/流体/逻辑工作与网络字节。N1 仅 runtime 迁移、职责上移、编码/传输、各 Node feature 应分开记录对照；不能把 mesh 仍在浏览器当成权威计算尚未上移，也不能把浏览器负载下降当成整体收益。

实际接线后收集客户端生成计数、mesh 排队/运行/丢弃、基线准备和解码/重组/复制时间、首块可用与输入修正延迟、服务端 canonical/流体/逻辑吞吐与队列龄、两端 CPU/内存及实际网络字节。当前未采样项保持未采集。退化必须按被冻结的性能门定位、修复并复验；此页不新增宽松阈值或宣称性能收益。

本计划属于既有网络/客户端迁移工作包，未增加预算授权。完成 reference 实现和真实消费测试后再依据实耗重估下一阶段；未知 credits、API 费用和活跃工时不以代码行数替代。

## 独立审查记录

2026-09-07，由负责者之外的 Terra/high 子任务只读核查实际调用点，发现并纳入完整 halo 身份缺口、transfer 副本所有权、World 能力拆分和反向依赖失效。其初步“缺块预测直接当 Air”的判断经负责者沿 PlayerController → VoxelCollisionWorld 核查修正：现有 revision-null 门禁产生未知阻挡；剩余任务是保持该门禁并明确远端同步时的预测行为。该审查只约束本草案，不构成已实现或已通过浏览器验收的证据。
