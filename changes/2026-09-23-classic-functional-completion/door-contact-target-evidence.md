# V1 门接触位 Toggle 目标闭环证据

阶段：`V1-DOOR-CONTACT-TARGET-CLOSE-01`

结论：**fixture 目标选择与静态验证完成；Browser 未验证。**

## Browser-10 RED

Browser-10 唯一正式窗口 `af18e91d-2d06-48f5-8350-1b95eadbe25d` 在真实正交 closed-door probe 通过后，于 `aimAtVoxelWithRealMouse(page, door.lower)` 失败。结束位置为 player `[70.49250030517578,32.599998474121094,0.4989718496799469]`、server `[70.49249900119875,32.6,0.4989718402279727]`，view `[-97.8,-88]`；最后 12 次 target-card 全部为 upper `[70,32,0]`，`interactionAttempts=13` 没有增加，右键/toggle 尚未发送。诊断 SHA256 为 `33d89bf5ed78984cbf3c7ae3cc0e73ed2f631758468df70766562f369b53f111`。

归属为 fixture target selection：接触位的 eye y=`32.6` 处于 upper voxel cell，upper 是稳定的精确 target；从这个位置强制瞄准 lower center 会被 upper 遮挡。本证据不将未调用的 Structure toggle/Authority 定性为产品失败。

## 修正与覆盖保留

`apps/web/tests/e2e/classic-support/v1-slice.ts` 仅修改 `expectClosedDoorBlocks()` 后紧邻的首次 toggle 目标：

```diff
- await aimAtVoxelWithRealMouse(page, door.lower);
+ // The collision probe ends with the camera inside the upper door cell, which is the visible target here.
+ await aimAtVoxelWithRealMouse(page, door.upper);
```

该路径仍使用原 `aimAtVoxelWithRealMouse` 的 exact target-card/Harness target 观察与真实 PointerLock，成功后才执行真实 canvas 右键。未增加动态 half fallback，未改 target/adjacent 判定、坐标、timeout 或 180 次预算。

后续断言保持原样：首次 upper toggle 后必须观察 door pair 变化、open descriptor 无 collision、mesh 旋转与 Chunk revision 增长；穿过后仍点 upper 关门、再点 lower 开门，仍覆盖上下 half targetability。jukebox/media、C4/C5、save-return-continue、runtime/developer epoch、resume/eject/cleanup 顺序与断言均未修改。

## 静态验证

所有命令分别通过默认 `benchmark-window` 机器锁串行执行，stdout 与 window receipt 保留在 `evidence/v1-door-contact-target-close-01/`。

Classic test types：

```sh
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- sh -c 'pnpm typecheck:classic 2>&1 | tee changes/2026-09-23-classic-functional-completion/evidence/v1-door-contact-target-close-01/typecheck-classic.log; exit ${PIPESTATUS[0]}'
```

PASS，窗口 `8dc009c8-28d8-440b-a9f1-fc26eeb3c221`，`2026-09-25T07:20:36.816Z` 至 `07:20:40.904Z`。

Root test types：

```sh
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- sh -c 'pnpm exec tsc -p tsconfig.test.json --noEmit 2>&1 | tee changes/2026-09-23-classic-functional-completion/evidence/v1-door-contact-target-close-01/typecheck-root-test.log; exit ${PIPESTATUS[0]}'
```

PASS，窗口 `2f206e29-1ccc-457a-8bf3-17ef84201a89`，`2026-09-25T07:20:47.552Z` 至 `07:20:50.471Z`。

`v1-slice.ts` 定向 ESLint：

```sh
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- sh -c 'pnpm exec eslint apps/web/tests/e2e/classic-support/v1-slice.ts 2>&1 | tee changes/2026-09-23-classic-functional-completion/evidence/v1-door-contact-target-close-01/eslint.log; exit ${PIPESTATUS[0]}'
```

PASS，窗口 `366efe5b-9fb8-44a5-90af-b58d57487072`，`2026-09-25T07:21:02.485Z` 至 `07:21:04.221Z`。

Prettier 机械格式化：

```sh
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec prettier --write apps/web/tests/e2e/classic-support/v1-slice.ts changes/2026-09-23-classic-functional-completion/spec.md changes/2026-09-23-classic-functional-completion/door-contact-target-contract.md
```

PASS，窗口 `620b46cf-665a-4348-87bc-25e4341e00ed`，`2026-09-25T07:21:11.105Z` 至 `07:21:11.566Z`，3 文件均 unchanged。

- tracked `v1-slice.ts` / `spec.md` scoped `git diff --check` PASS，窗口 `fbd6eb6c-0947-4685-8237-506649caac68`。
- 新 contract 显式 `git diff --no-index --check` PASS，窗口 `81088d63-9fb1-422a-af9f-739a94f5fa31`。

没有重跑既有 23 个 oracle/route/aim 行为测试：本阶段未修改 `door-collision-oracle.ts`、`target-aim.ts` 或任何行为 helper，且 root 明确要求无必要不重跑。Browser-10 作为该单行目标选择的真实 RED，不为该替换新增镜像 Vitest。

## 文件与边界

- `apps/web/tests/e2e/classic-support/v1-slice.ts`：`615f43f9862f1eb031a63125a2bdd7dbb440f5b8a72e7187c9b35900143fbc3a`
- `changes/2026-09-23-classic-functional-completion/spec.md`：`8a7734bd81fd52056a9c5cd5b133b1a799f1f28a030905df413bb1caf5bef106`
- `changes/2026-09-23-classic-functional-completion/door-contact-target-contract.md`：`edb1200d97b5b5cd6f2284ca489a4064ef3d58c8215d65cef5700454cfbb8f2e`

tracked diff 只有 `v1-slice.ts` `+2/-1` 与 spec `+2/-0`；另新增 contract/evidence 及本任务 raw receipts。未修改 production、scenario、Harness、aim/target-aim、closed-door oracle、`classic-runtime.spec.ts` 或 execution-state；未运行 browser、build、Cua、dev server、CI、Git/index/push/deploy。

当前只可称 fixture/static 完成。真实首次 upper toggle、open mesh/no-collision/traverse、后续 upper/lower、jukebox aim/media、C4/C5/save 需由 954 完成 GIT18/BUILD12 后的唯一 Browser-11 验证。

## Evidence-inclusive 终检

- `v1-slice.ts`、spec、contract 与本 evidence 的 Prettier 终检窗口 `2ec5186f-b655-4a13-a56d-f3467d784ac5` PASS。
- 已跟踪 `v1-slice.ts` / `spec.md` scoped `git diff --check` 窗口 `714a9adf-a2d6-4f36-adf0-feddf680a9f3` PASS。
- 新 contract/evidence 逐文件 `git diff --no-index --check` 窗口 `1a872db4-04c2-4db4-8ea3-f36f62fc99d4` PASS。

## GIT-18 隔离合并门禁

从基线 `eea4cdf27ba351b934bfcefc6ac54224a603b3f6` 创建
`/private/tmp/seedlands-git18-door-target`，应用 40 路径 binary patch
`95b77c7a1cb1bca51f4337faa00936280b7e6749c9c52a2f9ffa7e12bd09e1fc`。根与 Web
workspace 的 `@seedlands/stdlib` 均解析到隔离树自身源码；第三方 `.pnpm` store 只读复用，
task-run-state 为真实目录。

- Classic test types：窗口 `4d1cd3e1-f610-4bff-b8f0-2e1e7a69f150`，
  `2026-09-25T07:29:27.340Z` 至 `07:29:32.335Z`，PASS。
- root test types：窗口 `4d8e8851-7b0f-4124-83d4-6109b700281f`，
  `07:29:32.367Z` 至 `07:29:35.137Z`，PASS。
- `v1-slice.ts` ESLint：窗口 `80e3d397-bf27-4575-946e-6e91302be2da`，
  `07:29:35.172Z` 至 `07:29:36.920Z`，PASS。
- Prettier 首次窗口 `9c5691b3-368e-42ef-a451-2248ea9c5ca1` 只因本批新增的
  `execution-state.md` 行格式退出 1；锁内仅机械格式化该文件后，最终窗口
  `010ac3fe-fb8e-464d-9a52-2202d22e6237`，`07:30:12.727Z` 至 `07:30:13.296Z`，PASS。
- fixture TS、可编辑 Markdown/state 及 hooks 会读取的 Browser JSON 的 scoped diff 窗口
  `9ade83e9-cb4f-41fc-b836-2037cd00270c`，`07:30:13.328Z` 至 `07:30:13.355Z`，PASS；
  Browser-10 原始 JSON.log/stdout/context/trace 不格式化、不改写。

本阶段没有重跑 23 项 oracle/route/aim 行为测试，因为唯一代码差异只是既有 fixture 首次 toggle
目标从 lower 改为 upper，且 root 明确冻结无需镜像测试。上述窗口 `measurement.status` 均为
`NOT_RECORDED`，不构成性能验收；Browser-11 尚未运行。
