# V1 门出口面闭环合同

阶段：`V1-DOOR-EXIT-FACE-CLOSE-01 / V1-DOOR-EXIT-FACE-CLOSE-02`

状态：fixture、确定性与静态验证完成；Browser-13 保持 FAIL，真实 Browser GREEN 待新 identity。

## Close-02 收口

- Close-01 的 `.06/.08` 到达域测试只证明三个实际位置满足 route 与完整 voxel 出口谓词，未从这些 position
  运行瞄准闭环；该结论不得表述为“整个到达域已证明 lower face 收敛”。
- 同一 position 循环必须复用 `doorExitAdjacent(plan, lower)` 与 Browser-13 view，逐点调用既有 `converge`，
  并要求 180 次内得到 exact lower position 与 exact non-null exit adjacent。不得增加预算、改变模拟或新增算法。
- Close-01 合同、证据和 SOURCE/MANIFEST/delivery 在修改前原字节保存到
  `evidence/v1-door-exit-face-close-02/prior-release/`；本段及新 evidence 明确 supersession，不重写旧 PASS 含义。

## Browser-13 RED

- 唯一窗口 `ca001977-b334-4fbc-962f-254c2bc44a46` 在 V2 开始前失败。玩家 eye 为
  `[71.475830078125,32.60000228881836,0.502830982208252]`，view 为
  `[-270.17999999999995,-48.37]`；期望 lower `[70,31,0]`，最后 12 次只观察 upper `[70,32,0]`。
- 从该 eye 指向 lower center `[70.5,31.5,0.5]` 的射线在门东侧平面 `x=71` 时高度为
  `32.063623889792346`，会先进入 upper voxel。失败发生在 lower 右键前，不能把累计
  `interactionAttempts=15` 当作该动作已分派。
- 旧确定性用例只证明理想 eye `[71.5,32.6,0.5]` 与初始 view `[-90,-20]` 可在 14 次内命中 lower center；
  该结论保留但不外推到 Browser-13 真值。

## 可验证行为

1. `doorExitAdjacent(plan, target)` 只由同一 `ClosedDoorProbePlan.normalAxis/direction` 推导：在法向轴加
   `direction`，其余坐标不变。本例 lower 得到 `[71,31,0]`。输入 target 必须是有限整数。
2. 穿门仍以真实键盘走向现有 `[door.lower[0]+1.5,door.lower[2]+0.5]`；仅把参数收紧为
   `tolerance=0.06`、`corridorTolerance=0.08`、`pulseMs=80`，沿用既有 45 秒默认 timeout。
3. walk 完成后，client snapshot 与 Authority observation 都必须 `onGround && !colliding`，并由纯谓词确认其
   法向位置严格越过 lower 完整 voxel 的出口边界；不能只证明越过薄 collision box。
4. upper 关闭仍走现有真实 Pointer Lock/右键。lower 重开必须调用
   `aimAtVoxelWithRealMouse(page, door.lower, doorExitAdjacent(plan, door.lower))`；只有同轮 target-card、Harness
   target 与非空正交 adjacent 精确匹配才点击，随后原 opened pair 断言不变。
5. 确定性测试使用生产 `traceVoxelTarget`、实际门 pair `93/94` 和 Browser-13 eye/view，证明 center 控制在
   180 次内不能得到 lower，而 exit face 能收敛；覆盖 X/Z 两轴正负方向、真实/理想 eye、`.06/.08` 到达域、
   小 y 浮点误差和完整 voxel 出口判定。

## 范围与停止线

- 只修改 `v1-slice.ts`、`door-collision-oracle.ts`、其定向测试和本 change 文档；不改 production、
  `aim.ts`、`target-aim.ts`、mouse/harness/scenario、V2 equipment helper、坐标、timeout 或预算。
- 原 closed probe、entry face、upper/lower 覆盖、Media、V2、C0-C5 均保留。若现有真实输入无法在冻结路线内证明
  exit face，则停止并交 root，不添加 fallback。
- 本阶段预算上限 3 小时；传统工作量约 0.25-0.5 PD。credits、费率、API 等价费用和额度占比 unknown。
