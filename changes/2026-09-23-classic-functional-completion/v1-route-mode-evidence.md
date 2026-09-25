# V1 路线模式闭环证据

阶段：`V1-ROUTE-MODE-CLOSE-01`
结论：**fixture 修正完成，browser 待复验。**

## RED 与修正

RED 复用 Browser-05 唯一正式窗口 `319d5d90-396a-4e4d-84f9-caaccf4fdabb`，不伪造、不重跑。该次旅程已证明 water-bucket 放 source 与 empty bucket 收 source 通过，但选择水桶时正式切入创造模式并启用飞行；门路线仍以 `jump:true` 发送 `Space`，玩家虽已到门 approach 的 x/z，却悬停在 y=34.7 且 `onGround=false`，最终在 `walkTo` 的落地 predicate 超时。原始 Browser-05 证据保持在 `evidence/v1-canonical-browser-05/`，本阶段未修改。

本阶段只在 `apps/web/tests/e2e/classic-support/v1-slice.ts` 的水桶放/收全部断言之后、门路线之前增加：

```ts
await switchToSurvival(page);
await waitForSnapshot(page, (value) => value.onGround && !value.colliding);
```

`switchToSurvival` 继续使用正式 `KeyE`、创造目录“切换生存模式”按钮、“背包与合成”对话框可见和既有关闭背包路径；没有 teleport、world command、直接 mode/runtime 调用或 Harness 新写口。通用 `walkTo`、`jump:true`、坐标、地形、超时及全部水桶、门、媒体、C4/C5 和保存恢复断言均未修改。

## 模式链复核

- 门 approach 在新增的正式 UI 切换及落地确认后从生存模式开始；到位后选择 wooden-door 才重新进入创造模式，放置完成后原有 `switchToSurvival` 先于碰撞和穿门检查。
- 门流程结束时为生存模式，因此 jukebox approach 的真实移动不会触发 creative flight；选择 jukebox/record-13 后临时进入创造模式，媒体断言完成后原有 `switchToSurvival` 恢复生存。
- C4 从生存模式开始；C5 保存前也是生存模式。恢复后的首次 jukebox approach 沿保存的生存 mode 执行，eject 流程结束后仍沿原路径恢复生存。

## 静态检查

所有重命令分别通过默认 `benchmark-window` 机器锁执行；没有嵌套锁。原始日志和窗口 receipt 位于 `changes/2026-09-23-classic-functional-completion/evidence/v1-route-mode-close-01/`。

1. Classic 测试类型检查

```sh
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm typecheck:classic
```

结果：PASS，exit 0。窗口 `24a7d9f8-e777-42f4-81bd-d10445dbac22`，`2026-09-25T02:37:28.071Z` 至 `02:37:31.970Z`，`waitedMs=1`。

2. 定向 ESLint

```sh
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- zsh -o pipefail -c 'pnpm exec eslint apps/web/tests/e2e/classic-support/v1-slice.ts 2>&1 | tee changes/2026-09-23-classic-functional-completion/evidence/v1-route-mode-close-01/eslint.log'
```

结果：PASS，exit 0。窗口 `f1ad02f9-a584-4040-82c7-fcadb7541d4d`，`2026-09-25T02:38:01.712Z` 至 `02:38:03.757Z`，`waitedMs=1`。

3. 定向 Prettier

```sh
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- zsh -o pipefail -c 'pnpm exec prettier --check apps/web/tests/e2e/classic-support/v1-slice.ts changes/2026-09-23-classic-functional-completion/spec.md changes/2026-09-23-classic-functional-completion/v1-route-mode-contract.md 2>&1 | tee changes/2026-09-23-classic-functional-completion/evidence/v1-route-mode-close-01/prettier.log'
```

结果：PASS，exit 0，输出 `All matched files use Prettier code style!`。窗口 `6ef95a7f-6b0b-4dc4-94f7-3be390286775`，`2026-09-25T02:38:11.138Z` 至 `02:38:11.604Z`，`waitedMs=1`。

4. 精确 diff check

```sh
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- zsh -o pipefail -c 'git diff --check -- apps/web/tests/e2e/classic-support/v1-slice.ts changes/2026-09-23-classic-functional-completion/spec.md changes/2026-09-23-classic-functional-completion/v1-route-mode-contract.md 2>&1 | tee changes/2026-09-23-classic-functional-completion/evidence/v1-route-mode-close-01/diff-check.log'
```

结果：PASS，exit 0。窗口 `89143c1d-38a4-431f-b2f7-b37a215e3fc9`，`2026-09-25T02:38:17.638Z` 至 `02:38:17.692Z`，`waitedMs=2`。

本阶段未运行 Vitest：改动是既有 canonical 浏览器旅程的正式 UI 模式切换与 Authority landing 时序，仓库没有不启动浏览器即可观察该行为的既有测试；新增源码正则、调用次数或平行 mock 框架只会镜像实现，不能证明真实模式/物理状态。

## 原始回执 SHA256

- `d7c202ce0f0f4567e9230d280cc52c28922a9bf37c5b25740b2d6b8f11ad0bbc` `typecheck-classic.log`
- `147f59ca0db35297f0f917d11fbf27371596888d943b904fd7db5779cab68fbe` `typecheck-classic-window.json.log`
- `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` `eslint.log`
- `7a0029784b70432f0fa2fdaf11c0c080fb58e651708c6b19c1d5010a23942b36` `eslint-window.json.log`
- `17aa973d3f004560237d9a95171210b0671deff23d61628eecf7322ff5938f20` `prettier.log`
- `e8f3fa1c763318392a750437b108038e6b5ac45ce34c5fa8537183b05bcbb51b` `prettier-window.json.log`
- `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` `diff-check.log`
- `e3f19d3aee8991845806998d8cebeaa64e2b8e2e95fcc6be560b3f8939723386` `diff-check-window.json.log`

## 未执行与后续 GREEN

- 未运行 browser、build、Cua、dev server、CI、Git commit/push 或全仓测试。
- 静态检查不能证明落地等待、门、媒体、C4/C5 或保存恢复已经通过。
- 真正 GREEN 仍须 root 准出、954 生成语义提交与新 identity artifact 后，由唯一 canonical Browser-06 证明正式 UI 切回生存、`onGround && !colliding` 后门 approach 可达，并继续完成门、媒体、C4/C5 与保存恢复。

## GIT-13 隔离合并门禁

唯一 Git writer 从 `6f82a2b7c4516a2f1fc77e54c07ee7f2d3fe527d` 构造 28 路径 detached staged tree；
根与 package 级 `@seedlands/*` 均解析到临时树自身源码。Classic test types、目标 TS ESLint、
TS/Markdown Prettier 与非原始证据 scoped diff 均 `PASS/exit 0`：

- types window `3ff38ebe-2c7b-4b6c-9059-4c12cc7f1549`，SHA-256 `b9829d4ae93685b3a380a3b57e959d2cfc1d0e71ecc099561e1692d33b5670c9`；
- ESLint window `8534aa94-ce4a-4c07-a306-acd63f60ed28`，SHA-256 `6fd7f84614a9b3ddeeae95648a9a4a03986f197df12b037d142c3bac9abea337`；
- Prettier window `185b90b8-5c9a-47f9-9161-7f977c48ad19`，SHA-256 `d6044184b3cfb806310f9decdf841b38918e5ca65349db4ea66ad998f872959d`；
- diff window `55191b61-8a68-49d9-9037-8819bd3564a7`，SHA-256 `eb38c735b5ff726433c0069196d73bf65fe485d84f2117299e22fc256174ae3d`。

首次 Prettier 命令误把 6 份必须保真的原始 window JSON 纳入格式检查，window
`573aa1d1-a934-48de-8c33-b4498f9ac2a5` 为 `FAIL/exit 1`，SHA-256
`0ae3750f37664e029d8c1bbeacf606864b9d852aea18f1ca5405c9463a6820d4`。该命令只执行 `--check`，
没有改写任何文件；最终命令按原始证据边界只检查 TS 与 Markdown。5 份 GIT-13 window JSON 均在
临时树清理前归档到 `evidence/v1-route-mode-close-01/`。
