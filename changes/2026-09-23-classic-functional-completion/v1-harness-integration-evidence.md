# V1 Harness 公共集成证据

状态：共享集成与 GIT-07 staged-tree GREEN。Media/geometry/scenario 私有闭包均已由 root 准出，三个只读 oracle 和 `worldEpoch` 生命周期门禁已完成。未运行 browser、build、dev server 或 CI。

## 冻结范围

- 公共 API：`getVoxelGeometry(voxel)`、`getRenderedMaterialMesh(cx, cy, cz, material)`、`mediaSnapshot()`。
- 只读来源：当前 Authority geometry registry、当前 World 已 postrender material mesh summary、当前 GameMediaController forwarding receipt 与 GlobalAudio worldMedia snapshot。
- 明确不证明：geometry descriptor 不证明 mesh 已渲染；forwarded batch 不证明 playing；Vitest/typecheck 不证明生产浏览器、WebGL 或真实音频设备。
- 私有 owner：794 独占 PlayCanvas adapter/World mesh summary；a288 独占 GameMediaController snapshot；761 独占唯一 canonical scenario。公共集成未修改这些私有文件。

## RED

命令经默认全机锁运行：

```text
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/tests/unit/app/game-harness-observability.test.ts --maxWorkers=1
```

首轮结果：`1 file / 3 tests failed`。三个失败分别为 `api.getVoxelGeometry is not a function`、`api.getRenderedMaterialMesh is not a function`、`api.mediaSnapshot is not a function`，准确证明共享 BrowserProductHarness 尚无三项 oracle；没有 fixture 或环境失败。

Web typecheck 中间 RED：`game.ts` 的 `createRuntimeHarnessApi` bindings 缺 `renderedMaterialMesh`、`media`、`audio` 三项，Svelte diagnostic 为 `1 error / 0 warnings`。Media/audio 已使用正式 current-owner getter 接入；geometry 保持必填，未用 optional/no-op 假 GREEN。

## 当前 GREEN

- 共享 oracle 单测在实现 clone/epoch 逻辑后为 `1 file / 3 tests PASS`；职责提取后与新增 Authority registry 动态切换、audio epoch mismatch 反例后仍为 `3/3 PASS`。最终改为精确最小端口并将 restore epoch 拆为独立用例后为 `4/4 PASS`，测试不使用 `as never` 或 no-op 补齐大接口。
- `worldEpoch` 修订首轮为 `1 failed / 2 passed`，原因是测试夹具每次构造新Authority对象，触发真实同实例门禁；改为稳定Authority对象后第二轮仍有测试局部变量作用域错误。修正夹具后最终 `3/3 PASS`，生产门禁未放宽。
- 最终mesh回归覆盖：旧world+旧epoch可读；Authority切新epoch但旧repository尚在时返回`null`；失败restore回到旧epoch仍可读旧world；成功restore清空repository期间返回`null`；新postrender摘要出现后才携带新`worldEpoch`。
- geometry 四个私有/相邻测试与共享 oracle 合并运行结果为 `5 files / 26 tests PASS`。其中 geometry owner 为 `4 files / 22 tests`，共享为 4 条；未重复无变化的 Media 私有 suite。
- Web typecheck 在修正大 Harness binding 被窄 Pick 污染的三个诊断后 PASS，Svelte 为 `0 errors / 0 warnings`；`tsconfig.test.json --noEmit` PASS。随后 761 继续写 scenario 并新增对共享类型的 import，因此全树最终 types 必须等 scenario 冻结后再跑一次，本证据不冒充该未来结果。
- targeted ESLint 覆盖 `app-contracts.ts`、`game-harness.ts`、`game-harness-contract.ts`、`game-harness-observability.ts`、`game.ts`、共享 test，结果 PASS。
- `game-harness.ts` 提取纯 clone helper 并加入 epoch 双读门禁后有效行数为 `468/500`。
- a288 私有 seam 已由 root 准出：controller SHA-256 `f9ada640ff78884ab238b1833eb6b1f8169763ffedec3dc4ce9c00722ff736a7`、test `8e6088a86ebb5e322b47c2e34915abacd37e303123e7a38e88d73823b42dfd32`、evidence `9a41d72d67906fd58df9679d5c633ac46cab8b99e051dc86823ed9b89691bbf3`；7+5 tests、Web/root-test types与lint/format PASS。公共集成没有重复运行其无变化私有测试。

## 私有 seam 准出

- geometry：root 已核 `playcanvas-chunk-adapter.ts` `6479afdd...7cb8c`、`world-runtime.ts` `a66a42f9...7e447`、helper `31adfb73...3308e`、test `c71c6d69...4ef8a`、evidence `0125d167...caa95`。公共 owner 没有修改这些文件。
- media：root 已核 controller `f9ada640...36a7`、test `8e6088a8...fd32`、evidence `9a41d72d...bbf3`。公共 owner 只读取 `snapshot()`。

## 公共生命周期与剩余边界

- `game.ts` 只增加 `this.world?.getRenderedMaterialMesh(...) ?? null` 动态转发；成功 restore 的既有 `restoreBrowserPresentation()` 先调用 `world.beginScenario()` 清空 repository，随后更新 Harness epoch 标签。失败 restore 不进入回调，因此旧 world/旧 epoch 保持。查询前后核对 Authority 对象、Authority runtime epoch 和标签。
- Browser Harness 返回的 `RenderedMaterialMeshSummary` 必填 `worldEpoch`；私有 World 摘要仍不含 epoch。完整 projection 与 batch 通过正式 validator clone，audio 必须与 controller worldEpoch 一致，否则为 `null`。
- 唯一 canonical scenario 与真实 browser 由761/root后续阶段负责；本证据不宣称其通过。

本 checkpoint 最后读回：最终去重 Harness/Media/Geometry/Scenario/restore 回归 `9 files / 43 tests PASS`；Web、root-test、Classic package types直接PASS，Classic-test types首轮发现两个E2E类型壳缺口，窄修后复验PASS。合并范围ESLint/Prettier、`git diff --check` PASS，index为空。未运行browser/build/CI；下一步为GIT-07精确暂存与detached staged-tree复验。

最终合并验证使用以下命令，均经默认全机锁执行；Vitest 固定单 worker：

```text
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/tests/unit/app/rendered-material-mesh.test.ts apps/web/tests/unit/app/playcanvas-water-transition-adapter.test.ts apps/web/tests/unit/app/chunk-resource-repository.test.ts apps/web/tests/unit/worker/geometry-mesh-task.test.ts apps/web/tests/unit/app/game-harness-observability.test.ts --maxWorkers=1
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm --filter @seedlands/web typecheck
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec tsc -p tsconfig.test.json --noEmit
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec eslint apps/web/src/app/app-contracts.ts apps/web/src/app/game-harness.ts apps/web/src/app/game.ts apps/web/src/app/gameplay/game-harness-contract.ts apps/web/src/app/gameplay/game-harness-observability.ts apps/web/src/app/world/playcanvas-chunk-adapter.ts apps/web/src/app/world/world-runtime.ts apps/web/src/app/world/rendered-material-mesh.ts apps/web/src/app/audio/game-media-controller.ts apps/web/tests/unit/app/game-harness-observability.test.ts apps/web/tests/unit/app/rendered-material-mesh.test.ts apps/web/tests/unit/app/game-media-controller.test.ts
```

scenario冻结后的最终类型命令还包括 `pnpm --filter @seedlands/playbook-classic typecheck` 与 `pnpm exec tsc -p tsconfig.classic-tests.json --noEmit`。Prettier check覆盖全部本阶段源码/测试/docs，scoped `git diff --check` PASS。

## GIT-07 Staged-tree

18路径代码/场景闭包从 `HEAD 1b98df45...` 导出 binary patch，SHA-256 `4529cf0e84a0f829e1147c5ab216cf3623c61d4f9ffa2648d6e130029c925af3`，应用到 `/private/tmp/seedlands-git07-harness` detached worktree。

- 首轮将整个根 `node_modules` 链回主工作区，导致 `@seedlands/stdlib` 错误解析到含未提交 Lighting 的主树源码；结果 `7 files / 37 tests PASS`、2个suite在收集时因 `Voxel semantics resolver is required` 失败。该结果不计GREEN。
- 第二轮把根 `@seedlands/*` 指回detached源码，但缺 package级第三方依赖；结果 `5 files / 28 tests PASS`、4个suite因找不到 `bitecs` 在收集时失败。该结果不计GREEN。
- 最终使用实际目录式依赖视图：第三方包链接到现有安装，根及package级 `@seedlands/*` 明确链接detached worktree自身源码。原9-file命令结果 `9 files / 43 tests PASS`。
- detached tree 的Web三段类型、root-test、Classic package、Classic-test types均PASS；staged TypeScript ESLint、全部18路径Prettier和`git diff --cached --check` PASS。ESLint首次因临时`packages/eslint-plugin`缺`@eslint/js`未进入规则执行；补其第三方依赖视图后原命令PASS。
- 自然hooks的Prettier、ESLint、`ls-lint`通过；代码提交为 `5d05607027ad0781a349bec37bb49c1c485b8b99`。上述隔离失败没有修改生产逻辑、测试口径或断言。

## 后续干净 Production Artifact

当前已提交HEAD可以使用仓库现有入口，不需要新工具：根 `pnpm build` 调用 `scripts/harness/artifact.mjs --build`，内部只执行 `pnpm build:web`，完成后写入并立即复验 `apps/web/dist/harness-artifact.json`；`pnpm harness:artifact`可再次只读验证。`pnpm harness:classic`会在唯一Playwright spec运行前后分别验证同一artifact，不会重新构建。

后续阶段应从最终远端精确SHA创建新的detached临时worktree。不得把整棵`node_modules`直接软链回dirty主树；本阶段已证明那会让workspace包解析到主树源码且pnpm可能拒绝symlink task-state目录。可复用现有安装而不下载新工具：在临时树创建真实`node_modules`目录，把第三方依赖逐项链接到现有安装，同时把根和package级`@seedlands/*`链接到临时树自身`packages/`/`playbooks/`；`node_modules`和`dist`均被source snapshot排除。

取得root的build阶段授权后，在默认全机锁内于该干净树运行一次`pnpm build`，读回artifact的sourceSha/sourceDigest/lockDigest/files/MP3；随后`pnpm harness:artifact`。取得唯一browser lease后，在同一树、同一dist执行`pnpm harness:classic`，不再build。当前阶段没有执行这些命令。

## 公共文件 Manifest

```text
3ccad4871dcbc0075a5411f72600a8e63e61b926ca3413bd48d9af4a85260533  apps/web/src/app/app-contracts.ts
14757fb1d47325603678b5e017f891f4d01e46accad3a55d47b84e1679069ab4  apps/web/src/app/game-harness.ts
9d240afeda3e9bf22dc003e65af7ec3eb49ecfa90a8ad8b4fb3bd1bb20caaf68  apps/web/src/app/game.ts
7bc0c8c9cb4041d85e505e897df2d34fac448c5a5a7fd62abbe2d10b6a6559d5  apps/web/src/app/gameplay/game-harness-contract.ts
7b9a18ea1e8680f5165543116860fb56ca705d92fe4526ffbed1f528d9758aa8  apps/web/src/app/gameplay/game-harness-observability.ts
e616af9eac6f428e434fdd721a221abdb60efe5fb5082f51e75cbd30a6f15bb8  apps/web/tests/unit/app/game-harness-observability.test.ts
c49916075ace27664cdf45c4814dc4e0ef2c6a36312ad7e6bb7d51860ded03d9  docs/ci-testing.md
85c043d25aa4e974c714452c68b33c4d28eec49c28462ffea9828397c79be308  docs/harness-contracts.md
702d6481615e165b40fc5c6310d72f3797fc06cab960aca710929cd02a189db2  changes/2026-09-23-classic-functional-completion/v1-harness-contract.md
```

Manifest 在最终格式化后计算；`spec.md`、`tasks.md`、`execution-state.md` 与本 evidence 会继续写入状态，不使用早期哈希冒充最终值。
