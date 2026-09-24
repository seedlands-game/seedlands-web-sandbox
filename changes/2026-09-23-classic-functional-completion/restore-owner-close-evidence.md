# RESTORE-OWNER-CLOSE-01 证据

更新时间：2026-09-24T18:00:16Z

状态：**candidate GREEN，等待 root 独立读回与准出；未提交。**

## 根因

- `GameServer` 的 `kernelState` getter 始终返回 `gameplayHost` 当前 active Gameplay 的 owner。
- 构造期 `createGameServerWorldCommitApi({ kernelState: this.kernelState })` 却把当时的 owner 对象按值捕获；成功 restore 后 `gameplayHost.commitRestore` 替换 active Gameplay 并 dispose 旧 runtime，world commit adapter 仍调用旧 owner。
- 真实表现是半程 mining 保存/restore 后继续完成时，`RegisteredBlockRuntime.drain` 经 world commit metadata 抛 `Kernel state owner is disposed`。

## RED

命令：

```text
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm --filter @seedlands/web test apps/web/tests/integration/runtime/server/composition/gameplay-mining-progression.test.ts -t 'restores actual half-finished mining with the same tool durability and completes only once' --maxWorkers=1
```

结果：`1 failed / 6 skipped`；错误为 `Block completion failed: OPERATION_FAILED: Kernel state owner is disposed.`。原 mining 断言未删除或放宽。

## 实现

- `game-server-world-commit-adapter.ts` 的 owner 端口从对象改为 `kernelState(): KernelStateOwner`。每次读取/提交 revision 与准备 metadata 时解析当前 owner；单个 prepared 操作中的 `prepareWorldCommitMetadata` 仍捕获准备时 owner。
- `GameServer` 注入 `() => this.kernelState`。成功 restore 后新 world edit 使用替换后的 owner；restore 前准备的 edit/batch仍因旧 owner dispose或旧 Chunk identity判 stale，不会透明重绑。
- `FluidTransactionRuntime` 是 world 派生 owner，成功 restore 时创建 `epoch+1` 的新 runtime并清旧 lease；`FluidChunkActivationQueue.restore` 丢弃旧 Chunk job、按当前 active keys和新 Chunk重建。失败 restore不安装新 runtime。
- fluid runtime创建/epoch校验提取到 `game-server-fluid-runtime.ts`，避免扩大 `game-server.ts`；未修改 Kernel、fluid算法、disposed/epoch 校验或全局状态。

## 边界回归

新 `game-server-restore-owner.test.ts` 使用真实 GameServer、MemoryGamePersistence、prepared single/batch和真实 fluid candidate：

- 成功 restore：旧 single/batch validate均拒绝；旧 fluid candidate=`work-id`；restore后新 edit可提交；新 fluid candidate epoch严格增加且 accepted。
- 失败 restore：旧 single、batch、fluid candidate仍分别可提交，证明失败路径未替换当前 owner/runtime。
- 指定半程 mining用例转为 `1 passed / 6 skipped`，恢复后耐久扣一次、体素清除、只生成一个掉落，后续 advance不重复。

## 最终验证

- stdlib A1/Fluid/Media/Structure：

```text
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec vitest run --config packages/stdlib/vitest.config.ts packages/stdlib/tests/server/game-server-restore-owner.test.ts packages/stdlib/tests/server/prepared-world-edit-batch.test.ts packages/stdlib/tests/server/fluid-transaction.test.ts packages/stdlib/tests/server/world-transaction-atomicity.test.ts packages/stdlib/tests/server/gameplay-media-fact-drain.test.ts packages/stdlib/tests/server/registered-structure-runtime.test.ts --maxWorkers=1
```

结果：`6 files / 72 tests PASS`。

- Web server/Classic restore：

```text
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm --filter @seedlands/web test apps/web/tests/integration/runtime/server/composition/gameplay-mining-progression.test.ts apps/web/tests/integration/runtime/server/composition/classic-media-authority.test.ts apps/web/tests/integration/runtime/server/composition/classic-door-authority-red.test.ts apps/web/tests/integration/runtime/server/composition/gameplay-composition-checkpoint.test.ts apps/web/tests/integration/runtime/server/prepared-world-edit.test.ts --maxWorkers=1
```

结果：`5 files / 54 tests PASS`。

- `pnpm --filter @seedlands/stdlib typecheck`、`tsc -p tsconfig.test.json --noEmit`、`tsc -p tsconfig.classic-tests.json --noEmit`：PASS。
- Targeted ESLint、Prettier、`git diff --check`：PASS。

## 文件 Manifest

```text
eebd18fc7712fb0d1749caa45f65d56ab83d458cd79c38c44e421494ecf8f7ef  changes/2026-09-23-classic-functional-completion/spec.md
3361c5cd74cc206f3854762b3b216fcc11899e948b6055ff12874830ef2e55b1  changes/2026-09-23-classic-functional-completion/tasks.md
475cc1b324a66e6bd6cf58b6d456a72f303d76a03a4b01d802953d641257f379  packages/stdlib/src/server/game-server-world-commit-adapter.ts
05cfd792960922c1cfd0faed2adea2d259073db95fa0e190c2311de8ade8b507  packages/stdlib/src/server/game-server-fluid-runtime.ts
7f1894e76fb0cb79b0c9f4b58c853868deb61d68269d864049d20062a9ecd995  packages/stdlib/src/server/fluid/fluid-chunk-activation-queue.ts
73e1e26306f31975beed07af150397957255a53086fd64cd7472ac774561754d  packages/stdlib/src/server/game-server.ts
3458483bb90ffa0bb02473fcfe3987c08d4007d13588b6d443b777316ca676d1  packages/stdlib/tests/server/game-server-restore-owner.test.ts
31f7b43664fbd7e673b3ad31a45beab9867836e6d99f7c7c6333e44b64877057  apps/web/tests/integration/runtime/server/composition/gameplay-mining-progression.test.ts
```

## 并行边界与未执行

- 未修改 a288 独占的 snapshot-migration、checkpoint-identity、gameplay-composition、mod-api、Classic lineage文件。其接口变化若影响后续合并类型检查，应由 LEGACY-LINEAGE-CLOSE-01 evidence归因。
- 未修改 root 已接受的 Media capacity runtime/test。
- 未运行 full build、browser、CI、PR、部署或 Git stage/commit/push。
