# A3.2b Web / Worker Geometry Evidence

## Scope

A3.2b carries the bounded `VoxelGeometryDefinitionV1[]` projection through Authority ready and mesh preparation into the existing TypeScript chunk mesher. Item and collision-debug projections accept the same per-world read-only resolver. It does not install the composition capability in `GameServer`, replace the Wasm ABI, or claim browser/WebGL acceptance.

## RED contract

- Authority ready and mesh payloads copy a validated, detached, serializable geometry projection; legacy calls omit it.
- A registered render box suppresses the static cube path and changes real positions, normals, UVs, and material output. An open door still renders its rotated thin box even when its collision list is empty.
- A mesh task rebuilds a registry from the projection before meshing. A malformed projection is rejected before task execution.
- Wasm-selected workers use the existing TypeScript mesher only for tasks with registered geometry; legacy tasks retain the existing kernel selection.
- Item and collision-debug projections use an explicitly supplied resolver. An explicit empty collision list does not fall back to legacy collision.
- Browser Authority ready/restore validates before replacement, rebuilds a per-world registry, forwards geometry with prepared mesh input, and retains the prior world when a replacement projection is malformed.

## GREEN boundary

Targeted Vitest behavior tests, package type checks, ESLint, Prettier, and `git diff --check` run under `scripts/benchmark-window.mjs`. Browser build, WebGL compilation, pixels, Cua, and production composition injection remain later acceptance work.

## Result

### RED

- stdlib: 2 files collected, 4/4 failed. Failures were missing Authority geometry projection and full-cube mesh output instead of registered thin boxes.
- Web/Worker: 3 files collected, 6/6 failed. Failures were missing ready registry, missing mesh/item/debug consumption, and full-cube Worker output. No import, fixture, skip, or collection failure was used as RED evidence.

### GREEN

- `node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec vitest run --config packages/stdlib/vitest.config.ts packages/stdlib/tests/server/authority-geometry-projection.test.ts packages/stdlib/tests/world/voxel-geometry-mesh.test.ts packages/stdlib/tests/server/authority-geometry-consumers.test.ts packages/stdlib/tests/world/mesh.test.ts --maxWorkers=1`: 4 files, 34/34 passed.
- `node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/tests/unit/client/geometry-presentation-consumers.test.ts apps/web/tests/unit/worker/geometry-mesh-task.test.ts apps/web/tests/unit/client/browser-authority-geometry.test.ts apps/web/tests/unit/client/browser-compute-geometry.test.ts apps/web/tests/unit/client/browser-compute-runtime.test.ts apps/web/tests/unit/client/item-mesh-definition.test.ts apps/web/tests/unit/client/collision-debug-projection.test.ts apps/web/tests/unit/worker/compute-worker-task.test.ts apps/web/tests/unit/worker/data-plane-adapter.test.ts apps/web/tests/unit/app/browser-world-restore.test.ts --maxWorkers=1`: 10 files, 42/42 passed.
- `node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm --filter @seedlands/stdlib typecheck`: passed.
- `node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm --filter @seedlands/web typecheck`: passed, including `svelte-check` with 0 errors and 0 warnings.
- Targeted ESLint and Prettier checks: passed. `git diff --check`: passed.
- No build, browser, dev server, commit, or push was run.

### A3.2b-TYPES closure

- Initial root `tsconfig.test.json` check found four attributable errors: `authority-geometry-projection.test.ts:30` and `voxel-geometry-mesh.test.ts:9,20` used `Array(6).fill(...)` casts that did not prove a six-element readonly tuple; `authority-geometry-projection.test.ts:76` cast a readonly geometry vector to `number[]` for the detached-copy assertion.
- The fixtures now use explicit six-element tuples and a structurally compatible mutable source type. No `any`, double assertion, or production-interface change was introduced.
- Final `node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec tsc -p tsconfig.test.json --noEmit --pretty false` reports no A3/geometry errors. It remains nonzero only for eight out-of-scope `packages/stdlib/tests/server/inventory-pointer-model.test.ts` sites (`84,94,131,149,176,255,277,283`) missing `cursor.craftingGrid`. No A1 error appeared in this final run.
- The two changed tests were rerun under the machine lock: 2 files, 5/5 passed. Targeted ESLint, Prettier, and `git diff --check` passed.

### Behavior evidence

- Registered geometry suppresses the static cube/model path and drives actual positions, normals, UVs, materials, AO occlusion, item geometry, and target collision-debug lines. Registered empty collision remains nonblocking while its open, rotated render box remains visible.
- Classic `89` closed north and `91` open north produce different thin-box axes with 36 indices and complete normal/UV arrays. Legacy geometry and old messages without `voxelGeometry` retain their existing behavior.
- Authority output, Browser ready, mesh preparation, Browser compute enqueue, and Worker execution all rebuild the strict registry and verify geometry against the accompanying voxel semantics before state/cache/task replacement.
- Mesh preparation must equal the active ready projection. A valid descriptor from another composition is rejected before canonical/collision cache mutation. Restore clears old prepared inputs and replaces the ready-bound registry only after validation.
- Wasm selection falls back to the existing TypeScript `meshChunk` only for tasks carrying custom geometry. It does not mark Wasm memory failed or disable Wasm for later legacy tasks.
- Item mesh caches are partitioned by resolver identity. Collision debug consumes the current Authority resolver each frame. No global geometry setter was added.

## Frozen interfaces

- Protocol: `AuthorityReady.voxelGeometry?` and `AuthorityMeshPayload.voxelGeometry?` are bounded `readonly VoxelGeometryDefinitionV1[]` projections.
- Rendering: `MeshOptions.geometry?: VoxelGeometryResolver`; `modelBoxesForVoxel(voxel, geometry?)`; `forEachVoxelGeometryFace(voxel, cell, visit, geometry?)`; `forEachVoxelModelFace(data, visit, geometry?)`.
- Presentation: `itemMeshDefinition(voxel, faceMaterials?, geometry?)`; `CollisionDebugProjectionOptions.voxelGeometry?`; `BrowserAuthorityClient.voxelGeometry`.
- Validation: `validateVoxelGeometrySemantics(semantics, geometry)` is the shared closure check.
- Scheduling: `WorkerInput.voxelGeometry?`; `MeshTaskPayload.voxelGeometry?`; `GenerateMeshTaskPayload.voxelGeometry?`. Geometry participates in the per-task revision identity and is not transferred or detached.

## Required public integration by 954

1. Install `classicStructureDefinitionModule` and the A3.1 Classic geometry module in `playbooks/classic/src/pack.ts`; no production composition currently exposes the geometry capability.
2. Read `VOXEL_GEOMETRY_CAPABILITY` once from the assembled composition in `apps/web/src/worker/authority-worldgen-runtime.ts`, retain the registry/projection per prepared world, and pass it through an optional `AuthorityRuntimeOptions` field.
3. In `packages/stdlib/src/server/authority/authority-runtime.ts`, pass that projection to both `projectAuthorityReady(...)` and `prepareAuthorityMeshPayload(...)`. These are the only two Authority protocol emission points.
4. Pass the same resolver to `VoxelCollisionWorld` in `authority-session.ts`, `playerOccupiesVoxelShape` in block interaction/commit paths, and `queueBodyRecoveriesAfterCommit` in `authority-runtime.ts`, as frozen by A3.2a.
5. Pass `world.authority.voxelGeometry` as the fourth argument of the client `VoxelCollisionWorld` in `apps/web/src/app/player/player-controller.ts`.

`apps/web/src/app/gameplay/browser-gameplay.ts` is owned concurrently by 761. Before ownership was clarified, this stage added only the optional `BrowserGameplayAuthorityPort.voxelGeometry` field and forwarded it to `GameplayEntityPresenter` and `FirstPersonViewmodel`. Those exact lines must be reconciled by root/954 with 761's A2 hunk; this worker did not revert or further edit the file after the clarification.

## Remaining acceptance

- Production composition injection and Classic Pack installation are not complete in this checkpoint, so the browser does not yet receive `89..104` descriptors in a real session.
- WebGL compilation, pixels, Cua, save/reopen, and the complete door interaction journey remain V1.9/B acceptance. Unit behavior here is not called playable evidence.
- The legacy static `0..88` model table remains the compatibility fallback and was not globally rewritten.

## File SHA-256

The final hashes below exclude this evidence file itself; its hash is reported in the checkpoint after the file is closed.

```text
b2f846ee7f5f3b11816f946760e51bcdb4415bddddeb71acf178159263512106  packages/stdlib/src/server/protocol/authority-worker-protocol.ts
888f7ab102816621171cd2f2508f0474e8fc8483bb9975ca9ee529e26a709f04  packages/stdlib/src/server/authority/authority-ready.ts
efbb4fa4068edd5d543276a28eeab7e045e621cf19cee1d9f2fe7d3a35cf17ff  packages/stdlib/src/server/authority/authority-mesh-payload.ts
37ad19381a4d66d5b255007dde386293ad8d12f7266c7b3f042b962a50a838ea  packages/stdlib/src/server/compute/world-compute-task.ts
1d7c69be2ca23ad1d1706f51fef2559471560aea37725800c97996cd969e406f  packages/stdlib/src/world/mesh.ts
1f97df0f4ee49a60397f66828820b870536585871abda3ce2ecf07140d00fb9c  packages/stdlib/src/world/mesh-semantics.ts
92ca5ad6ee22f4cf98c0a9d8a7420cba7ad5426fee1b354c08e3229d7111ccd7  packages/stdlib/src/world/voxel-model.ts
b57e75910efd2767516543dc839b734b94c6b41680a5c4e98991314e0eb6c72e  packages/stdlib/src/world/voxel-model-mesh.ts
85b6ba6d078bf2fcf9f5009553e20031dcd681ff21c322404de60da2c898dfea  packages/stdlib/tests/server/authority-geometry-projection.test.ts
fcf8ffb6fc156886a3100b9dd088dfd76ec974e88bd6cc49f6a8fc595c5c638d  packages/stdlib/tests/world/voxel-geometry-mesh.test.ts
bc49fddca041a21bf77262853cc51383a0486898c2f0b0e672841f2157ffaa7d  apps/web/src/worker/world-kernel-adapter.ts
4d7599eddfd2fcf8fec605cb35681498dcad6a9e2edefa4b3b693d0cba73bfaa  apps/web/src/app/world/mesh-task-dispatch.ts
7c51f7d0bbb74f136499c001c100dd045c256bd66018a95e95f26ba3cd1351d2  apps/web/src/app/world/world-authority-port.ts
67c82ac99597266c52a1f922867efab8bb024e7e10adea2b06022cd14b3d0c7d  apps/web/src/client/authority/browser-authority-geometry.ts
5ea339039b1567ea606fd3351a5bbc440096d94b2cad289d7729be12177994df  apps/web/src/client/authority/authority-mesh-preparation.ts
1da5d67b525910a66399f31a65f16db689993509cb7f35b46da50ad9251154d9  apps/web/src/client/authority/browser-authority-chunk-client.ts
0f3e2bd0a61fbd33f09702638dd8620e9d511b0b222d93d37be6a0280a628300  apps/web/src/client/compute/browser-compute-runtime.ts
55603493d8b2d9f2db31e655b0b90012471bcd9ababfb7f5aac14c6697a4782b  apps/web/src/client/authority/browser-authority-client.ts
aa53016c15b52e957ba363353341404d85b745ec8fb0bd725e66ff3fe9a809b2  apps/web/src/client/presentation/item-mesh-definition.ts
b05ca025936c643eac476345b191a9a1a07060665c7d258633f36d4524c5f01b  apps/web/src/client/presentation/collision-debug-projection.ts
72a5f0789f723421231c7cf2585155c7a5af0dd9e65921e17dbd1f62c5e79c17  apps/web/src/app/gameplay/gameplay-model-assets.ts
8ed97c809413c558cf7ae562b594b4e6a2f025efd3a71a4c6382402a05193d49  apps/web/src/app/gameplay/gameplay-entity-presenter.ts
90f4ade78633b730a8cc56a0a6dfac4c19a3a3f0b66429360609702f31334695  apps/web/src/app/player/first-person-viewmodel.ts
7596cdbcc1eaefeb4f920508e1659285f162c2603aae65f7b7174c9e5b721f9b  apps/web/src/app/gameplay/browser-gameplay.ts
3a5a67489fd23d2962810e97cb7aae77d0f4bbd8bf3b5cae30241d6ef8d244b6  apps/web/src/app/player/collision-debug-runtime.ts
732e3e9e27829f6c841e5420eb52fdb1ba29c5bc928374dd61d6528d441c3e42  apps/web/src/app/game-frame-loop.ts
fa1cb932a1eab2efc5a7560bbc36fad35da0f8b7c9bd823d4a7ce0c105e001b2  apps/web/tests/unit/client/geometry-presentation-consumers.test.ts
1d8b81a102e9c7921b55e2d8b09aa9b7937f370ad8aa44057a4d36296057fb0b  apps/web/tests/unit/worker/geometry-mesh-task.test.ts
c3264a8557edd9fb1577929d9095feb2f232d2abbb64875eb6cacd5f0f72da74  apps/web/tests/unit/client/browser-authority-geometry.test.ts
9101636b07fdba6e5839b96f844fbb8dfc0745a2e272eda62ac7db321d8be13e  apps/web/tests/unit/client/browser-compute-geometry.test.ts
```
