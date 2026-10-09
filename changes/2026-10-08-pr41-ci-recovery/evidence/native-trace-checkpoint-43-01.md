# checkpoint43：有界原生 trace 诊断接线

Browser32 的精确源码为 `1b6ba70d3ce811398c4a86c33e63a5fc94d1015e`，build31 的 sourceDigest 为 `d199e75c1213c959152476820b848a40ea0d5120aa8a3beb70ee65ec8dc5ef5d`，artifactDigest 为 `2aa9767028ae9394a65e02c5a6eeeda38a68cff784f3049862fb772e11efd8ca`。原唯一完整3测试终态为 main FAIL、visual PASS、Modular条件SKIP，17.2分钟。C0–C3、Creative 作物与地图输入、V1完成；V2在 `followEquipmentRoute → mineResources → prepareCraftedIronArmor` 的 `keyboard.up` 触及原900秒。V2步骤耗时不是通过，C5没有运行。

真实地图截图 `browser-32-navigation-map-43-01.png` 已从闭合trace精确提取并查看：地图map-1、1/81像素、revision2、中心67,-1；导航后原作物保持断言通过。原完整 results、原 failure JSON、截图与只读 CPU 观察均保留在 `/workspace/pr41-recovery-20261008-root-01` 的独立 browser-32 路径，不把局部输入证据代替保存恢复或全产品验收。

末尾同128帧CPU样本中位 tick22.5ms、相邻帧gap402.35ms、同步receive29.55ms；另一1200帧窗口 p50 为442.4ms，窗口不同不能相减。独立10.010824402秒原生CPU观察中，GPU process五工作线程合计26.58CPU秒，renderer主线程2.45秒，单DedicatedWorker5.23秒。未识别该Worker URL/owner，未取得GPU执行时间或因果证据，未更改线程、CPU affinity或额度。

新 `classic-support/native-trace.ts` 只拥有可选的browser CDP诊断，不改变生产代码。默认关闭，仅main开启，拒绝benchmark与CPU sampler同时启用；先发现并记录实际可用categories，核心toplevel/gpu/cc/viz/devtools.timeline缺失拒绝。固定延迟360秒、20秒采集、16MiB原生buffer、JSON stream64MiB上限、64KiB读块、10秒completion和drain限时。记录实际UTC/elapsed/source/run/dataLoss，提前退出取消timer；stream、listener、session各自清理，协议失败和清理失败均保留。失败的start也尝试end，避免未知开启状态留下采集。原始trace与元数据均仅 `diagnosticOnly=true / eligible=false`；发现dataLoss保留raw但诊断失败。

Task86 缺模块的实际RED保留；fake CDP生命周期和相邻CPU profiler共2文件13/13 GREEN，scoped lint、Classic types通过。该模拟检查不证明 Chromium支持本次categories，也不证明实际native trace有效。根必要复核：sealed5/5、paths、CI选择器与新增类型/错误保留；原全套生产结果沿用checkpoint41及远端当前SHA有效检查，不将旧552例结果描述为本组重跑。

根随后复核start未知状态与错误消息保留，Task87新增失败start后end/未读stream关闭、read与close双错元数据及64MiB cap边界：最终两文件16/16 PASS、scoped lint PASS。根 `native-trace-{sealed,paths,selector}-43-01.log` 为sealed5/5、paths和CI选择器14/14 PASS；`native-trace-types-43-02.log` 为Classic types PASS（最终fixture增加之后另做完成检查）。第一次scoped lint缺AggregateError.cause失败已修正，原问题没有以吞错解决。

最终8路径Prettier、3文件scoped lint、完整Classic types及diff-check均PASS，见根 `native-trace-static-final-43-01.log`。主spec仍原500行，无期限、选择器减项、品质或断言变更；新fixture追加至原headless与Classic types入口。不是整PR正式review结论。

当前远端精确 `1b6ba70d` 的CI run37899321803：Architecture、Static、Deterministic modules、Classic headless、Production build SUCCESS；Chromium CANCELLED、Cloudflare部署SKIP。日志显示第一次main约7分钟失败、retry约15.2分钟失败，之后job取消；workflow为25分钟上限。没有可用完整PASS，不推断尚未输出的首个断言原因，不通过提高期限修复。

本组只做有界诊断接线与风险复核；新精确源码build32/browser33仍待执行。没有选择性能优化，也没有整帧A/A/A/B、C5、全194或真实Modular玩法通过证据，当前不可合入。长期代码地图仅更新实际诊断owner。最新真实UI读数07:39 UTC剩88%，含其他任务用量；08:07已请求更新，未用token/API估算换算，约60%停止线保持。
