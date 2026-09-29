# 旧存档 Lineage 收口证据

状态：stdlib 通用前驱合同、Classic 精确来源声明与真实 V3/V4 composed restore 链已完成 GREEN。冻结基线 `78545d877ed08ee0613a690ff53e36b0c2120b69`，工作树同时包含其他 owner 的未提交改动。

## 合同与实现

- `GameplaySnapshotMigration` 可声明最多 16 条 `GameplaySnapshotPredecessorV1`。注册使用 descriptor-only 有界复制，拒绝 hole 被命名属性抵消的伪 dense 数组、数组/entry/version accessor、空/重复/非法版本、重复 identity、非 JSON 数据、未知字段及畸形 Pack/definition graph；严格确认版本为 `1 | 2 | 3 | 4` 后才排序，拒绝前不执行 getter 或 coercion hook。接受值会完整 clone、deep-freeze。
- V1-V3 composed restore 先要求 host-observed `legacyCompositionIdentity` 精确命中当前 Pack 声明且包含对应 gameplay version，再运行 Pack migration。缺失、版本不符、digest 或 graph 单字段变化均 fail closed。
- V4 以 embedded composition 为观测来源。精确声明前驱只允许进入 Pack migration；migration 必须把 composition 投影为 current，最终 guard 不接受未投影 predecessor，也不再使用 `legacy === explicitLegacy` 自批准。
- Classic production 源码冻结 c18a890 capture 的完整 identity，并声明 captured、pre-pointer、NPC-composable 和 pre-change 四条已知来源。captured 完整 identity 与 fixture 相等，canonical SHA-256 为 `d34c16d56c4e68211deb3331607b0a581f69b8ac1e201287842d0967f6107ad2`。运行时不读取 test/change 文件。
- 非 Classic composition 不继承 Classic allowlist。Snapshot 仍不保存额外 provenance；Browser V1-V3 可靠来源无法判定时的拒绝和中文反馈由独立 Browser 任务负责。

## RED 与根因

1. 初始 predecessor 测试：`4 failed / 5 passed`，失败为 API/严格声明尚未实现；实现后转为 `9/9 PASS`。
2. needs + autonomy 首次合并运行：`1 failed / 10 passed`。autonomy 已到达原 513 actor capacity 拒绝；needs 在 `gameplay-snapshot.ts:383` 报 `Inventory snapshot capacity does not match`。源码与 `d1e692ca` 历史核对证明：V1-V3 使用 target 36/9 `EntityStore` 后直接 `PlayerState.Inventory.replace(legacy 24)`，在 Needs phase 迁移前失败。`playerLayout` 已正确从 `GameplayRuntimeCheckpoint` 传入，不是接线缺失。该通用 V1-V3 24/8 保留语义由 `LEGACY-LAYOUT-CLOSE-01` owner 修复；本任务没有预扩输入或修改其文件。
3. composition checkpoint：`8 passed / 1 failed`。失败的 pre-pointer fixture 使用旧 digest、captured graph、当前资源路径和占位 digest，并把同一 identity 作为 `legacyCompositionIdentity`；旧代码依靠已禁止的 explicit self-approval。Classic 已声明的精确 pre-pointer 为 `05bc5e57.../4a773fe7...`、captured graph、`resources: []`。fixture 由独立 owner改为该精确来源；本任务没有放宽 production guard。
4. validator hardening 首轮：`3 failed / 9 passed`。顶层 predecessor hole+命名属性被静默接受，数组 index getter 被调用，版本 hole+命名属性未在 shape gate 拒绝。改为 descriptor-only 复制后，这三项转 GREEN。
5. identity canonical array 首轮：`1 failed / 12 passed`。`packLock` hole+命名属性可进入 canonicalization；canonical array 分支改为逐索引读取 data descriptor 后转 GREEN，getter 执行计数保持 `0`。
6. version coercion 首轮：`1 failed / 13 passed`。两元素非法 version 数组在严格合法性检查前进入 `sort(Number(...))`，触发恶意 `Symbol.toPrimitive` 一次；改为先用严格恒等检查全部值，再排序已收窄的数字版本后转 GREEN，coercion执行计数保持 `0`。

## 已完成验证

所有重命令分别经默认 `benchmark-window` 全机锁执行，Vitest 固定 `--maxWorkers=1`。

```sh
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec vitest run --config packages/stdlib/vitest.config.ts packages/stdlib/tests/server/gameplay-snapshot-predecessor.test.ts --maxWorkers=1
```

结果：`1 file / 14 tests PASS`。

```sh
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm --filter @seedlands/playbook-classic test playbooks/classic/tests/legacy-composition-lineage.test.ts playbooks/classic/tests/media-declarations.test.ts --maxWorkers=1
```

结果：`2 files / 5 tests PASS`。

```sh
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm --filter @seedlands/web test apps/web/tests/integration/runtime/server/composition/gameplay-registered-needs.test.ts apps/web/tests/integration/runtime/server/autonomy-restore-capacity.test.ts --maxWorkers=1
```

结果：`2 files / 11 tests PASS`。真实 V3 captured lineage 经 `GameServer.restore()` 到达 shared needs phase → per-actor phase 和原 513 actor capacity 拒绝；保存后的 V4 仍保留 legacy 24/8 player layout，不做 Classic padding。使用的通用 layout owner SHA-256 为 `0d1df1e75f11117631dfd99515319602d35cc866983fa1dfabacd287e03ccd2e`。

```sh
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm --filter @seedlands/web test apps/web/tests/integration/runtime/server/composition/gameplay-composition-checkpoint.test.ts --maxWorkers=1
```

结果：`1 file / 9 tests PASS`。精确 pre-pointer、pre-Media、retired actor、current identity及各自 tamper/原子保留断言全部通过；fixture SHA-256 为 `0e51ccba0b628c409e99442c979ec0519a60192626ba1d94af77b15568a1f9bb`。

```sh
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm --filter @seedlands/stdlib typecheck
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm --filter @seedlands/playbook-classic typecheck
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec tsc -p tsconfig.test.json --noEmit
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec tsc -p tsconfig.classic-tests.json --noEmit
```

结果：四条均 PASS；此前 `gameplay-snapshot-predecessor.test.ts` 的 readonly `entryDigest` 与 `modules.pop()` 诊断已通过不可变副本构造关闭。

Targeted ESLint 和 Prettier check 均 PASS。格式检查覆盖本任务全部 production/test/docs 文件；ESLint 覆盖全部 TypeScript owner 文件。

## 证据边界

- 上述测试证明 codec/composed-host 对已知精确 lineage 的恢复、投影与 fail-closed 拒绝。
- 真实 Browser V1-V3 因没有可信 embedded/external provenance仍按独立 Browser 合同拒绝并保留原数据；本证据不证明 Browser 可恢复未知来源旧档。
- 未运行 build、CI、浏览器、dev server、Git commit/push或部署。

## 文件 Manifest

```text
f5e14fdef65c625526dd8ae3f77a33f968b6d0b13eb96e111a4871bfcd74fd75  packages/stdlib/src/server/gameplay/gameplay-snapshot-migration.ts
28f0f781cacb8141b2bb9e2f17371ae6191ebd5c9b34627d498523ab51c89158  packages/stdlib/src/server/composition/checkpoint-identity.ts
55a64e0ede52b7edea305d50969c299d35cb9cce16768baff818c40a732115a1  packages/stdlib/src/server/composition/gameplay-composition.ts
08a121e8b9fe3625a2ac98ed34e06f4b9a8ed188b18c76cc031330cc5dc458b0  packages/stdlib/src/server/composition/mod-api.ts
f3474e3dd1b474581475ad9a90f59f5ac0afbb86a7e2ae8666c8330f70fec1d7  packages/stdlib/tests/server/gameplay-snapshot-predecessor.test.ts
0d1df1e75f11117631dfd99515319602d35cc866983fa1dfabacd287e03ccd2e  packages/stdlib/src/server/gameplay/gameplay-snapshot.ts
6e2473f6e638d62d75ae4a7ba2d69746e3bb8205b85a87eb46bbc7f26717778b  playbooks/classic/src/legacy-composition-identities.ts
8ee779d01af3f564f25c32901d523c446ea26efa456f02ecc2eea64f365ab198  playbooks/classic/src/retired-actors-migration.ts
e597be2579a6296cf2a3a1614c5ed8a21d3bf09b31ba7870dea4ce2e16645aa1  playbooks/classic/tests/legacy-composition-lineage.test.ts
5f014572301ecee20d2b665d8e0ee202d82545d6f058e426d03896de144e167f  apps/web/tests/integration/runtime/server/composition/gameplay-registered-needs.test.ts
33a0bf556de6a37cecf3dc94b3dfe73307bb7126bdea406af8e95c5bfe3d2d02  apps/web/tests/integration/runtime/server/autonomy-restore-capacity.test.ts
0e51ccba0b628c409e99442c979ec0519a60192626ba1d94af77b15568a1f9bb  apps/web/tests/integration/runtime/server/composition/gameplay-composition-checkpoint.test.ts
80e2da63ad78c25094bd631d275157aa9e193f894e01e55f051d6aca43090268  changes/2026-09-23-classic-functional-completion/lineage-contract-amendment.md
d2b98a868fad0f7ba72126e0f2bf97af695fe22cef6f8ff423ae22dc9a0b7611  changes/2026-09-23-classic-functional-completion/legacy-lineage-decision.md
```

本 evidence 自身 SHA-256 在最终格式检查后单独回报。
