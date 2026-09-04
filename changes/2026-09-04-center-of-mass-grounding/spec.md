# Center-of-mass Grounding

**Status:** Delivered locally

## Context & Goal

The prior partial-support regression removed three of four equal footprint quadrants and therefore did not model normal downward excavation. At an integer player coordinate, the footprint overlaps four voxels; digging the voxel selected directly below the player removes only one quadrant, leaving 75% overlap and satisfying the previous 50% support threshold. This keeps `onGround` armed until WASD moves the footprint and can repeatedly trigger Space.

Complete when removing the voxel beneath the player's horizontal center starts falling without WASD and cannot re-arm jump from neighboring floor overlap.

## Scope & Non-goals

- In scope: reproduce center excavation, correct the support rule, and retain flat-ground/partial-support regressions.
- Non-goals: step climbing, crouching, swept collision, or changing player dimensions.

## Decisions

Use center-of-mass support: downward grounding depends on the voxel below the horizontal player center, while horizontal/body and upward collisions continue using the full AABB. This matches the voxel selected by a downward ray at the player's coordinates. The floating-point contact epsilon from the flat-ground fix remains essential and independent: it prevents a correctly grounded player from being classified as horizontally embedded in the floor.

Retire the previous one-corner regression because it encoded an area-threshold assumption rather than product intent. A centered single-column pillar should support jump-building; the critical inverse case is an empty center with neighboring footprint overlap, which must fall.

## Behaviour

- Given the player center is on a voxel grid boundary and the directly targeted center voxel is removed, When no movement key is pressed, Then falling begins immediately despite neighboring footprint overlap.
- Given the same state, When Space is held, Then neighboring floor voxels cannot re-arm jumping.
- Given an intact flat platform, When walking, Then the player remains grounded and horizontal movement remains unblocked.

## Acceptance & Evidence

- [x] The new Chromium center-excavation regression fails before the production fix and passes after it.
- [x] Deterministic checks, production build, and the full Chromium harness pass.
- [x] `git diff --check` passes.

## Tasks & Current State

1. [done] Reproduce the real center-excavation geometry and capture state.
2. [done] Implement the corrected support rule.
3. [done] Validate and record delivery evidence.

## Delivery Snapshot

Changed paths after rebase: `src/app/main.ts`, `tests/e2e/support/harness.ts`, `tests/e2e/regression/world-play.spec.ts`, the superseded player-support record, and this change record.

Current validation: the center-excavation Playwright regression removes the horizontal-center ground voxel through production `World.edit()`, waits for descent without movement, then verifies that Space cannot re-arm grounding while the player continues falling. `corepack pnpm verify:static`, `corepack pnpm build`, and `corepack pnpm harness` passed on the rebased branch.

Known limitation: the controller remains axis-separated and does not implement step climbing or swept-capsule collision. Center-of-mass grounding intentionally allows a centered pillar to support jump-building while rejecting surrounding-only support.

Git: rebased implementation commit `17abcdd` on `codex/player-ground-collision-integration`; no remote push requested.
