# Browser56 失败只读诊断与原完整运行

- 源码基线 `3f784078eab25a51bf749f658939d9ce81dd9892`，只有未提交的failure只读readback变更；run `pr41-classic-browser56-01`。production artifactDigest与Browser55完全相同：`41d4f632d6033029c4a72d3cf461127eebe35b11a920418180f5a147c72b07c1`；新sourceDigest `5e0477a6626fba0547883aaddff5c8f5ee4249dea5a7ad9f429a594b81864e40`；builtAt `2026-10-09T15:35:58.488Z`。runner前后身份校验完成，期间生产源码未改。
- 完整 `verify:static:ci` 实际EXIT0；build实际EXIT0；原唯一runner实际EXIT1：主旅程FAIL、visual PASS、Modular SKIP，总14.9分钟。本地原retry0、原900/240/90秒、动作/poll/输入/画质/renderer未改，没有CPU/native profiler。
- 主旅程12.4分钟在V2 `prepareCraftedIronArmor → mineResources → followEquipmentRoute → walkTo → correctMouseToRoute.observe` 的原移动时限失败：`Real input route timed out before 78.5,-0.5.`。未耗尽900秒，不认定为mesh失败或全局总时限。
- 正式阶段附件C0–C3 PASS；V1已返回且进入V2，但此前Browser55同production bytes的门mesh失败仍未关闭。后续完整V2/C4/C5、保存恢复和全194未完成。Modular条件SKIP不能计正式产品PASS。
- 最后player `[82.8453140258789,32.599998474121094,-0.5087938904762268]`，Authority `[82.84531544648735,32.6,-0.5087939138311806]`、velocity全0、ground=true、colliding=false、ack4622，距离目标仍4.345格。末段样本显示真实西向输入与ACK持续推进，不能把超时本身当永久阻塞或性能阈值。
- failure只读presentation附件成功记录相关Chunk的Authority/rendered revision和按时间排序的末256个既有trace事件。只在失败后读取，不增加每帧扫描、派生mesh owner或状态写入；错误捕获不吞原失败。
- 原始日志 `/workspace/pr41-recovery-20261008-root-01/{production-build-56-01.log,presentation-readback-static-56-01.log,classic-browser-56-01.log}`；原始trace目录 `/workspace/pr41-recovery-20261008-root-01/browser56-results-01/test-results/`；runner回执 `harness/results/pr41-classic-browser56-01/classic.json`；流式派生217样本 `/workspace/pr41-recovery-20261008-root-01/browser56-route-samples-01.json`。未改历史sealed证据。
- 主旅程失败之后，初次trace解析一次载入过多数据，占约2.8GB内存；Root主动终止自己的解析进程（EXIT143），没有终止/重跑浏览器。解析负载与本轮visual期间重叠，因此不能拿其耗时或帧数据充当性能测量；visual所有原断言仍实际PASS。后续改用有界流式提取。整轮从未作为独占A/A/A/B或性能准出。
- CI54精确3f的build/architecture/deterministic/Classic headless/Static verification SUCCESS，Chromium诊断重试在25分钟job上限取消、部署SKIP。PR保持Draft、mergeable=true只表示无当前Git冲突，不能当可合入。最后实际周读数14:09为85%，15:45刷新待回复，约60%停止线。
- 长期docs本片未更新职责；后续CI预算合同单独更新CI文档。继续V2真实路线、正式transport/Modular/全194和组合整帧性能工作。
