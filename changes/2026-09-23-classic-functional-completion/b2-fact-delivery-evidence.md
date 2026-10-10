# B2-FACT-01 dependent fact delivery evidence

## Scope

- Exact B2 interface thaw only: `structure-host-commit.ts`, `registered-structure-runtime.ts`, the existing B2 tests, and this evidence file.
- No A1, shared Gameplay/Authority adapter, Media private runtime, Classic Pack, browser, build, CI, Git commit, or push work.
- Structure remains free of durable state. Fact delivery is one prepared aggregate participant per Structure transaction, never a process-global pending queue.

## Frozen contract

- Every `PreparedStructureDependentRemovalV1` has a required `facts: readonly ModuleInvocationValue[]`; no facts is the explicit frozen empty array.
- The host collects at most 64 detached, deeply frozen, plain ModuleInvocation facts across all removals. The bound matches the existing Structure V1 maximum footprint rather than creating an unbounded event surface.
- `prepareFactDelivery(facts, precedingWorldCommit, gameplayRevision)` is mandatory on the host/runtime options. It is prepared after the world receipt and gameplay revision participant exist, but before any participant applies.
- All participants validate before any apply. Apply order is entity, cancellation, removals, world, receipt, gameplay, then fact delivery. Delivery apply only installs the prepared owner state and cannot call an external publisher or allocate fallibly.

## RED design

1. A real GameServer/EntityStore break removes both parts. Each removal contributes a position-bound fact. Exactly one delivery batch must contain both facts and the matching world/gameplay revisions. Its apply assertion fails if canonical voxels, ECS drop/inventory, receipt, or gameplay revision are not already visible.
2. Place/toggle with no dependent facts still prepare and apply one explicit empty batch.
3. A second-removal prepare failure, world validate failure, gameplay validate failure, delivery validate failure, and delivery-capacity failure all leave canonical Structure cells, ECS, receipt, and delivered facts unchanged. One-shot prepare failure followed by a successful retry proves no leaked pending fact state.
4. Source fact mutation after preparation cannot affect the delivered detached/frozen facts. Oversized and non-plain fact input is rejected before apply.

## Initial RED

- Command: `node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec vitest run packages/stdlib/tests/server/registered-structure-runtime.test.ts --maxWorkers=1`.
- Result before the production interface change: `5 failed / 16 passed`. No delivery batch was produced, delivery validate/capacity failures were not observed, and retry had no facts. This directly reproduced the missing owner rather than relying on a type-only RED.

## Final GREEN

- `node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec vitest run packages/stdlib/tests/server/structure-actions-module.test.ts packages/stdlib/tests/server/registered-structure-runtime.test.ts packages/stdlib/tests/server/registered-structure-fact-delivery.test.ts --maxWorkers=1` -> PASS, `3 files / 24 tests`.
- `node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec eslint packages/stdlib/src/server/gameplay/modules/structure-host-commit.ts packages/stdlib/src/server/gameplay/modules/registered-structure-runtime.ts packages/stdlib/tests/server/registered-structure-runtime.test.ts packages/stdlib/tests/server/registered-structure-fact-delivery.test.ts packages/stdlib/tests/server/registered-structure-runtime-fixture.ts packages/stdlib/tests/server/structure-runtime-test-composition.ts packages/stdlib/tests/server/structure-actions-module.test.ts` -> PASS.
- `node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec prettier --check packages/stdlib/src/server/gameplay/modules/structure-host-commit.ts packages/stdlib/src/server/gameplay/modules/registered-structure-runtime.ts packages/stdlib/tests/server/registered-structure-runtime.test.ts packages/stdlib/tests/server/registered-structure-fact-delivery.test.ts packages/stdlib/tests/server/registered-structure-runtime-fixture.ts packages/stdlib/tests/server/structure-runtime-test-composition.ts packages/stdlib/tests/server/structure-actions-module.test.ts changes/2026-09-23-classic-functional-completion/b2-fact-delivery-evidence.md` -> PASS.
- `git diff --check` -> PASS.
- Full `@seedlands/stdlib typecheck` and root `tsconfig.test.json` were run independently under the machine lock but are blocked by the concurrent public installation. The final run reports only root-owned files: `authority-mutation-preparation.ts` missing `prepareBreak` and typed Chunk keys, `authority-player-action.ts` unsafe union `commit`, `gameplay-runtime.ts` mutable/readonly Position mismatch, `registered-block-runtime.ts` stale target-runtime export, and the related A2 tests. No FACT-01 production or test file appears in the diagnostics. The earlier run also exposed the public dependent-removal adapter missing required `facts`; that exact signature was sent to root and disappeared on the final run.

The final real-owner tests prove that two position-bound removal facts are detached, deeply frozen and installed exactly once as one batch. Delivery observes canonical Air in both cells, the ECS drop, the registered commit receipt, and the final gameplay revision before swapping its prepared state. Place produces an explicit empty batch. Second-removal preparation, world validation, gameplay validation, delivery validation, delivery capacity, and the host's 64-fact bound all fail with no Structure canonical/ECS/receipt/fact commit; one-shot failures can retry without leaked pending facts. Fact envelopes also have a 4,096-node, depth-16, 65,536-character/field-name budget and reject accessors, sparse arrays, symbols, non-plain objects, non-finite numbers, and excess cardinality.

Final SHA256 before this evidence update:

- `50120da4c5a0bf06ec755265200d83234fe874ef5cba490e60b49abcd82fa17b` `packages/stdlib/src/server/gameplay/modules/structure-host-commit.ts`
- `36093708af5bca9fa6ca64dd86e73f483a94a991f15f8c0091f2cf30ff15160f` `packages/stdlib/src/server/gameplay/modules/registered-structure-runtime.ts`
- `f65f95b07f598465f51084bab3a981f1ddb9e090d9d02b5f2fbc890214a3d7c5` `packages/stdlib/tests/server/registered-structure-runtime.test.ts`
- `699e44ad93956b10aeddcd058d98dafce8f70380dcf78980537c3f988b0da371` `packages/stdlib/tests/server/registered-structure-fact-delivery.test.ts`
- `23ebc7aa1632f0f73de04b5ba95a015fe18fc0b3c6250a672b5bfd23613a0161` `packages/stdlib/tests/server/registered-structure-runtime-fixture.ts`
- `9ec01a04b69b1c4e13cb53691fe33ae620a605fd844f5ff00a8a27b21fd3e2de` `packages/stdlib/tests/server/structure-runtime-test-composition.ts`

## Shared adapter signature

The root-owned adapter must return `facts` for every removal, including `Object.freeze([])` when no fact exists. A real Media removal maps its already prepared position-bound committed fact to a generic frozen envelope; it must not publish during removal apply.

The root-owned runtime must provide:

```ts
prepareFactDelivery(
  facts: readonly ModuleInvocationValue[],
  precedingWorldCommit: WorldCommitResult,
  gameplayRevision: number,
): PreparedStructureParticipant
```

Preparation must reserve one aggregate delivery replacement without mutating a global pending queue. Validation checks its capacity/frontier. Apply only swaps prepared internal state. Publication/consumption occurs later from that committed owner state. The Structure host always calls it, including for an empty fact batch, and applies it after entity, cancellation, removals, world, receipt, and gameplay participants.
