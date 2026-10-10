# B2 Structure registered runtime evidence

## Scope and stop line

- This checkpoint owns only the new private `structure-*` registered module, state port, host commit, runtime, their directed tests, and this evidence file.
- B1 candidate models and A2 target routing are frozen inputs. A1 world commit, Authority, Web, Classic declarations, Pack assembly, and shared Gameplay runtime/adapters remain owned by the root coordinator.
- This checkpoint proves a private registered-operation chain. It does not claim the Classic door is installed or playable; the existing Classic Authority RED remains the shared integration handoff.
- Structure instances remain encoded only in canonical Chunk voxels. The runtime retains bounded transient commit receipts and no durable Structure state or snapshot child.

## Private interface freeze

- `structure-actions-module.ts` registers one generic Structure resource, actor/voxel projections, and actor `place`, `toggle`, and `break` operations. Operation candidates are B1 plans derived from registered observations. Inputs never contain a definition ID, state ID, orientation, item ID, or operation ID chosen by a client.
- Placement accepts only the canonical hit/adjacent voxel pair. It derives a trusted bearing from that pair plus the authoritative actor position, then calls an injected Pack-owned `placementState(definition, bearing)` policy.
- `structure-state-port.ts` projects the authoritative actor lifetime/mode/selection/inventory and loaded voxel cells. It issues bounded observation receipts and rejects stale or mismatched observation scopes before host preparation.
- `structure-host-commit.ts` re-reads the actor and every B1 footprint/support cell, recomputes the B1 plan, checks registered resource authorization, lifecycle, selection, range, double LOS, support, replaceability, geometry collision, and world expectations, then prepares all participants before any apply.
- `registered-structure-runtime.ts` supplies the state port and a bounded receipt participant only. It owns no door state.
- Dependent Media removal is consumed through a private structural port compatible with `prepareDeviceRemoval(position) -> { removed, ejectedItem, fact, validate, apply }`. Production Media wiring remains a later shared-owner installation.

## RED design

1. Assemble a non-Classic content/geometry/Structure/actions composition and invoke through `createRegisteredOperationRuntime`; prove registered operation ownership and resource authorization, forbidden identity/orientation fields, complete observation scope, and stale actor/world observations.
2. Use a real `GameServer.prepareVoxelEdits` host plus a real `EntityStore`; place a two-cell Structure across y=31/32, toggle from either half, break from either half, migrate a valid legacy pair, and assert one world revision with one changed revision per Chunk.
3. Prove survival consumes exactly one placement item, creative consumes none, break creates one owner-role drop only in survival, and selected durable tool wear/cancellation are included in the prepared entity replacement.
4. Inject capacity, Media participant, cancellation, receipt, selection/lifetime, and world-stale failures. Every failure must leave both Chunk cells/fluid bytes, world/Chunk/gameplay/inventory revisions, actor inventory/tool state, world-item set, Media state, cancellation state, and receipt frontier unchanged.
5. Keep the real Classic Authority four-case test RED until the root-owned shared installation wires the module/runtime, A2 target port, Classic placement policy, and Pack module.

## Evidence log

### Initial RED

- Command: `node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec vitest run packages/stdlib/tests/server/structure-actions-module.test.ts --maxWorkers=1`.
- Result: FAIL, `Cannot find module '../../src/server/gameplay/modules/structure-actions-module'`; `1 failed file / 0 collected tests`. This is the executable pre-implementation RED.
- First real-owner run after the private modules existed: `registered-structure-runtime.test.ts` was `8/8 FAIL`. The chain reached the formal owner boundaries and exposed, in order, an invalid actor projection fixture and a GameServer without the same composition (`Mutation voxel must be a registered voxel id, received 101`). The fixes corrected the fixture/composition; no validator was weakened.

### Final GREEN

- `node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec vitest run packages/stdlib/tests/server/structure-actions-module.test.ts packages/stdlib/tests/server/registered-structure-runtime.test.ts --maxWorkers=1` -> PASS, `2 files / 16 tests`.
- `node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm --filter @seedlands/stdlib typecheck` -> PASS.
- `node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec tsc -p tsconfig.test.json --noEmit` -> PASS.
- `node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec eslint packages/stdlib/src/server/gameplay/modules/structure-actions-module.ts packages/stdlib/src/server/gameplay/modules/structure-state-port.ts packages/stdlib/src/server/gameplay/modules/structure-host-commit.ts packages/stdlib/src/server/gameplay/modules/registered-structure-runtime.ts packages/stdlib/tests/server/structure-actions-module.test.ts packages/stdlib/tests/server/registered-structure-runtime.test.ts` -> PASS.
- `node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec prettier --check packages/stdlib/src/server/gameplay/modules/structure-actions-module.ts packages/stdlib/src/server/gameplay/modules/structure-state-port.ts packages/stdlib/src/server/gameplay/modules/structure-host-commit.ts packages/stdlib/src/server/gameplay/modules/registered-structure-runtime.ts packages/stdlib/tests/server/structure-actions-module.test.ts packages/stdlib/tests/server/registered-structure-runtime.test.ts changes/2026-09-23-classic-functional-completion/b2-structure-runtime-evidence.md` -> PASS.
- `git diff --check` -> PASS.

The real-owner suite proves: four trusted bearings; two-cell y=31/32 cross-Chunk placement with world/gameplay/inventory revision +1 and each changed Chunk revision +1; survival consume; creative catalog place and break with zero inventory/drop; lower/upper toggle and break; single owner-role drop, selected tool wear, and pending-break cancellation; valid legacy pair migration; isolated and three-cell ambiguous legacy rejection; stale selection/lifetime/world; range and double-LOS; cancellation, dependent removal, and receipt-capacity failures with no Structure world/ECS/receipt commit. A failing dependent-removal participant is prepared for each part and all participants validate before the ordered synchronous apply.

Final production/test SHA256:

- `dec0045496d05916df7c791616e19508665e7d021ca1e080bad8f0cf70243844` `packages/stdlib/src/server/gameplay/modules/structure-actions-module.ts`
- `8918c74a336e1fb4f92f54d4d03d93f0e399b981f7b9f7d8ce4f69663640089b` `packages/stdlib/src/server/gameplay/modules/structure-state-port.ts`
- `2996270c388737e88cfad9a102bbec876e3c1995cb26323d604057640dc6dd0b` `packages/stdlib/src/server/gameplay/modules/structure-host-commit.ts`
- `4d3dd9dc83ff6ed2a81682587dcae4416230f54c232310ea258ad5321163137b` `packages/stdlib/src/server/gameplay/modules/registered-structure-runtime.ts`
- `de2108163b0d9c6fbd868a6b43907302f81be14ca1cfa08890d328dada3c9f5f` `packages/stdlib/tests/server/structure-actions-module.test.ts`
- `a24ad117e61f4dbd15b9d61de2924db0bb2e99c3d226464b75b91c794db1911e` `packages/stdlib/tests/server/registered-structure-runtime.test.ts`

Frozen A2/B1 hashes remained unchanged: A2 evidence `3540505e...`, B1 evidence `271420ab...`, B1 model `edd909cf...`, B1 test `6d7fc426...`, Classic policy `40b85524...`, Classic policy test `7a123a42...`.

## Shared one-time wiring handoff

1. `gameplay-registered-adapters.ts`: construct `RegisteredStructureRuntime` only when the three Structure operations/states and Structure/geometry capabilities are present. Pass the existing `EntityStore`, loaded voxel+fluid byte reader, A1 `prepareVoxelEdits`, `simulation.prepareCancellation([actorId], 'slot-changed')`, and Media `prepareDeviceRemoval(position)`. Both dependent ports are mandatory; do not restore no-op fallbacks.
2. `gameplay-module-runtime.ts`: add one optional `structures: RegisteredStatePort` and route only `STRUCTURE_ACTOR_COMPONENT` / `STRUCTURE_VOXEL_COMPONENT` to it. This preserves the one-owner registered transaction rule.
3. `gameplay-runtime.ts`: pass `callbacks.prepareVoxelEdits` and a prepared gameplay-change participant. Required signature is `prepareGameplayChange(inventoryChanged, precedingWorldCommit) -> { revision, validate, apply }`. `validate` must reserve/check the Kernel frontier for the preceding world commit plus one gameplay commit; `apply` synchronously commits the prevalidated gameplay revision/event/inventory statistic without allocating or calling external code. A naked post-world `touch()` is not sufficient.
4. Media integration: expose the existing `RegisteredMediaPlaybackRuntime.prepareDeviceRemoval(position)` instance to the Structure adapter. If Media runtime is intentionally absent for a composition, install an explicit composition-level participant that has proved the targeted cells cannot own Media; do not silently no-op per invocation.
5. A2 target port: `resolve` must use the already prepared target/placement resolver; `invoke` maps target intent to `STRUCTURE_PLACE_OPERATION` (placement item), `STRUCTURE_TOGGLE_OPERATION` (use), or `STRUCTURE_BREAK_OPERATION` (alternate) and sends only `{hit, adjacent}`. It must acknowledge the private receipt by returned world revision. The client still sends no item/operation/definition/state/orientation ID.
6. Classic Pack: install the Structure actions module with `classicWoodenDoorClosedStateForBearing`, `toggle`, replaceable policy, and Classic tool-wear policy. This stage did not edit `pack.ts` or Classic declarations. The four real Classic Authority cases therefore remain the deliberate shared-install RED, not a B2 GREEN claim.

Not executed here: Classic Authority integration, shared Gameplay/Authority installation, Web/browser/build/CI, save/reopen, or Cloudflare preview. These remain root-owned post-B2 work.
