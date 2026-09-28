# V2 Canonical Browser 证据

## Browser-19 后续 fixture 收口

Browser-19 原始结果保持 FAIL：wood/stone 各三格采矿、掉落、拾取与木/石镐已真实完成；首个 iron 已真实
leftdown、清空 voxel 并观察到 drop，但 inventory pickup 仍 `NOT PROVEN`。剩余 iron、iron unpack、五件铁甲、四槽
pointer、C4/C5 与保存恢复仍 `NOT REACHED`。

`V2-EQUIPMENT-PICKUP-REFRESH-CLOSE-09/10` 后续只修 canonical fixture 的 post-correction snapshot 边界：仅 V2
equipment walk options 开启 refresh；true 分支在 correction 后与 refresh await 后检查原 deadline，省略/false 保持原
pulse 与 snapshot 读取语义。Close-10 RED 为 `2 failed / 10 passed`，GREEN 为 `12/12`，affected closure 为
`7 files / 74 tests`；GIT35 detached staged tree 对同一五路径 patch 再次通过 `7 files / 74 tests`、Classic/root test
types、3 TS ESLint、Prettier 与 scope 校验。该 fixture/static GREEN 不改写 Browser-19，也不证明 Browser-20 或完整
V2 产品 GREEN；BUILD11 与 Browser20 尚未执行。

## Browser-19 正式验收

阶段：`V2-CANONICAL-BROWSER-19`

结论：**FAIL。C0-C3 与完整 V1 test step 本次真实完成；V2 已完成 workbench/10 格资源放置、wood/stone 各三格
采矿/掉落/拾取、木镐与石镐合成装备，并对首个 iron `[92,31,2]` 发出真实左键、清空 voxel 和观察到可展示
drop。随后前往该 iron 的 pickup waypoint `[92.5,2.5]` 时 route 超时。** 首个 iron 的 inventory pickup 未确认，
剩余三格 iron、iron unpack、五件铁甲、四槽 pointer、C4/C5 与保存恢复均 NOT REACHED。本结果不证明 16 件护甲、
194 项矩阵、Cua、人类听觉或性能。

验收树 `/private/tmp/seedlands-v2-acceptance-f282da95`，HEAD/source
`f282da95833c5ff568b8b7a4caac7d7a7513514f`，tree `ad93a8e1afdbb461a32f7c87ab4b860fd44a2074`；
source/lock/artifact digest 为
`c8463ed87574e1ff1ad4d1c06beb4649fc518ee6815e071a289aec1187c0e865`、
`44db46fb0f159ebe6d88435c8cfb5d46127d1c7f363a50d19217d454c30e1169`、
`f6f1ea672dc8d19dacf70482aa900538c6d81f33637c16e9a718fc22fc1acfa4`。artifact receipt SHA256 为
`fd010be92fce57ffebb254b0eb2b653a385922d22234856d85317074e39d79e0`，builtAt
`2026-09-28T05:47:05.058Z`，dist 为 276 个盖章文件/277 个磁盘文件且无 symlink。Pack lock 与 MP3 SHA256
分别为 `f362a074758f751d828d3881d9427a0945ae5efbce3237dfd3e287d24676c16f`、
`3c69ae745727607de266898ab68a92c7c75f7f08e27daf0c6cec463f7bd119c9`。

精确命令：

```sh
env SEEDLANDS_HARNESS_RUN_ID=v2-canonical-browser-19-f282da95 node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm harness:classic
```

唯一机器窗口 `25700431-601a-4f4d-a294-d90574e3d4f7`，UTC `2026-09-28T05:59:07.361Z` 至
`06:12:37.996Z`，`waitedMs=1`、`exitCode=1`、`measurement.status=NOT_RECORDED`。Playwright 单 worker/
单 Chromium/`retries=0`，canonical 主测试只有 attempt 0，没有第二 attempt。原命令未把 runner stdout 重定向到文件，
故 frozen evidence 将该文件标为 `NOT_RECORDED_AS_FILE`；不从会话输出补造视觉测试状态。Classic receipt 明确记录
non-Classic attempt 为 skipped。

C0-C3 receipt 均为 PASS；V1 step 在 `75.606..123.531s` 无错误返回。V2 receipt 的
`restoreEvidence.before.v2Equipment` 记录到 `phase=stone-pickaxe`：`resources-placed`、`wood-collected`、
`wood-pickaxe-equipped`、`stone-collected`、`stone-pickaxe-equipped` 五个 snapshot 均存在。wood 三格和 stone
三格的 inventory 增量已经按步骤落盘；木镐 durability 从 60 变为 57，石镐为 132，证明前三次 stone mining 消耗了
木镐。四个 armor slot 与 cursor 仍为空，`armorPoints=0`。

首个 iron 的完整 trace 在 `669656.305ms` 记录 `Mouse down(left)`，`669678..670360ms` 的 voxel poll
仍读到 `21`，`670502.804ms` 成功读到 `0`，随后 `670503.157ms` 发送 `Mouse up`。drop poll 以
`itemId=iron-block,countBefore=0` 在 `670700.355ms` 返回 true；这是“inventory 已增加或可展示 world item”的析取，
不能单独当作 inventory pickup。随后 `walkEquipmentRoute([92.5,2.5])` 运行 17 个 `KeyS` down/up pulse、118 次
route mouse move、0 次 mouse button，最终超时；因此首 iron 的 Authority mining/voxel clear/drop 已通过，inventory
pickup 尚未通过。

完整失败 leg 解码 157 个 snapshot/60 个压缩位置段。初始 route 样本 client/server 为
`[92.473900,32.6,-0.317659]` / `[92.627098,32.6,-0.459169]`，`onGround=true`、world item=1；失败附件
末值为 `[92.681175,32.6,2.330123]` / `[92.612282,32.6,2.389833]`，`onGround=false`、world item=0。
期间 trace 有 4 组位置样本静态落入 `±0.45/<0.08` 双投影包络，但没有序列化每次 controller 的 active direction、
freshness baseline 或分类返回值；故可证 owner 是 V2 fixture route controller/consumer，不可仅凭这些位置提前冻结
“already arrived short-circuit”或其他具体修复。afterEach 尾窗、ack 增长和 step 标题均未被用作该归因的单独证据。

| 域                                                                     | Browser-19 结果                        |
| ---------------------------------------------------------------------- | -------------------------------------- |
| C0-C3                                                                  | PASS；receipt 明确记录                 |
| V1 水桶、门、jukebox/record/media                                      | PASS；完整 test step 已返回            |
| V2 workbench、10 格 resource、`resources-placed`                       | PASS；receipt phase/step 明确记录      |
| wood/stone 各三格 mining/drop/pickup、木镐/石镐                        | PASS；五个 equipment snapshot 明确记录 |
| 首格 iron leftdown、voxel clear、drop                                  | PASS；完整 trace 调用和 poll 明确记录  |
| 首格 iron inventory pickup / `[92.5,2.5]` route                        | NOT CONFIRMED / FAIL                   |
| 剩余 iron、iron unpack、五件铁甲                                       | NOT REACHED                            |
| 四槽 click/Shift、wrong-slot 零变化、swap、quickmove、close settlement | NOT REACHED                            |
| C4、`before.v2EquipmentPreSave`、C5、save/continue、V1 media restore   | NOT REACHED                            |
| runtime/actor epoch、durability/revision、新 ref restore               | NOT REACHED                            |
| non-Classic smoke                                                      | SKIPPED；Classic receipt 明确记录      |
| 视觉测试                                                               | NOT RECORDED IN CLASSIC RECEIPT        |
| durability-1、death、drop、respawn                                     | NOT OBSERVED                           |
| Cua、人类听觉                                                          | NOT RUN                                |
| 性能                                                                   | NOT MEASURED                           |

failure attachment schema 不含 pageErrors/failedResponses，二者为
`NOT_RECORDED_BY_FAILURE_ATTACHMENT`。只读 trace 记录 1 条 Tone.js log、0 条 page-error 和 1331 条 network
resource snapshot，其中 HTTP `>=400` 为 0；这些 trace readback 不补造成 failure attachment 字段。trace 为
1041592835 bytes，SHA256 `09f89b6ee5e56bddbd7721d0cc9640e5e2dd2fca38b455d550474c1c7b1edcc7`；
`trace-50m/` 含 20 个最大 50 MiB 分片，流式重组已验证。

独立 machine-lock `harness:artifact` 后验窗口 `v2-canonical-browser-19-artifact-postcheck` PASS，UTC
`2026-09-28T06:20:22.389Z` 至 `06:20:25.713Z`，同 source/lock/artifact digest、builtAt 与 276-file map。
后验验收树 tracked/index clean，dist 277 files/0 symlink，4273 无监听，owned Playwright/Chromium/preview 为 0，
benchmark lock absent；BUILD09/BUILD10 tree 与 Git32 backup ref 保留。本轮未修改 source/test/scenario/dist，也未 build、
第二 attempt、Browser20、Cua、CI、Git/index、push、deploy 或 merge。Close09 尚未实施或验证，需 root 独立审证据后
重新冻结 scope。

## Browser-18 正式验收

阶段：`V2-CANONICAL-BROWSER-18`

结论：**FAIL。C0-C3 与完整 V1 test step 本次真实通过；V2 已完成 workbench、10 格资源放置并真实记录
`phase=resources-placed`，随后在第一格 wood `[80,31,2]` 的真实鼠标瞄准中失败。** 该格左键采矿输入尚未发送，
因此资源采矿拾取、木/石镐、iron unpack、五件铁甲、四槽 pointer 矩阵、C4/C5 与保存恢复均 NOT REACHED。
Classic 视觉测试独立 PASS，non-Classic smoke SKIPPED。本结果不证明 16 件护甲、194 项矩阵、Cua、人类听觉或性能。

验收树 `/private/tmp/seedlands-v2-acceptance-4de6383e`，HEAD/source
`4de6383e431df6f1b08fb6297e1b9c7ab95143a6`，tree `04fa698407463b167125ba86b5403d3f57a767e7`；
source/lock/artifact digest 为
`900774ae3ae028f06767b75c73ac5243473f3f8ad63a034232b41dea27459c30`、
`44db46fb0f159ebe6d88435c8cfb5d46127d1c7f363a50d19217d454c30e1169`、
`f6f1ea672dc8d19dacf70482aa900538c6d81f33637c16e9a718fc22fc1acfa4`。artifact receipt SHA256 为
`a0200fe0eb3b182c50f22535c104e753a0045c0a9c96f86e3d04e5cb52c875fd`，builtAt
`2026-09-28T04:06:54.023Z`，dist 为 276 个盖章文件/277 个磁盘文件且无 symlink。Pack lock 与 MP3 SHA256
分别为 `f362a074758f751d828d3881d9427a0945ae5efbce3237dfd3e287d24676c16f`、
`3c69ae745727607de266898ab68a92c7c75f7f08e27daf0c6cec463f7bd119c9`。

精确命令：

```sh
env SEEDLANDS_HARNESS_RUN_ID=v2-canonical-browser-18-4de6383e node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm harness:classic
```

唯一机器窗口/run ID `4aba5a83-c1c9-4d4e-b4c4-a0a5123c279d`，UTC `2026-09-28T04:17:21.422Z` 至
`04:22:28.553Z`，`waitedMs=1`、`exitCode=1`、`measurement.status=NOT_RECORDED`。Playwright 单 worker/
单 Chromium/`retries=0`，结果 `1 failed / 1 passed / 1 skipped`；canonical 主测试只有 attempt 0，没有第二 attempt。

C0-C3 receipt 均为 PASS。V1 test step 在本次 attempt 中完整返回，覆盖水桶、门 readiness/upper/lower/exit-face、
jukebox/record/media；没有用历史结果倒填。V2 receipt 在 `placeResourceStrip` 完整循环之后记录
`phase=resources-placed` 和同名 step，因此可确认 workbench 与 10 格 resource placement、grounded route 及 Close-06
arrival/drift 闭环本次真实到达。该 snapshot 的四个 armor slot、cursor 均为空，`armorPoints=0`。

失败发生在 `equipment-journey-support.ts:260` 调用 `mineVoxel([80,31,2])`，最终由 `harness.ts:335` 抛出。
失败快照 player `[80.659676,32.599998,-0.499733]` 到目标中心距离约 `3.199m`，已经通过既有 mining readiness/range。
完整失败 step trace 记录 180 次真实 `Mouse move`；错误对象保留的最后 12 个 target 在 `[84,31,2]` 与
`[84,30,1]` 间交替。末段鼠标 x 固定为 `479.556...`，y 在 `196.886.../190.886...` 间各出现 81 次。
`adjustPitchToTarget` 对有效但错误的 voxel 只发 `dy=±6`，不会调用完整 dx/dy correction；关键帧也显示轮廓落在
更远 wood voxel。该 step 中 `Mouse down/up` 事件为 0，故第一格 wood 的左键采矿输入尚未发送；不能将失败归因于
Authority mining、掉落或拾取。failure snapshot 的 physics tick/ack 前进也不能单独证明未发送的采矿输入。

| 域                                                                     | Browser-18 结果                   |
| ---------------------------------------------------------------------- | --------------------------------- |
| C0-C3                                                                  | PASS；receipt 明确记录            |
| V1 水桶、门、jukebox/record/media                                      | PASS；完整 test step 已返回       |
| V2 workbench、10 格 resource、`resources-placed`                       | PASS；receipt phase/step 明确记录 |
| 第一格 wood approach/mining readiness                                  | PASS；距离约 3.199m               |
| 第一格 wood 鼠标 aim / 左键 mining input                               | FAIL / NOT SENT                   |
| 全部采矿拾取、木石镐、iron unpack、五件铁甲                            | NOT REACHED                       |
| 四槽 click/Shift、wrong-slot 零变化、swap、quickmove、close settlement | NOT REACHED                       |
| C4、`before.v2EquipmentPreSave`、C5、save/continue、V1 media restore   | NOT REACHED                       |
| runtime/actor epoch、durability/revision、新 ref restore               | NOT REACHED                       |
| Classic 视觉 v3                                                        | PASS，31.2 秒                     |
| non-Classic smoke                                                      | SKIPPED                           |
| durability-1、death、drop、respawn                                     | NOT OBSERVED                      |
| Cua、人类听觉                                                          | NOT RUN                           |
| 性能                                                                   | NOT MEASURED                      |

failure attachment schema 不含 pageErrors/failedResponses，二者为
`NOT_RECORDED_BY_FAILURE_ATTACHMENT`。只读 trace 记录 1 条 log、0 条 page-error 和 944 条 network resource
snapshot，其中 HTTP `>=400` 为 0；这些 trace readback 不补造成 failure attachment 字段。trace 为 438432955 bytes，
SHA256 `93321ab6b0deefa228ed7e84c125a0269a8b88ab23d36c67f7d74298c7fa420e`；`trace-50m/` 含 9 个最大
50 MiB 分片，流式重组已验证。

独立 machine-lock `harness:artifact` 后验窗口 `v2-canonical-browser-18-artifact-postcheck` PASS，UTC
`2026-09-28T04:27:03.330Z` 至 `04:27:06.322Z`，同 source/lock/artifact digest、builtAt 与 276-file map。
后验验收树 tracked/index clean，dist 277 files/0 symlink，4273 无监听，owned Playwright/Chromium/preview 为 0，
benchmark lock absent。本轮未修改 source/test/scenario/dist，也未 build、第二 attempt、Cua、CI、Git/index、push、
deploy 或 merge。Browser lease 在证据封存后释放。

## Browser-17 正式验收

阶段：`V2-CANONICAL-BROWSER-17`

结论：**FAIL。C0-C3 与完整 V1 test step 本次真实通过；V2 已放置 workbench、3 格 wood、3 格 stone 和首个
iron resource，在前往第 8 格（第二个 iron）approach `[94.5,-0.5]` 的双投影 arrival wait 中失败。** 第 8 格
`[94,31,2]` 尚未选择或放置，`resources-placed` phase、全部采矿/拾取、合成与装备手势均 NOT REACHED。Classic
视觉测试独立 PASS，non-Classic smoke SKIPPED。本结果不证明 16 件护甲、194 项矩阵、Cua、人类听觉或性能。

验收树 `/private/tmp/seedlands-v2-acceptance-cb4941bf`，HEAD/source
`cb4941bfd1801422802463bc7bbc41dd7d8e9484`，tree `0ce6d40c340f153007a8d8bc24742f635222fb29`；
source/lock/artifact digest 为
`ec6301aec3c1de8f61579c1e305626a675f76be10fb40aaf2b1b350efc1c9a17`、
`44db46fb0f159ebe6d88435c8cfb5d46127d1c7f363a50d19217d454c30e1169`、
`f6f1ea672dc8d19dacf70482aa900538c6d81f33637c16e9a718fc22fc1acfa4`。artifact receipt SHA256 为
`a02e67c6c2694bfbb188d81ae8d74b554f6604c773389d952a4c5e40c222f682`，builtAt
`2026-09-26T06:29:08.702Z`，dist 为 276 个盖章文件/277 个磁盘文件且无 symlink。Pack lock 与 MP3 SHA256
分别为 `f362a074758f751d828d3881d9427a0945ae5efbce3237dfd3e287d24676c16f`、
`3c69ae745727607de266898ab68a92c7c75f7f08e27daf0c6cec463f7bd119c9`。

精确命令：

```sh
env SEEDLANDS_HARNESS_RUN_ID=v2-canonical-browser-17-cb4941bf node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm harness:classic
```

唯一机器窗口 `v2-canonical-browser-17-cb4941bf`，UTC `2026-09-26T07:07:54.237Z` 至
`2026-09-26T07:13:43.802Z`，`waitedMs=1`、`exitCode=1`、`measurement.status=NOT_RECORDED`。Playwright
单 worker/单 Chromium/`retries=0`，结果 `1 failed / 1 passed / 1 skipped`；canonical 主测试只有 attempt 0，
没有第二 attempt。

C0-C3 receipt 均为 PASS。V1 test step 在本次 attempt 中完整返回，覆盖本轮水桶、门 readiness/upper/lower/
exit-face、jukebox/record/media；没有用 Browser-16 的 V1 PASS 倒填。V2 receipt 只记录 `phase=started`，armor 四槽与
cursor 为空。trace 的 voxel readback 明确记录七次成功，按 scenario 顺序为 `[80,82,84]` 三格 wood、
`[86,88,90]` 三格 stone 和 `[92]` 首个 iron，z 均为 `2`、y 均为 `31`；第 8 格 `[94,31,2]` 尚未进入
creative 选择或右键放置。

失败发生在 `equipment-journey-support.ts:225` 对第 8 格 approach `[94.5,-0.5]` 的
`followEquipmentRoute -> waitForArrival`。最后真实 `KeyW` pulse 为 trace `249924.979..250008.719ms`，内部
grounded wait 在 `250026.263ms` 成功。此时 client `[94.459671,-0.505328]` 已进入有限到达域，但 server 为
`[94.527518,-0.308819]`，尚未进入 `<0.08` z corridor；下一采样 server 到达约 `-0.505328` 时，client 已因
释放后的残余速度到达 `-0.636522`。之后双方稳定在约 `-0.654540`，20 秒内从未出现双投影同轮满足 corridor 的
snapshot。同期 physics tick `16754 -> 17955`、ack `9986 -> 11187` 持续前进，client 保持 grounded、
non-colliding；因此不能归因为 input 未 ack、tick 停止或 Browser-16 的“停滞”。trace 未序列化每次 predicate 的布尔
分解或输入轴值，本阶段只把它归类为 fixture 双投影 arrival mismatch，不声称更深生产根因。

| 域                                                                  | Browser-17 结果                         |
| ------------------------------------------------------------------- | --------------------------------------- |
| C0-C3                                                               | PASS；receipt 明确记录                  |
| V1 水桶、门 readiness/upper/lower/exit-face、jukebox/record/media   | PASS；完整 test step 已返回             |
| V2 workbench 与前 7 格 resource                                     | PASS；trace voxel readback 明确记录     |
| 第 8 格 iron approach                                               | FAIL；双投影未同轮进入 `<0.08` corridor |
| 剩余 3 格 iron、`resources-placed` phase                            | NOT REACHED                             |
| wood/stone/iron 采矿拾取、两把镐、iron unpack、五件铁甲             | NOT REACHED                             |
| 四槽 click/Shift、wrong-slot、swap、脱穿、close settlement          | NOT REACHED                             |
| C4、C5、`before.v2EquipmentPreSave`、save/restore、双 epoch、新 ref | NOT REACHED                             |
| Classic 视觉 v3                                                     | PASS，32.2 秒                           |
| non-Classic smoke                                                   | SKIPPED                                 |
| death、durability-1、drop、respawn                                  | NOT OBSERVED                            |
| Cua、人类听觉                                                       | NOT RUN                                 |
| 性能                                                                | NOT MEASURED                            |

failure attachment schema 不含 pageErrors/failedResponses，二者为
`NOT_RECORDED_BY_FAILURE_ATTACHMENT`。只读 trace 另记录 1 条 Tone.js log、0 条 page-error 和 810 条 network
resource snapshot，其中 HTTP `>=400` 为 0；这些 trace readback 不补造成 failure attachment 字段。trace 为
480136175 bytes，SHA256 `341dbe30467b4f1a5dc008182fe67f92ea4ed565de8fda44d95de0b810d61544`；
`trace-50m/` 含 10 个最大 50 MiB 分片，流式重组已验证，仓库内无本轮 `>=100MB` 文件。

独立 machine-lock `harness:artifact` 后验窗口 `v2-canonical-browser-17-artifact-postcheck` PASS，UTC
`2026-09-26T07:20:40.769Z` 至 `2026-09-26T07:20:43.599Z`，同 source/lock/artifact digest 与 276-file map。
后验验收树 tracked/index 0/0，dist 277 files/0 symlink，4273 无监听，本树 Playwright/Chromium/preview 为 0，
benchmark lock absent；历史 `refs/task-backups/git32-evidence-a402b016` 保留。本轮未修改 source/test/scenario/dist，
也未 build、第二 attempt、Cua、CI、Git/index、push、deploy 或 merge。Browser lease 在证据封存后释放。

## Browser-16 输入轨迹勘误（CLOSE-04）

后续对同一原始 trace 的完整失败 leg 流式提取否定了下方 Browser-16 初步段中的“先有 1.35m 净进展后停滞”：
从 server `[98.4630739258,32.6,-0.5003726519]` 到 `[85.8325211929,32.7366676667,-0.5109755188]`，
53/53 个 `KeyS+Space` pulse 的匹配落地 snapshot 都产生负向 x 位移，总计 `12.6305527329m`。下方 `1.35m` 是
failure attachment 内 256-sample Authority 尾窗的覆盖范围，不能外推为完整 leg。

trace 同时显示按键约保持 `82.748..91.688ms`，但因每次 jump 后等待 grounded，pulse 起点间隔为
`751.243..900.944ms`；首次 pulse 前还发生约 2.45s 的 PointerLock/视角校正。故 Browser-16 可证结论是：方向输入
持续到达并推进，但 `KeyS+Space` 的落地等待节奏使固定 `19.9630739258m` leg 未能在 45 秒内完成；不是停滞、
server lag 或资源碰撞。Browser-16 仍为 FAIL，采矿以后仍 NOT REACHED。本勘误不改其 raw、SOURCE/MANIFEST 或历史
正文，只 supersede 该诊断句；精确六个代表 pulse 与 53 pulse 汇总在 CLOSE-04 新证据目录。

## Browser-16 正式验收

阶段：`V2-CANONICAL-BROWSER-16`

结论：**FAIL。C0-C3 与完整 V1 test step 本次真实通过；V2 只完成 workbench 和 10 格资源带放置，在首个 wood
batch 进入资源循环前返回 workbench corridor `[78.5,-0.5]` 时耗尽 45 秒真实输入路线。** Classic 视觉测试独立
通过。本结果不证明采矿、合成、装备 pointer、C4/C5、保存恢复、16 件护甲、194 项矩阵、Cua、人类听觉或性能。

验收树 `/private/tmp/seedlands-v2-acceptance-65938068`，HEAD/source
`659380680628520f6b662b66129a594f5001b612`，tree `b7996a7004e7bc9894a051cfedc161b34cbf443b`；
source/lock/artifact digest 为
`c79b1bf7019ef3b4d5ca44b3dad0ca19e3280eaf57fd6bd9cc97ebbe5af0345c`、
`44db46fb0f159ebe6d88435c8cfb5d46127d1c7f363a50d19217d454c30e1169`、
`f6f1ea672dc8d19dacf70482aa900538c6d81f33637c16e9a718fc22fc1acfa4`。artifact receipt SHA256 为
`b55c1d89e3eb10c0014af086f6b09a49a2b4cc1bdf98793f65fcdab844af20ca`，builtAt
`2026-09-26T03:53:19.146Z`，dist 为 276 个盖章文件/277 个磁盘文件且无 symlink。Pack lock 与 MP3 SHA256
分别为 `f362a074758f751d828d3881d9427a0945ae5efbce3237dfd3e287d24676c16f`、
`3c69ae745727607de266898ab68a92c7c75f7f08e27daf0c6cec463f7bd119c9`。

精确命令：

```sh
env SEEDLANDS_HARNESS_RUN_ID=v2-canonical-browser-16-65938068 node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm harness:classic
```

机器窗口 `da2aac87-8432-4039-b0ea-a404f803e6fe`，UTC `2026-09-26T04:09:20.018Z` 至
`2026-09-26T04:17:03.079Z`，`waitedMs=1`、`exitCode=1`、`measurement.status=NOT_RECORDED`。
Playwright 单 worker/单 Chromium/`retries=0`，结果 `1 failed / 1 passed / 1 skipped`；canonical 主测试只有
attempt 0，没有第二 attempt。

V1 test step 真实完成，覆盖本次水桶放收、门 entry/exit readiness、upper 关闭、lower+exit face 重开和
jukebox/record/media；这仍只是既有只读投影合同，不称 Authority readiness 或跨 owner 原子事务。V2 receipt 最后且
唯一 phase 为 `resources-placed`，armor 四槽为空、cursor 为空；随后 `mineResources:242` 尚未进入首个 wood
循环，就先走公共 workbench corridor waypoint `[78.5,-0.5]` 并失败。因此 wood/stone/iron 采集、两把镐、
iron unpack、五件铁甲与所有 equipment pointer 手势均 NOT REACHED，不能按 Playwright step 标题倒填为通过。

trace 显示该 corridor leg 持续发送真实 `KeyS+Space`。Authority 256-sample trajectory 从
`[87.18252119286404,33.625001,-0.5097974215475533]` 前进到
`[85.832521192864,32.600001,-0.5109755187512944]`，之后多个跳跃周期 x 保持
`85.832521192864`；failure attachment 的 client/server 位置一致，ack 为 `17784`、grounded true、colliding
false、velocity `[0,0,0]`。可证明真实输入已到达 Authority 且先有 1.35m 净进展后停滞，但 attachment/trace
未序列化阻挡 voxel、碰撞法线或逐脉冲 matched snapshot，不能进一步断言是已知资源碰撞、server lag 或产品移动缺陷。
最后帧显示平整 corridor，已放资源位于 z=2；不得复用 Browser-15 的资源阻挡归因。

Close-03 的 server-only projection bounded-wait 分支本次未触达：失败时 client 自身仍远离 waypoint，处于真实
`walkTo` 阶段。最窄后续应先由 root 冻结同一 leg 的确定性 fixture 诊断，记录每个真实 pulse 的方向、matched
client/server 位置、tick/ack 与附近只读 voxel，再决定路线建模；不得先增 timeout、随机 fallback 或修改通用
`walkTo`。

| 域                                                                  | Browser-16 结果                       |
| ------------------------------------------------------------------- | ------------------------------------- |
| C0-C3                                                               | PASS；receipt 明确记录                |
| V1 水桶、门 readiness/upper/lower/exit-face、jukebox/record/media   | PASS；完整 test step 已返回           |
| V2 workbench 与 10 格资源放置                                       | PASS；receipt 记录 `resources-placed` |
| 首个 wood batch 前 corridor 回程                                    | FAIL；真实输入已 ack 后路线停滞       |
| wood/stone/iron 采矿拾取、两把镐、iron unpack、五件铁甲             | NOT REACHED                           |
| 四槽 click/Shift、wrong-slot、swap、脱穿、close settlement          | NOT REACHED                           |
| C4、C5、`before.v2EquipmentPreSave`、save/restore、双 epoch、新 ref | NOT REACHED                           |
| Classic 视觉 v3                                                     | PASS，31.5 秒                         |
| non-Classic smoke                                                   | SKIPPED                               |
| Close-03 server-only projection wait                                | NOT OBSERVED                          |
| death、durability-1、drop、respawn                                  | NOT OBSERVED                          |
| Cua、人类听觉                                                       | NOT RUN                               |
| 性能                                                                | NOT MEASURED                          |

失败 attachment schema 不含 pageErrors/failedResponses，二者为
`NOT_RECORDED_BY_FAILURE_ATTACHMENT`。trace 为 774153112 bytes，SHA256
`5ce02c71e564d498bb6c5d030c9dbe8d26aab442e1a85fe19f7c87c06e5aab41`。未发布 evidence commit
`a402b016...` 的六个 128 MiB/末片约 98 MiB 分片被 GitHub `GH001` 拒绝；旧包装元数据原字节归档在
`prior-packaging/`，旧 commit 由本地 `refs/task-backups/git32-evidence-a402b016` 保留且不推送。当前 `trace-50m/`
含 15 个最大 50 MiB 的新分片，流式重组仍为同一 774153112 bytes/SHA，Browser 未重跑且 FAIL 结论不变。runner 原始
14 个输出记录、2 条 exec lifecycle 与 13 次 terminal interaction 按 process `18806` 归档。

锁内 `harness:artifact` 后验窗口 `v2-canonical-browser-16-artifact-postcheck` PASS，UTC
`2026-09-26T04:23:19.665Z` 至 `2026-09-26T04:23:22.472Z`，同 source/lock/artifact digest 与
276-file map。后验验收树 tracked/index clean，4273 无监听，本树 Playwright/Chromium/preview 为 0，benchmark lock
absent；本 tree/dist 与旧验收树保留。本轮未修改 source/test/scenario/dist，也未 build、第二 attempt、Cua、CI、
Git/index、push、deploy 或 merge。Browser lease 在证据封存后释放。

## Browser-15 正式验收

阶段：`V2-CANONICAL-BROWSER-15`

结论：**FAIL。V1 门同轮 readiness 与 lower exit-face 已在本次真实产品旅程中通过；V2 只完成固定资源带放置，
首个原木的采矿辅助走位被已放置资源阻挡，尚未发送采矿输入。** Classic 视觉测试独立通过。本结果不证明完整 V2、
16 件护甲、194 项矩阵、Cua、人类听觉或性能。

验收树 `/private/tmp/seedlands-v2-acceptance-25adda5b`，HEAD/source
`25adda5becbcab339a8364bbd23ac86ace3d8d8e`，tree `0acd81acafa1f60f477925483102f115699fa5f4`；
source/lock/artifact digest 分别为
`74752aed3e6df9973b3e70e26fe2cb1d1566c56b469e1da9a404777452c1e3a4`、
`44db46fb0f159ebe6d88435c8cfb5d46127d1c7f363a50d19217d454c30e1169`、
`fc7ac0053fd73c08035e95b41d39bf80889c7e23155a9e14d88a096f0b54f6e2`。artifact receipt SHA256 为
`e41cdee53b0242e00a347ab6a6ee74d40ea661d96a45b84742c94a6106fee45d`，builtAt
`2026-09-26T01:43:48.170Z`，dist 为 276 个盖章文件/277 个磁盘文件，无 symlink。

精确命令：

```sh
env SEEDLANDS_HARNESS_RUN_ID=v2-canonical-browser-15-25adda5b node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm harness:classic
```

机器窗口/run ID `129ac7e8-effb-44a0-a011-3a8f56076510`，UTC
`2026-09-26T02:04:29.646Z` 至 `2026-09-26T02:09:17.707Z`，`waitedMs=1`、`exitCode=1`、
`measurement.status=NOT_RECORDED`。Playwright 单 worker/单 Chromium/`retries=0`，结果
`1 failed / 1 passed / 1 skipped`；canonical 主测试只有 attempt 0。

V1 test step 真实完成，因而同轮 readiness 的 client ready、client/server 完整 voxel entry/exit 边界、fresh
physics tick 与 ack 不倒退条件，以及随后 upper 关闭、lower+exit adjacent 严格同轮目标、真实右键重开、
jukebox/record/media 均越过此前阻断点。这只证明一次 Harness snapshot 内的 client/server 投影满足合同，不称为
Authority 独立 readiness 或跨 owner 原子事务。

V2 已经用正式 UI 与真实输入放置 workbench 和 3 原木、3 石块、4 铁块，receipt 的唯一 V2 step 为
`resources-placed`。随后首个原木 target `[80,31,2]` 进入 `mineVoxel`；因当前位置不在 2.5-4.5 距离范围，helper
推导 approach `[77.2,2.5]` 并选择 `KeyS`。已放置的原木位于 player 与该 approach 的直线路径上；trace 中 fresh ack
的 KeyS 脉冲把 x 从约 `83.60` 推到 `81.32` 后不再减少，而 z 继续漂到约 `2.50`，最终耗尽既有 15 秒 helper
route budget。失败前没有进入 voxel aim，也没有发送 left mouse down，因此不能称 Authority mining 拒绝或装备 pointer 失败。
最窄后续由 root 另行冻结 V2 资源采集 approach/路线；不得据此修改通用 `walkTo` 或增加 timeout。

| 域                                                                            | Browser-15 结果                       |
| ----------------------------------------------------------------------------- | ------------------------------------- |
| C0-C3                                                                         | PASS；Harness receipt 明确记录        |
| V1 水桶、门 entry/exit readiness、upper/lower/exit-face、jukebox/record/media | PASS；完整 test step 已返回           |
| V2 workbench 与 10 格资源放置                                                 | PASS；receipt 记录 `resources-placed` |
| 首个原木采矿辅助走位                                                          | FAIL；尚未发送采矿输入                |
| 木/石镐、其余采集、iron unpack、五件铁甲合成                                  | NOT REACHED                           |
| 四槽 click/Shift、wrong-slot、swap、脱穿、close settlement                    | NOT REACHED                           |
| C4、C5、`before.v2EquipmentPreSave`、restore/双 epoch/新 ref                  | NOT REACHED                           |
| Classic 视觉 v3                                                               | PASS，31.2 秒                         |
| non-Classic smoke                                                             | SKIPPED                               |
| death、durability-1、drop、respawn                                            | NOT OBSERVED                          |
| Cua、人类听觉                                                                 | NOT RUN                               |
| 性能                                                                          | NOT MEASURED                          |

失败 attachment 不含 pageErrors/failedResponses 字段，二者记为
`NOT_RECORDED_BY_FAILURE_ATTACHMENT`。原始 trace 为 413834226 bytes，SHA256
`e123610dcb014804b9b4f2ce6de96ce5a887f002a99bd65911e13a113097d612`；四片重组已验证。失败 attachment 的
client/server 位置为 `[81.31999969482422,32.599998474121094,2.495638370513916]` 与
`[81.3200007042292,32.6,2.495638381730721]`；其中 `onGround=false` 是 afterEach failure attachment 状态，
不倒填为 15 秒 deadline 精确瞬间。

锁内 `harness:artifact` 后验窗口 `v2-canonical-browser-15-artifact-postcheck` 为 PASS，同
source/lock/artifact digest 与 276-file map。runner 结束后验收树 tracked/index clean，4273 无监听，owned
Playwright/Chromium/preview 为 0，benchmark lock absent；本 tree/dist 与旧验收树均保留。本轮未修改
source/test/scenario/dist，也未 build、第二 attempt、Cua、CI、Git/index、push、deploy 或 merge。Browser lease 在证据封存后释放。

## Browser-14 正式验收

阶段：`V2-CANONICAL-BROWSER-14`

结论：**FAIL。Browser-13 的 lower-center 遮挡尚未进入验证；唯一 canonical attempt 在同一 V1 门穿越后的第二次
readiness 采样失败，V2 全部未触达。** Classic 视觉测试独立通过。本结果不替代 Cua、人类听觉或性能验收。

验收树为 `/private/tmp/seedlands-v2-acceptance-0a0a6318`，HEAD/source
`0a0a63188805f0a7d96221a841e2b6292fa97205`，tree `ab92a25e22c025d65a4948e469ededf29a6e4c71`；
source/lock/artifact digest 分别为
`c86e64716b9bd29f79bcf7897437342f97766faaa110907fd12046f9e0f64bc2`、
`44db46fb0f159ebe6d88435c8cfb5d46127d1c7f363a50d19217d454c30e1169`、
`fc7ac0053fd73c08035e95b41d39bf80889c7e23155a9e14d88a096f0b54f6e2`。artifact receipt SHA256 为
`869ad08581fec7c293523c51ae997041674ab0fba95bb5b9d99164ba434cc8e1`，builtAt
`2026-09-26T00:17:03.654Z`，dist 为 276 个盖章文件/277 个磁盘文件，无 symlink。

精确命令：

```sh
env SEEDLANDS_HARNESS_RUN_ID=v2-canonical-browser-14-0a0a6318 node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm harness:classic
```

机器窗口/run ID `f7a53699-300d-429c-a308-8c48399036df`，UTC
`2026-09-26T00:47:25.998Z` 至 `2026-09-26T00:50:04.147Z`，`waitedMs=1`、`exitCode=1`、
`measurement.status=NOT_RECORDED`。Playwright 单 worker/单 Chromium/`retries=0`，结果
`1 failed / 1 passed / 1 skipped`；canonical 主测试只有 attempt 0。

失败在 `v1-slice.ts:298`：收紧后的真实 `walkTo` 已返回一个 `onGround && !colliding` snapshot，fixture
立即调用 `doorAuthorityObservation` 再采样并断言相同布尔组合，该次结果为 false。该 helper 只有 position 来自
`serverPlayerPosition`，`onGround/colliding` 仍来自同一个顶层 client snapshot，故不能描述为 Authority 与 client
分歧。trace 未序列化第二次采样中具体哪个布尔为 false；约 10ms 后 failure attachment 又为
`onGround=true, colliding=false`。失败快照 client/server 位置分别为
`[71.60638427734375,32.60000228881836,0.5013126730918884]` 与
`[71.60638694230313,32.600001,0.5013126463361098]`，两者均已越过完整门体素的 `x=71` 出口边界。

首因分类为 **fixture 在真实跳跃移动后对瞬时 readiness 做非原子重复采样**。失败发生在 upper 再关闭之前，因此
lower exit-face aim/click 尚未执行，也没有 Authority lower toggle 可供评价。最窄后续应由 root 另行冻结：复用
`walkTo` 已返回且已校验的 client readiness，同时用紧随其后的 snapshot 只读取 Authority position；或等待一个
fresh stable snapshot 后一次性读取 position/readiness。不得放宽完整 voxel 出口断言、改变路线/预算或重跑本次。

| 域                                                                              | Browser-14 结果                     |
| ------------------------------------------------------------------------------- | ----------------------------------- |
| C0-C3                                                                           | PASS；Harness receipt 明确记录      |
| V1 音量、水桶、门放置、closed probe、首次打开、open mesh/no-collision、真实穿门 | PASS；失败行之前完成                |
| 穿门后第二次 readiness snapshot                                                 | FAIL；具体瞬时 false 字段未记录     |
| upper 再关闭、lower exit-face aim/click/reopen                                  | NOT REACHED                         |
| jukebox/record/media                                                            | NOT REACHED                         |
| V2 resource strip、采矿拾取、合成、装备矩阵                                     | NOT REACHED                         |
| C4、C5、`before.v2EquipmentPreSave`、restore/双 epoch/新 ref 脱穿               | NOT REACHED；`restoreEvidence=null` |
| Classic 视觉 v3                                                                 | PASS，32.0 秒                       |
| non-Classic smoke                                                               | SKIPPED                             |
| death、durability-1、drop、respawn                                              | NOT OBSERVED                        |
| Cua、人类听觉                                                                   | NOT RUN                             |
| 性能                                                                            | NOT MEASURED                        |

失败 attachment 不含 pageErrors/failedResponses 字段，二者记为
`NOT_RECORDED_BY_FAILURE_ATTACHMENT`。原始 trace 为 227649859 bytes，SHA256
`ca42ad29f2a3a003cba16ace578a987ec7ffea283802d70ba7bc22227e3d1aa5`；五片重组已验证。runner 原始 6 个输出块、
2 条 exec lifecycle 和 5 条 terminal interaction 均按 process `72318` 机械归档。

锁内 `harness:artifact` 后验窗口 `v2-canonical-browser-14-artifact-postcheck` 为 PASS，UTC
`2026-09-26T00:52:39.991Z` 至 `2026-09-26T00:52:42.444Z`，同 source/lock/artifact digest 与 276-file map。
最终验收树 tracked/index clean，4273 无监听，本树 owned Playwright/Chromium/preview 为 0，benchmark lock absent；
本 tree/dist 与其他验收树均保留。本轮未修改 source/test/scenario/dist，也未 build、第二 attempt、Cua、CI、Git/index、
push、deploy 或 merge。Browser lease 在证据封存后释放。

## Browser-13 正式验收

阶段：`V2-CANONICAL-BROWSER-13`

结论：**FAIL。唯一 canonical attempt 在完整 V2 旅程开始前，被 V1 门下半格重新瞄准的 fixture 边界阻断；本次不能评价
V2 装备路线。** Classic 视觉测试独立通过。该结果不替代 Cua、人类听觉或性能验收。

### 身份与执行

- 验收树：`/private/tmp/seedlands-v2-acceptance-00009bf2`
- HEAD/source：`00009bf26c821d115264d224899dafde0d6cc163`
- tree：`e263d29f14a607103c3a80a40a9b7bed4997c58d`
- source digest：`315820d63fc0ca323380ca45b6a537cb541842a41e396f3bfe94b0507d062dff`
- lock digest：`44db46fb0f159ebe6d88435c8cfb5d46127d1c7f363a50d19217d454c30e1169`
- artifact digest：`fc7ac0053fd73c08035e95b41d39bf80889c7e23155a9e14d88a096f0b54f6e2`
- artifact receipt SHA256：`fa846dd12d91662a0f64b6a109df4b9c366f94d18d5108de5e10f94d7ccfb92d`
- Pack lock SHA256：`d365ec8409eee8b1d0155cb0e0ec2fb6e966e1bf351696496314e5cac01950b7`
- MP3 SHA256：`3c69ae745727607de266898ab68a92c7c75f7f08e27daf0c6cec463f7bd119c9`
- build 时间：`2026-09-25T22:06:39.842Z`；dist 276 个盖章文件、磁盘 277 个文件，无 symlink。

精确命令：

```sh
env SEEDLANDS_HARNESS_RUN_ID=v2-canonical-browser-13-00009bf2 node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm harness:classic
```

机器窗口/run ID：`ca001977-b334-4fbc-962f-254c2bc44a46`，UTC
`2026-09-25T22:19:45.188Z` 至 `2026-09-25T22:23:10.346Z`，`waitedMs=1`，`exitCode=1`，
`measurement.status=NOT_RECORDED`。Playwright 为单 worker、单 Chromium、`retries=0`；结果为
`1 failed / 1 passed / 1 skipped`，canonical 主测试仅 attempt 0，没有第二 attempt。

### 首因

失败点为 `v1-slice.ts:293` 的 `aimAtVoxelWithRealMouse(page, door.lower)`，发生在穿过已打开门、用 upper
重新关闭之后和 lower 右键重新打开之前。固定 180 次真实 Pointer Lock 校正耗尽，最后 12 次 target-card 均为
upper `[70,32,0]`，未取得期望 lower `[70,31,0]`，因此 lower click 尚未发送。

失败快照为 player eye `[71.475830078125,32.60000228881836,0.502830982208252]`、view
`[-270.17999999999995,-48.37]`、grounded true、colliding false、worldRevision 144、interactionAttempts 15。
从该东侧眼位指向 lower center `[70.5,31.5,0.5]` 的射线，在门东侧平面 `x=71` 时高度为
`32.063623889792346`，仍位于 upper voxel。真实 trace 末段显示每轮都读取 target/Harness snapshot 并发送 mouse
move，但生产 target 持续为 upper。

首因分类为 **V1 canonical fixture 的下半格不可见 center 目标选择**，不是 V2 resource/equipment 失败，也未证明
Authority Structure 拒绝。本次失败前的 `interactionAttempts=15` 是累计值；lower click 尚未发生，不能将它当作
本次 lower Authority dispatch。最窄后续由 root 冻结：从门几何推导东侧 lower adjacent 并要求 exact target+face，
或用真实键盘移动到射线可进入 lower 的更远东侧固定位置；不得增加预算、随机 fallback 或第二路线。

### 触达矩阵

| 域                                                                      | Browser-13 结果                             |
| ----------------------------------------------------------------------- | ------------------------------------------- |
| C0、C1、C2、C3                                                          | PASS；Harness receipt 明确记录              |
| V1 音量设置与旧上传入口移除                                             | PASS；失败行之前内联断言完成                |
| 水桶放 source、空桶收 source                                            | PASS；失败行之前内联断言完成                |
| 门两格放置、closed mesh/collision、正交 Authority probe、entry retreat  | PASS；失败行之前内联断言完成                |
| 首次 upper+entry face 打开、open no-collision/mesh/revision、真实穿门   | PASS；失败行之前内联断言完成                |
| 穿门后 upper 关闭                                                       | PASS；下一行 lower aim 才失败               |
| lower 重新瞄准/点击/打开                                                | FAIL / NOT REACHED / NOT REACHED            |
| jukebox 放置、record fact/projection/headless audio                     | NOT REACHED                                 |
| V2 逐格资源放置、采矿拾取、3x3 合成                                     | NOT REACHED                                 |
| V2 四槽 click/Shift、wrong-slot、swap、脱穿、close settlement           | NOT REACHED                                 |
| C4 与装备不漂移                                                         | NOT REACHED                                 |
| C5、`before.v2EquipmentPreSave`、双 epoch 换代、装备恢复与新 epoch 脱穿 | NOT REACHED；receipt `restoreEvidence=null` |
| Classic 视觉 v3                                                         | PASS，31.7 秒                               |
| non-Classic smoke                                                       | SKIPPED，沿既有条件                         |
| death、durability-1、drop、respawn                                      | NOT OBSERVED；fixture 未定义                |
| Cua、人类听觉                                                           | NOT RUN                                     |
| 性能                                                                    | NOT MEASURED                                |

失败 attachment schema 只序列化 stages、errors、current、restoreEvidence 和 logicEvidence，不包含成功 receipt 的
pageErrors/failedResponses 字段；因此本次二者记为 `NOT_RECORDED_BY_FAILURE_ATTACHMENT`，不能补写为空数组。

### 原始证据与后验

目录：`changes/2026-09-23-classic-functional-completion/evidence/v2-canonical-browser-13/`。

- `classic.json.log`、`performance-window.json.log`、`playwright-last-run.json.log`、
  `canonical-error-context.md.log`、`classic-runtime-failure.json.log` 与 `harness-artifact.json` 均从验收树或
  trace attachment 原字节复制并核对。
- `runner-output.jsonl` 精确包含本次启动 call 和六次同 session 输出；`runner-exec-events.jsonl` 保留同 process
  的 backgrounded/final failed 两条 exec 事件，`runner-terminal-events.jsonl` 保留六次 wait 事件。
- 原始 trace 为 281535240 bytes，SHA256
  `5c382e5fd523e975859b1ee3642e762382eff70a7c61af160cb42a4d4a6d3115`；机械分为六片，按文件名字节序拼接已验证
  回到同一 SHA。`failure-page.jpeg` 从 trace 最后一个 JPEG entry 原字节提取，不冒充独立 Playwright screenshot。
- 直接执行一次 `pnpm harness:artifact` 后验为 PASS：source/sourceDigest/lockDigest/artifactDigest/276-file map 与
  build 时间均未漂移。该只读 verifier 不调用 benchmark wrapper，因此没有伪造 postcheck window receipt；原始
  tool output 与 exec event 已归档。
- 后验 HEAD/tree 保持上述身份，tracked/index clean；4273 无监听，本树 Playwright/Chromium/preview 无遗留，默认
  benchmark lock 不存在。验收树、dist 和全部旧树保留。

本轮没有修改 source/test/scenario/dist/baseline/timeout/retry，没有 build、第二 browser attempt、Cua、CI、Git/index、
push 或 deploy。Browser lease 在证据封存后释放。
