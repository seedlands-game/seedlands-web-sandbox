# V1 门接触位 Entry Face 闭环证据

阶段：`V1-DOOR-ENTRY-FACE-CLOSE-01`

结论：fixture、确定性回归与静态检查完成；未运行 Browser、build、Cua 或 CI。真实首次 toggle、门后旅程、Media 与保存恢复仍须 GIT19/BUILD13 后唯一 Browser-12 验证。

## Browser-11 RED 与根因

Browser-11 唯一正式窗口 `192d22bd-b0b2-4290-bfbf-3de62e2c9b86`、诊断 SHA256 `e6765a285c05266a421105194b9692a88d2b58394af2f19fad8edb0f69e9274c` 保持 FAIL。接触位 eye `[70.49249900007506,32.6,0.49733905377911297]` 位于 targetable upper `[70,32,0]` 完整体素 cell 内；生产 `traceVoxelTarget` 在 origin cell 立即返回 upper 且 `adjacent=null`。真实右键已发生，但 Web 在 Authority 前进入裸 `无法放置` fallback，门 `[93,94]` 与 `worldRevision=142` 不变。

本阶段先增加使用生产 ray、实际两格门 pair `93/94`、现有 `voxelAimPoint` / `mouseCorrectionToPoint` 的确定性反例。首次 RED 命令：

```sh
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- /bin/bash -o pipefail -c 'pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/tests/e2e/classic-support/door-collision-oracle.test.ts --maxWorkers=1 2>&1 | tee changes/2026-09-23-classic-functional-completion/evidence/v1-door-entry-face-close-01/red-door-entry-face.log'
```

窗口 `ce11103b-fb6d-4f2f-9364-85aa9582eb5c` 为 `FAIL/exit 1`，结果 `6 failed / 10 passed`；六个新用例均因 plan owner 尚无 `doorEntryAdjacent` 失败，既有十项 closed-door 回归继续通过。原始 stdout SHA256 为 `915edae977bf6819b2d0d0b23ab0b3bebad3550a50f87996a49d7f36fdea112f`。

## 实现与确定性 GREEN

- `door-collision-oracle.ts` 从同一 `ClosedDoorProbePlan.normalAxis/direction` 推导目标门格近侧的正交 adjacent，并提供检查 player/server 是否已退出 target 完整体素近侧边界的纯谓词；未改既有碰撞 assessment。
- `expectClosedDoorBlocks` 返回它实际使用的 plan。probe 全部原断言和 1.25 秒内部输入上限保持；调用方随后以现有 `walkTo`、真实 `KeyS` 回到 `plan.approach`，参数仍为 `tolerance=0.06`、`corridorTolerance=0.08`、`pulseMs=80`。
- 回退后先确认门仍 closed、client/Authority 均 grounded 且无碰撞，并且两者都已退出 upper 完整体素近侧边界；之后 `aimAtVoxelWithRealMouse(page, door.upper, entryAdjacent)` 必须得到同次 exact target+face，才发送真实右键。
- 测试用生产 `traceVoxelTarget` 证明 Browser-11 接触 eye 即使 upper target 成功也因 null adjacent 不能满足 strict face；并覆盖 X/Z 法向、正负近侧、`walkTo` 欧氏 `.06` 完成域与 canonical `KeyS` `.08` corridor 越界完成分支，以及穿门后 upper/lower 两个既有目标。全部校正保持 180 次预算。

穿门后风险检查最初假设 lower center 可能继续被完整两格门的 upper 遮挡；窗口 `9f69e3f1-569d-4dc3-981e-6f40f92fc450` 以 `1 failed / 16 passed` 反证该假设：现有 `[71.5,32.6,0.5]` 位置在 14 次校正内直接命中 lower 及其远侧 adjacent `[71,31,0]`，并非耗尽 180 次。该失败 stdout SHA256 为 `d9aab6ed111643c57d7afa0d20620076d80d1e2b52f320a5518a4fb8c1679498`；测试随后按实际生产 ray 结果确认 upper/lower center 和严格 face 均可达，因此不修改后续两次 toggle。

交付态确定性命令：

```sh
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- /bin/bash -o pipefail -c 'pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/tests/e2e/classic-support/door-collision-oracle.test.ts apps/web/tests/e2e/classic-support/target-aim.test.ts apps/web/tests/e2e/classic-support/route-progress.test.ts --maxWorkers=1 2>&1 | tee changes/2026-09-23-classic-functional-completion/evidence/v1-door-entry-face-close-01/delivery-aim-route-green.log'
```

窗口 `b7efa66f-5f6f-46f7-9ef6-1e249f3e6d70` 为 `PASS/exit 0`，结果 `3 files / 30 tests`；stdout SHA256 为 `5ea81e38899b76c3adb6fed135730c5e694ce25add81cc09bddf09e173c1fce5`。初次 helper GREEN `16/16`、实际门 pair 收紧后的 `29/29`、路线完成域收紧后的 `30/30` 与格式化后中间回执均保留，没有覆盖。

## 类型与静态检查

每条命令均使用独立默认 benchmark window。最终格式化后结果：

- `pnpm typecheck:classic`：窗口 `bec008f6-6ada-42b8-be94-e7f8a17bfecb`，`PASS/exit 0`。stdout SHA256 `d7c202ce0f0f4567e9230d280cc52c28922a9bf37c5b25740b2d6b8f11ad0bbc`。
- `pnpm exec tsc -p tsconfig.test.json --noEmit`：窗口 `56923204-7be9-4b30-8989-84bcf8526eea`，`PASS/exit 0`。命令成功无 stdout，空文件 SHA256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e464f9b934ca495991b7852b855`。
- 三个改动 TS 的 ESLint：窗口 `d6cb16b1-4b66-43ca-88a8-582a8bdd4c69`，`PASS/exit 0`。命令成功无 stdout，空文件 SHA256 同上。
- 获授权 TS/MD 的 Prettier write：窗口 `077843ed-cfcd-405a-9c2a-b48dbd0b1783`，`PASS/exit 0`；其后按最终文件再次执行测试、类型与 ESLint。
- 六个 TS/MD 的阶段 `prettier --check`：窗口 `10f708ec-ab71-40f5-b1bc-99d5f707258c`，`PASS/exit 0`。
- tracked TS/spec `git diff --check` 与两个新增文档 `git diff --no-index --check` 的阶段组合检查：窗口 `ef80ffc1-4c77-45b3-9b20-2acfdad66c56`，`PASS/exit 0`；新文件的正常差异退出码 1 在同一 shell child 内只作为无 whitespace 错误处理。交付态检查的原始窗口另存于本阶段 evidence 目录，最终文件 hash 由 `delivery-validation.json` 与 `MANIFEST.sha256` 绑定，避免报告自引用。

Classic typecheck 初次窗口 `85d296f3-173e-42ae-8856-97378923c646` 为 `FAIL/exit 2`，只发现新测试把 readonly `Point` 传给生产 ray mutable tuple 参数；修正测试局部 `directionForView` 返回类型后，窗口 `b03c11df-9864-4e46-8405-1c285acbac82` 及最终窗口均 PASS。失败日志和窗口原件均保留。

最终源码静态命令均作为独立 benchmark child 执行，stdout 通过 `/bin/bash -o pipefail -c '<command> 2>&1 | tee <evidence>'` 保留退出码：

```sh
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- /bin/bash -o pipefail -c 'pnpm typecheck:classic 2>&1 | tee changes/2026-09-23-classic-functional-completion/evidence/v1-door-entry-face-close-01/delivery-classic-test-typecheck.log'
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- /bin/bash -o pipefail -c 'pnpm exec tsc -p tsconfig.test.json --noEmit 2>&1 | tee changes/2026-09-23-classic-functional-completion/evidence/v1-door-entry-face-close-01/delivery-root-test-typecheck.log'
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- /bin/bash -o pipefail -c 'pnpm exec eslint apps/web/tests/e2e/classic-support/v1-slice.ts apps/web/tests/e2e/classic-support/door-collision-oracle.ts apps/web/tests/e2e/classic-support/door-collision-oracle.test.ts 2>&1 | tee changes/2026-09-23-classic-functional-completion/evidence/v1-door-entry-face-close-01/delivery-eslint.log'
```

## 范围与剩余风险

本阶段未修改 production、`harness.ts`、`mouse-input.ts`、`aim.ts`、`target-aim.ts`、scenario、坐标、timeout、玩法协议或 shared execution state。没有运行 Browser/build/Cua/devserver/CI，也没有 Git/index/push。

最终文件 SHA256：

- `apps/web/tests/e2e/classic-support/v1-slice.ts`：`af17d799bcbe18dd7daf53183e457af36c263fdbcc3acd4bf51443c1954e60e3`
- `apps/web/tests/e2e/classic-support/door-collision-oracle.ts`：`93c3f0fcc4372442cb83cfde30427673fe1230ad9ec0094ac178f2310add7a2c`
- `apps/web/tests/e2e/classic-support/door-collision-oracle.test.ts`：`291c8f045c9a81208318af9937cd9e8da44a20e230ca2fd9f9c3dceac618170a`
- `changes/2026-09-23-classic-functional-completion/spec.md`：`f9c2933792a0f599e811bca9a580f1a594890e90c32460a264edc0b06a0cc9e4`
- `changes/2026-09-23-classic-functional-completion/door-entry-face-contract.md`：`067aade6570270af83768e69823f45916f277b2b6f3624a8b3310e5c133bbb1c`

当前产品 ray 对“eye 已在 targetable 薄门完整 voxel cell 内”仍返回 null entry face；本阶段只让 canonical fixture 通过真实键盘回退到可观察近侧面，没有宣称产品该限制不存在。确定性测试不能证明浏览器实际 `walkTo` 会在 Browser-12 环境稳定达到回退位置，也不能证明首次 toggle、open mesh/collision/revision/traverse、后续上下 half、jukebox/media/C4/C5/save；这些均保留为后续唯一 Browser-12 验收。

长期 docs baseline 未更新：这是当前 V1 canonical fixture 的局部闭环，不改变通用 Harness、生产输入、架构或长期验收职责。

## GIT-19 隔离合并门禁

从基线 `dd0f13e84b27967d460ec9008d17e98d85f1a815` 创建
`/private/tmp/seedlands-git19-door-entry`，应用 86 路径 binary patch
`dc7ff4ea90af5ff40f43b37d80b61878041ee804d9d0cab35bea818c53d6af16`。根与 Web
workspace 的 `@seedlands/stdlib` 均解析到隔离树自身源码；第三方 `.pnpm` store 只读复用，
task-run-state 为真实目录。

- oracle/target-aim/route：窗口 `3ec02f6b-37b8-4fe1-b57e-1fa20a383513`，
  `2026-09-25T08:17:41.228Z` 至 `08:17:44.069Z`，`3 files / 30 tests PASS`。
- Classic test types：窗口 `1963ed90-bacd-45c6-aa91-b265f0aee5ae`，
  `08:18:03.019Z` 至 `08:18:06.473Z`，PASS。
- root test types：窗口 `d8f7d67e-9555-4de1-bcbf-67196eb41800`，
  `08:18:06.505Z` 至 `08:18:09.270Z`，PASS。
- 3 个 fixture TS ESLint：窗口 `2bbdec98-e698-4ce7-8ee6-f42f6d88700a`，
  `08:18:09.302Z` 至 `08:18:10.999Z`，PASS。
- 首次 Prettier 窗口 `5e708354-5696-4cae-aee9-959bb29f5e71` 同时发现本批
  `execution-state.md` 需机械格式化，以及 `MANIFEST.sha256` 无可用 parser；锁内只格式化 state，
  最终可解析文件 Prettier 窗口 `0b992354-820f-4eec-8512-5478ff96cb32`，
  `08:18:51.263Z` 至 `08:18:51.861Z`，PASS。
- 3 个 TS、可编辑 Markdown/state、Browser diagnosis JSON 与不需 parser 的 manifest scoped diff 窗口
  `805ab607-75fc-4bae-aa59-c4da437b76cf`，`08:18:51.896Z` 至 `08:18:51.922Z`，PASS。

Browser-11 原始 JSON.log/stdout/context/trace 未格式化或改写。上述窗口
`measurement.status` 均为 `NOT_RECORDED`，不构成性能验收；fixture 回退不表示 production ray
的 origin-cell null entry face 限制已经修复，Browser-12 尚未运行。
