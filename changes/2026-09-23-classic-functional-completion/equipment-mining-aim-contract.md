# V2 装备采矿瞄准合同

阶段：`V2-EQUIPMENT-MINING-AIM-CLOSE-07 / V2-EQUIPMENT-MINING-AIM-CLOSE-08`

状态：Close-07 被本节 supersede；Close-08 fixture/deterministic/static GREEN。Browser-18 保持 FAIL，
Browser-19 未授权。

## Close-08 单一 callback 修订

- Close-07 的“pre-aim 后旧 guard 首轮返回”只由固定 pose 的纯模型和源码邻接断言支持，不能排除两次 readback 间
  漂移、Pointer Lock 恢复或旧 guard 再获 180 次预算，因此不作为最终单预算证据。
- `mineVoxel` 仅扩展一个可选 `aim` callback，默认值为 `adjustPitchToTarget`。它在既有 range guard 与
  `ensurePointerLock` 后被 `await` 一次，然后才读取 interactionAttempts 和发送 left mouse down；reject 时 mouse down
  必须为 0，且不得调用默认 aim fallback。
- V2 的 resource 与 workbench 两个 consumer 将 `aimAtVoxelWithRealMouse` 作为第三参传给 `mineVoxel`，不再提前调用。
  这使 V2 只有 full aim 的一个 180 次预算；其他调用省略第三参并保持旧 pitch aim 语义。
- 确定性模型必须包含 scenario floor 和全部 resource/workbench voxel，并逐字复现旧 helper：valid wrong voxel 仅
  `dy=±6`，null/invalid observation 使用 `mouseCorrectionToVoxel` 完整修正。Browser-18 pose 是失败时记录的起点重放，
  不能表述为 180 个实际 target 全序列；raw 只记录最后 12 项。

## Owner 与最小接线

- owner 仅为 canonical V2 equipment fixture consumer。生产 `traceVoxelTarget`、通用 `aimAtVoxelWithRealMouse`、
  `mineVoxel`、Pointer Lock、Authority mining、drop/pickup 与 route owner 均保持不变。
- `mineResources` 的 10 个固定 resource 和 `reclaimEquipmentWorkbench` 的最终 workbench 回收，在既有
  `isEquipmentMiningReady` 成功后调用 `mineVoxel(page, target, aimAtVoxelWithRealMouse)`。不得复制、包装重试或旁路
  `mineVoxel` 内的输入、提交、掉落与失败反馈。
- pre-aim 复用 target-card 与 `aimedVoxelTarget()` 的同轮 exact target 双读回，并使用
  `mouseCorrectionToPoint(voxelAimPoint(target))` 完整修正 yaw/pitch。不得只按 observed cell 高度调整 pitch。

## 单一预算与失败

- 唯一 correction budget 是注入 callback 的既有 180 次循环。callback reject 立即抛错，不发送 left mouse down，
  不得启动默认 aim fallback、第二条路线或第二份 correction budget。
- 默认调用仍选择 `adjustPitchToTarget`；V2 调用只选择 full aim。测试必须直接执行 `mineVoxel` 并证明 default、
  injected-success、injected-reject 三条 dispatch，而不是用固定 pose 再次读 target 冒充真实 guard。
- stale/null observation 仍由既有 helper 在同一预算内处理；不得放宽 exact target、5m server reach、
  `isEquipmentMiningReady`、interactionAttempts、voxel 清空或 drop/pickup 断言。

## 布局、保存与替代配置

- 覆盖 Browser-18 失败姿态、10 个 resource approach 的 `±0.45m/<0.08m` 有限到达域关键边界，以及最终
  workbench mining approach。生产 `traceVoxelTarget` 必须证明目标在现有邻居布局中可见且完整 correction 在
  ≤180 次收敛；旧 pitch-only control 对 Browser-18 姿态稳定失败。
- 本片不改变存档 schema、runtime/actor epoch、inventory/equipment revision 或 restore。失败发生在首次 mining input
  前时世界、背包、equipment/cursor 继续由既有 owner 保持；Browser 的 save/restore 仍需未来唯一 attempt 观察。
- 非 Classic 反例：helper 接收任意整数 voxel target 与调用方提供的真实 voxel reader，不识别 wood、iron、workbench
  或 Classic voxel ID；测试用 synthetic targetable voxel 证明同一 correction 机制可替换内容。

## 验收边界与预算

- RED 必须真实复现 Browser-18 pose 下旧 pitch-only valid-wrong-voxel 分支无法命中 `[80,31,2]`，并在 consumer
  尚未 pre-aim 时使 source contract 失败。
- GREEN 覆盖新 aim 回归、resource route/drift/grounded/scenario 相关测试、Classic/root test types、仅变更 TS
  ESLint、可编辑文件 Prettier 与 scoped diff；Vitest `maxWorkers=1`，全部命令使用默认 machine lock。
- 本阶段 fixture/deterministic/static GREEN 不等于 Browser-19、采矿/拾取或装备产品 GREEN。
- 传统工作量 0.25-0.5 PD；AI 活跃预计 1-2 小时，硬上限 3 小时。credits、API 等价费用、费率、额度与占比
  unknown。长期 docs 不更新，因为 owner、公共协议和生产架构均未变化。
