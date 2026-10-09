# CI 浏览器 job 资源预算与失败证据 checkpoint57

- 接续精确head `3f784078eab25a51bf749f658939d9ce81dd9892`。CI54 run `37949472227`：build/architecture/deterministic/Classic headless/Static verification五项SUCCESS；Chromium job `113884710636` CANCELLED，部署SKIP。首轮原主旅程15.3分钟FAIL，原一次诊断重试仍运行时于`2026-10-09T15:34:55.9265571Z`取消，不能据步骤耗时行认定V1/V2或整体PASS。
- 确认资源预算矛盾：Classic主旅程900秒与视觉场景240秒在CI各至多两次，共38分钟；Modular90秒与两者互斥。原job25分钟不能覆盖这些原测试及报告。新确定性合同实际RED：`Chromium job 25min cannot cover 38min of existing tests plus 5min reporting margin.`
- 最小修复：Chromium job上限25→45分钟；900/240/90秒、动作/poll、retry1、`failOnFlakyTests=true`、唯一`harness:classic`、build一次/下载校验同artifact全部保持。余量覆盖setup、失败附件、上传与清理，不是性能阈值或产品验收放宽。
- `scripts/ci-browser-time-budget.test.mjs` 读取实际workflow/config/spec，冻结原时限/重试/flaky拒绝/互斥场景，验证job覆盖完整runner加至少5分钟裕量，并确认Chromium不重建artifact。纳入现有`test:ci-selection`；完整15/15 PASS。原RED `/workspace/pr41-recovery-20261008-root-01/ci-browser-budget-red-57-01.log`；GREEN `ci-browser-budget-green-57-01.log`。
- 初版完整静态因新测试正则的`no-regex-spaces`失败；保留`ci-browser-budget-static-57-01.log`，等价改成`{2}`后，最终`ci-browser-budget-static-57-02.log`实际EXIT0：全格式、冻结5/5、paths/lint、所有产品/tool/test类型、Svelte0/0、ESLint规则66及工程选择15/15。
- 同次提交包括Browser55/56的真实失败证据和仅失败后相关Chunk Authority/rendered revision、末256trace只读诊断。两次原完整runner均EXIT1，不因诊断变更或单次V1返回而改绿；visual实际PASS，Modular仍SKIP。
- 长期docs baseline只更新`docs/ci-testing.md`的真实job资源/报告合同，其他架构与产品门槛不变。workflow部署触发、权限与目标未改：只推现有feature；此前授权的PR preview可随原条件运行，main/生产部署/merge/automerge禁止。
- 仍需V2真实长段移动、完整C0–C5/V1–V4/死亡/保存/全194、正式transport与Modular产品、组合整帧A/A/A/B，以及最终精确SHA必需CI/review/conflict判断。无新本地build/browser/性能GREEN声明。
- 14:09实际周剩85%，15:09/15:45刷新请求尚未取得新产品UI读数，约60%停止线；不由token/credits/工时估算周比例。运行型号实际元数据未核实，没有为探测启动额外模型会话。
