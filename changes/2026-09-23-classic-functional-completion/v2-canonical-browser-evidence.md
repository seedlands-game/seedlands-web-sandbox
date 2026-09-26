# V2 Canonical Browser 证据

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
