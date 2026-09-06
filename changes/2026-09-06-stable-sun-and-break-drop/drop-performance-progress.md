# 破坏掉落性能进展

## 只读链路

生产链为：真实左键输入启动 `breakAction`，Authority 的 20Hz 玩法规则在完成时提交体素删除，并在同一规则调用中生成 `world-item`；体素提交触发受预算约束的 Chunk remesh，Gameplay view 则以最多 20Hz 回到浏览器。浏览器收到 view 时会在 Worker 消息回调中立即执行一次 `BrowserGameplay.refresh()`，每个渲染帧又由 `advance()` 再执行一次。新物件首次出现时，`GameplayEntityPresenter` 同步创建 Entity 和 2–3 个带阴影的 box RenderComponent。

掉落物落地在客户端没有独立的 `grounded` 分支；视觉节点只更新旋转与位置。若长帧精确对齐落地刻，候选应优先检查 Authority 的统一 `stepBody`、吸附/拾取或与 remesh/呈现重合的时序，不能直接归因于“落地动画”。现有 Harness 的 `drawCalls`、`triangles` 和上传队列只统计 Chunk，不包含物件 RenderComponent、阴影 pass 或它们的 GPU 工作；现有 `MeshCommit`、`SceneAttach` span 也没有覆盖 Gameplay view 回调和实体创建。因此首轮证据可以确定逐帧 RED 和 Chunk/Worker 是否同时活跃，但尚不能把未记录部分伪报为 GPU 根因。

## 基准用例

`e2e/break-drop-performance.spec.ts` 使用真实 Pointer Lock 和持续左键，连续破坏视线方向上的两个泥土块。玩家与最终落点保持超过 2.25 格，排除吸附和拾取；两个掉落必须各生成一次、经 Authority 身体实际落在同一地面且保持存在。页面内的逐帧采样只读取 `performance.now()` 和两个既有体素，不调用完整 Harness snapshot；流程结束后再导出 Authority 状态、帧分布和已有性能 trace。

预置 RED 门槛为事件窗口帧 p95 不超过 20ms、单帧不超过 33.34ms。该门槛针对可感知的连续帧丢失，不使用平均 FPS。首轮运行还需保留原始 video、逐帧数组和 trace；若 RED，下一步以同地形的“仅 remesh、不生成物件”和“仅生成物件、不改 Chunk”作为诊断对照，而最终准出仍必须回到真实连续左键全流程。

## 首轮真实结果与根因收敛

`2257aff` 不可变生产构建上的真实 Pointer Lock 用例已通过物件数、落地位置和逐帧耗时门槛：两个泥土块各生成一个掉落物，180 个 Authority physics tick 后两者均在脚底 `y=49` 接地且未被吸附；事件窗口帧 p95 不超过 20ms、最大帧不超过 33.34ms。原始日志为 `/tmp/seedlands-2257aff-break-drop-baseline.log`，视频保存在该次 Playwright `test-results`。这排除了该次复现中真实 rAF 长帧，但尚未满足用户看到的运动流畅性。

源码与运行时频率给出一个可执行主因：Gameplay view 最多以 20Hz 发布，`BrowserGameplay.advance()` 每个 rAF 都把同一个 `view.gameplayTime` 传给 presenter。`GameplayEntityPresenter` 又用该值计算表现 `dt`，所以两个权威 view 之间的渲染帧 `dt=0`，掉落节点只在约每 50ms 收到新 view 时移动。用户看到的是约 20Hz 的位置阶梯，外观等同掉帧，即使实际 rAF 保持 60Hz。

正式确定性 RED 直接读取真实 PlayCanvas 节点，而不把 Authority 数据伪装成表现位置：先给掉落物两个 50ms 间隔的权威位置，再在权威时间不变的下一 60Hz 渲染帧推进；节点必须继续向最新位置移动。当前实现保持完全不动。并列边界锁定落地目标不能外推穿过地面，实体被拾取/移除时同一帧销毁节点。

计划修复将 Authority 位置继续作为唯一真值，把“接收权威样本”和“每帧推进表现”分开。表现时钟只驱动有界插值；新实体和大跨度传送直接对齐，最后一个样本不向地面以下外推，移除不保留节点。需求 Playwright 随后通过只读诊断导出实际节点位置，在真实连续采集的每个 rAF 对比 Authority 身体，要求下落期间多数渲染帧发生单调位移，并保留首轮真实帧耗时与最终落地/未重复拾取断言。

## RED、实现与 GREEN

绑定实现前 spec hash 为 `16d71bcaf814605815076a57cecd20ccfe4ff4527cb249deb782402b70d82213`。确定性用例首次运行得到预期 RED：连续两个渲染帧的真实 PlayCanvas 节点高度都为 `2.801445245742798`，证明权威时间不变时原 presenter 的 `dt` 为零；同轮落地不穿地和移除节点边界已通过。

实现将 presenter 的参数收口为真实 `renderDeltaSeconds`。Authority Gameplay 回调以零步长只提交新目标，rAF 的 `BrowserGameplay.advance()` 才传入渲染步长；旋转、受伤闪烁和位置追随共用有界表现时钟。步长限制在 `0..0.1s`，非有限值和负数按零处理。位置只在当前表现点与最新权威目标之间做 `55ms` 时间常数的指数追随，不外推；仅在误差不超过 `1mm` 时精确贴合，避免无法收敛的浮点尾差。新实体和超过四格的传送仍直接对齐，实体从 Authority view 移除时立即销毁。

确定性用例最初为 `3/3` GREEN，另锁定 `NaN`/负步长不会污染节点且后续合法帧可继续推进。第一次真实修复候选运行中，落地十二帧后仍高出权威目标 `3.376cm`，命中预置 `3cm` RED；曾尝试在 `4cm` 邻域直接贴合，但独立复核指出这会让每 `50ms` 只前进 `2cm` 的慢速实体在 Authority 回调中重新阶跃。新增慢速目标用例后得到预期 RED：节点从 `1.100000` 直接跳到 `1.080000`。最终去除该泛化特例，只保留 `1mm` 的浮点收敛，慢速目标、独立渲染帧、落地/移除和非法步长现为 `4/4` GREEN。落地验收不再使用脱离滤波设计的固定 `200ms/3cm`，而是验证十二帧误差不超过 `initialError * exp(-elapsed / 0.055) + 2mm`，并在有限渲染帧内进入 `1mm`。

首个候选的同源工作树生产构建通过，Vite 转换 `2440` 个模块，主 bundle 为 `index-CXpVLCR_.js`。真实 Chromium headed、单 worker、零重试运行本 change 两项，结果 `2/2` GREEN（`21.9s`），但该轮包含后来被慢速目标 RED 否决的 `4cm` 贴合，只保留为诊断证据，不能作为最终准出：

- 连续破坏两个方块后恰有两个泥土掉落，均经 Authority 物理在脚底 `y=49` 接地；事件窗口 p95 不超过 `20ms`、最大帧不超过 `33.34ms`。
- 单个高处泥土掉落在实际 rAF 中持续读取 presenter 节点和 Authority 身体；下落样本超过 30 帧，多数渲染帧有单调向下位移，未穿过最终地面；玩家移近后物件从 Authority 与表现层同时移除，泥土库存精确增加一份。

该候选原始日志为 `/tmp/seedlands-break-drop-green-2.log`，真实退出码保存在 `/tmp/seedlands-break-drop-green-2.exit` 且为 `0`；两个场景均保留 Playwright video。

## 最终准出

最终 `1mm` 收敛版本重新通过完整类型检查和生产构建，Vite 转换 `2440` 个模块，主 bundle 为 `index-Bh_nS3s5.js`。同一构建的 Chromium headed、单 worker、零重试结果为 `2/2` GREEN（`21.7s`）：原两块场景继续验证逐帧成本、恰好两个掉落与 Authority 落地；可视场景只把地面抬到 `y=53`，使同次视频能清楚观察下落和落地，未改真实 Pointer Lock、吸附距离、物理或表现断言。最终日志 `/tmp/seedlands-break-drop-final-visual-e2e.log`，退出码 `/tmp/seedlands-break-drop-final-visual-e2e.exit` 为 `0`。

最终视频在 `8.76s`、`8.86s`、`8.96s`、`9.06s` 提取四张未经修改的原始帧，组成 `/tmp/seedlands-break-drop-gallery-1mm/drop-presentation.html`。`midscene/drop-motion.yaml` 对早期、中期、近地和落地帧完成视觉检查，结果 `1/1` GREEN（`6.67s`）；摘要 `/tmp/seedlands-drop-motion-midscene.json`，报告 `midscene_run/report/drop-motion-2026-09-06_17-27-44-e726d64d.html`。画面中同一泥土物件连续下降并落到固定地面，没有复制、穿地、悬浮或表现残留。

独立 Sol 最终复核未发现 P1：Authority view 仍是唯一目标，只有 rAF 推进表现时钟，快照回调不移动节点；`1mm` 收敛不会触发 `2cm/50ms` 慢速目标阶跃。当前未改 Authority、物理、世界格式、Chunk remesh 或素材画质；首轮逐帧证据不支持额外缓存、批处理或物理特例，因此没有加入未经证实的优化。
