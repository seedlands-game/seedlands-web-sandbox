# Classic 退役角色与旧存档迁移证据

日期：2026-09-22。范围仅覆盖 Classic 对 `grazer`、`night-stalker`、`settler` 的退出、定向存档迁移和恢复报告；stdlib 保留通用 actor/NPC 能力，Kernel 没有写入 Classic ID。

## 生产旧身份门槛

- 迁移只接受 V4 中单一 `seedlands:overworld@1.0.0` Pack、精确的旧操作顺序，以及由视觉重构前提交 `0759202cd0efbd6cc23dca4f96f657f70f8879d0` 重建的完整性 receipt：
  - manifest SHA-256：`74d0a1a50d2812053fa442ae00137d285dd6b80954c3e21d788053eb2ec243f2`
  - entry SHA-256：`a0822ae7e3ae985c47db22deee54d77f788a0cd72eece3f4a4c46a4c6037eee6`
- 重建方式：将 `0759202` 置于隔离只读 worktree，复用该提交的 `scripts/build-gameplay-packs.mjs`，执行 `node scripts/benchmark-window.mjs -- zsh -lc 'cd <0759202-worktree> && node scripts/build-gameplay-packs.mjs --out <temporary-output>'`，读取输出 `packs.lock.json`。临时产物未写入仓库。
- 旧 `apps/web/tests/fixtures/npc/main-composition.json` 的 `05bc…/7583…` 是更早 6c7124a fixture，不是本次用户实际使用的 `0759202` 生产 Pack；测试仅复用其冻结的注册图，并替换为上述可验证的生产 receipt。任意其他 Pack receipt 或操作图仍由 composition guard 拒绝。

## 行为与报告

- Classic 不再注册三种退役 profile、不再配置 starter ecology 或 `night-stalker-claw`。
- 精确命中的旧档在 guard 前由 Pack 提供的迁移器克隆后处理：过滤退役实体、autonomy actor、动作、combat、character 引用；保留玩家、背包、其他物种、issued ID 与无关内容。
- 即使旧档中的三个角色都已不存在，精确旧身份仍重投影到当前 composition，并移除遗留 `night-stalker-claw` combat metadata；没有实际删除实体时不产生报告。
- 仅实际删除时，恢复成功后通过 `AuthorityReady.snapshotMigrationReports?: readonly { id: string; removedActorIds: readonly string[] }[]` 传给 Web。输入 snapshot 保持不变，迁移已覆盖幂等的空删除结果。

## 自动化检查

- GREEN：`node scripts/benchmark-window.mjs -- pnpm --filter @seedlands/web test apps/web/tests/integration/runtime/server/composition/gameplay-composition-checkpoint.test.ts --maxWorkers=1 -t 'filters the retired settler|reprojects an exact pre-change|removes only retired Classic'`：3/3 通过。覆盖生产 `0759202` receipt、三种实体与动作/combat 引用过滤、无退役实体的 composition 重投影、旧爪击清理、报告和输入不变。
- GREEN：`node scripts/benchmark-window.mjs -- pnpm --filter @seedlands/stdlib test packages/stdlib/tests/server/server-headless-cli.test.ts --maxWorkers=1`：7/7 通过。覆盖鸡/狼/僵尸的观察与行动，及三个退役 `/summon` 的拒绝。
- 已知独立缺口：完整 checkpoint 文件运行结果为 7 通过、1 失败；失败的既有 pre-pointer 测试在 [gameplay-composition-checkpoint.test.ts](../../apps/web/tests/integration/runtime/server/composition/gameplay-composition-checkpoint.test.ts) 第 109 行读取不存在的 `apps/web/tests/fixtures/checkpoints/base-checkpoint.json.gz`，报 `ENOENT`。该 fixture 缺失不涉及本次迁移断言；上述三条新迁移用例全部 GREEN。
- Browser、生产构建和整库测试由主线程统一执行，本文不把它们记为已通过。
