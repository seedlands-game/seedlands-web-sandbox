# V1 门接触位 Entry Face 闭环合同

阶段：`V1-DOOR-ENTRY-FACE-CLOSE-01`

状态：fixture 修正与确定性/静态验证完成；Browser GREEN 待后续唯一 Browser-12。

## Browser-11 RED

Browser-11 唯一正式窗口 `192d22bd-b0b2-4290-bfbf-3de62e2c9b86` 在新的 upper 目标选择后执行了真实右键，但门仍为 `[93,94]`、`worldRevision=142`。失败时 player eye 为 `[70.49250030517578,32.599998474121094,0.49733904004096985]`，Authority server eye 为 `[70.49249900007506,32.6,0.49733905377911297]`，view 为 `[-90.12999999999998,-27.44]`。同次观察精确命中 upper `[70,32,0]`，但 `adjacent=null`。

生产 `traceVoxelTarget` 从 origin 所在 cell 开始读取；该 eye 已处于 targetable upper 完整体素 cell，因此在跨越任何边界前返回 target 且 adjacent 保持 null。`performVoxelTargetInteraction` 遇到 null adjacent 直接返回 fallback，随后 secondary interaction 显示裸 `无法放置`，不会构造 Authority `interact`。`interactionAttempts` 从 13 增至 14 只证明真实客户端右键，不证明 Authority 或 Structure 收到动作。诊断 SHA256 为 `e6765a285c05266a421105194b9692a88d2b58394af2f19fad8edb0f69e9274c`。

## 可验证行为

1. `expectClosedDoorBlocks` 的 Authority 推进、safe corridor、fresh ack、至少 6 ticks 持续阻挡和 1.5 秒总预算全部保留；函数可返回本次实际使用的 `ClosedDoorProbePlan`，不得复制第二套 collision/route 推导。
2. probe 成功后复用 `plan.approach`，通过现有 `walkTo` 和真实键盘退回近侧，继续使用 `tolerance=0.06`、`corridorTolerance=0.08`、`pulseMs=80`。不得增加 timeout、teleport、set-view、Harness 写口或随机路线。
3. 回退完成后从正式 snapshot 与 Authority observation 分别确认 `onGround && !colliding`，且 player/server 的法向坐标都已退出 upper 完整体素的近侧边界。
4. upper 的交互 adjacent 只由同一 plan 的 `normalAxis` 和 `direction` 推导：沿接近方向的反方向移动一个 voxel。随后 `aimAtVoxelWithRealMouse(page, upper, adjacent)` 必须在同次 observation 中严格匹配 target-card、Harness target 与生产 ray adjacent，成功后才发送真实右键。
5. 确定性测试使用生产 `traceVoxelTarget` 与完整上下两格门，证明 Browser-11 接触 eye 即使转向门面仍得到 `target=upper, adjacent=null` 且严格 target+face 不通过；从 approach 的真实 `.06/.08` 容差边界出发，现有 `mouseCorrectionToPoint` 在既有 180 次预算内对 X/Z 两轴和正负近侧分支均得到正确 target+adjacent。
6. 穿门后的既有位置必须能为 upper 关闭和 lower 再打开取得非空正确 face；相关 open collision/mesh/revision/traverse、上下 half、jukebox/media/C4/C5/save 顺序与断言不变。

## 证据边界

- 本阶段仅修改 canonical fixture、closed-door 纯 plan helper/测试及当前 change 文档；不修改 production、Harness API、mouse input、aim controller、scenario、坐标、timeout 或玩法协议。
- 近接触薄门 target 缺少 entry face 是当前产品 ray 的实际限制；本阶段只建立可执行的 fixture 路线，不宣称产品不存在该限制。
- Browser-11 保持 FAIL 且原始证据不变。Vitest、类型和静态检查只证明 fixture/deterministic 完成，首次 toggle、后续 Media/save 与产品体验必须由 GIT19/BUILD13 后 root 另授唯一 Browser-12 验证。
