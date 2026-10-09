# Browser21 路线快照候选撤回

候选源码 `8255157424f8f7f776b8c4224092744e9392385b`，artifact `096d567ba795426cc7cac83673ebdbe4d01917ee1b41317c81a08c2c029b2a1c`，window/run `pr41-cloud-browser-21`。当前失败是测量资格否决，不证明新的只读 API 不正确，也不证明其性能收益。

## 实际终态

Browser21 为 1 FAIL / 2 SKIP，性能窗口 FAIL / NOT_RECORDED。C0 启动 6.7s；主旅程在测量资格处失败，后续 C1–C5 未完成。既有 benchmark 模式显式跳过视觉诊断，modular 使用另一 Pack artifact，均不得计为 PASS。未写 measurement declaration，未修改 baseline、timeout、到达或真实输入断言。

采到14次同任务 owner 等价观测：4 warmup、10 A/A；未满足8对A/A，未采平衡A/B。测量第14次 ack 从743前进至755；位置、视角、零速度、ground/collision、world revision、runtime 和 generator 均相同。`0-trace` 的 `63199.121–64237.141ms` 区间没有 Playwright Keyboard/Mouse 调用。Controller 预测循环会发送其生成的输入命令；把持续前进的输入确认序号冻结为物理输入身份，在真实流水线中不成立。该源码核对是诊断推断，不追认本次失败窗口为有效A/A或收益。

## 撤回与证据

候选生产 API、路线切换、测量接线、对应测试与 selector、临时代码地图改动全部恢复到父提交 `cd5ff7caadfb335bef54764d7140b09dac3d1132`，Git 的限定路径比较已确认完全相同。原候选 checkpoint 保留为历史开发状态，本记录为终态。候选曾通过72 files/513 tests及完整静态检查，但均不替代资格和产品验收。候选未推送。

`measurement.json` 是真实 TestInfo attachment 的格式规范化副本，`owner-veto.json` 是流式读取原始trace的窄字段诊断；原始未改写文件、trace与HTML在 `/workspace/pr41-recovery-20261008-root-01/browser-21-*`。原始attachment SHA256 为 `88e2907101df17ec00564fdb2cad026b472ef7a83cc412d9deea7651bf72b5e2`，原始owner诊断 SHA256 为 `8ad209280d7106c092487048bbdda81ea6f09e9dcfea75439af276a3d37ca899`；规范化副本不声称字节等同。逻辑UTF-8 JSON bytes不是实际CDP或网络bytes，部分elapsed不作性能结论。

远端cd5 run37865111807的构建、静态、确定性、Classic headless PASS；Chromium首轮主旅程15.3m失败，V2阶段10.9m，重试后job CANCELLED，deploy SKIPPED。原始job日志另存 `ci-cd5-chromium-28-01.log`。PR仍不满足可合入条件。

后续若新实验，需要先登记物理输入事件观测、tick/ack单调新鲜度与同任务精确投影，而非对本次固定ack门槛作临时放宽。当前没有新实验PASS、实际帧收益或最终玩法PASS。
