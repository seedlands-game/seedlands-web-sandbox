# V2 装备资源安全走廊证据

阶段：`V2-EQUIPMENT-RESOURCE-ROUTE-CLOSE-01`

状态：fixture、确定性与静态验证完成。Browser-15 原始失败证据保持在
`evidence/v2-canonical-browser-15/`，本阶段未修改或重跑。

## RED 与实现

行为 RED 窗口 `v2-equipment-resource-route-close-01-red` 为 `1 file / 1 failed`。测试先用 Browser-15 的
东端位置 `[98.5,32.6,-0.5]` 与首个 wood approach `[80.5,-0.5]` 证明默认 `KeyW` 会被现有
`reachedRouteTarget` 立即接受，然后要求 V2 专用方向为 `KeyS`；旧占位 helper 返回 `KeyW`，失败来自行为断言，
不是 missing import 或 collection。

实现新增 V2 专用 `walkEquipmentRoute`，每个 leg 从调用前 snapshot 的 x 与固定 waypoint x 选择 `KeyW/KeyS`，
调用既有 `walkTo` 的 `.06/.08/80ms` 参数，并要求返回或后续 `waitForSnapshot` 匹配对象同时满足 client grounded、
non-colliding、physics tick 前进、ack 不倒退，以及 client/server 双投影到达。资源放置仍保持 survival 走位后再经
正式 UI 切 creative 放置、voxel readback 后切 survival 并等待落地的既有顺序。

三个采集 batch 都先回到 workbench x 上的外侧 z=`-0.5` corridor，再横移到每个 resource 的声明 approach。
调用原 `mineVoxel` 前先验证同轮 client/server 到 target center 的距离均在既有 `2.5..4.5` 范围；采矿后先到
清空格 pickup，再退回同一 approach 才横移。workbench 打开走 corridor→原 approach；最终拆回走 corridor→原
approach→固定 mining approach `[78.5,1.5]`，通过相同距离检查后才调用原 `mineVoxel`。没有删除通用补位防护。

## 几何与反例

- 使用 player body half-width `0.32` 扩张实际 voxel AABB。Browser-15 真实线段
  `[83.60385119512642,1.4372953280896212] -> [77.2,2.5]` 与未采 resource 相交，故不是安全路线。
- 真实 10-resource layout 按 wood/stone/iron 三批逐项验证：corridor 横移不碰未采 resource/workbench；approach 到
  pickup 只在该格清空后通过；pickup 必须退回 approach；三个 batch 起点及返回 workbench 的 leg 均在同一 corridor。
- 全部 10 个 resource 在 `.06/.08` 到达域边缘、东西双向下，client/server 双投影到 target center 的距离均保持
  `2.5..4.5`，不会触发 `mineVoxel` 隐式西侧补位。另有旧 tick、未 grounded、仅 server 未到达、ack 倒退及
  超距反例。

## 验证

- 初始 GREEN `v2-equipment-resource-route-close-01-green`：`1 file / 7 tests PASS`。
- 首次 affected 窗口为 `1 failed / 26 passed`，唯一失败是 `scenario.test.ts` 仍查找旧
  `walkTo(resource.approach)` 文本；更新为新 `walkEquipmentRoute` 后 `affected-02` 为 `4 files / 27 tests PASS`。
- 首次 Classic types 只因测试局部 `obstacle` 过窄地要求 `V2EquipmentResource`，不能接收真实 workbench
  `V1Placement` 而 TS2345 失败；收窄为只需 `{ target: Point }` 后 `classic-types-02` PASS。原失败均保留。
- 补充 Browser-15 斜线/AABB、workbench 拆除 mining approach 及全部 10-resource 到达域边缘后，最终窗口
  `v2-equipment-resource-route-close-01-final-affected-02` 为 `4 files / 28 tests PASS`，`maxWorkers=1`。
- 最终 `final-classic-types-02`、`final-root-types-02`、`eslint-final`、`static-final` 均 PASS；分别覆盖 Classic/root
  test types、4 个 TS 的 ESLint、7 个 TS/MD 的 Prettier 与 tracked/no-index scoped diff。所有命令均使用默认
  benchmark machine lock。

## 证据边界

- Browser-15 已证明 V1 完整 step 和 V2 resource placement 真实到达；V2 receipt 只有 `resources-placed`，四槽仍空。
- 失败在首个 wood 的 `mineVoxel` 辅助走位，尚未发送采矿输入；不能表述为 Authority mining 或 equipment pointer
  缺陷。
- 本阶段只证明固定 corridor、方向、同轮到达与采矿距离的纯 fixture 合同；真实键鼠动态路线仍待新 artifact 上
  唯一 Browser-16。
- 没有运行 Browser/build/Cua/devserver/CI/Git/index/push/deploy，也没有修改 scenario JSON、通用 route/aim/mouse、
  V1、production 或 V2 pointer/restore 矩阵。

## 预算与长期文档

预计 AI 活跃 2-4 小时，上限 6 小时，传统工作量约 0.5-1 PD。credits、API 等价费用、费率、额度分母与占比
unknown。本片不改变 owner、公开协议或架构，长期 docs baseline 不更新。
