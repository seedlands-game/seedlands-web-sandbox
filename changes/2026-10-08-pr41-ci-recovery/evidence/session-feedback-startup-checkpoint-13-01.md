# Browser13 session反馈与启动 checkpoint

2026-10-08，基线 `765eef9f295ffa17c729a887be9defbb96f87fe6`。本组候选尚未做新build/browser，不宣称启动或连击已通过产品验收。

## 当前产物终态

build12 PASS：sourceDigest `77dbff8f4b8e5c267e246e1f8f8a3f7451faaeb5045d2af008e08ffcbd429a21`，artifactDigest `33393cc637c14ab97f450a64af1cf4bef58a94294bb7d5a88e7689e306ee8f19`。唯一完整 Browser13（runId `pr41-cloud-browser-13-01`）为1 FAIL / 1 PASS / 1 SKIP，receipt的真实selection为CANONICAL_MAIN且终态FAIL。主旅程C0在start.ts原10秒启动卡隐藏断言超时，未到C3；visual PASS用时2.7m，modular因Classic产物SKIP。旧Browser12 C3失败仍未关闭。

实际startup marks：save-flush55.1ms、scene57.7ms、materials608.3ms、media17.9ms、worker6434.3ms、first-visible2896.6ms；mark开始约2702.2ms、最后约12996.4ms，整个启动约10.29s。之后诊断DOM卡已hidden不改变原10秒失败。耗时只是本次诊断，不是性能样本或收益结论。

## 两个最小候选

session组合入口原先漏转发Game提供的onPointerAttackResult。使用实际startBrowserWorkerSession、实际Authority/Logic客户端及受控worker派送的有效RED中，当前epoch的accepted receipt未触发callback（0次）；修复仅在Options声明可选callback并转发到实际客户端，原去重/epoch/gameplay revision门禁保持。首轮RED因fixture snapshot epoch不匹配提前失败，独立保留，不计作行为RED。

启动候选只在loading卡覆盖画布、还没有可玩World时关闭PlayCanvas autoRender，保留app.start的update循环和Worker生成。Controller/frameLoop安装后、等待first-visible之前恢复autoRender。假设为空场景重复全分辨率渲染与初始化争用；是否改善必须新browser判断。质量、shader、physics、就绪条件和10秒断言均未改。

## 验证与恢复

根独立输出 `/workspace/pr41-recovery-20261008-root-01/`：有效RED `worker-session-feedback-red-02.log`；GREEN `worker-session-feedback-green-01.log`。后续4文件23/23 PASS（session反馈、原scene renderer合同、真实客户端pointer回执及18个实际安装输入用例），`session-start-focused-01.log`。生产types、Classic测试types、scoped ESLint PASS；新测试已加入正式headless和Classic types选择。

18:16–18:17控制面断连通知后，18:18UTC最小读回成功：HEAD仍765eef9f、七个预期未提交路径保留、Node22.23.3/pnpm11.25.0、现有检查终态仍上述PASS。没有重跑setup/测试或重复提交。无法在本环境直接读取产品周额度；最新主对话真实读数17:52UTC剩余93%，未收到停止。

本组新SHA的build、完整browser、CI和preview仍待验证；V2/V3/V4、modular和194项完整验收未关闭，PR仍不可宣布可合入。
