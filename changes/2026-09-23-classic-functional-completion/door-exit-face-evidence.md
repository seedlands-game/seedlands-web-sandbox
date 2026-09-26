# V1 门出口面闭环证据

阶段：`V1-DOOR-EXIT-FACE-CLOSE-01`

结论：fixture、确定性回归与静态验收完成；Browser-13 保持 FAIL，未运行新的 Browser、build、Cua 或 CI。

## Browser-13 反例

Browser-13 窗口 `ca001977-b334-4fbc-962f-254c2bc44a46` 在 V2 开始前失败。失败点是穿门后 upper 已真实关闭，
随后 `v1-slice.ts:293` 以 center-only 方式重新瞄准 lower `[70,31,0]`；真实 eye
`[71.475830078125,32.60000228881836,0.502830982208252]`、view
`[-270.17999999999995,-48.37]` 下，最后 12 次只观察 upper `[70,32,0]`。lower click 尚未发送，故累计
`interactionAttempts=15` 不能证明本次 Authority dispatch。

几何核算显示，从该 eye 指向 lower center `[70.5,31.5,0.5]` 的射线在门东侧平面 `x=71` 时
`y=32.063623889792346`，先进入 upper voxel。旧测试从理想 `[71.5,32.6,0.5]`、`[-90,-20]` 得到 lower
center 的事实仍保留，但其适用域不覆盖 Browser-13 真值。原 Browser-13 诊断 SHA256 为
`a8677c5125f34e3e6b2fc15260096b57a451300dffcb42966b8d8eb616b2b5fd`。

## RED 与实现

新增测试先使用生产 `traceVoxelTarget` 和完整门 pair `93/94` 证明 Browser-13 center 控制在 180 次内仍命中
upper，同时证明显式 lower exit face `[71,31,0]` 可在同一预算内收敛。RED 窗口
`v1-door-exit-face-close-01-red` 为 `1 failed / 0 passed`；几何断言已执行，唯一失败是现有 fixture 尚未接线
`doorExitAdjacent(closedDoorPlan, door.lower)`，不是 missing import/collection 失败。

实现只增加两个纯 helper：`doorExitAdjacent` 在 plan.normalAxis 上加 plan.direction；
`isOutsideDoorTargetOnExitSide` 以完整 target voxel 的出口边界判定，而不是薄 collision 平面。V1 穿门继续走原
`[lower.x+1.5,lower.z+0.5]`，仅收紧为 `.06/.08/80ms`；随后对 client 和 Authority 均检查
grounded/non-colliding 与完整 voxel 出口，再保留 upper 真实关闭，最后以 lower+exit adjacent 的严格同轮 readback
发送真实右键并保留原 opened pair 断言。

GREEN 窗口 `v1-door-exit-face-close-01-green` 为 `1 file / 8 tests PASS`。用例覆盖 Browser-13 真值、理想点
旧结论、X/Z 法向正负四方向、`.06/.08` 到达域、y 小浮点误差、完整 cell 出口边界和非法 target。
受影响闭包窗口 `v1-door-exit-face-close-01-affected` 为 `4 files / 38 tests PASS`，包含 exit face、既有 door
collision/entry face、target aim 与 route progress。

首次聚合窗口 `v1-door-exit-face-close-01-final` 中 38 个行为测试先通过，随后 Classic types 因新测试局部把
readonly `Point` 传给生产 ray 的 mutable tuple 参数而 TS2345 FAIL；原始失败保留。只把测试局部
`directionForView` 返回类型收紧为可变三元组，并补充四方向完整 voxel 出口边界断言后，最终窗口
`v1-door-exit-face-close-01-final-03` 为中间 PASS。最后仅将旧 oracle 测试名称/局部变量明确限定为 ideal
post-traverse point，不改其断言；最终交付窗口 `v1-door-exit-face-close-01-final-04` 覆盖 `4 files / 38 tests`、
Classic/root test types、4 个 TS 的 ESLint、7 个 TS/MD 的 Prettier 与 scoped diff。`final-02/03` 保留但不作为
最终身份。

## 边界

没有修改 production、`aim.ts`、`target-aim.ts`、mouse/harness/scenario、V2 equipment helper、坐标、timeout、
180 次 aim 预算或重试。没有运行 Browser/build/Cua/devserver/CI/Git/index/push。V1 后续 Media、V2 装备、C4/C5
与保存恢复仍需新 identity 上唯一 Browser-14；death、durability-1、drop、respawn 继续 `NOT OBSERVED`。

本阶段不改变长期 owner、公共协议或架构，因此长期 docs baseline 不更新。预算上限 3 小时；credits、API 等价费用、
费率和额度占比 unknown。

## Close-02 补充证据

阶段：`V1-DOOR-EXIT-FACE-CLOSE-02`。Close-01 的合同、证据正文、SOURCE/MANIFEST/delivery 在修改前已原字节
复制到 `evidence/v1-door-exit-face-close-02/prior-release/`；原 SHA 和原 PASS 含义保持，不以后续文本倒填。

Close-01 的 `.06/.08` 测试只断言三个实际位置满足 route 和完整 voxel 出口谓词，未从这些位置执行瞄准闭环。
Close-02 在同一循环中复用同一 `doorExitAdjacent(plan, lower)` 和 Browser-13 view，逐点调用现有 `converge`，
要求在 180 次内返回 exact lower 与 exact exit adjacent。Browser-13 真值和理想点用例保持；没有修改路线、预算、
模拟、生产代码或 V1 接线。

Close-02 实际验证：

- 格式化窗口 `v1-door-exit-face-close-02-format-write`：PASS，UTC
  `2026-09-25T23:56:50.247Z` 至 `2026-09-25T23:56:50.926Z`。
- 受影响闭包窗口 `v1-door-exit-face-close-02-affected`：`4 files / 38 tests PASS`，UTC
  `2026-09-25T23:56:59.493Z` 至 `2026-09-25T23:57:00.734Z`；stdout SHA
  `4b939df38a8813f987b407b277fe080e41b3e32c99edf318e8d5e7692b4de43b`，receipt SHA
  `5ee25a84d066756c8bea00395e9cc07ac9cd4c1e1cfbb0e6a7d63b48fbb27dfb`。
- Classic test types 窗口 `v1-door-exit-face-close-02-classic-types`：PASS；root test types 窗口
  `v1-door-exit-face-close-02-root-types`：PASS；单 TS ESLint 窗口
  `v1-door-exit-face-close-02-eslint`：PASS；Prettier/scoped diff 窗口
  `v1-door-exit-face-close-02-static`：PASS。所有窗口均使用默认 benchmark machine lock，测试
  `maxWorkers=1`。

本阶段不运行 Browser/build/Cua/devserver/CI/Git/index/push。测试通过只关闭确定性到达域证明缺口；真实 V1/V2
canonical 旅程仍需新 identity 上唯一 Browser-14。death、durability-1、drop、respawn 继续 `NOT OBSERVED`。
