# Pre-pointer fixture 闭包证据

状态：`PREPOINTER-FIXTURE-CLOSE-01` 完成。只修改 `gameplay-composition-checkpoint.test.ts` 中已定位的 pre-pointer 用例及本证据；未修改 production、guard、Classic 声明或其他测试。

## 来源边界

- 可信来源是 Classic production 已声明的 `classicGameplaySnapshotPredecessors[1]`，适用版本精确为 `[4]`。
- Pack identity 精确为 manifest `05bc5e57bb6cfd4ed0e2da821f8b6e803bb7e3676453988a131a4b8524c066dd`、entry `4a773fe7225f13ef018def0a930b469aa82e558fdebc5172b7ef602ed8e148e2`、`resources: []`。
- definition graph 继承生产声明内冻结的 `c18a890` capture graph。测试不再读取 Web gzip fixture，也不把当前 Pack 的 presentation/MP3 resource receipt拼到旧摘要上。
- 测试 payload 是由正常当前 `GameplayRuntime` 生成的 synthetic V4 payload，再附上述冻结 predecessor identity；它验证迁移控制面，不声称是完整历史 artifact 的真实字节重放。

## 修复

原 fixture 用旧 manifest/entry digest组装当前 Pack，因而带入当前 resources和当前 registration graph，再只替换 definitionMap；随后把同一个拼接 identity作为 host `legacyCompositionIdentity`。这既不是已声明前驱，也形成同源自批准依赖。

修复后：

- source只负责生成合法 V4 payload；`composition` 整体替换为 `structuredClone(classicGameplaySnapshotPredecessors[1].identity)`。
- 用例显式断言 predecessor index、`[4]`、两个 digest和空 resources，避免数组或声明漂移后误测其他 lineage。
- 从本文件 `create()` helper删除未再使用的 `legacyCompositionIdentity` 参数；target仅装配当前 Classic Pack并依赖其正式 predecessor allowlist。
- 保留 `inventoryRevision` / `inventoryCursor` 缺失到 `revision: 0` / 空 cursor的原迁移断言。
- 在正例 restore前从原 synthetic predecessor payload复制负例，只篡改 entry digest一个字段；拒绝后 target snapshot保持不变。

## RED / GREEN

修复前准确 RED：`1 file / 8 passed / 1 failed`。唯一失败用例为 `migrates only the exact pre-pointer overworld V4 Pack identity`，在 `checkpoint-identity.ts:475` 抛出 `Gameplay composition identity is missing or incompatible.`；其余8例通过。

最终：`1 file / 9 tests PASS`。

```sh
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/tests/integration/runtime/server/composition/gameplay-composition-checkpoint.test.ts --maxWorkers=1
```

静态验证均在默认 benchmark锁下独立执行：

```sh
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec tsc -p tsconfig.test.json --noEmit --pretty false
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm --filter @seedlands/web typecheck
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec eslint apps/web/tests/integration/runtime/server/composition/gameplay-composition-checkpoint.test.ts
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec prettier --check apps/web/tests/integration/runtime/server/composition/gameplay-composition-checkpoint.test.ts
```

- Root test typecheck：PASS。
- Web package typecheck：PASS，Svelte `0 errors / 0 warnings`。
- 定向 ESLint、Prettier与 scoped `git diff --check`：PASS。
- 未运行 build、browser、dev server、CI或Git写操作。

## SHA-256

```text
0e51ccba0b628c409e99442c979ec0519a60192626ba1d94af77b15568a1f9bb  apps/web/tests/integration/runtime/server/composition/gameplay-composition-checkpoint.test.ts
6e2473f6e638d62d75ae4a7ba2d69746e3bb8205b85a87eb46bbc7f26717778b  playbooks/classic/src/legacy-composition-identities.ts (只读来源)
```

本 evidence 自身哈希在最终格式检查后单独回报。
