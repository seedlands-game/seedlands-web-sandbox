# 独立输入事件路线观测候选 checkpoint29

父提交 `5948da8a8543fc14fcc76746289d21310960d1df` 已撤回未取得资格的28候选；候选29只复用同一只读路线投影，用新注册的短生命周期DOM事件观察区分真实输入与推进中的tick/ack。本记录为待测状态，不能宣称采用、性能收益、当前SHA玩法或可合入。

## 新证据与合同

28的Browser21测量区间无Playwright键鼠调用，14次同任务字段精确等价，仅最后一次ack由743到755。原始FAIL/window NOT_RECORDED及撤回记录保留于 `route-snapshot-rejected-28-01/`。29不更改该结果。

新工程观察器拒绝既有实例，记录window键/鼠/焦点事件和document pointerlockchange，不阻止或消费事件、不写玩法owner；成功/失败都清理全部listener与自身probe。每个同步任务仍比较完整/路线字段的精确等价，包括tick/ack。采样之间冻结实际事件数、双端姿态、world/runtime/generator和quality/backend/请求实验/worker配置；tick/ack只允许非递减，不允许倒退或epoch替换。样本保存这些原始字段与固定身份。

完整canonical入口、原真实输入、pulse、到达/settle、期限、A/A 8对及15%噪声线、ABBA/BAAB 8对及20%收益线均不变。部分样本、whole FAIL或未预留窗口不得通过资格；新窗口尚未运行。

## 验证范围和实际状态

独立日志在 `/workspace/pr41-recovery-20261008-root-01/` 与 `/workspace/pr41-recovery-20261008-fixtures-01/`。

- Task51有效RED `route-snapshot-51-red-01.log`：8 PASS/2 FAIL。旧helper拒绝无DOM输入时的单调tick/ack，且漏拒姿态未变的真实EventTarget keydown。
- 最初候选GREEN暴露Node22 EventTarget布尔capture删除参数的差异：probe属性删掉后listener仍增计数。确定性平台探针对比true与`{capture:true}`，后者正确清理；实现改用DOM等价对象参数，未弱化断言。失败输出保留。
- Task51 `route-snapshot-51-green-03.log`：33/33 PASS，含10类事件、同任务不等、clock倒退、pose/world/profile、成功/失败清理、foreign probe保护、非法计时。计时为fixture，不作真实性能证据。
- 根 `route-observation-regression-29-01.log`：4 files/58 tests PASS，覆盖投影、导航、原handoff及新测量合同。
- `route-observation-static-29-01.log` FAIL于新增test格式，格式修正后29-02通过5/5冻结原字节、格式、目录、全lint、生产类型和Svelte 0/0；但最终Classic测试类型FAIL于fixture把JSON字符串标成对象。该完整命令仍记录FAIL，未称其整体PASS。
- 唯一fixture类型改为实际string后，`route-snapshot-51-new-focused.log` 33/33 PASS，`route-snapshot-51-new-typecheck.log` 的 `pnpm typecheck:classic` PASS。`route-observation-static-continuation-29-01.log` exit0，重验该test的格式/lint，并完成此前阻塞的ESLint插件66 tests和CI selection14 tests。全部必要静态分项已完成。
- Route生产投影、移动循环、其他app生产代码与28候选825相同，原72 files/513 tests PASS作为未改动行为的回归证据；本轮只扩大工程测量fixture，未重复全量业务测试。上项58及最后33覆盖新变化；不能把旧513改写成当前全量538已运行。
- stdlib未重跑，仍复用cd5组152 files/1102 tests及其远端确定性PASS；新组没有stdlib生产变更。

## 身份、预算和剩余工作

2026-10-09 01:24 UTC远端仍cd5、main仍fba4486e433c145db658f6b1598b70c47f759c8a。候选未推送，须独立新SHA构建与完整当前artifact/window资格后再判是否采用。benchmark会按原合同跳过视觉诊断；实际visual验收和modular Pack烟测仍需分别运行，不冒称benchmark涵盖这些PASS。

长期代码地图恢复同一实际移动循环承接路径；新增事件probe只属于工程测量，不改变产品/owner长期架构。最新真实预算由主对话01:09 UTC提供：周剩余91%，约60%停止线；本环境不能读产品UI，未作额度换算。无合并、自动合并、main push、生产部署或新权限。完整V2/V3/V4/194及组合frame A/B仍未完成。
