# V1 真实鼠标瞄准闭环合同

阶段：`V1-REAL-MOUSE-AIM-CLOSE-01`
状态：实施中；Browser GREEN 待后续唯一 Browser-09。

## RED 基线与根因

Browser-08 唯一正式窗口 `8c83c1ed-9482-464c-a2b0-89f70e52b78e` 在完整门旅程通过后，到达 jukebox approach 并从正式创造目录选中 jukebox。目标 support 为 `[76,30,2]`，adjacent 为 `[76,31,2]`，玩家 eye 为 `[73.74300384521484,32.60000228881836,2.7646305561065674]`。`aimAtVoxelWithRealMouse` 耗尽 180 次校正，末尾 target-card 只在 `[75,30,2]` 与 `[75,30,3]` 间振荡，尚未执行右键；机器诊断 SHA256 为 `e39c8cb06fd27a1dae7198cbc837d9837432af949417097debc5b60acac0993d`。

Trace 证明 PointerLock mouse move 持续执行，不是输入事件丢失。旧算法用“目标格中心 yaw - 当前离散命中格中心 yaw”估计水平误差；只要该离散 yaw 差超过 2.5 度，就只更新 dx、不更新 pitch。失败末段鼠标绝对 x 依次出现约 `107.65 -> 131.36 -> 155.07 -> 178.79 -> 202.50 -> 122.50 -> 146.21 -> 169.92`，y 长期保持 `330`；其中重新回到约 122.50 是既有 PointerLock 边界重锁后继续负向有界步进。离散格变化持续抢占 pitch 分支，验证了横向振荡/纵向饥饿假设。

## 可验证行为

1. 每轮仍通过真实 PointerLock `moveMouseBy` 发送输入；不直接 set view、teleport 或调用 interaction。
2. 校正量由现有 `mouseCorrectionToPoint(player, viewAngles, point)` 同时计算 yaw 和 pitch，并保持每轴最大 80 mouse units。`snapshot.player` 已是 eye，不再增加 1.6。
3. 无 adjacent 时瞄准点保持 voxel center，兼容现有门上下 half、eject、采集与视觉调用。
4. 有 adjacent 时先验证 hit/adjacent 均为有限整数且 Manhattan 距离恰好 1，再取两格共享面中心、向 hit 内侧偏移 `1e-6`。该点必须使客户端 voxel ray 首个命中精确 hit，且 previous/adjacent 精确为请求 adjacent；不瞄 solid center，也不进入 adjacent 内部。
5. 成功判断在同一次页面 `evaluate` 中读取 target-card 与 Harness aimed target；要求 target-card、aimed position 精确等于 target，有 adjacent 时还要求 aimed adjacent 精确相等。blocked/unavailable/null 或错误 adjacent 均不得假成功。
6. 保留 180 次尝试预算、既有 PointerLock 生命周期和失败 history；不增加 timeout、随机搜索、第二路线或 fallback click。

## 确定性测试

- 用 Browser-08 player/view/目标构造旧离散控制对照，证明它在真实 voxel ray 反馈下不能收敛且 pitch 不推进；新控制在相同预算内收敛到 exact target+adjacent。
- top placement 的 face point 穿过 adjacent 并首先命中 target；负轴侧面同样保持正确 target+adjacent。
- yaw wrap 使用最短角误差且校正有界；无 adjacent 的门/eject 目标继续使用 voxel center。
- success predicate 对 null、错误 target 或错误 adjacent 均返回 false，避免 blocked/unavailable 被误判成功。

## 边界

- 只修改 Classic E2E fixture 的 aim/target-aim 纯辅助与测试，不修改 production、mouse-input、harness、scenario、v1-slice、坐标、timeout 或玩法流程。
- 本阶段的 deterministic/类型/静态通过只说明 fixture 控制器闭环；真实 PointerLock、jukebox、media、C4/C5 与保存恢复仍须新 artifact 上的唯一 Browser-09。
