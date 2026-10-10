# V2 装备采矿瞄准证据

阶段：`V2-EQUIPMENT-MINING-AIM-CLOSE-07 / V2-EQUIPMENT-MINING-AIM-CLOSE-08`

状态：Close-07 证据已冻结并归档到 Close-08 `prior-release/`；Close-08 fixture/deterministic/static GREEN。
Browser-18 原始证据保持在 `evidence/v2-canonical-browser-18/`，本阶段未修改或重跑。

## Close-08 修订原因

- Close-07 在 V2 consumer 中先 full pre-aim 再调用仍含旧 180 次 guard 的 `mineVoxel`；固定 pose source test 未直接
  执行真实 guard，不能证明两次 readback 间动态漂移时首轮返回，也不能证明拒绝时没有第二预算。
- Close-07 `voxelMap` 没有 scenario floor，且旧 control 在 observation=null 时直接保留 view；实际旧 helper 会在
  null 时调用 `mouseCorrectionToVoxel`。因此 Close-07 的 Browser-18 “完整 180 次振荡”描述被本节收窄为：它真实
  证明最后 12 个 recorded target 交替和 180 次 mouse move，但纯模型未完整复现旧 null 分支。
- Close-07 SOURCE/MANIFEST/delivery SHA 分别为 `2acd5807d8303d5b6f01da213fa3b878efe2374ab7820a7441183b47c9dcfeeb`、
  `b68ac9053322c417d7c643bfcf2936a3f653c424c5fdda7faf8398fdd82d42fa`、
  `c34a151876cca83c6dfb54e9bd14322be33ba1eb99f824bb5ea8f94d52d10546`；metadata 与相关 source 在修改前原字节
  归档到 `evidence/v2-equipment-mining-aim-close-08/prior-release/`。

## Close-08 RED 与实现

可信 RED 为 `1 file / 3 failed / 24 passed`：两个 consumer 仍在 `mineVoxel` 外单独 pre-aim；实际 `mineVoxel`
忽略第三参并调用默认旧 aim；注入 callback reject 未被传播。默认 `mineVoxel` 行为、真实 floor/邻居模型、
Browser-18 pose、10 resource/bench 边界和 content-neutral 反例均已通过，故失败准确指向 callback dispatch。

实现只让 `mineVoxel` 接收可选 `(page, target) => Promise<unknown>` aim callback，默认仍为
`adjustPitchToTarget`；既有 range guard 与 `ensurePointerLock` 后只 `await aim(page,target)` 一次，然后才读取
interactionAttempts 和发送 left mouse down。两个 V2 consumer 改为
`mineVoxel(page,target,aimAtVoxelWithRealMouse)`，删除外部 pre-aim。没有 fallback、第二预算、第二路线或 mining/drop
逻辑复制。

## Close-08 最终验证

- 最终单文件 `green-final-02` 为 `27/27 PASS`，直接调用实际 `mineVoxel` 证明顺序为 range snapshot → Pointer Lock
  检查 → default/injected aim → post-aim snapshot → left mouse down；注入 full aim 恰调用一次且 legacy aim 不运行；
  注入 reject 时执行停在 full aim，legacy aim、mouse down/up 全为 0。
- 最终 `affected-final-02` 为 `7 files / 73 tests PASS`，包含 mining aim、arrival drift、grounded/resource route、scenario、
  route-progress 与 target-aim，`maxWorkers=1`。
- Classic/root test types 与 3 个变更 TS ESLint PASS。首次 format 仅新 test 未格式化而 FAIL；格式化后单测、最终
  affected 与 6 文件 Prettier 均 PASS。scoped diff 证明 harness 只有 callback signature/单一 await hunk，其他通用
  aim/target-aim、scenario test/JSON、route、V1、production 均未改。最终准出窗口在 dispatch 顺序断言增强后重新执行；
  更早的 GREEN/affected/types/lint/format/scope 回执作为中间证据保留，不替代 final 窗口。
- 所有命令经默认 machine lock，wrapper 使用 `pipefail`。未运行 Git/index/push/build/Browser-19/Cua/devserver/CI/
  deploy/merge。Close-08 GREEN 不等于动态 Browser mining、pickup 或 equipment 产品 GREEN。

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
