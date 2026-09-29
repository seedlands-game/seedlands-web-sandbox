# A3.2a Authority Geometry Consumer Evidence

日期：2026-09-24
范围：让 Authority collision、placement occupancy、post-commit recovery 三个既有 consumer 接受同一只读 per-instance geometry resolver。

## 冻结接口

```ts
type VoxelGeometryResolver = Pick<VoxelGeometryRegistryV1, 'get'>;
collisionBoxesForVoxel(voxel: number, geometry?: VoxelGeometryResolver): readonly LocalBox[];
new VoxelCollisionWorld(source, requestUnknownChunk?, semantics?, geometry?);
playerOccupiesVoxelShape(player, voxel, voxelId, geometry?);
queueBodyRecoveriesAfterCommit(commit, entities, requestRecovery, geometry?);
```

- Resolver 是实例参数，不存在 global setter 或可重配 singleton。
- descriptor 命中时优先使用其 collision；显式空数组表示 nonblocking，不回退 legacy 整格。
- 未命中或未注入 resolver 时保持旧 `0..88` 静态 geometry 行为。
- unknown/unloaded Chunk 的 synthetic full-cell blocker 位于 descriptor lookup 之前，继续 fail closed。
- 本阶段没有新增 physics owner，也没有修改 GameServer、GameplayRuntime、AuthoritySession、Worker、Web 或 Pack。

## RED

命令：

`node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec vitest run --config packages/stdlib/vitest.config.ts packages/stdlib/tests/server/authority-geometry-consumers.test.ts --maxWorkers=1`

结果：1 file，5 tests collected，3 failed / 2 passed。

- `VoxelCollisionWorld` 对注册 voxel 500 实际返回整格，而非 west-thin box。
- `playerOccupiesVoxelShape` 对 east/open descriptor 仍返回 legacy unknown-ID 整格 overlap。
- `queueBodyRecoveriesAfterCommit` 对 open empty-collision descriptor 仍请求 recovery。
- unknown Chunk synthetic blocker 与未注入 legacy compatibility 两项在 RED 阶段已通过。

## GREEN

1. 新 consumer tests：1 file / 5 tests PASS。
2. 既有回归：`authority-session`、`player-occupancy`、`voxel-model`、`classic-structural-voxel-model`，4 files / 19 tests PASS。
3. Targeted Prettier check：PASS。
4. Targeted ESLint：PASS。
5. `pnpm --dir packages/stdlib typecheck`：PASS。
6. `git diff --check`：PASS。
7. `todo/skip/pending` 与 `as any` 扫描：无命中。

所有 test/typecheck/lint/format 命令均通过 `benchmark-window.mjs --wait-timeout-ms 600000` 全机锁串行执行；Vitest 使用 `--maxWorkers=1`。未运行 build、browser 或 dev server。

## 行为证据

- 同一 storage ID 500 注入 west-thin 与 east-thin registry 时，`VoxelCollisionWorld` 返回不同 AABB；再次读取 first world 未受 second world污染。
- west-thin 与 player AABB overlap，east-thin 不 overlap；open empty collision 明确 nonblocking。
- 相同 collision delta：closed descriptor触发 recovery，open descriptor不触发。
- unknown Chunk 即使注入 open descriptor仍产生 synthetic blockers并请求两个跨界 Chunk。
- 未注入 resolver 时 Lantern/Fence/door 等既有静态 shape tests 全部通过。

## 尚待公共 owner 注入

- `packages/stdlib/src/server/authority/authority-session.ts:85`：构造 `VoxelCollisionWorld` 时传 composition geometry。
- `packages/stdlib/src/server/authority/creative-physics.ts:35`：safe landing 的临时 collision world传同一 resolver。
- `packages/stdlib/src/server/gameplay/modules/block-host-commit.ts:264`：registered placement occupancy 传 resolver。
- `packages/stdlib/src/server/gameplay/modules/block-interaction-runtime.ts:90`：legacy/uncomposed placement可选传 resolver；无 composition 保持默认。
- `packages/stdlib/src/server/authority/authority-runtime.ts:529`：post-commit recovery传 resolver。
- 注入源应由 A3.1 `VOXEL_GEOMETRY_CAPABILITY` 从当前 composition 解析；缺 capability传 `undefined`，不得使用 global registry。

这些 call sites 未获 A3.2a ownership，本阶段没有修改；因此当前证据只证明三个 consumer 在注入后行为正确，不证明 production composition 已完成 geometry 接线。Worker/Web mesh仍属于 A3.2b。

## 文件 SHA-256

- `packages/stdlib/src/world/voxel-model.ts`: `0a3f4c5452d86ff3dff5149fdf34c9fffba4d86e84aed50ba01563064adb8573`
- `packages/stdlib/src/server/authority/voxel-collision-world.ts`: `f0a1aafb9473bd2de09139fd6e8ce6b5ffd5739b1941b9fcdd2d234f0b31e8d9`
- `packages/stdlib/src/server/gameplay/player-occupancy.ts`: `ababa8cca31170aef4d29c965259e08eb00a5eee2518ad99d110a9c11c102a2a`
- `packages/stdlib/src/server/authority/authority-geometry-recovery.ts`: `2d10c91a5a606bc92894c2ad46fc8dd80b65819583787c5414f1a234e12ca513`
- `packages/stdlib/tests/server/authority-geometry-consumers.test.ts`: `3c295b3600d0092c9068efe00f198ab2782b1dc429e6c342592fa5992405899c`

Evidence 文件自身 hash 在 checkpoint 单独报告，避免自引用。
