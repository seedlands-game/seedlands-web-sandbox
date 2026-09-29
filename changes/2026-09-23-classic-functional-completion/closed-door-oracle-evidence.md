# V1 关闭门碰撞 Oracle 闭环证据

阶段：`V1-CLOSED-DOOR-ORACLE-CLOSE-01`

结论：**fixture 修正、确定性反例与静态验证完成；Browser 未验证。**

## Browser-09 RED

Browser-09 唯一正式窗口 `c95e4fa0-e195-4c43-88e5-1f011dbee53e` 在门 support/lower 的真实 PointerLock 瞄准、两格放置、closed descriptor 与双 Chunk mesh/epoch 通过后，于 `expectClosedDoorBlocks()` 失败。诊断 SHA256 为 `c4e3ac0e4583ab07a2a1d7ea320d8d007e08f877e95ddf8dfb89df143cee99f8`；Browser-09 保持 FAIL，本阶段未重跑 browser。

旧 fixture 在 `[68.46859339486005,32.6,-0.4489545940748269]`、view `[-107.94,-35.5]` 直接持续 `W` 1.5 秒。closed voxel `93` 的 collision box 为 local x `[0.8125,1]`、z `[0,1]`，player half-width 为 `0.32`，理论接触中心 x 是 `70.4925`。Authority trajectory 实际在 x=`70.49249948474204` 停住，但 z 从 `0.7199951193123576` 滑至 `1.32061353847437`，绕过门边后 x 继续增长。因此失败是 fixture 斜向路径/最终 x oracle 误报，不是闭门碰撞完全失效。

## 实现

`door-collision-oracle.ts` 是 test-only 纯 helper：

- 从实际 door cell、registered collision box 和 player AABB 推导法向/横向轴、近侧接触面、门前 approach、法向 route target 和安全 corridor。
- corridor 与接触容差直接复用 physics `COLLISION_EPSILON * 4`，不引入无依据的宽松常量。
- `assessClosedDoorProbe()` 只在起始 body 落地且非 colliding、全部采样在安全 corridor、ack 新鲜、法向推进超过 `0.25`、到达接触面且继续至少 6 个 Authority physics tick 不穿透时返回 `blocked`。

`v1-slice.ts` 仍走正式输入路径：

- 放置后先重读门 pair 和实际 descriptor，以 `bodyConfigFor('player')` 取 player half-width。
- 复用 `walkTo` 将玩家对齐门前中线，再复用 `correctMouseToRoute`/`moveMouseBy` 通过 PointerLock 把 `W` 对准门法向；yaw 剩余误差必须小于 1 mouse unit。
- 只读取 Authority `serverPlayerPosition`、physics tick 和 acknowledged input sequence。`KeyW` 的内部上限是 1.25 秒/75 ticks，为 `keyup` 与末次 readback 保留 250 ms，不超过原 1.5 秒总 pulse 预算；由 `requestAnimationFrame` 驱动新 tick 采样，`keyup` 始终在 `finally`。
- 旧 open/toggle/no-collision/真实穿门/上下 half、jukebox/media、C4/C5/save 流程和断言保持原样。

## RED / GREEN

定向命令：

```sh
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm --filter @seedlands/web test apps/web/tests/e2e/classic-support/door-collision-oracle.test.ts --maxWorkers=1 --reporter=json --outputFile=changes/2026-09-23-classic-functional-completion/evidence/v1-closed-door-oracle-close-01/door-oracle-red.json.log
```

- 可执行 RED：窗口 `77caf3df-b809-43c0-b35f-708893640169`，`2026-09-25T06:25:07.234Z` 至 `06:25:08.222Z`，exit 1；1 suite 在 collect 阶段因 `./door-collision-oracle` 不存在而失败，0 tests 执行。
- 首轮实现后窗口 `ca584820-e767-4441-8abb-f62a6d6ad138` 和 `c4bc552a-ecca-406a-a203-af3239a2ce19` 均为 `6/7`，唯一失败是浮点派生值 `0.49999999999999994` 被测试用 deep exact 比较；修为逐坐标 `toBeCloseTo` 后窗口 `ad07cacf-cab9-4755-a260-457de1220339` 为 `7/7 PASS`。
- 随后用正式 physics epsilon 取代无依据余量，并加入 `sweepBodyThroughWorld` closed/open 对照、Z-normal 门与 body-ready 反例。最终联合命令：

```sh
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- sh -c 'pnpm --filter @seedlands/web test apps/web/tests/e2e/classic-support/door-collision-oracle.test.ts apps/web/tests/e2e/classic-support/route-progress.test.ts apps/web/tests/e2e/classic-support/target-aim.test.ts --maxWorkers=1 --reporter=json --outputFile=changes/2026-09-23-classic-functional-completion/evidence/v1-closed-door-oracle-close-01/fixture-regressions-fixed-2.json.log 2>&1 | tee changes/2026-09-23-classic-functional-completion/evidence/v1-closed-door-oracle-close-01/fixture-regressions-fixed-2.stdout.log; exit ${PIPESTATUS[0]}'
```

窗口 `4b33a460-5df9-4ab2-9ca0-1c553a3fa408`，`2026-09-25T06:47:09.319Z` 至 `06:47:10.409Z`，`6 suites / 23 tests PASS`。其中 closed-door oracle 10 例，route 2 例，target-aim 11 例。

oracle 定向覆盖：X/Z 两种门法向；真实 physics sweep 中 closed 停在接触面、open 穿过；正交 fresh 接触 PASS；Browser-09 斜向滑边、无碰撞穿越、未推进、横向越界、旧 ack、起始未落地/已 colliding 均不 PASS。

## 类型与静态

- Classic test types 首轮窗口 `5289d54d-94b3-4a09-84ff-afc470c7ae7b` 为 exit 2，只报告旧 `snapshot` import 在新接线后未使用；删除重复 import 后通过。
- 最终 Classic test types：窗口 `65a9a986-7688-42de-b5dc-2b763b1e8d60`，PASS。
- 最终 root-test types：窗口 `6b1c8c5b-33dc-4489-b190-5f638ca23f49`，PASS。
- 最终 3 个 fixture TS ESLint：窗口 `0517dd86-ca99-4632-8ec4-662a2dd7fff0`，PASS。
- 最终代码/合同/evidence 机械格式化：窗口 `14cc9e42-f120-4e78-bcc1-a4bd4e28c124`，PASS。

最终命令分别为：

```sh
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- sh -c 'pnpm typecheck:classic 2>&1 | tee changes/2026-09-23-classic-functional-completion/evidence/v1-closed-door-oracle-close-01/typecheck-classic-fixed-2.log; exit ${PIPESTATUS[0]}'
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- sh -c 'pnpm exec tsc -p tsconfig.test.json --noEmit 2>&1 | tee changes/2026-09-23-classic-functional-completion/evidence/v1-closed-door-oracle-close-01/typecheck-root-test-fixed-2.log; exit ${PIPESTATUS[0]}'
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- sh -c 'pnpm exec eslint apps/web/tests/e2e/classic-support/v1-slice.ts apps/web/tests/e2e/classic-support/door-collision-oracle.ts apps/web/tests/e2e/classic-support/door-collision-oracle.test.ts 2>&1 | tee changes/2026-09-23-classic-functional-completion/evidence/v1-closed-door-oracle-close-01/eslint-fixed-2.log; exit ${PIPESTATUS[0]}'
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec prettier --write apps/web/tests/e2e/classic-support/v1-slice.ts apps/web/tests/e2e/classic-support/door-collision-oracle.ts apps/web/tests/e2e/classic-support/door-collision-oracle.test.ts changes/2026-09-23-classic-functional-completion/spec.md changes/2026-09-23-classic-functional-completion/closed-door-oracle-contract.md changes/2026-09-23-classic-functional-completion/closed-door-oracle-evidence.md
```

以上重命令均各自通过默认 `benchmark-window` 机器锁串行执行，Vitest 使用 `--maxWorkers=1`。原始 JSON、stdout 与 window receipt 均保留在 `evidence/v1-closed-door-oracle-close-01/`，包括上述 RED 和中间失败。

## 边界

- 未修改 production、`harness.ts`、`target-aim.ts`、`mouse-input.ts`、scenario、`classic-runtime.spec.ts`、坐标、timeout 或 180 次 aim 预算。
- 未运行 browser、build、Cua、dev server、CI、Git/index/push 或其他业务 suite。
- 当前只可称 fixture/oracle 确定性和静态 GREEN。真实正交路径、后续门 toggle/traverse、jukebox aim/media、C4/C5/save 仍须 954 完成 GIT17/BUILD11 后的唯一 Browser-10。

## 最终文件身份

- `apps/web/tests/e2e/classic-support/v1-slice.ts`：`9d20a58f56e00b338e2bc232a6b07c9bb1b3f7c25459ea113d4405d4cbdfdfc1`
- `apps/web/tests/e2e/classic-support/door-collision-oracle.ts`：`34a5c1f0917e5d0509fe575ba841d8a7972d4b7c4a0d94abeeffb8d1ff582946`
- `apps/web/tests/e2e/classic-support/door-collision-oracle.test.ts`：`ddc888c5b009530ff001dbc6f5f4f7777b0533655e627805554d30c83826daa9`
- `changes/2026-09-23-classic-functional-completion/spec.md`：`6374026a14532a63fe02b020a7aa0b46e6d06c7f5a8d9c73b3a86c9489162969`
- `changes/2026-09-23-classic-functional-completion/closed-door-oracle-contract.md`：`9d3893a467528160e135ae6adc31189e941f0ebbc46a78b0a6a9072df4dfe930`

`closed-door-oracle-evidence.md` 在 evidence-inclusive 格式/diff 终检后另取最终 SHA256，以 checkpoint manifest 为准。

## Evidence-inclusive 终检

- 上述 3 个 fixture TS、spec、contract 和本 evidence 的 Prettier 终检窗口 `35a2143b-7af9-4d76-8fc2-606b158cb0bc` PASS。
- 已跟踪的 `v1-slice.ts` / `spec.md` scoped `git diff --check` 窗口 `ed8a94ce-ad89-466b-b5b4-65c9c66a3298` PASS。
- 新 helper/test/contract/evidence 逐文件 `git diff --no-index --check` 窗口 `9a1bfb33-f98f-484e-8caf-6d28a98616da` PASS。

## GIT-17 隔离合并门禁

从基线 `d958f1026d46a875e0737258858925bce76b93e9` 创建
`/private/tmp/seedlands-git17-door-oracle`，应用 112 路径 binary patch
`a16f15412c269a333cd19eea62f4b29c6c457c7c378b9aec575f9e61188f8600`。根与 Web
workspace 的 `@seedlands/stdlib` 均解析到隔离树自身源码；第三方 `.pnpm` store 只读复用，
task-run-state 为真实目录。

- oracle 10 + route 2 + target-aim 11：窗口 `6d96984a-3b35-44ff-ada3-691804498977`，
  `2026-09-25T06:56:20.474Z` 至 `06:56:23.436Z`，`6 suites / 23 tests PASS`。
- Classic test types：窗口 `6f893216-b420-4840-9190-3b24cec5e38b`，
  `06:56:38.371Z` 至 `06:56:41.902Z`，PASS。
- root test types：窗口 `c2d0cdb5-5544-44a5-b371-4f8b2d5be4ee`，
  `06:56:41.935Z` 至 `06:56:44.710Z`，PASS。
- 3 个 fixture TS ESLint：窗口 `bf839e37-64b0-4d03-b05c-3e68a4a1d2ef`，
  `06:56:44.743Z` 至 `06:56:46.437Z`，PASS。
- Prettier 首次窗口 `496dcc3d-899f-42e5-94e0-28ae4122b925` 只因本批新增的
  `execution-state.md` 行格式退出 1；锁内仅机械格式化该文件后，最终窗口
  `bab5ee0e-5d71-4027-99e4-c0ed3f466f85`，`06:57:35.977Z` 至 `06:57:36.560Z`，PASS。
- 3 个 TS 与可编辑 Markdown/state 的 scoped diff 窗口
  `6c0f05ac-91b9-443b-808d-6dbaa26b6489`，`06:57:36.591Z` 至 `06:57:36.618Z`，PASS；
  Browser-09 原始 JSON/stdout/context/trace 不格式化、不改写。

上述窗口 `measurement.status` 均为 `NOT_RECORDED`，不构成性能验收。该合并门禁仍不证明
Browser-10 的正交真实输入路径、门后续 toggle/traverse 或 Media/save GREEN。
