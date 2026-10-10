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

## Close-02 有限域补充

root 复核指出 Close-01 的 `matchesEquipmentRouteArrival` 仍继承 `reachedRouteTarget` 的单侧无界 crossing：
`KeyW` 对任意 `x>=target`、`KeyS` 对任意 `x<=target` 都可能返回 true。CLOSE-01 的 SOURCE/MANIFEST/delivery、
合同与证据在本轮修改前已原字节复制到 `evidence/v2-equipment-resource-route-close-02/prior-release/`，并逐项
`cmp` 通过；其 SHA 分别保持 `92cde4c820d88c822fced9e9e40e0f90165d982f4aad1ae26f6b49ab098674b3`、
`bb776cbb6075907973a5398d77f7e84234cd1a4383863920d88a9a5cadd7b904`、
`4a76cdfdef669f38f2866edd0531ca6c785e99d9073af57d28cd463fb1518c6c`。

CLOSE-02 RED 窗口 `v2-equipment-resource-route-close-02-red` 为 `1 file / 3 failed / 9 passed`：正反向
`x=82.5` / `x=78.5` 远越界 snapshot 被旧 predicate 接受，且 wrapper 在第一次 overshoot 后错误返回，未执行
期望的反向真实输入纠正。该 RED 针对旧行为，不是 import/collection 失败。

实现增加 `±0.45m` 有限 x 邻域。该值与既有 `mineVoxel` approach tolerance 一致；player 最大速度 4.5m/s 下
单次 80ms pulse 最多移动 0.36m，并在 2m resource 间距与 player half-width 0.32m 下为下一 resource 扩张 AABB
保留 0.73m。client 与 server projection 必须分别位于该有限 x 邻域和 `<0.08m` z corridor；任一仍在域外时，
wrapper 对同一 waypoint 用新 snapshot 重算 `KeyW/KeyS` 并再次调用真实 `walkTo`，不做静止等待。所有纠正 leg
共用一次 45 秒 deadline；只有双方均进入有限邻域后，readiness poll 才可使用 `min(20s, remaining)`。

几何测试用整个 leg 的保守包络矩形（两端各扩张 `±0.45m/±0.08m`）对 player-expanded voxel AABB 做分离，
而非只检查四个理想端点。Browser-15 真实斜线仍作为独立相交反例；10 个 resource、三个 batch、pickup 退回、
workbench 往返与拆除 mining approach 均覆盖。另有 wrapper stub 证明第一次 eastbound overshoot 后第二次必须
`KeyS`，timeout 从 45000 降至 44000；30 秒后 projection wait 只获剩余 15000ms，未重置预算；仅 server 仍远
越界时必须再发真实 walk，不能进入 wait。

CLOSE-02 最终验证：

- `v2-equipment-resource-route-close-02-green-02`：`1 file / 13 tests PASS`。随后补充 async walk 超过共享 deadline
  后即使返回匹配 snapshot 也必须拒绝的反例。
- 最终 `v2-equipment-resource-route-close-02-affected-05`：`4 files / 35 tests PASS`，包含 resource route、scenario
  source-policy、既有 route-progress 与 target-aim；`maxWorkers=1`。
- 最终 `v2-equipment-resource-route-close-02-classic-types-05`、`root-types-05`、`eslint-05`、`static-05` 均 PASS。
  所有命令使用默认 benchmark machine lock。

本轮未修改 scenario JSON、通用 `walkTo`/`waitForSnapshot`/`route-progress`/aim/mouse、V1、production、V2 pointer
或 restore 矩阵；未运行 Browser/build/Cua/devserver/CI/Git/index/push/deploy。CLOSE-02 只完成 fixture 确定性与
静态收口，动态路线仍需新 artifact 上由 root 单独授权的 Browser-16。长期 docs 不更新，预算/费率边界沿用上节。

## Close-03 真实 driver 纠正

root 复核 `harness.ts` 后确认：`walkTo` 的循环只看 client player 与 `reachedRouteTarget`。client 已在 target 时，
即使 server projection 仍在 `[79,...]` 或 `[82.5,...]`，再次按 server 选 `KeyW/KeyS` 调用 `walkTo` 也会零输入
立即返回。CLOSE-02 的 server-only 测试让第二次 walk stub 直接返回 matched snapshot，未模拟这一真实 driver 语义；
其原始 release 已在修改前复制到 `evidence/v2-equipment-resource-route-close-03/prior-release/` 并逐项 `cmp`。

CLOSE-03 RED `v2-equipment-resource-route-close-03-red` 为 `1 file / 5 failed / 13 passed`。测试用生产
`reachedRouteTarget` 模拟零输入返回，证明 server 位于 target 两侧时旧实现不会进入 bounded wait；另证明 server 未追平、
共享 deadline 耗尽和 client 位于有限域但尚未 crossing 的路径均走错控制分支。失败来自行为断言，不是 missing import
或 collection。

实现删除 server 选方向 helper。方向始终由 client position 决定；client 域外或尚未完成 crossing 才继续真实 walk，
client 已完成有限域 crossing 时则允许只读等待 server 投影。最终 arrival predicate 完全保持双方有限域、fresh tick、ack、
readiness 与方向 crossing；等待未追平抛错，deadline 恰好耗尽也失败。client overshoot 的反向真实输入与 Close-02
完整邻域几何测试保持。初始 GREEN `v2-equipment-resource-route-close-03-green` 为 `1 file / 18 tests PASS`。
最终 `v2-equipment-resource-route-close-03-affected` 为 `4 files / 38 tests PASS`；Classic/root test types、两个改动 TS
的 ESLint，以及五个 TS/MD 的 Prettier/scoped diff 均在默认 benchmark machine lock 下 PASS。

本片预计 AI 活跃不超过 1.5 小时，传统工作量约 0.25-0.5 PD；credits、API 等价费用、费率、额度分母与占比
unknown。不改变 owner、公开协议或架构，长期 docs baseline 不更新。真实 Browser 动态 server 投影追平、采矿、拾取和
后续装备旅程仍未观察，Browser-16 仍须 root 另行授权。

## Close-04 Grounded Route

Browser-16 trace 的失败 leg 以 `test.trace` 中 `330729.270..373286.246ms` 的 53 个 `KeyS` down 事件为边界，
并从 `0-trace.trace` 选择每次 keyup 后、下一 pulse 前首个 grounded/non-colliding snapshot。53/53 个 matched server x
都严格小于上一项：baseline `98.4630739258`，末项 `85.8325211929`，总位移 `-12.6305527329m`。代表 pulse 1/2/3、
26/27/53 的事件、client/server、tick/ack 与视角记录在本片 `browser16-input-trace-summary.json`。pulse 按键保持
`82.748..91.688ms`，起点间隔 `751.243..900.944ms`；因此旧报告由 Authority 尾部 256 样本得出的“1.35m 后停滞”
被本节明确 supersede。Browser-16 的 FAIL、实际未到 waypoint、未触达采矿/装备等事实不变。

行为 RED 保留三轮：首轮还暴露测试 leg 计数误写（2 failed）；修正后仅 `jump=true` 配置失败（1 failed）；最终
RED 将当前生产 options 送入真实 `PlayerInputStream -> InputCommandBuffer -> stepBody`，45 秒只推进 `13.95m`，低于
固定最长 leg `19.9630739258m`，而同文件的完整平面/障碍几何合同通过。实现只新增共享 V2 walk options 并把
`jump` 设为 `false`，consumer 仍调用原 `walkTo`，其坐标、方向、`.06/.08/.45`、80ms、20s、45s 均未改变。首个
GREEN 为 `1 file / 2 tests PASS`。

几何用例枚举 V1 jukebox approach 到 V2 corridor 的交接，以及 workbench 放置/打开/回收、10 格资源放置、wood/stone/
iron 三批 corridor、清空格 pickup/retreat 共 52 个冻结 leg；使用 scenario 的连续 floor、真实 player half-width 与当时
未清 obstacle 集验证完整包络。确定性 A/B 不是 Browser 性能测量，也不证明 Browser-17、采矿、合成或装备旅程通过。
最终 affected 窗口为 `5 files / 40 tests PASS`；最终 Classic test types、root test types、目标 ESLint 与
Prettier/scoped diff 均 PASS，全部通过默认 benchmark machine lock、Vitest `maxWorkers=1` 串行执行。Browser/build/
devserver/Cua/CI/Git/index/push/deploy 均未运行。
本片预计 AI 活跃不超过 2 小时、硬上限 3 小时，传统工作量约 0.25-0.5 PD；credits、API 等价费用、费率、额度
分母与占比 unknown。未改变长期 owner、公共协议或架构，因此长期 docs baseline 不更新。

## Close-05 Release/consume 测试收口

root 复核发现 Close-04 的测试调度在 ground 分支同 tick 结束 waiting 并启动下一 pulse，因此连续签发 pressed command，
没有模拟真实 `keyup -> neutral input -> Authority consume -> grounded readback`。CLOSE-04 实现保持原字节，本轮只修测试与
证据。RED `v2-equipment-grounded-route-close-05-red` 为 `1 failed / 1 passed`，精确失败是
`configured.issued.neutral === 0`；wrapper 使用 bash `pipefail`，exit code 为 1。

GREEN 模型每个 pulse 先经 `PlayerInputStream.sample` 发送 pressed command；80ms 后只调用一次
`PlayerInputStream.release()`，把 neutral command 送入 `InputCommandBuffer`，然后停止签发新 command，直到该 release
sequence 被 `consumeForTick` 实际确认且 `stepBody` grounded。测试记录每个 pulse 的最后 consumed pressed sequence 与
neutral sequence，断言二者均存在、`pressed < neutral < 下一 pressed`，并同时覆盖 jump=true 45 秒不可达和正式
jump=false 同预算可达。首个实现因 pending input lead 将上一 neutral 错配给下一 pressed 而失败，原始 `green` 回执保留；
改为等待本 pulse 的具体 neutral sequence 后，`green-02` 为 `1 file / 2 tests PASS`。该模型使用固定 60Hz 可控 poll cadence，
只证明调度合同，不声称浏览器墙钟或 Browser-17 GREEN。

收口中继续加强两侧 pulse 的 consumed state 后，`green-03` 暴露 45 秒边界前已启动的末个 pulse 尚未完成 release
消费便停止的测试缺口（`1 failed / 1 passed`）。模型改为不再启动新 pulse，但允许已启动 pulse 在既有 20 秒单次上限内
完成 release/consume/grounded，再由总 elapsed 判定 45 秒路线成功；`green-04` 与最终 `green-final` 均为
`1 file / 2 tests PASS`。最终 affected 为 `5 files / 40 tests PASS`，Classic test types、root test types、单测试
ESLint 和 Prettier/scoped diff 均 PASS，所有命令使用默认 benchmark machine lock、Vitest `maxWorkers=1`。
Browser/build/devserver/Cua/CI/Git/index/push/deploy 均未运行。

## GIT32 未发布证据包装恢复

首次 evidence commit `a402b01623354a5c78e41260354a0fdd7c35394c` 包含六个超过 GitHub 100 MB 限制的
Browser-16 trace 分片，push 被 `GH001` 拒绝；远端保持 `ba5ea55627da8f87caa700ecd43df525aaee6f61`。该未发布
commit 由本地 `refs/task-backups/git32-evidence-a402b016` 保留且不推送。经 root 授权，仅重写这一 evidence commit：
旧 6 片先按顺序流式核对为 774153112 bytes、SHA256
`5ce02c71e564d498bb6c5d030c9dbe8d26aab442e1a85fe19f7c87c06e5aab41`，再无损重切为 `trace-50m/` 下 15 片，
单片最大 52428800 bytes，重组后的长度与 SHA 完全相同。旧 MANIFEST、delivery、trace parts 清单和重组记录原字节
保存在 `prior-packaging/`；Browser 未重跑，CLOSE04/05 raw 与 Browser-16 FAIL 结论不变。
