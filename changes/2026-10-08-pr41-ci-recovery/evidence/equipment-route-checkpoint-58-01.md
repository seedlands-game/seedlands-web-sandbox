# Group58：有界远段输入规划与原完整浏览器失败

本片没有产品准出：模型、静态和构建通过，原完整Browser58失败。后续继续修复真实输入，PR保持Draft，不合并、不生产部署。

## 改动和模型证据

`walkTo`允许从当前完整snapshot选择输入脉冲上限，保留原数字参数（含既有0ms夹具）。共享`walkEquipmentRoute`只有ground/noncollision、Authority停稳且位置追上、两者严格在原0.08走廊、沿程超过3格及原小于1px航向误差时用既有普通300ms脉冲；其余仍80ms。原45/20/900秒、0.06到达半径、0.45资源邻域、fresh ACK、输入释放和overshoot/方向交接不变。没有世界/视角状态写入或补给捷径。

- 精确Luna/medium独占新长路线夹具，旧helper RED-03：长20m段因真实调用链45秒超时FAIL，near control PASS。模型使用真实stdlib stepBody/BodyConfig、clear PhysicsWorld floor与固定每次读回250ms虚拟延迟；fake Page只是协议/输入端口，不证明真实Authority、PointerLock或性能。
- 候选最终长/近两例PASS。较早夹具误用了比合同严格的0.005精度，保留RED-02/GREEN-01日志后统一为原0.06圆距离。Root清理unused声明、纠正streamCenter维度、异步结果类型及完整snapshot元数据；这些类型/Lint失败全部保留。
- Root原八文件55例PASS；候选边界15例及长/近两例PASS。首次边界夹具用270.13度落在浮点1px边界，改为270.26度明确超出原门槛，未改生产阈值。两个新文件纳入原Classic headless selector。
- 完整`verify:static:ci`第三次实际EXIT0：frozen evidence 5/5、格式/路径/Lint、生产/工具/测试类型、Svelte 0 errors/0 warnings、规则66/66、工程合同15/15。之前unused/类型失败没有标成通过。

独立原始日志位于`/workspace/pr41-recovery-20261008-root-01/equipment-route-{regression-58-01,regression-58-02,integration-58-01,types-58-01,types-58-02,static-58-01,static-58-02,static-58-03}.log`；模型原始RED/GREEN与局限位于`/workspace/pr41-recovery-20261008-fixtures-01/task114-*`。

## Browser58 的身份与实际结果

新identified build实际EXIT0。source SHA为`cea9a9481a7c040cc0c9e0bb1dfaa49fea44b74c`加本片未提交工作区；sourceDigest `9d946dec1dafe3cdfef8f1b8a33d505060bbde45dee8620f4443a592f5a79b2b`，artifactDigest `41d4f632d6033029c4a72d3cf461127eebe35b11a920418180f5a147c72b07c1`，builtAt `2026-10-09T16:25:35.877Z`。生产bytes与Browser55/56相同；不能把工作区证据当作最终提交SHA的CI。

原唯一`SEEDLANDS_HARNESS_RUN_ID=pr41-classic-browser58-01 pnpm harness:classic`实际EXIT1：主旅程10.9分钟FAIL、Visual约4分钟PASS、Modular SKIP，总15.1分钟。正式failure receipt确认C0–C3 PASS。错误为`Real input route timed out before 65.5,-0.5`，调用链`walkTo → followEquipmentRoute → completeCropJourneyBeforeSave → completeBeforeSave`；没有进入V1/V2/C4/C5/恢复/全194准出。

结果保存在原`test-results`、`playwright-report`和ignored `harness/results/pr41-classic-browser58-01/classic.json`；日志为独立`production-build-58-01.log`、`classic-browser-58-01.log`。上一产物已移动保留至`browser58-retained-inputs-01/dist-before-58`；没有删除/改写sealed evidence。完整运行期间无源码编辑、构建、测试或大型trace解析并发；这次是功能证据，不是whole-frame A/A或A/B。

## 后续输入诊断，不是新PASS

主/visual结束后，流式读取同一次zip，只保存23个晚期完整snapshot的指定字段及13个输入事件到独立`browser58-route-samples-01.json`，没有构造全trace对象。失败段从x81.457/z0.500到x59.975/z-0.851；各读回均ground/noncollision、Authority停稳且位置追上。所有脉冲前读回均不满足新的远段窄走廊条件，因此这段继续原80ms。

最后一次输入前x66.412/z-0.442，距目标x不足1格；后台trace记录KeyS down end630021.868ms、up start630837.716ms/up end631473.174ms，随后停稳在x59.975。该记录证明实际按住间隔显著超过计划80ms，不能将其计为300ms候选或声明到达成功。暂停发生在失败后diagnostic hook主动`document.exitPointerLock()`，不是已证明的路线阻挡原因。

已读实际安装Playwright1.62.1 primary implementation：dispatcher在method end后await onAfterCall，tracing等待after snapshot，再返回keyboard.down响应；当前helper之后才启动pulse timer。下一有界片先对延迟响应取得有效RED，再复用原生keyboard.press的同一次down/delay/up操作，保留trace/断言/时限；不修改包源码、不自建输入协议、不声称FPS收益。

## 精确前驱 CI 与剩余边界

[CI57 run37956614529](https://github.com/seedlands-game/seedlands-web-sandbox/actions/runs/37956614529)精确cea9a948：五项SUCCESS，Chromium job113909037832 FAILURE，两次主旅程分别12.7/12.2分钟在V2返回[78.5,-0.5]超过原45秒，Visual PASS，部署SKIP。45分钟job预算保留了完整终态，不将取消或失败当成功。

长期docs baseline未更新：本片未改变生产owner/玩法/架构，只调整真实输入规划并增加定向夹具。原门mesh不稳定、完整V1/V2/C4/C5/死亡/恢复/194、正式运输产品与Modular正常玩法、组合whole-frame性能及最终精确SHA CI/review仍未准出。16:05实际周剩84%不是17:25新读数；服务端503中断后单次恢复，继续原授权与约60%停止线。
