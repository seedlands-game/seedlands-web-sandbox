# Authority 完整基线与兴趣控制实施记录

2026-09-07，本切片已形成通过本地检查的内部能力检查点，整个 change 仍 Active。冻结 spec SHA-256 保持 `0181d7a49487a9a88de98e572e0ea2ec82b8f2cc6b43921f97dc32c214475274`；本页记录 [采集计划](network-baseline-capture-plan.md) 和 [兴趣控制计划](network-interest-control-plan.md) 的实际执行，不修改已批准的协议采用门禁。

## 当前实现

- Interest 控制参考 DTO 覆盖 request、accepted、cancel、cancelled 和 collision-baseline-request。ref 必须与可信上下文匹配；`interestId: null` 只是请求声明，没有读取或生成授权副作用。长度和合计预算先于数组遍历，未知 Symbol/数组扩展被拒绝；消费者必须使用 projector 返回的副本，validator 只返回 boolean。
- 内部 Authority capture 一次取得 mesh 主块及完整 26 邻接块，或单块 collision-resync；主块下界、checkpoint 和每块 revision/generator 随 owned buffer 返回。Node 主上下文不逐项拉取和拼接邻域。
- Node facade 新增 capture/cancel，业务取消独立于控制端口 AbortSignal。capture 回复除通用 RPC 身份外，还绑定请求 captureId、purpose、key、minimumRevision、当前 lane epoch 和 generatorVersion。
- worker 使用 54/2 个 ArrayBuffer transfer；facade 不再额外复制整组 buffer。mesh、collision、cancel 分别预留至多 4 MiB、128 KiB、1 KiB，并受自定义控制 RPC 上限进一步收紧。

## 已取得的 RED 与定向证据

Interest 最初以缺模块 RED 开始。审阅再发现预算检查晚于遍历、Symbol 被对象展开透传；以巨大稀疏数组访问哨兵和 Symbol 扩展取得真实 RED，修复后 Node 22 定向 16/16 通过。四个 ref 字段错配、五个变体版本/种类、非法拒绝原因、取消跨字段和整数边界已有回归。早期 typecheck 通过；随后并行 capture 测试先于源码落盘导致临时类型 RED，不计为最终集成失败或通过。

Node baseline protocol 先因三个未知 RPC kind 取得 RED；实现后 protocol 与已有 Authority protocol 共 9/9 通过。新增严格门覆盖 27 项顺序/角色、重复 buffer、生成器不一致、缺项、数组扩展、checkpoint 和超界邻域坐标。真实 Authority lane 测试先因缺少 `captureBaseline()` 得到 6 项 RED，再接入 worker/facade；接线后 Node 22 实际 Worker 测试 8/8 通过，包括请求参数副本、主块最低版本、整个 bundle 的 generatorVersion 和错误取消回复绑定。

`authority-baseline-rpc-budget.test.ts` 先因缺 helper 模块 RED，随后在官方 Node 22.23.2 下 5/5 通过。使用真实 `worker_threads.MessageChannel`、生产 validators/计量/transfer helper 和手工 ACK，验证 server 侧 buffer detach、client 独立可写，以及有效 ACK 前后保留量归零。

| 当前确定 fixture | 原始块字节  | 实际 DTO 计量 | 初始响应预留 |
| ---------------- | ----------- | ------------- | ------------ |
| Mesh 27 块       | 2,654,208 B | 2,657,979 B   | 4 MiB        |
| Collision 1 块   | 98,304 B    | 98,721 B      | 128 KiB      |
| Cancel           | 0 B         | 81 B          | 1 KiB        |

以上是该确定 fixture 的实际内容计量，字符串变化会改变 DTO 总量；不是公网帧大小、吞吐或延迟证据。超大 epoch 的 collision 回复超过固定预留时拒绝，既不截断身份，也不提高预算。ACK 证明内部 RPC 的结构校验和接收；它不证明浏览器已安装基线，也不是网络 interest/page ACK。

平台无关实现先以缺少 `authority-baseline-capture` 模块和 `host.captureBaseline()` 取得 RED。Node 22.23.2 最终定向运行五个 server 文件为 5 files / 36 tests GREEN：

- `authority-baseline-capture.test.ts` 覆盖 27/1 确定集合、同步 checkpoint、minimum revision、owned buffer、错误坐标与 MAX_SAFE 邻域溢出。
- `dedicated-host-baseline-capture.test.ts` 覆盖真实 27 块生成、已加载目标先 pin 再 maintenance、hard/pending 零 dispatch、严格 captureId high-water 与完成窗口淘汰、两个重叠 capture 加普通 `requestChunk()` 共享生成，以及调用方 request 修改隔离。
- 同一 Host 文件还覆盖预先取消零生成、中途取消等待物理结算、完成后 `already-settled`、stop 并发取消、持久化准备失败与生成失败的诊断和零资源泄漏。受控 port 的同步启动失败会先等待此前已接纳 Promise `allSettled`，再释放 retention 并结算错误。
- 回归同时运行 `dedicated-host.test.ts`、`game-server.test.ts` 和 `authority-collision-baseline.test.ts`。

相同 Node 22 下，生产 `tsc --noEmit` 与 `tsc -p tsconfig.test.json --noEmit` 均无错误；受影响文件 ESLint 与 Prettier 通过。`DedicatedServerHost` 为 488 个非空、非纯注释有效行；GameServer 新增观察/retention 职责已抽至 `canonical-chunk-observation.ts`，未使用 max-lines 豁免。

owned copy 是单事件轮次同步操作，不存在可插入的“复制中取消”观察点；现有证据只证明完成后 cancel 为 `already-settled`，不宣称抢占已完成的 copy。真实 Node control port 在 capture 执行中关闭后的故障顺序仍是下方明确记录的未覆盖项。

## 分工与独立审阅

Sol/high 实现平台无关 Host/采集与 admission，Terra/high 实现兴趣参考和真实 lane 测试，另一 Terra/high 完成跨浏览器 WS 探针、实际 MessageChannel 预算测试与 Node 接线独立审阅。Astra 负责边界取舍、Node 接线、整合与最终验收。分工是本次实际路由，不作为模型成本优劣实验。

原 Node 接线独立审阅未发现新增 P1：结构门、回复身份、owned transfer、固定预留和非即时取消边界一致。真实 Authority Worker 侧 buffer detach 没有新增专用诊断入口；直接观察 detach 的证据来自使用同一生产 helper 的 MessageChannel 测试，应与真实 worker 行为测试区分。

## 预算调度与请求顺序修正

整合发现通用 RPC 会为利用剩余预算越过排队的大请求：在一个尚未 ACK 的回复预留 3,800,000 B 时，mesh captureId 0 无法开始，后到的 collision captureId 1 却能先进入 Host，破坏其严格递增门禁。真实 MessageChannel 测试取得 `acceptedCaptureIds` 为 `[1]` 的 RED。

通用 RPC 新增可选 `dispatchOrderKey`，两种 capture kind 进入同一组；同组后项不能越过仍在队列中的前项，已派发请求仍能并发完成。cancel 不属于此组，其他 lane 默认调度不变。测试引用 worker 使用的同一生产分组 helper，证明 ACK 释放预算后依次开始 mesh 0 和 collision 1。相关四文件 18 项在 Node 22 通过；独立 Terra 审阅未发现新增阻断。

## 仍未完成的网络层

共享控制 RPC 满载时，cancel 仍可能排队；本切片不承诺即时取消、抢占或控制优先级。尚未进入 Host 的 capture 与取消先后关系也不能冒充公开 interest tombstone 状态机。后续会话层须独立阻止迟到结果安装，并管理授权、owner/refcount、分页、超时和背压。

针对“真实 Authority Worker 正在采集时控制端口故障”的专门故障注入本批尚未采集；已有普通 stop、错误回复清理与 MessageChannel 机制证据不能替代该组合场景。

没有公开网络 listener、客户端 Remote adapter、完整浏览器安装门或 GUI。27 块内部 owned capture 仍需按公开 transfer/page 合同拆分；大 WorldCommit 的分帧或 resync 也未完成。普通 WS loopback 的功能结果见 [独立探针](network-websocket-loopback-progress.md)，不能替代 WSS 可信证书、目标 IPv6/WAN 或性能 A/B。

## 统一准出

所有实现冻结后，官方 Node 22.23.2 下 `pnpm verify:static` 一次完整通过：189 个测试文件/1030 项通过，另 2 文件/4 项跳过；world 行覆盖 96.37%，Prettier、ESLint、路径规范、Svelte 与两份 TypeScript 检查通过。

`pnpm build` 和 Node 五入口构建通过。产物记录 source `c4e2f16` 与 `sourceDirty=true`，source inputs SHA-256 为 `1c02da36f90682d94be3e63c5aaae71ce07d5e14503ce4f4c73c893a97e811ab`，不把构建时工作树冒称未来提交。浏览器现有 500 kB bundle 提示保留。

`CI=true SEEDLANDS_E2E_PORT=4197 pnpm test:e2e:regression` 使用本工作树独立开发服务，headless Chromium 8/8 通过；包含真实输入、持久化和 streaming 基线，未新增或提升基线用例。该结果不替代远端会话、GUI 或 Midscene。

共享 Host 核心经独立 Terra 审阅，没有发现新的 P1/P2 阻断。全部阶段检查日志分别为 `/tmp/seedlands-baseline-capture-static.log`、`/tmp/seedlands-baseline-capture-build.log`、`/tmp/seedlands-baseline-capture-node-build.log` 和 `/tmp/seedlands-baseline-capture-browser-regression.log`。没有运行正式 benchmark；用户已暂停另一任务，本切片自身的构建/Worker 测试也没有被当作性能采样。

长期 docs baseline 只更新代码地图中的真实采集入口；实现/用例/本页作为 `codex/node-dedicated-server` 功能分支恢复检查点提交并推送，最新 SHA 由 Git 历史定位。公开网络、GUI、WAN/CI、最终 codec/transport 与 A13 仍未准出。
