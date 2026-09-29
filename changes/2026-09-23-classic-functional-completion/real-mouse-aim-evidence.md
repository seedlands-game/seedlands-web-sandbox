# V1 真实鼠标瞄准闭环证据

阶段：`V1-REAL-MOUSE-AIM-CLOSE-01`
结论：**fixture 控制器与确定性回归完成，Browser 未验证。**

## Browser-08 RED 与根因

Browser-08 唯一正式窗口 `8c83c1ed-9482-464c-a2b0-89f70e52b78e` 在完整门旅程通过后，到达 jukebox approach 并选中 jukebox。目标 support 为 `[76,30,2]`、adjacent 为 `[76,31,2]`，玩家 eye 为 `[73.74300384521484,32.60000228881836,2.7646305561065674]`。`aimAtVoxelWithRealMouse` 在 180 次真实 PointerLock 校正内未命中，最后 target-card 在 `[75,30,2]` 与 `[75,30,3]` 间振荡，尚未调用右键；Browser-08 机器诊断 SHA256 为 `e39c8cb06fd27a1dae7198cbc837d9837432af949417097debc5b60acac0993d`。

Trace 最近失败段证明 PointerLock `Mouse move` 持续完成，不是执行层丢事件。旧算法用目标格中心 yaw 与当前离散命中格中心 yaw 的差值控制 dx：

- observed `[75,30,2]` 时 yaw 差约 `-3.0825°`，旧 dx 约 `+23.7115`；
- observed `[75,30,3]` 时 yaw 差约 `+28.1939°`，旧 dx 被限制为 `-80`；
- 最近绝对 mouse x 依次约 `107.65 -> 131.36 -> 155.07 -> 178.79 -> 202.50 -> 122.50 -> 146.21 -> 169.92`，而 y 持续为 `330`。

只要离散 yaw 差绝对值大于 2.5 度，旧分支只更新 dx，pitch 不更新；格子反馈变化因而持续抢占纵向校正。该证据确认了“离散横向振荡导致 pitch 饥饿”的根因假设。

## 实现

`target-aim.ts` 新增两个纯 fixture helper：

- `voxelAimPoint(target, adjacent?)`：验证坐标均为有限整数；有 adjacent 时要求 Manhattan 距离恰好 1，并取共享面向 hit 内侧 `1e-6` 的点；无 adjacent 时保持 voxel center。
- `matchesVoxelAim(observed, target, adjacent?)`：严格比较 aimed position；请求 adjacent 时也严格比较 adjacent。null、错误 target 或错误 adjacent 均不成功。

`aim.ts` 删除离散命中格 yaw/距离控制，每轮改用既有 `mouseCorrectionToPoint(playerSnapshot.player, playerSnapshot.viewAngles, aimPoint)` 同时计算有界 dx/dy。`snapshot.player` 已是 camera/eye，没有再增加 1.6。PointerLock 仍只经既有 `moveMouseBy` 执行，180 次预算与失败 history 不变。

成功判定收紧为单次页面 `evaluate` 同时读取 target-card 与 Harness aimed target；只有 target-card、aimed position 及可选 adjacent 全部精确匹配才返回。没有 set view、teleport、interaction 旁路、随机搜索或 fallback click。

## 确定性 RED / GREEN

单文件命令：

```sh
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm --filter @seedlands/web test apps/web/tests/e2e/classic-support/target-aim.test.ts --maxWorkers=1 --reporter=json --outputFile=<receipt>
```

- RED：窗口 `62da0fe3-6087-4c15-8334-e1d10d917023`，`2026-09-25T05:27:20.553Z` 至 `05:27:22.402Z`，exit 1；`11 tests / 6 passed / 5 failed`，五个新用例因 `voxelAimPoint` / `matchesVoxelAim` 尚不存在而失败。
- 首轮 GREEN：窗口 `3c193335-255e-453c-997c-1bb253b2a022`，`11/11 PASS`。
- 显式 tuple 修正后的最终 GREEN：窗口 `e6eb84b1-a6b9-4cef-9514-5f8abb386366`，`11/11 PASS`。
- 机械格式化后的最终复验：窗口 `ce2a1d8d-9635-432f-b180-f6c9f95a3b21`，`11/11 PASS`。

测试使用生产 `traceVoxelTarget` 建立 floor ray：同一 Browser-08 player/view 与 180 次预算下，旧离散控制不收敛且 pitch 不变，新控制取得 exact `[76,30,2] + [76,31,2]`。另覆盖 top face、负轴侧面、yaw wrap、无 adjacent center，以及 null/错误 target/错误 adjacent/畸形 face 均不假成功。

## 类型与静态检查

- Classic type 首次窗口 `e03c718b-a37e-45b8-a323-360b3bbf9723` 为 exit 2，暴露 5 个 readonly tuple / `Array.map` 长度类型问题；修为显式三元素 tuple 后，窗口 `fc9c492f-ae1a-4cbb-80c8-8fa63b41153b` PASS，机械格式化后最终窗口 `5a1a7ab7-28b2-43f3-bfb6-8ce6821beef3` PASS。
- Root-test type 窗口 `5950d1e1-0084-4325-81be-1dc8db7d98cd` PASS；机械格式化后最终窗口 `f6a4d814-884a-4317-85f8-1919e3f45592` PASS。
- 定向 ESLint 窗口 `191129cd-a856-43f5-bd2d-f09c2eecb839` PASS；最终窗口 `90a74d00-a291-4f2c-8a11-f4906b9ba200` PASS。
- Prettier 首检窗口 `8f993dd0-e411-467a-8056-7397e3b8ef49` 仅报告 `target-aim.test.ts` 格式差异；窗口 `a0f5eeb7-0590-489e-8293-ab127a3f92c5` 只机械格式化该文件；最终窗口 `0553026f-49d1-4ea8-9bcc-c57c72ae2ffb` PASS。
- Scoped `git diff --check` 窗口 `7171bb2d-ef00-4346-9a3f-15d8bd29570f` PASS。
- 写完本 evidence 后的 evidence-inclusive Prettier 终检窗口 `7f87131d-c348-42c7-b18c-1cc66e09185c`（`2026-09-25T05:37:35.608Z` 至 `05:37:36.045Z`）PASS；命令通过 `benchmark-window` 锁内执行 `pnpm exec prettier --check`，覆盖 3 个 fixture 文件、spec、contract 与 evidence。
- 同一 6 文件的 evidence-inclusive scoped `git diff --check` 终检窗口 `7224c40d-d576-42c6-910d-d981d6893ec0`（`2026-09-25T05:37:42.080Z` 至 `05:37:42.100Z`）PASS；该命令使用独立 `benchmark-window` 锁，未与前一命令用 `&&` 串联。

所有原始 JSON 测试结果、stdout 和机器窗口 receipt 位于 `evidence/v1-real-mouse-aim-close-01/`，失败与成功均保留。

## 边界

- 未修改 `mouse-input.ts`、`harness.ts`、`v1-slice.ts`、scenario、production、坐标、timeout 或 180 次预算。
- 未运行 browser、build、Cua、dev server、CI、Git commit/push 或业务全套。
- 当前只可称“fixture 控制器与确定性回归完成”。真实 PointerLock 收敛、jukebox、media、C4/C5 与保存恢复仍须 954 生成新 identity artifact 后由唯一 Browser-09 验证。

## GIT-16 隔离合并门禁

从远端基线 `94f54543cfedd1155afbc715b29b6542a1f6b9c0` 创建
`/private/tmp/seedlands-git16-aim`，并应用 59 路径 binary patch
`bb5e157af00aedd62b92edd582b69cc89caf96fe6c68c4e6f95a53eb8ccdcc86`。根与 Web
workspace 的 `@seedlands/stdlib` 均实际解析到该隔离树的 `packages/stdlib`；第三方 `.pnpm`
store 只读复用，task-run-state 为真实目录。

- target-aim：窗口 `3816c40b-6a0e-422f-a192-4927f49f7d80`，`2026-09-25T05:44:15.548Z`
  至 `05:44:18.240Z`，`1 file / 11 tests PASS`。
- Classic test types：窗口 `a512dcc4-33fa-4b99-97c7-8eea45744be9`，
  `05:44:35.715Z` 至 `05:44:39.149Z`，PASS。
- root test types：窗口 `ed7a5fb2-4052-4aaa-8f6d-d049abf53a04`，
  `05:44:39.180Z` 至 `05:44:41.968Z`，PASS。
- 3 个 fixture TS ESLint：窗口 `fcb49bea-a1f5-434d-ae8c-b852292a92c5`，
  `05:44:42.001Z` 至 `05:44:43.677Z`，PASS。
- 可编辑白名单 Prettier：初次窗口 `4e5643ef-3446-4041-bca4-789268ac8764` 只因本批新增
  `execution-state.md` 行格式退出 1；锁内仅机械格式化该文件后，最终窗口
  `9fca4eb6-2f0f-45ea-a39a-f7463bfcc6f2`，`05:45:28.913Z` 至 `05:45:29.455Z`，PASS。
- 完整 staged diff 窗口 `f58fb438-e7a3-497f-b872-066759140449` 只报告 Browser-08 原始
  `canonical-error-context.md.log` 的采集时尾随空格；为保持原始字节未改写。排除原始 raw/log/trace
  后，对 3 个 TS 与可编辑 Markdown/state 的 scoped diff 窗口
  `12c55a8d-1ee7-4c22-9298-5a171ce8a616`，`05:46:16.765Z` 至 `05:46:16.793Z`，PASS。

上述窗口 `measurement.status` 均为 `NOT_RECORDED`，不构成性能验收。GIT-16 合并门禁仍不证明
真实 PointerLock 或产品旅程 GREEN；Browser-09 尚未运行。
