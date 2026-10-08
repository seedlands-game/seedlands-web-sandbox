# Browser15 真实路线归因与有界候选

冻结基线 `c682770cadd194649830fc1f5e7a9ade7c77b76f`。Browser15 runId `pr41-cloud-browser-15-01` 已终态：主旅程1 FAIL、visual1 PASS、modular1 SKIP，8.2m、CLI exit1、CANONICAL_MAIN receipt FAIL。build14 sourceDigest `27cccf9e5278e7b04d958793dea29323584c22fa01573ef752354b68ee8bedc9`，artifactDigest `ce977f12f66a54025eeebec83ffc21dbe38d324ba9fdc3f20bd8d5120dc0d28e`。

失败附件明确记录C0/C1/C2/C3 PASS，原真实held mouse二段连击、7点伤害、怪物消失与工作台回收断言完成。V2在放置工作台后、资源带第一段corridor route失败；没有开始资源采集或四槽铁甲。实际错误为 `Real input route timed out before 78.5,-0.5`，harness observe在原45秒deadline内未到达。不是900秒预算失败；不能由本次总耗时推断瞄准优化收益。

## 闭合 trace 中的控制事实

约t344481ms的同一实际snapshot：player `[78.50038146972656,32.599998474121094,0.567771852016449]`，server `[78.50037892536223,32.6,0.5677718721688696]`，server velocity零，target `[78.5,-0.5]`，yaw先为`-0.69`随后`0.09`。X已在原`.06`容差内，Z仍偏离原`.08`走廊。旧方向选择只因X多出约0.000379m选择KeyS，使已经朝向-Z目标的相机必须转到约180°。下一次微小X误差反向后再次转回约360°；trace记录两次转向期间player/server静止、yaw每次递进10.4°。完整原字段选取保留于 `browser-15-route-last-snapshots-01.json`；没有修改raw trace或旧receipt。

## 最小控制候选及边界

仅在实际snapshot有finite yaw/delta、`|dx|<=.06`且`|dz|>=.08`时，以当前水平forward和目标delta的dot选择KeyW/KeyS，并优先于待消费的opposite hint。其他情形继续原X selector/hint；缺失或非有限yaw也回退原控制。没有改变实际动作、坐标、yaw sensitivity、80px步长、18/19次角度边界、80ms pulse、45s共享deadline或20s progress等待。

双投影freshness、grounded/noncollision、`.45`有限X邻域、`.06/.08`到达核验和classifier仍全部使用原实现。没有在timeout/invalid/exhaustion后捕获并伪造到达。新fixture只证明控制选择与保留的到达门禁；不能代替真实physics/browser。

## 验证与未闭合项

有效 RED `equipment-route-corridor-19-red.log`：实际followEquipmentRoute第一次委派KeyS，按记录中的朝向应选KeyW，精确失败。候选GREEN `equipment-route-corridor-19-green.log` 5/5，覆盖记录姿态、反向姿态、missing/NaN fallback和拒绝只有client到达；scoped format/lint PASS。原route/pulse/aim四文件42/42 PASS（`corridor-route-focused-15-01.log`），复用原deadline、双投影和18/19边界测试。新测试加入正式Classic headless/types选择；Classic types PASS（`corridor-classic-types-15-01.log`），根 scoped lint PASS（`corridor-lint-15-01.log`）。提交hooks随后核实。

此前实时鼠标目标发布的职责已补入 `docs/code-map.md`。本组尚未build/browser；下一个唯一候选仍须完整真实输入验收，不能由上述47例宣布路线已可玩。基线c682远端五项检查PASS、Chromium仍在运行，等待其终态后正常推送，避免取消既有验收。

V2正式till/crop producer只读审计已确认缺口，报告位于 `/workspace/pr41-recovery-20261008-fixtures-01/v2-till-crop-producer-map-18-01.md`；尚未实现。V2/V3/V4、modular、194项矩阵、完整审查与最终preview未闭合。最新实际额度18:57UTC剩余93%，停止线约60%；未收到停止要求。
