# 自然河岸与实体介质验收进度

## 用例合同

`e2e/natural-river-and-entities.spec.ts` 复用已验证的 `mosslight-68` 自然河岸坐标 `(30.5, 13.6, -30.5)`，不编辑河床或对岸几何。玩家只以真实 Pointer Lock 和键盘完成涉水、下潜、上浮及越岸：持续前进但不按 Space 时必须停在对岸台阶前，持续 Space 后才可离水并落地。用例保存未经修饰的岸边、涉水、水下、对岸截图、Playwright 视频、逐帧权威位置/速度/介质轨迹，以及由生产混音器 `MediaStreamDestination` 录制的水声 WebM。

同一自然河岸附近额外建立两个临时支撑，分别生成一个 `grazer` 和一个掉落物。生成与挖除支撑均走生产 Authority 命令和 `World.edit()`；结果只以 Authority Worker 每 tick 的身体位置、速度和 grounded 证明，不能由 Harness 写位置或伪造重力。相机仅为可见证据朝向目标，不作为行为结果。

## RED 与状态

- [x] 先写浏览器用例；`tsconfig.test` 因 Harness 没有逐实体权威身体只读端口产生 10 处预期 RED。
- [x] 增加只读 `authorityBody(entityId)`，它逐次复制当前 Authority snapshot 的 tick、位置、速度和 grounded，不产生世界写入。
- [x] `pnpm exec tsc --noEmit --pretty false`、`pnpm exec tsc -p tsconfig.test.json --noEmit --pretty false`、定向 ESLint、Prettier 与 `git diff --check` 通过。
- [ ] `pnpm build` 在本用例静态检查通过后，被并行 A7 未提交测试夹具 `tests/client/local-player-prediction.test.ts` 的 `LazyRevisionWorld.revisionVector` 返回类型阻塞；本任务不越权修改该文件。
- [ ] 主任务在不可变浏览器产物上运行并保存视频、截图、轨迹与生产音频。
