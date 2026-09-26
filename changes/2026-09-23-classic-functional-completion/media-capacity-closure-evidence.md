# Media 多设备移除容量边界收口证据

## 范围与假设

- 仅修改 `registered-media-playback-runtime.ts`、`media-dependent-removal.test.ts` 与本证据文件。
- 通过正式 checkpoint candidate 恢复两个媒体实例，不读取或反射 private generation。
- 目标是确认同一事务在同一 generation 上 prepare/validate 多个 removal 时，generation 始终是安全整数，并且 apply 阶段不再执行容量判断或可能抛错的外部调用。

## RED

新增测试只通过正式 `prepareCheckpointCandidate` 恢复两个 revision=`Number.MAX_SAFE_INTEGER - 1` 的 occupied device，再从相同 generation 调用两次 `prepareDependentRemoval`，执行 validate-all/apply-all，最后通过公开 `read` 检查空实例 revision。没有读取或反射 private generation。

```text
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec vitest run --config packages/stdlib/vitest.config.ts packages/stdlib/tests/server/media-dependent-removal.test.ts --maxWorkers=1
```

结果：`1 file / 5 tests`，`1 failed / 4 passed`。失败原文为 `expected 9007199254740992 to be 9007199254740991`，证明第二个 removal 的 `apply()` 把 generation 推到了非安全整数。

## 修复与回归

- `prepareDeviceRemovalAt` 在 prepare 阶段、既有 exhaustion 检查之后计算并捕获 `nextGeneration = generation + 1`。
- 同一 captured generation 创建的多个 removal 共享这个有界高水位。每个 `apply()` 只执行 `Math.max(this.generation, nextGeneration, candidateRevision)`，不再按 participant 数执行 `generation + 1`。
- 该实现不增加 reservation 或 pending 状态；失败 prepare 不改变 runtime。测试先执行一个公开的 unsupported `prepareDeviceRemoval` 并验证 checkpoint 不变，再证明同一双 removal 仍可成功。
- 普通双设备 removal 从共同 generation 1 迁移到共同 generation 2；随后正式 checkpoint rebuild 到 revision 3，证明同位置重建 revision 仍严格递增，不通过饱和或重复版本掩盖问题。
- 近上限双设备从共同 `MAX_SAFE_INTEGER - 1` 迁移到共同 `MAX_SAFE_INTEGER`；两个空位置 `read()` 都返回安全整数，后续新 mutation 在 prepare 阶段明确 `revision exhausted`。
- `apply()` 不新增容量检查、外部 getter 或回调，仅删除已捕获 key 并合并已预构造的数字高水位。既有第二 participant validate 失败测试继续证明 validate-all 前不执行任何 apply。

最终命令均独立持有默认 `benchmark-window`，所有 Vitest 使用 `--maxWorkers=1`：

- `node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec vitest run --config packages/stdlib/vitest.config.ts packages/stdlib/tests/server/media-dependent-removal.test.ts --maxWorkers=1` -> 中间 GREEN 为 `1 file / 5 tests PASS`；这是加入第六个“同位置重建 revision 严格递增”用例之前的历史结果，不作为最终计数。
- 加入第六个用例后，`node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec vitest run --config packages/stdlib/vitest.config.ts packages/stdlib/tests/server/registered-media-playback-runtime.test.ts packages/stdlib/tests/server/media-dependent-removal.test.ts --maxWorkers=1` -> `2 files / 16 tests PASS`，其中 `media-dependent-removal.test.ts` 的 6 个用例全部执行。
- `node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec vitest run --config packages/stdlib/vitest.config.ts packages/stdlib/tests/server/media-dependent-removal.test.ts packages/stdlib/tests/server/registered-media-playback-runtime.test.ts packages/stdlib/tests/server/media-playback-host-commit.test.ts --maxWorkers=1` -> `3 files / 19 tests PASS`，同样包含最终 6 个 removal 用例。
- 最终复跑命令：`node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec vitest run --config packages/stdlib/vitest.config.ts packages/stdlib/tests/server/media-dependent-removal.test.ts packages/stdlib/tests/server/registered-media-playback-runtime.test.ts packages/stdlib/tests/server/media-playback-host-commit.test.ts packages/stdlib/tests/server/registered-structure-fact-delivery.test.ts --maxWorkers=1` -> `4 files / 27 tests PASS`；开始时间 `2026-09-25 01:08:11 +08:00`，Vitest duration `2.52s`。该最终集合由 removal 6 例、registered Media runtime 10 例、Media host commit 3 例和 B2 fact delivery 8 例组成。
- `node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm --filter @seedlands/stdlib typecheck` -> PASS。
- `node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec tsc -p tsconfig.test.json --noEmit` -> PASS；该命令在第六个 removal 用例及其 import 落盘后执行，exit code 为 `0`。
- `node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec eslint packages/stdlib/src/server/gameplay/modules/registered-media-playback-runtime.ts packages/stdlib/tests/server/media-dependent-removal.test.ts` -> PASS。
- `node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec prettier --check packages/stdlib/src/server/gameplay/modules/registered-media-playback-runtime.ts packages/stdlib/tests/server/media-dependent-removal.test.ts changes/2026-09-23-classic-functional-completion/media-capacity-closure-evidence.md` -> PASS。
- `git diff --check -- packages/stdlib/src/server/gameplay/modules/registered-media-playback-runtime.ts packages/stdlib/tests/server/media-dependent-removal.test.ts changes/2026-09-23-classic-functional-completion/media-capacity-closure-evidence.md` -> PASS。

最终 SHA-256：

```text
7a673f70d76702125934259ded243d8dd8e0e7a41b7378ae3ddeb683f412fbe9  packages/stdlib/src/server/gameplay/modules/registered-media-playback-runtime.ts
0ec7c50a0c87e23c9560effc00321313d8aab8ec6ea2add700b49c95632e933a  packages/stdlib/tests/server/media-dependent-removal.test.ts
```

不需要扩展共享接口。修复完全位于现有 Media private owner 内，也没有新增 reservation 字段或可持久化状态。

## 未执行项

- 未运行 build、browser/dev server、Web tests、完整仓库测试、CI、Git commit/push 或部署。
- 未修改 Media 算法、B2/Structure、公共 adapter、Web 或 Classic Pack。
