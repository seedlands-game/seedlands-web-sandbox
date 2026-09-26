# V2 Canonical Browser 证据

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
