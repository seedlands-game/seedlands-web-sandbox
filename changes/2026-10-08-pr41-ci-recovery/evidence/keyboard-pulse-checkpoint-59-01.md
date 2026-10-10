# Group59：原生按键脉冲边界与完整浏览器失败

本片修复实际输入驱动的等待边界，模型、静态与构建通过；原完整 Browser59 仍失败。PR 保持 Draft，不能合入，不合并或部署生产。

## 改动与有效反例

实际安装的 Playwright 1.62.1 dispatcher 在 method end 后等待 tracing after snapshot，再返回公共 keyboard.down 响应。原 walkTo 在该响应之后才开始脉冲计时，因此快照等待发生于真实按住期间。现在复用原生 keyboard.press(key, {delay:pulseMs})；跳跃使用 KeyW/KeyS+Space 原生组合键。原生操作完成释放后才进入 after-call 观察等待，失败时尝试释放全部相关键并保留原错误。没有包源码补丁、页面事件派发、禁用 trace/截图或新输入协议。

原 pulseMs 选择、routePulseDurationMs、0ms 夹具、45/20/900 秒、0.06/0.08/0.45、fresh full snapshot、ACK/ground/noncollision/settle 与方向交接不变。五个 fake Page 输入端口同步模拟原生 press；新故障例检查组合键中断且两个清理响应也失败时，仍释放两键并重抛原错误。它们不替代真实浏览器输入。

- 精确 Luna/medium 的 Task115 以实际 walkEquipmentRoute、真实 stdlib stepBody、明确平地、60Hz 与固定 snapshot 250ms 模型取得 RED。公共 down/up 在事件立即生效后追加 1000ms 响应等待；旧 helper 的首组持键为 [1080,1300,1080,1300]ms，实际路线超时。新 native press 端口在释放后才等待响应；最终 near 与原 long 两例，共 3/3 PASS。near 保持最终双 owner 各自小于原 0.06、ground/noncollision、velocity0 和 fresh tick/ACK。
- 首版额外要求每个接近脉冲都已在 0.45 邻域，属于夹具错误；保留 GREEN-01 失败，仅改为首脉冲未跨过目标，保留最终全部原验收。模型不证明 Authority、实际物理持键时间或 FPS。
- Root 8 文件 70/70 PASS；兼容修改后的 5 文件 45/45 PASS。第一次完整静态因五个测试端口用了当前 TS 目标不支持的 toReversed 失败；改为局部 keys.reverse，没有提高编译目标或弱化门禁。第二次完整 verify:static:ci 实际 EXIT0，frozen evidence 5/5、格式/paths/lint、全部类型、Svelte0/0、规则66与工程合同15通过。

原始日志：`/workspace/pr41-recovery-20261008-root-01/keyboard-pulse-{regression-59-01,regression-59-02,static-59-01,static-59-02}.log`。模型报告与 RED/GREEN：`/workspace/pr41-recovery-20261008-fixtures-01/task115-*`。所有失败保留，未重复环境 setup 或已闭合 Browser58。

## Browser59 身份与终态

新 identified build 实际 EXIT0。source SHA `27cebc0bbdf92f31679d772999d7aa1ad8b4fece` 加本片未提交工作区；sourceDigest `74739c8e61bded230374d1838be32e1ec63b5c259c7de4709473cd32021971a3`，artifactDigest `41d4f632d6033029c4a72d3cf461127eebe35b11a920418180f5a147c72b07c1`，builtAt `2026-10-09T17:48:47.444Z`。生产字节与 Browser58 相同；工作区验证不能当最终提交 SHA 的 CI。

原唯一 `SEEDLANDS_HARNESS_RUN_ID=pr41-classic-browser59-01 pnpm harness:classic`：日志明确 runner 失败与 pnpm exit1，canonical receipt FAIL/runnerOutcome failed。主旅程10.6分钟 FAIL、Visual2.6分钟 PASS、Modular SKIP，总13.4分钟；正式 failure receipt 的 C0–C3 PASS。错误为 `Real input route timed out before 65.5,-0.5`，仍在 Creative 作物共享路线，未进入 V1/V2/C4/C5/恢复/194 准出。步骤耗时行不作为嵌套步骤 PASS。

本片17:33开始，原18:21附近有界 checkpoint 期间执行连接中断。18:21单次只读操作成功，HEAD/全部修改/证据完整且无活跃测试进程；原日志于18:02:26正常收尾。原 exec/PTY 回传句柄丢失，所以没有把未收到的最终工具状态伪作已收到；日志、canonical 回执与原流程互相印证失败，未见测试被连接中断取消的证据。没有重启环境或重跑验证。运行期间源码冻结，没有并发测试、构建、profiling 或大型 trace 解析。

产物身份为独立 `browser59-build-identity-01.json`，日志为 `production-build-59-01.log` 与 `classic-browser-59-01.log`。本次原始 `test-results`、`playwright-report` 与 ignored `harness/results/pr41-classic-browser59-01/classic.json` 保留。此前 Browser58 的 dist、test-results/report 移动保留至 Root 独立 `browser59-retained-inputs-01/`，没有复制或改写 sealed evidence。

## 运行结束后的只读诊断与剩余风险

完整运行结束后流式扫描原 zip 的 metadata 子文件，仅保留末40个完整 snapshot 指定字段与末40个输入动作到独立 `browser59-route-samples-01.json`，没有解析整个资源集合。晚期 native press 均为原80ms参数，API操作约0.5–0.68秒；操作总时长不能当实际物理持键时长。

失败前两个 owner 一致、ground/noncollision、velocity0，最终 player `[65.7046127,32.6000023,-0.4836019]`，目标 `[65.5,-0.5]`，圆距离约0.205格；不是原0.06到达。前次一次跨过约6.4格的轨迹未在本次末尾重现，仍不能宣称所有脉冲无超调或已解决路线。路径一直斜向接近目标，远段300ms的固定目标z走廊条件未成立；需要下一有界片以实际证据诊断，不能放宽到达、延时限或伪造 owner。

[精确27 CI run37967074699](https://github.com/seedlands-game/seedlands-web-sandbox/actions/runs/37967074699)：五项 SUCCESS，Chromium FAILURE，部署 SKIP。首轮等待 start-card 隐藏超过原10秒，重试在 V2 内耗尽原900秒，Visual PASS；不能将 V2 耗时行当完整通过。18:23读取原 job113944523294 日志确认终态，不抢推取消。

完整 Classic/真实 Modular 玩法、正式运输产品与旧非空存档迁移、组合 whole-frame A/A 与有效 A/B、最终精确 SHA CI/review 均仍未准出。17:38实际 UI 周剩84%，账户自初始98%下降14点不能单独归因 PR；约60%停止线不变。连接等待墙钟与 tokens 不折算为周额度。
