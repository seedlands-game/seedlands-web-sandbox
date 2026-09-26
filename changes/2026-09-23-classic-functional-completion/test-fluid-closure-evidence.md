# TEST-FIX-02 Classic Fluid Negative Fixture Closure

## 范围与根因

本次只修改 `apps/web/tests/integration/runtime/server/composition/classic-fluid-interactions.test.ts` 的两个旧负例。生产代码与其余八个用例未修改。

旧测试通过 `vi.spyOn(runtime.server, 'prepareVoxelEdit')` 伪造 `unchanged` 和 `stale`。当前合法 registered interaction 路径由 `GameServer` 构造时捕获的 `GameServerGameplayWorldPort.prepareVoxelEdit` 调用 server-owned `ServerWorldCommitHost`，不再经过后来替换的公开 facade 方法，因此两个 spy 没有拦截真实提交。

## RED

命令：

```sh
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/tests/integration/runtime/server/composition/classic-fluid-interactions.test.ts --maxWorkers=1
```

初始结果为 1 个文件、10 个测试中 8 通过、2 失败。两个负例均意外得到成功的 `seedlands:water-bucket-voxel-interaction` 回执，而不是预期的 `world-not-changed` / `interaction-stale`，证明旧 public-method spy 已脱离生产路径。

## 修复

- `world-not-changed`：测试组合只替换现有 `seedlands:fluid-container-handler` 模块配置，将 `Voxel.Water` 加入 `replaceableVoxels`。合法 water-bucket 操作因目标已经是 Water，真实 private world participant 生成 Water 到 Water 的 no-op，并返回 `world-not-changed`。
- `interaction-stale`：使用既有公开 `CorePlatformPorts.clone` 测试端口，在 prepared result 被复制后、所有 participant 统一 validate 前，对另一 Chunk 的 `x=40,y=59,z=0` 执行真实 `server.editBatch`。该显式外部提交推进 world revision，使原 fluid participant 在 validate 阶段返回 `interaction-stale`。
- 两例在建立断言基线前调用公开 `runtime.takeCommits()` 排空 fixture setup 的历史 commit；失败 interaction 的 `response.commits` 必须为空。
- no-op 例断言 inventory、目标 voxel、world revision、gameplay revision 均不变。stale 例断言只有显式外部提交推进一次 world revision，目标 Chunk baseline、目标 voxel、inventory、gameplay revision 均不变。
- 未恢复 public Station/World bypass，未使用 production test hook、private reflection、`as any`，未删减或弱化断言。

第一次 GREEN 尝试中，两例的 failure reason 已正确，但 `response.commits` 含 setup 阶段遗留的 commit。测试随后显式排空 setup commit，并将 stale 外部写移到另一 Chunk，以区分测试前置历史和失败 interaction 的原子性；该中间失败保留在此记录中。

## GREEN

- 上述 Vitest 命令最终结果：1 个文件、10/10 通过。
- `node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec tsc -p tsconfig.test.json --noEmit --pretty false`：通过。
- `node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm --filter @seedlands/web typecheck`：通过，`svelte-check` 为 0 errors / 0 warnings。
- Targeted ESLint、Prettier 和 `git diff --check`：通过。
- 未运行 browser、build、全套测试、CI，未 commit 或 push。

## 文件

```text
71963015bb4edf587f7f737f5613f3aa31e70bd55b34d4ac0c855ac3e7e38a2e  apps/web/tests/integration/runtime/server/composition/classic-fluid-interactions.test.ts
```

证据文件 hash 在内容冻结后由 checkpoint 记录。
