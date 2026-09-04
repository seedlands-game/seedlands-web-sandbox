# Step-down Stall Recovery

**Status:** Delivered locally

## Context & Goal

Stepping down could settle the player on the lower floor while the rear of the AABB still intersected the former upper ledge. The controller then rejected reverse or sideward input that increased the existing overlap, leaving the player stuck. Complete when the controller restores a non-overlapping position at the lower level and immediate reverse input remains usable.

## Scope & Non-goals

- In scope: horizontal depenetration after a downward collision snap and a deterministic browser regression for immediate reversal.
- Non-goals: step climbing, slopes, a general physics-engine migration, or changing center-of-mass grounding.

## Decisions

Keep center-of-mass grounding unchanged. When a downward snap creates body overlap, derive axis-aligned exit candidates from the intersecting voxels, choose the shortest candidate that fully clears the AABB, and apply it before the next input frame. This resolves an invalid state without allowing reverse input to pass through the old ledge.

## Behaviour

- Given a player crossing from an upper platform to a one-voxel-lower platform, When downward motion snaps them to the lower floor while the old ledge overlaps the body, Then the controller clears the horizontal overlap before the next frame.
- Given that same transition, When forward input is released and reverse input starts immediately, Then the player moves in the reverse direction at the lower height and is not colliding.
- Given neighboring floor cells around an excavated center cell, When the center-support rule is absent, Then the player still falls; horizontal depenetration is only used after a downward collision snap.

## Acceptance & Evidence

- [x] The immediate-reversal Playwright regression reproduces the previous stall and passes with the recovery.
- [x] Static verification, the full Chromium harness, and production build pass.
- [x] `git diff --check` passes.

## Tasks & Current State

1. [done] Reproduce the stalled lower-floor state and identify the horizontal rejection rule.
2. [done] Add post-snap horizontal depenetration and the immediate-reversal regression.
3. [done] Run required verification and record results.

## Delivery Snapshot

Changed paths: `src/app/main.ts`, `tests/e2e/regression/world-play.spec.ts`, and this change record.

Validation passed on `codex/sync-main-quality-e2e`:

- `corepack pnpm verify:static`: Prettier, ESLint, ls-lint, TypeScript, and 30 Vitest tests passed; `src/world/**` line coverage was 94.56%.
- `corepack pnpm test:e2e:regression`: 8 Chromium regression tests passed, including immediate reversal after stepping down.
- `corepack pnpm harness`: 30 unit tests, production build, and 9 Chromium cases (including the benchmark sample) passed; browser E2E and benchmark aggregation both reported `PASS`.
- `git diff --check`: passed.

Known limitation: collision remains axis-separated and does not add swept high-speed collision or upward step climbing. If no horizontal exit candidate completely clears the body, normal horizontal rejection remains in force rather than moving the player through voxels.
