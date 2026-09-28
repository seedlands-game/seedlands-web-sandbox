# V2 装备采矿瞄准证据

阶段：`V2-EQUIPMENT-MINING-AIM-CLOSE-07`

状态：fixture/deterministic/static GREEN。Browser-18 原始证据保持在 `evidence/v2-canonical-browser-18/`，
本阶段未修改或重跑。

## 已冻结输入

- Browser-18 已记录 `phase=resources-placed`；首格 wood `[80,31,2]` 距失败 player pose 的 voxel center 约
  `3.199m`，通过既有 mining range。
- 失败 step 内有 180 次真实 mouse move、0 次 mouse button；错误只保存最后 12 个 target，交替为
  `[84,31,2]` 与 `[84,30,1]`。不得编造其余 168 次 target 值。
- `adjustPitchToTarget` 对 valid wrong voxel 只发送 `dy=±6`；`aimAtVoxelWithRealMouse` 使用 target-card、
  `aimedVoxelTarget()` 和 `mouseCorrectionToPoint(voxelAimPoint(...))` 完整 yaw/pitch correction。

## RED

首轮 `red` 因测试正则未转义在 collection 前失败，不作为行为 RED；原 stdout/receipt 保留。`red-02` 成功收集
24 项，其中 source contract 与 synthetic content-neutral 单步模型两项失败；后者只执行一次受 80-step clamp 限制的
correction，是测试模型缺口，原证据继续保留。修正 synthetic 模型为同一 ≤180 收敛循环后，可信 `red-03` 为
`1 failed / 23 passed`：Browser-18 pose 的旧 pitch-only control 稳定不命中，完整 correction、10 resource 两侧有限域、
workbench 与非 Classic synthetic target 均通过；唯一失败是两个 V2 mining consumer 尚未执行 exact pre-aim。

## 实现与 GREEN

- `mineResources` 和 `reclaimEquipmentWorkbench` 在既有 `isEquipmentMiningReady` 后各增加一次
  `aimAtVoxelWithRealMouse(page, target)`，下一条语句仍为原 `mineVoxel(page, target)`。没有复制 mining/drop/pickup
  流程，没有 try/catch fallback，也没有修改通用 helper、route、scenario JSON 或预算。
- source contract 要求每个 consumer 恰有一个 pre-aim 和一个 `mineVoxel`，并且两者之间只有当前 pre-aim 调用的参数
  尾部与空白；成功 pre-aim 后旧 guard 的首次 observation 已 exact，不获得第二份 correction budget。
- 初次 `green`、收紧 source contract 后的 `green-final`、Prettier 后的 `green-final-02` 均为 `1 file / 24 tests PASS`。

## 最终验证

- 最终 affected 组合为 `7 files / 70 tests PASS`，包含 mining aim、arrival drift、grounded/resource route、scenario、
  route-progress 与 target-aim；`maxWorkers=1`。
- Classic test types、root test types、两个变更 TS 的 ESLint 均 PASS。首次 format 仅因新测试未格式化而 FAIL；只对
  新测试运行 Prettier 后，最终 5 文件 format 与 scoped diff PASS。
- scoped diff 确认仅 5 个授权可编辑路径；`scenario.test.ts`、`harness.ts`、`aim.ts`、`target-aim.ts`、
  scenario JSON、route、V1 与 production 均未修改。

所有测试和静态命令使用默认 benchmark machine lock，Vitest `maxWorkers=1`，wrapper 使用 `pipefail`。本阶段未运行
Browser-19、build、Cua、devserver、CI、Git/index/push/deploy/merge。fixture/deterministic/static GREEN 不等于
采矿、拾取或装备产品 GREEN。长期 docs 不更新；传统工作量 0.25-0.5 PD，AI 活跃约 1 小时，credits、费率、额度
与占比 unknown。
